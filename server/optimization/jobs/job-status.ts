import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { hasCapability, resolveRuntimePermission, type CapabilitySubject } from '../../../src/lib/product-catalog'
import { hasTrainingDiagnosisEntitlement } from './entitlements'
import type { OptimizeResult } from "../../../src/lib/types";
import type { OptimizationFailureSnapshot, OptimizationJobListItem, OptimizationJobListResponse, OptimizationJobSnapshot } from "../../../src/lib/optimization-contracts";
import { recordUsageEvent } from "../../handlers/usage-stats";
import { getProfileForUser, normalizeProfileKind } from "../../storage/user-store";
import { requireUserSession } from "../../handlers/user-auth";
import { getOptimizeJobStore, OptimizeJobAdmissionError, type OptimizeJobPriority, type OptimizeJobQueueEstimate, type OptimizeJobRecord, type OptimizeJobSummaryRecord, type OptimizeJobStore } from "../../storage/optimize-job-store";
import { requestOptimizeJobCancellation, requestOptimizeJobProcessing } from "../../optimize-job-signals";
import type { OptimizeDurationEstimate, OptimizeRuntimeEstimate } from './shared';
import { getOptimizeJobEstimate, getOptimizeRuntimeEstimate } from './job-estimates';
import { jsonResponse } from './http-core';
import { prepareOptimizeJob } from './prepare-job';
import { getServiceLifecycleState } from '../../lifecycle';
import { getSecretKeyring } from '../../handlers/license-utils';
import { recordRequestBehaviorEvent } from '../../behavior-risk/service';
import { getRequestClientIp } from '../../security/client-ip';
import { stableJsonStringify } from '../../security/request-validation';
import {
  PersonalUseDeclarationRequiredError,
  recordPersonalUseDeclarationUsage,
} from '../../storage/personal-use-declaration-store';
import { resolveProfileAuthorization } from '../../handlers/profile-authorization'
import { projectOptimizeResultForCapabilities } from '../../../src/lib/optimize-result-projection'
import { logPerformanceEvent } from '../../performance-observation'

export async function submitOptimizationJob(req: Request): Promise<Response> {
  const lifecycleState = getServiceLifecycleState();
  if (lifecycleState === 'draining' || lifecycleState === 'stopped') {
    const response = jsonResponse({ error: '服务正在重启或排空任务，请稍后重试。', code: 'service_draining' }, 503)
    response.headers.set('Retry-After', '60')
    return response
  }
  const idempotencyKey = normalizeIdempotencyKey(req.headers.get('Idempotency-Key'));
  if (!idempotencyKey) return jsonResponse({ error: '本次提交信息不完整，请重新操作。', code: 'idempotency_key_required' }, 400);
  const rawRequestBody = await req.clone().text()
  const requestHash = hashOptimizationRequest(rawRequestBody)
  const legacyRequestHash = createHash('sha256').update(rawRequestBody).digest('hex')
  const store = getOptimizeJobStore();
  try {
    const replayed = await findEarlyIdempotentJob(req, rawRequestBody, idempotencyKey, requestHash, legacyRequestHash)
    if (replayed) return acceptedOptimizationJobResponse(req, replayed)
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

    return acceptedOptimizationJobResponse(req, admitted.job)
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
          source: prepared.billing.billingKind,
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

async function acceptedOptimizationJobResponse(req: Request, job: OptimizeJobRecord): Promise<Response> {
  let subject = getJobCapabilitySubject(job)
  if (job.profile_id || job.owner_key.startsWith('profile:')) {
    const access = await canReadOptimizeJob(req, job)
    if (!access.ok) return jsonResponse({ error: access.message }, access.status)
    subject = access.subject
  }
  const accepted = await buildOptimizeJobAccepted(job, subject)
  logPerformanceEvent('optimization.accepted', { job_id: job.id, status: job.status })
  return jsonResponse({
    job: accepted,
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

function normalizeIdempotencyKey(value: string | null): string | null {
  const key = value?.trim() ?? '';
  return key && key.length <= 200 ? key : null;
}

export async function getOptimizationJob(req: Request, rawJobId: string): Promise<Response> {
  const jobId = rawJobId.trim();
  if (!jobId) return jsonResponse({ error: '缺少任务 ID。' }, 400);

  const store = getOptimizeJobStore();
  const job = await store.getJob(jobId);
  if (!job || isRemovedOptimizationJob(job)) return jsonResponse({ error: '任务不存在。' }, 404);

  const access = await canReadOptimizeJob(req, job);
  if (!access.ok) return jsonResponse({ error: access.message }, access.status);

  const queueEstimate = await getOptimizeJobQueueEstimate(store, job);
  return jsonResponse(await projectOptimizeJobSnapshot(
    formatOptimizeJobStatus(job, queueEstimate.queuePosition, queueEstimate.estimatedWaitMs),
    access.subject,
  ));
}

export async function listOptimizationJobs(req: Request): Promise<Response> {
  const auth = await requireUserSession(req)
  if (!auth) return jsonResponse({ error: '请先登录后查看任务列表。' }, 401)
  const url = new URL(req.url)
  const profileId = url.searchParams.get('profile_id')?.trim() ?? ''
  if (!profileId) return jsonResponse({ error: '请先选择游戏账号。', code: 'profile_id_invalid' }, 400)
  const profile = await getProfileForUser(auth.user.id, profileId)
  if (!profile) return jsonResponse({ error: '无权查看该任务列表。' }, 403)
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') ?? 50) || 50))
  const rawBefore = url.searchParams.get('before')?.trim() || null
  const before = rawBefore ? decodeOptimizationJobCursor(rawBefore) : null
  if (rawBefore && !before) return jsonResponse({ error: '任务列表加载位置已失效，请重新打开列表。', code: 'invalid_cursor' }, 400)
  const store = getOptimizeJobStore()
  const jobs = await store.listJobsByProfile(profileId, limit + 1, before)
  const page = jobs.slice(0, limit)
  const response: OptimizationJobListResponse = {
    jobs: page.map(({ job, queuePosition, queueWaitMs, resultAvailable, historyResultId }) => {
      const estimate = getOptimizeJobEstimate(job)
      const runtimeEstimate = getOptimizeRuntimeEstimate(job, queuePosition, estimate, new Date(), queueWaitMs ?? null)
      return toOptimizationJobListItem(
        formatOptimizationJobSummary(job, queuePosition, estimate, runtimeEstimate), resultAvailable, historyResultId,
      )
    }),
    nextCursor: jobs.length > limit && page.at(-1)
      ? encodeOptimizationJobCursor(page.at(-1)!.job)
      : null,
  }
  return jsonResponse(response)
}

function toOptimizationJobListItem(
  snapshot: ReturnType<typeof formatOptimizationJobSummary>,
  resultAvailable: boolean,
  historyResultId?: string | null,
): OptimizationJobListItem {
  if (snapshot.status === 'succeeded') {
    return {
      ...snapshot,
      resultAvailable: snapshot.kind === 'schedule' ? Boolean(historyResultId) : resultAvailable,
      ...(snapshot.kind === 'schedule' && historyResultId && { historyResultId }),
    }
  }
  return { ...snapshot, resultAvailable: false }
}

export async function cancelOptimizationJob(req: Request, rawJobId: string): Promise<Response> {
  const jobId = rawJobId.trim()
  if (!jobId) return jsonResponse({ error: '缺少任务 ID。' }, 400)
  const store = getOptimizeJobStore()
  const current = await store.getJob(jobId)
  if (!current || isRemovedOptimizationJob(current)) return jsonResponse({ error: '任务不存在。' }, 404)
  const access = await canReadOptimizeJob(req, current)
  if (!access.ok) return jsonResponse({ error: access.message }, access.status)
  if (current.status !== 'queued' && current.status !== 'running') {
    return jsonResponse({ error: '任务已经结束，无法取消。', code: 'job_not_cancellable' }, 409)
  }
  const cancelled = await store.requestCancel(jobId)
  if (!cancelled) return jsonResponse({ error: '任务不存在。' }, 404)
  requestOptimizeJobCancellation(jobId)
  return jsonResponse(
    { job: await projectOptimizeJobSnapshot(
      formatOptimizeJobStatus(cancelled, (await getOptimizeJobQueueEstimate(store, cancelled)).queuePosition), access.subject,
    ) },
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

export async function buildOptimizeJobAccepted(
  job: OptimizeJobRecord,
  subject: CapabilitySubject = getJobCapabilitySubject(job),
): Promise<OptimizationJobSnapshot> {
  const queueEstimate = await getOptimizeJobQueueEstimate(getOptimizeJobStore(), job);
  const estimate = getOptimizeJobEstimate(job);
  const runtimeEstimate = getOptimizeRuntimeEstimate(job, queueEstimate.queuePosition, estimate, new Date(), queueEstimate.estimatedWaitMs);
  return projectOptimizeJobSnapshot(
    formatOptimizationJobSnapshot(job, queueEstimate.queuePosition, estimate, runtimeEstimate),
    subject,
  );
}

function getJobCapabilitySubject(job: OptimizeJobRecord): CapabilitySubject {
  return {
    kind: job.source === 'free_preview' ? 'free_preview' : undefined,
    permission: resolveRuntimePermission(job.permission),
  }
}

async function projectOptimizeJobSnapshot(
  snapshot: OptimizationJobSnapshot,
  subject: CapabilitySubject,
): Promise<OptimizationJobSnapshot> {
  if (snapshot.status !== 'succeeded' || snapshot.kind !== 'schedule') return snapshot
  return {
    ...snapshot,
    result: projectOptimizeResultForCapabilities(snapshot.result, subject,
      hasCapability(subject, 'view_upgrade_suggestions') || await hasTrainingDiagnosisEntitlement(snapshot.id)),
  }
}

async function getOptimizeJobQueueEstimate(store: OptimizeJobStore, job: OptimizeJobRecord): Promise<OptimizeJobQueueEstimate> {
  if (job.status !== 'queued') return { queuePosition: null, estimatedWaitMs: null }
  if (typeof store.getQueueEstimate === 'function') return store.getQueueEstimate(job.id)
  return { queuePosition: await store.getQueuePosition(job.id), estimatedWaitMs: null }
}

function formatOptimizeJobStatus(
  job: OptimizeJobRecord,
  queuePosition: number | null,
  queueWaitMs: number | null | undefined = null,
): OptimizationJobSnapshot {
  const estimate = getOptimizeJobEstimate(job);
  const normalizedQueueWaitMs = typeof queueWaitMs === 'number' && Number.isFinite(queueWaitMs)
    ? queueWaitMs
    : null;
  const runtimeEstimate = getOptimizeRuntimeEstimate(job, queuePosition, estimate, new Date(), normalizedQueueWaitMs);
  return formatOptimizationJobSnapshot(job, queuePosition, estimate, runtimeEstimate);
}

function formatOptimizationJobSnapshot(
  job: OptimizeJobRecord,
  queuePosition: number | null,
  estimate: OptimizeDurationEstimate,
  runtimeEstimate: OptimizeRuntimeEstimate,
): OptimizationJobSnapshot {
  const summary = formatOptimizationJobSummary(job, queuePosition, estimate, runtimeEstimate)
  return summary.status === 'succeeded' ? {
    ...summary,
    result: job.result_json as OptimizeResult,
    ...(summary.kind === 'schedule' && { historyResultId: job.id }),
  } : summary
}

function formatOptimizationJobSummary(
  job: OptimizeJobSummaryRecord,
  queuePosition: number | null,
  estimate: OptimizeDurationEstimate,
  runtimeEstimate: OptimizeRuntimeEstimate,
) {
  const status = job.status;
  const upgradeSuggestions = getUpgradeSuggestionIntent(job);
  const base = {
    id: job.id,
    status: job.status === 'running' ? 'running' as const : 'queued' as const,
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
    return { ...base, status };
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

function getUpgradeSuggestionIntent(job: OptimizeJobSummaryRecord): { requested: boolean; allowed: boolean } {
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

function getOptimizeJobKind(job: OptimizeJobSummaryRecord): 'schedule' | 'scenario_comparison' {
  const payload = job.payload_json && typeof job.payload_json === 'object' ? job.payload_json as Record<string, unknown> : {}
  if (payload.kind === 'scenario_comparison') return 'scenario_comparison'
  return 'schedule'
}

function isRemovedOptimizationJob(job: OptimizeJobRecord): boolean {
  if (job.source === 'reorder_check') return true
  return Boolean(job.payload_json && typeof job.payload_json === 'object'
    && (job.payload_json as Record<string, unknown>).kind === 'reorder_check')
}

function getOptimizeExecutionPhase(job: OptimizeJobSummaryRecord): 'initial_queue' | 'retry_wait' | 'executing' | 'settling' | 'terminal' {
  if (job.status === 'running') return job.cancel_requested_at ? 'settling' : 'executing'
  if (job.status === 'queued') return job.attempt_count > 0 || job.failure_count > 0 ? 'retry_wait' : 'initial_queue'
  return 'terminal'
}

function formatOptimizationFailure(
  job: OptimizeJobSummaryRecord,
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

function canRetryOptimizeJob(job: OptimizeJobSummaryRecord): boolean {
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
  return job.priority >= 20 ? '优先计算券' : job.priority >= 10 ? '付费优先' : job.priority > 0 ? '高级分析' : '免费排队';
}
