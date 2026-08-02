import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { CapabilitySubject } from '../../../src/lib/product-catalog'
import type { LicenseConfig, OptimizeEstimateBucket, OptimizeResult } from "../../../src/lib/types";
import { SCENARIO_VARIABLE_SHIFT_CANDIDATE_LIMIT } from '../../../src/lib/scenario-comparison';
import type { OptimizationFailureSnapshot, OptimizationJobListItem, OptimizationJobListResponse, OptimizationJobSnapshot } from "../../../src/lib/optimization-contracts";
import { getScheduleGenerateDurationStatsByBucket, recordUsageEvent } from "../../handlers/usage-stats";
import { getProfileForUser, normalizeProfileKind } from "../../storage/user-store";
import { requireUserSession } from "../../handlers/user-auth";
import { getOptimizeJobStore, OptimizeJobAdmissionError, type OptimizeJobPriority, type OptimizeJobRecord, type OptimizeJobStore } from "../../storage/optimize-job-store";
import { requestOptimizeJobCancellation, requestOptimizeJobProcessing } from "../../optimize-job-signals";
import { isOptimizeEstimateOverdue } from "../../optimize-estimate";
import type { OptimizeDurationEstimate, OptimizeRuntimeEstimate, OptimizationJobPayload, OptimizeJobSource } from './shared';
import { OPTIMIZE_ESTIMATE_FALLBACK_MS, OPTIMIZE_ESTIMATE_MIN_MS, OPTIMIZE_ESTIMATE_MIN_SAMPLES, OPTIMIZE_ESTIMATE_HISTORY_DAYS } from './shared';
import { jsonResponse } from './http-core';
import { prepareOptimizeJob } from './prepare-job';
import { getServiceLifecycleState } from '../../lifecycle';
import { getSecretKeyring } from '../../handlers/license-utils';
import { getOptimizeJobHardTimeoutMs } from '../../optimize-job-config';
import { recordRequestBehaviorEvent } from '../../behavior-risk/service';
import { getRequestClientIp } from '../../security/client-ip';
import { stableJsonStringify } from '../../security/request-validation';
import {
  PersonalUseDeclarationRequiredError,
  recordPersonalUseDeclarationUsage,
} from '../../storage/personal-use-declaration-store';
import { resolveProfileAuthorization } from '../../handlers/profile-authorization'
import { projectOptimizeResultForCapabilities } from '../../../src/lib/optimize-result-projection'

export async function submitOptimizationJob(req: Request): Promise<Response> {
  const lifecycleState = getServiceLifecycleState();
  if (lifecycleState === 'draining' || lifecycleState === 'stopped') {
    const response = jsonResponse({ error: '服务正在重启或排空任务，请稍后重试。', code: 'service_draining' }, 503)
    response.headers.set('Retry-After', '60')
    return response
  }
  const idempotencyKey = normalizeIdempotencyKey(req.headers.get('Idempotency-Key'));
  if (!idempotencyKey) return jsonResponse({ error: '缺少或无效的 Idempotency-Key。', code: 'idempotency_key_required' }, 400);
  const rawRequestBody = await req.clone().text()
  const requestHash = hashOptimizationRequest(rawRequestBody)
  const legacyRequestHash = createHash('sha256').update(rawRequestBody).digest('hex')
  const store = getOptimizeJobStore();
  try {
    const replayed = await findEarlyIdempotentJob(req, rawRequestBody, idempotencyKey, requestHash, legacyRequestHash)
    if (replayed) return acceptedOptimizationJobResponse(replayed)
  } catch (error) {
    if (error instanceof OptimizeJobAdmissionError) {
      return jsonResponse({ error: error.message, code: error.code }, error.status)
    }
    throw error
  }
  const preparedResult = await prepareOptimizeJob(req);
  if (!preparedResult.ok) return preparedResult.response;

  const prepared = preparedResult.prepared;
  const preparedPayload = prepared.payload as { activeProfileId?: string | null; isPreviewTrial?: boolean };

  try {
    if (prepared.personalUseAudit) {
      await recordPersonalUseDeclarationUsage({
        userId: prepared.personalUseAudit.userId,
        profileId: prepared.personalUseAudit.profileId,
        action: 'optimization_generate',
        clientIp: getRequestClientIp(req),
      });
    }
    const admissionInput = {
      id: randomUUID(),
      priority: prepared.priorityValue,
      owner_key: prepared.ownerKey,
      profile_id: preparedPayload.activeProfileId ?? null,
      permission: prepared.permission,
      source: prepared.source,
      payload_json: prepared.payload,
      idempotency_key: idempotencyKey,
      request_hash: requestHash,
      legacy_request_hash: legacyRequestHash,
      free_profile_id: shouldReserveFreeScheduleEntitlement(prepared.source, preparedPayload.isPreviewTrial)
        ? preparedPayload.activeProfileId ?? null
        : null,
      reward_user_id: prepared.rewardUserId ?? null,
      use_priority_coupon: prepared.usePriorityCoupon === true,
      reward_item_codes: prepared.rewardItemCodes ?? [],
      billing: prepared.billing ?? null,
    };
    // Third-party test stores predating atomic admission remain read-only test
    // doubles; production and the built-in memory store always implement admitJob.
    const admitted = typeof (store as Partial<typeof store>).admitJob === 'function'
      ? await store.admitJob(admissionInput)
      : { job: await store.createJob(admissionInput), replayed: false };

    requestOptimizeJobProcessing();
    if (!admitted.replayed && (prepared.source === 'account_profile' || prepared.source === 'free_preview')) {
      if (prepared.behaviorIdentity) {
        void recordRequestBehaviorEvent({
          req,
          eventType: 'job_submit',
          userId: prepared.behaviorIdentity.userId,
          sessionTokenHash: prepared.behaviorIdentity.sessionTokenHash,
          profileId: admitted.job.profile_id,
          jobId: admitted.job.id,
          eventKey: `job-submit:${admitted.job.id}`,
        }).catch((trackingError) => {
          console.warn('optimization job submit behavior event skipped:', trackingError)
          return false
        });
      }
    }

    return acceptedOptimizationJobResponse(admitted.job)
  } catch (error) {
    if (error instanceof PersonalUseDeclarationRequiredError) {
      return jsonResponse({ error: error.message, code: error.code }, error.status);
    }
    if (error instanceof OptimizeJobAdmissionError) {
      if (prepared.billing && (error.code === 'insufficient_balance'
        || error.code === 'commercial_queue_capacity_exceeded'
        || error.code === 'commercial_submission_rate_exceeded')) {
        await recordUsageEvent('metered_billing', {
          status: 'failure',
          reason_code: error.code,
          source: prepared.billing.quote.billing_kind,
        }, `admission:${requestHash}:${error.code}`).catch((trackingError) => {
          console.warn('metered billing admission metric skipped:', trackingError)
        });
      }
      return jsonResponse({ error: error.message, code: error.code }, error.status);
    }
    throw error;
  }
}

async function findEarlyIdempotentJob(
  req: Request,
  rawRequestBody: string,
  idempotencyKey: string,
  requestHash: string,
  legacyRequestHash: string,
): Promise<OptimizeJobRecord | null> {
  const store = getOptimizeJobStore()
  if (typeof (store as Partial<OptimizeJobStore>).findIdempotentJob !== 'function') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(rawRequestBody)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const identity = (parsed as Record<string, unknown>).identity
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) return null
  const profileId = (identity as Record<string, unknown>).profileId
  if (typeof profileId !== 'string' || !profileId) return null
  const auth = await requireUserSession(req)
  if (!auth || !await getProfileForUser(auth.user.id, profileId)) return null
  return store.findIdempotentJob(`profile:${profileId}`, idempotencyKey, requestHash, legacyRequestHash)
}

async function acceptedOptimizationJobResponse(job: OptimizeJobRecord): Promise<Response> {
  return jsonResponse({
    job: await buildOptimizeJobAccepted(job),
    ...(!job.owner_key.startsWith('profile:') && { pollToken: createOptimizeJobPollToken(job) }),
  }, 202)
}

function hashOptimizationRequest(rawRequestBody: string): string {
  let canonical = rawRequestBody
  try {
    canonical = stableJsonStringify(JSON.parse(rawRequestBody))
  } catch {
    // The request validation layer will return the stable malformed-body response.
  }
  return createHash('sha256').update(canonical).digest('hex')
}

export function shouldReserveFreeScheduleEntitlement(
  source: OptimizeJobSource,
  isPreviewTrial: boolean | undefined,
): boolean {
  return source === 'free_preview' && isPreviewTrial !== true;
}

function normalizeIdempotencyKey(value: string | null): string | null {
  const key = value?.trim() ?? '';
  return key && key.length <= 200 ? key : null;
}

export async function getOptimizationJob(req: Request, rawJobId: string): Promise<Response> {
  const jobId = rawJobId.trim();
  if (!jobId) return jsonResponse({ error: '缺少任务 ID。' }, 400);

  const store = getOptimizeJobStore();
  const job = await store.getJob(jobId);
  if (!job) return jsonResponse({ error: '任务不存在。' }, 404);

  const access = await canReadOptimizeJob(req, job);
  if (!access.ok) return jsonResponse({ error: access.message }, access.status);

  const queuePosition = await store.getQueuePosition(job.id);
  return jsonResponse(projectOptimizeJobSnapshot(
    formatOptimizeJobStatus(job, queuePosition),
    access.subject,
  ));
}

export async function listOptimizationJobs(req: Request): Promise<Response> {
  const auth = await requireUserSession(req)
  if (!auth) return jsonResponse({ error: '请先登录后查看任务列表。' }, 401)
  const url = new URL(req.url)
  const profileId = url.searchParams.get('profile_id')?.trim() ?? ''
  if (!profileId) return jsonResponse({ error: '缺少 profile_id。' }, 400)
  const profile = await getProfileForUser(auth.user.id, profileId)
  if (!profile) return jsonResponse({ error: '无权查看该任务列表。' }, 403)
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') ?? 50) || 50))
  const rawBefore = url.searchParams.get('before')?.trim() || null
  const before = rawBefore ? decodeOptimizationJobCursor(rawBefore) : null
  if (rawBefore && !before) return jsonResponse({ error: '无效的任务分页游标。', code: 'invalid_cursor' }, 400)
  const store = getOptimizeJobStore()
  const jobs = await store.listJobsByProfile(profileId, limit + 1, before)
  const page = jobs.slice(0, limit)
  const response: OptimizationJobListResponse = {
    jobs: page.map(({ job, queuePosition }) => toOptimizationJobListItem(
      formatOptimizeJobStatus(job, queuePosition),
    )),
    nextCursor: jobs.length > limit && page.at(-1)
      ? encodeOptimizationJobCursor(page.at(-1)!.job)
      : null,
  }
  return jsonResponse(response)
}

function toOptimizationJobListItem(snapshot: OptimizationJobSnapshot): OptimizationJobListItem {
  if (snapshot.status === 'succeeded') {
    const { result: _result, ...summary } = snapshot
    return {
      ...summary,
      resultAvailable: true,
      ...(snapshot.kind === 'schedule' && { historyResultId: snapshot.id }),
    }
  }
  return { ...snapshot, resultAvailable: false }
}

export async function cancelOptimizationJob(req: Request, rawJobId: string): Promise<Response> {
  const jobId = rawJobId.trim()
  if (!jobId) return jsonResponse({ error: '缺少任务 ID。' }, 400)
  const store = getOptimizeJobStore()
  const current = await store.getJob(jobId)
  if (!current) return jsonResponse({ error: '任务不存在。' }, 404)
  const access = await canReadOptimizeJob(req, current)
  if (!access.ok) return jsonResponse({ error: access.message }, access.status)
  if (current.status !== 'queued' && current.status !== 'running') {
    return jsonResponse({ error: '任务已经结束，无法取消。', code: 'job_not_cancellable' }, 409)
  }
  const cancelled = await store.requestCancel(jobId)
  if (!cancelled) return jsonResponse({ error: '任务不存在。' }, 404)
  requestOptimizeJobCancellation(jobId)
  return jsonResponse(
    { job: formatOptimizeJobStatus(cancelled, await store.getQueuePosition(jobId)) },
    cancelled.status === 'cancelled' ? 200 : 202,
  )
}

async function canReadOptimizeJob(
  req: Request,
  job: OptimizeJobRecord,
): Promise<{ ok: true; subject: CapabilitySubject } | { ok: false; status: number; message: string }> {
  const profileId = job.profile_id
    ?? (job.owner_key.startsWith('profile:') ? job.owner_key.slice('profile:'.length) : null)
  if (!profileId) {
    const token = req.headers.get('X-Optimize-Job-Token')?.trim() ?? '';
    return verifyOptimizeJobPollToken(job, token)
      ? { ok: true, subject: getJobCapabilitySubject(job) }
      : { ok: false, status: 403, message: '缺少或无效的任务查询凭据。' };
  }
  const auth = await requireUserSession(req);
  if (!auth) return { ok: false, status: 401, message: '请先登录后查看任务状态。' };
  const profile = await getProfileForUser(auth.user.id, profileId);
  if (!profile) return { ok: false, status: 403, message: '无权查看该任务。' };
  const authorization = await resolveProfileAuthorization(profile)
  if (!authorization.ok) return { ok: false, status: authorization.status, message: authorization.message }
  return {
    ok: true,
    subject: { kind: normalizeProfileKind(profile), permission: authorization.permission },
  };
}

export async function buildOptimizeJobAccepted(job: OptimizeJobRecord): Promise<OptimizationJobSnapshot> {
  const queuePosition = await getOptimizeJobStore().getQueuePosition(job.id);
  const estimate = getOptimizeJobEstimate(job);
  const runtimeEstimate = getOptimizeRuntimeEstimate(job, queuePosition, estimate);
  return projectOptimizeJobSnapshot(
    formatOptimizationJobSnapshot(job, queuePosition, estimate, runtimeEstimate),
    getJobCapabilitySubject(job),
  );
}

function getJobCapabilitySubject(job: OptimizeJobRecord): CapabilitySubject {
  return {
    kind: job.source === 'free_preview' ? 'free_preview' : undefined,
    permission: job.permission,
  }
}

function projectOptimizeJobSnapshot(
  snapshot: OptimizationJobSnapshot,
  subject: CapabilitySubject,
): OptimizationJobSnapshot {
  if (snapshot.status !== 'succeeded' || snapshot.kind !== 'schedule') return snapshot
  return {
    ...snapshot,
    result: projectOptimizeResultForCapabilities(snapshot.result, subject),
  }
}

function formatOptimizeJobStatus(job: OptimizeJobRecord, queuePosition: number | null): OptimizationJobSnapshot {
  const estimate = getOptimizeJobEstimate(job);
  const runtimeEstimate = getOptimizeRuntimeEstimate(job, queuePosition, estimate);
  return formatOptimizationJobSnapshot(job, queuePosition, estimate, runtimeEstimate);
}

function formatOptimizationJobSnapshot(
  job: OptimizeJobRecord,
  queuePosition: number | null,
  estimate: OptimizeDurationEstimate,
  runtimeEstimate: OptimizeRuntimeEstimate,
): OptimizationJobSnapshot {
  const status = job.status === 'running' ? 'running' : job.status;
  const upgradeSuggestions = getUpgradeSuggestionIntent(job);
  const base = {
    id: job.id,
    status: job.status === 'running' ? 'running' : 'queued',
    kind: getOptimizeJobKind(job),
    source: job.source,
    priority: { kind: formatJobPriority(job), label: formatJobPriorityLabel(job) },
    queuePosition,
    pollAfterMs: getOptimizePollAfterMs(job.status, queuePosition),
    timestamps: {
      submittedAt: job.created_at,
      ...(job.started_at !== undefined && { startedAt: job.started_at }),
      ...(job.finished_at !== undefined && { finishedAt: job.finished_at }),
      nextAttemptAt: job.next_attempt_at,
      cancelRequestedAt: job.cancel_requested_at,
      stageUpdatedAt: job.stage_updated_at,
    },
    estimate: {
      durationMs: estimate.estimated_duration_ms,
      bucket: estimate.estimate_bucket,
      source: estimate.estimate_source,
      sampleCount: estimate.estimate_sample_count,
      remainingMs: runtimeEstimate.estimated_remaining_ms,
      totalMs: runtimeEstimate.estimated_total_ms,
      phase: runtimeEstimate.estimate_phase,
      updatedAt: runtimeEstimate.estimate_updated_at,
    },
    executionPhase: getOptimizeExecutionPhase(job),
    calculationStage: job.execution_stage,
    upgradeSuggestions,
    attemptCount: job.attempt_count,
    failureCount: job.failure_count,
    cancellationRequested: Boolean(job.cancel_requested_at),
    canCancel: job.status === 'queued' || job.status === 'running',
    canRetry: canRetryOptimizeJob(job),
    billing: job.billing_json,
  };
  if (status === 'succeeded') {
    return {
      ...base,
      status,
      result: job.result_json as OptimizeResult,
      ...(getOptimizeJobKind(job) === 'schedule' && { historyResultId: job.id }),
    };
  }
  if (status === 'failed') {
    return {
      ...base,
      status,
      error: formatOptimizationFailure(job, status),
    };
  }
  if (status === 'cancelled' || status === 'dead_lettered') {
    return { ...base, status, error: formatOptimizationFailure(job, status) }
  }
  return { ...base, status };
}

function getOptimizePollAfterMs(status: string, queuePosition?: number | null): number {
  if (status !== 'queued') return 1_500
  const position = Math.max(1, queuePosition ?? 1)
  return Math.min(10_000, 2_000 + position * 250)
}

function getUpgradeSuggestionIntent(job: OptimizeJobRecord): { requested: boolean; allowed: boolean } {
  const payload = job.payload_json && typeof job.payload_json === 'object' && !Array.isArray(job.payload_json)
    ? job.payload_json as Record<string, unknown>
    : {}
  const request = payload.request && typeof payload.request === 'object' && !Array.isArray(payload.request)
    ? payload.request as Record<string, unknown>
    : {}
  return {
    requested: request.include_upgrade_suggestions === true,
    allowed: request.upgrade_suggestions_allowed === true,
  }
}

function getOptimizeJobKind(job: OptimizeJobRecord): 'schedule' | 'scenario_comparison' | 'reorder_check' {
  const payload = job.payload_json && typeof job.payload_json === 'object' ? job.payload_json as Record<string, unknown> : {}
  if (payload.kind === 'scenario_comparison') return 'scenario_comparison'
  if (payload.kind === 'reorder_check') return 'reorder_check'
  return 'schedule'
}

function getOptimizeExecutionPhase(job: OptimizeJobRecord): 'initial_queue' | 'retry_wait' | 'executing' | 'settling' | 'terminal' {
  if (job.status === 'running') return job.cancel_requested_at ? 'settling' : 'executing'
  if (job.status === 'queued') return job.attempt_count > 0 || job.failure_count > 0 ? 'retry_wait' : 'initial_queue'
  return 'terminal'
}

function formatOptimizationFailure(
  job: OptimizeJobRecord,
  status: 'failed' | 'cancelled' | 'dead_lettered',
): OptimizationFailureSnapshot {
  const code = job.public_error_code || (status === 'cancelled'
    ? 'cancelled_by_user'
    : status === 'dead_lettered' ? 'execution_retries_exhausted' : 'optimization_failed')
  const retryable = code === 'queue_expired' || code === 'execution_retries_exhausted' || code === 'cancelled_by_user'
  const recoveryAction = code === 'application_error'
    ? 'review_input'
    : status === 'dead_lettered' ? 'contact_support' : retryable ? 'retry' : 'contact_support'
  return {
    code,
    message: job.error_message || (status === 'cancelled' ? '任务已取消。' : '优化任务失败，请重试。'),
    retryable,
    recoveryAction,
    ...(job.failure_kind && { failureKind: job.failure_kind }),
    attemptCount: job.attempt_count,
    supportReference: `OPT-${job.id.slice(0, 8).toUpperCase()}`,
  }
}

function canRetryOptimizeJob(job: OptimizeJobRecord): boolean {
  if (job.status !== 'failed' && job.status !== 'dead_lettered') return false
  return formatOptimizationFailure(job, job.status).retryable
}

export function encodeOptimizationJobCursor(job: Pick<OptimizeJobRecord, 'created_at' | 'id'>): string {
  return Buffer.from(JSON.stringify({ createdAt: job.created_at, id: job.id }), 'utf8').toString('base64url')
}

export function decodeOptimizationJobCursor(value: string): { createdAt: string; id: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const createdAt = (parsed as Record<string, unknown>).createdAt
    const id = (parsed as Record<string, unknown>).id
    if (typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt))) return null
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) return null
    return { createdAt: new Date(createdAt).toISOString(), id }
  } catch {
    return null
  }
}

function formatJobPriority(job: Pick<OptimizeJobRecord, 'priority'>): OptimizeJobPriority {
  return job.priority >= 20 ? 'priority_coupon' : job.priority >= 10 ? 'paid' : job.priority > 0 ? 'analysis' : 'standard';
}

export function createOptimizeJobPollToken(job: Pick<OptimizeJobRecord, 'id' | 'owner_key'>): string {
  return signOptimizeJobPollToken(job, getSecretKeyring('MAA_ADMIN_SECRET')[0]);
}

export function verifyOptimizeJobPollToken(job: Pick<OptimizeJobRecord, 'id' | 'owner_key'>, token: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(token)) return false;
  const actual = Buffer.from(token, 'hex');
  return getSecretKeyring('MAA_ADMIN_SECRET').some((secret) => {
    const expected = Buffer.from(signOptimizeJobPollToken(job, secret), 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}

function signOptimizeJobPollToken(job: Pick<OptimizeJobRecord, 'id' | 'owner_key'>, secret: string): string {
  return createHmac('sha256', secret).update(`optimize-job:${job.id}:${job.owner_key}`).digest('hex');
}

function formatJobPriorityLabel(job: Pick<OptimizeJobRecord, 'priority'>): string {
  return job.priority >= 20 ? '优先计算券' : job.priority >= 10 ? '付费优先' : job.priority > 0 ? '高级分析' : '普通队列';
}

function getOptimizeJobEstimate(job: OptimizeJobRecord): OptimizeDurationEstimate {
  const payload = job.payload_json as Partial<OptimizationJobPayload> | null;
  if (isOptimizeDurationEstimate(payload?.estimate)) return payload.estimate;
  const withSuggestions = payload?.request?.include_upgrade_suggestions === true
    && payload.request.upgrade_suggestions_allowed === true;
  const bucket = payload?.effectiveConfig
    ? getOptimizeEstimateBucket(payload.effectiveConfig, withSuggestions)
    : withSuggestions ? 'maa_plain_with_suggestions' : 'maa_plain';
  return buildFallbackOptimizeEstimate(bucket);
}

function getOptimizeRuntimeEstimate(
  job: OptimizeJobRecord,
  queuePosition: number | null,
  estimate: OptimizeDurationEstimate,
  now = new Date(),
): OptimizeRuntimeEstimate {
  const nowMs = now.getTime();
  const submittedMs = parseOptimizeJobTime(job.created_at, nowMs);
  const submittedElapsedMs = Math.max(0, nowMs - submittedMs);
  const baseMs = Math.max(OPTIMIZE_ESTIMATE_MIN_MS, estimate.estimated_duration_ms);
  const estimate_updated_at = now.toISOString();

  if (job.status === 'failed' || job.status === 'dead_lettered') {
    return {
      estimated_remaining_ms: null,
      estimated_total_ms: null,
      estimate_phase: 'failed',
      estimate_updated_at,
    };
  }

  if (job.status === 'cancelled') {
    return {
      estimated_remaining_ms: null,
      estimated_total_ms: null,
      estimate_phase: 'cancelled',
      estimate_updated_at,
    };
  }

  if (job.status === 'succeeded') {
    const finishedMs = parseOptimizeJobTime(job.finished_at, nowMs);
    return {
      estimated_remaining_ms: 0,
      estimated_total_ms: Math.max(0, finishedMs - submittedMs),
      estimate_phase: 'completed',
      estimate_updated_at,
    };
  }

  if (job.status === 'running' || (job.status === 'queued' && job.started_at)) {
    const startedMs = parseOptimizeJobTime(job.started_at, nowMs);
    const queueElapsedMs = Math.max(0, startedMs - submittedMs);
    const runningElapsedMs = Math.max(0, nowMs - startedMs);
    if (isOptimizeEstimateOverdue(runningElapsedMs, baseMs)) {
      return {
        estimated_remaining_ms: null,
        estimated_total_ms: Math.max(submittedElapsedMs, queueElapsedMs + baseMs),
        estimate_phase: 'overdue',
        estimate_updated_at,
      };
    }
    return {
      estimated_remaining_ms: Math.max(1_000, baseMs - runningElapsedMs),
      estimated_total_ms: queueElapsedMs + baseMs,
      estimate_phase: 'running',
      estimate_updated_at,
    };
  }

  const position = Math.max(1, queuePosition ?? 1);
  const queueEstimateMs = baseMs * position;
  const estimatedRemainingMs = Math.max(1_000, queueEstimateMs - submittedElapsedMs);
  return {
    estimated_remaining_ms: estimatedRemainingMs,
    estimated_total_ms: Math.max(queueEstimateMs, submittedElapsedMs + estimatedRemainingMs),
    estimate_phase: 'queued',
    estimate_updated_at,
  };
}

function parseOptimizeJobTime(value: string | null | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isOptimizeDurationEstimate(value: unknown): value is OptimizeDurationEstimate {
  if (!value || typeof value !== 'object') return false;
  const estimate = value as Partial<OptimizeDurationEstimate>;
  return typeof estimate.estimated_duration_ms === 'number'
    && isOptimizeEstimateBucket(estimate.estimate_bucket)
    && (estimate.estimate_source === 'history_p95' || estimate.estimate_source === 'fallback_p95')
    && typeof estimate.estimate_sample_count === 'number';
}

function isOptimizeEstimateBucket(value: unknown): value is OptimizeEstimateBucket {
  return value === 'maa_fiammetta'
    || value === 'maa_fiammetta_with_suggestions'
    || value === 'maa_plain'
    || value === 'maa_plain_with_suggestions'
    || value === 'rotation'
    || value === 'rotation_with_suggestions'
    || value === 'scenario_comparison';
}

export function getOptimizeEstimateBucket(config: LicenseConfig, includeUpgradeSuggestions = false): OptimizeEstimateBucket {
  const mode = String(config.schedule_mode ?? 'maa').toLowerCase();
  if (mode === 'rotation') return includeUpgradeSuggestions ? 'rotation_with_suggestions' : 'rotation';
  if (config.Fiammetta?.enable === true) {
    return includeUpgradeSuggestions ? 'maa_fiammetta_with_suggestions' : 'maa_fiammetta';
  }
  return includeUpgradeSuggestions ? 'maa_plain_with_suggestions' : 'maa_plain';
}

export function getEstimateScheduleMode(bucket: OptimizeEstimateBucket): 'maa' | 'rotation' {
  return bucket === 'rotation' || bucket === 'rotation_with_suggestions' ? 'rotation' : 'maa';
}

export function isEstimateFiammettaEnabled(bucket: OptimizeEstimateBucket): boolean {
  return bucket === 'maa_fiammetta' || bucket === 'maa_fiammetta_with_suggestions';
}

export async function resolveOptimizeDurationEstimate(bucket: OptimizeEstimateBucket): Promise<OptimizeDurationEstimate> {
  const fallback = buildFallbackOptimizeEstimate(bucket);
  if (bucket === 'scenario_comparison') return fallback;
  const endAt = new Date();
  const startAt = new Date(endAt.getTime() - OPTIMIZE_ESTIMATE_HISTORY_DAYS * 24 * 60 * 60 * 1000);
  try {
    const stats = await getScheduleGenerateDurationStatsByBucket(bucket, startAt.toISOString(), endAt.toISOString());
    if (stats.sample_count >= OPTIMIZE_ESTIMATE_MIN_SAMPLES && stats.p95_ms > 0) {
      return {
        estimated_duration_ms: clampOptimizeEstimateMs(stats.p95_ms),
        estimate_bucket: bucket,
        estimate_source: 'history_p95',
        estimate_sample_count: stats.sample_count,
      };
    }
    return { ...fallback, estimate_sample_count: stats.sample_count };
  } catch (error) {
    console.warn('optimize duration estimate fallback used:', error);
    return fallback;
  }
}

export function buildScenarioComparisonEstimate(scenarioCount: number, variableScenarioCount = 0): OptimizeDurationEstimate {
  const count = Math.max(1, Math.min(24, Math.floor(scenarioCount)))
  const variableCount = Math.max(0, Math.min(count, Math.floor(variableScenarioCount)))
  const fixedCount = count - variableCount
  const estimatedVerifications = Math.min(9, count)
  return {
    estimated_duration_ms: Math.max(
      OPTIMIZE_ESTIMATE_MIN_MS,
      Math.round(fixedCount * 4_000 + variableCount * SCENARIO_VARIABLE_SHIFT_CANDIDATE_LIMIT * 4_000 + estimatedVerifications * 9_000),
    ),
    estimate_bucket: 'scenario_comparison',
    estimate_source: 'fallback_p95',
    estimate_sample_count: 0,
  }
}

function buildFallbackOptimizeEstimate(bucket: OptimizeEstimateBucket): OptimizeDurationEstimate {
  return {
    estimated_duration_ms: clampOptimizeEstimateMs(OPTIMIZE_ESTIMATE_FALLBACK_MS[bucket]),
    estimate_bucket: bucket,
    estimate_source: 'fallback_p95',
    estimate_sample_count: 0,
  };
}

function clampOptimizeEstimateMs(value: number, maxMs = getOptimizeJobHardTimeoutMs()): number {
  if (!Number.isFinite(value)) return OPTIMIZE_ESTIMATE_FALLBACK_MS.maa_plain;
  return Math.max(OPTIMIZE_ESTIMATE_MIN_MS, Math.min(maxMs, Math.round(value)));
}
