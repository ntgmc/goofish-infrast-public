import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { LicenseConfig, OptimizeEstimateBucket, OptimizeResult } from "../../../src/lib/types";
import { SCENARIO_VARIABLE_SHIFT_CANDIDATE_LIMIT } from '../../../src/lib/scenario-comparison';
import type { OptimizationFailureSnapshot, OptimizationJobListItem, OptimizationJobListResponse, OptimizationJobSnapshot } from "../../../src/lib/optimization-contracts";
import { getScheduleGenerateDurationStatsByBucket } from "../../handlers/usage-stats";
import { getProfileForUser } from "../../storage/user-store";
import { requireUserSession } from "../../handlers/user-auth";
import { getOptimizeJobStore, OptimizeJobAdmissionError, type OptimizeJobPriority, type OptimizeJobRecord } from "../../storage/optimize-job-store";
import { getOptimizePollAfterMs, kickOptimizeJobCancellation, kickOptimizeJobProcessing } from "../../optimize-job-runner";
import { isOptimizeEstimateOverdue } from "../../optimize-estimate";
import type { OptimizeDurationEstimate, OptimizeRuntimeEstimate, OptimizationJobPayload } from './shared';
import { OPTIMIZE_ANALYSIS_ESTIMATE_MAX_MS, OPTIMIZE_ESTIMATE_FALLBACK_MS, OPTIMIZE_ESTIMATE_MIN_MS, OPTIMIZE_ESTIMATE_MAX_MS, OPTIMIZE_ESTIMATE_MIN_SAMPLES, OPTIMIZE_ESTIMATE_HISTORY_DAYS } from './shared';
import { jsonResponse } from './http-core';
import { prepareOptimizeJob } from './prepare-job';
import { getServiceLifecycleState } from '../../lifecycle';
import { getSecretKeyring } from '../../handlers/license-utils';

export async function submitOptimizationJob(req: Request): Promise<Response> {
  const lifecycleState = getServiceLifecycleState();
  if (lifecycleState === 'draining' || lifecycleState === 'stopped') {
    return new Response(JSON.stringify({ error: '服务正在重启或排空任务，请稍后重试。', code: 'service_draining' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
    });
  }
  const idempotencyKey = normalizeIdempotencyKey(req.headers.get('Idempotency-Key'));
  if (!idempotencyKey) return jsonResponse({ error: '缺少或无效的 Idempotency-Key。', code: 'idempotency_key_required' }, 400);
  const requestHash = createHash('sha256').update(await req.clone().text()).digest('hex');
  const preparedResult = await prepareOptimizeJob(req);
  if (!preparedResult.ok) return preparedResult.response;

  const store = getOptimizeJobStore();
  const prepared = preparedResult.prepared;

  try {
    const admissionInput = {
      id: randomUUID(),
      priority: prepared.priorityValue,
      owner_key: prepared.ownerKey,
      profile_id: (prepared.payload as { activeProfileId?: string | null }).activeProfileId ?? null,
      permission: prepared.permission,
      source: prepared.source,
      payload_json: prepared.payload,
      idempotency_key: idempotencyKey,
      request_hash: requestHash,
      free_profile_id: prepared.source === 'free_preview' ? (prepared.payload as { activeProfileId?: string | null }).activeProfileId ?? null : null,
      reward_user_id: prepared.rewardUserId ?? null,
      use_priority_coupon: prepared.usePriorityCoupon === true,
    };
    // Third-party test stores predating atomic admission remain read-only test
    // doubles; production and the built-in memory store always implement admitJob.
    const admitted = typeof (store as Partial<typeof store>).admitJob === 'function'
      ? await store.admitJob(admissionInput)
      : { job: await store.createJob(admissionInput), replayed: false };

    kickOptimizeJobProcessing();
    return jsonResponse({
      job: await buildOptimizeJobAccepted(admitted.job),
      ...(!admitted.job.owner_key.startsWith('profile:') && { pollToken: createOptimizeJobPollToken(admitted.job) }),
    }, 202);
  } catch (error) {
    if (error instanceof OptimizeJobAdmissionError) {
      return jsonResponse({ error: error.message, code: error.code }, error.status);
    }
    throw error;
  }
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
  return jsonResponse(formatOptimizeJobStatus(job, queuePosition));
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
  const before = url.searchParams.get('before')?.trim() || null
  const store = getOptimizeJobStore()
  const jobs = await store.listJobsByProfile(profileId, limit + 1, before)
  const page = jobs.slice(0, limit)
  const response: OptimizationJobListResponse = {
    jobs: await Promise.all(page.map(async (job) => toOptimizationJobListItem(
      formatOptimizeJobStatus(job, await store.getQueuePosition(job.id)),
    ))),
    nextCursor: jobs.length > limit ? page.at(-1)?.created_at ?? null : null,
  }
  return jsonResponse(response)
}

function toOptimizationJobListItem(snapshot: OptimizationJobSnapshot): OptimizationJobListItem {
  if (snapshot.status === 'succeeded') {
    const { result: _result, ...summary } = snapshot
    return { ...summary, resultAvailable: true }
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
  kickOptimizeJobCancellation(jobId)
  return jsonResponse(
    { job: formatOptimizeJobStatus(cancelled, await store.getQueuePosition(jobId)) },
    cancelled.status === 'cancelled' ? 200 : 202,
  )
}

export async function canReadOptimizeJob(
  req: Request,
  job: OptimizeJobRecord,
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  if (!job.owner_key.startsWith('profile:')) {
    const token = req.headers.get('X-Optimize-Job-Token')?.trim() ?? '';
    return verifyOptimizeJobPollToken(job, token)
      ? { ok: true }
      : { ok: false, status: 403, message: '缺少或无效的任务查询凭据。' };
  }
  const auth = await requireUserSession(req);
  if (!auth) return { ok: false, status: 401, message: '请先登录后查看任务状态。' };
  const profileId = job.owner_key.slice('profile:'.length);
  const profile = await getProfileForUser(auth.user.id, profileId);
  if (!profile) return { ok: false, status: 403, message: '无权查看该任务。' };
  return { ok: true };
}

export async function buildOptimizeJobAccepted(job: OptimizeJobRecord): Promise<OptimizationJobSnapshot> {
  const queuePosition = await getOptimizeJobStore().getQueuePosition(job.id);
  const estimate = getOptimizeJobEstimate(job);
  const runtimeEstimate = getOptimizeRuntimeEstimate(job, queuePosition, estimate);
  return formatOptimizationJobSnapshot(job, queuePosition, estimate, runtimeEstimate);
}

export function formatOptimizeJobStatus(job: OptimizeJobRecord, queuePosition: number | null): OptimizationJobSnapshot {
  const estimate = getOptimizeJobEstimate(job);
  const runtimeEstimate = getOptimizeRuntimeEstimate(job, queuePosition, estimate);
  return formatOptimizationJobSnapshot(job, queuePosition, estimate, runtimeEstimate);
}

export function formatOptimizationJobSnapshot(
  job: OptimizeJobRecord,
  queuePosition: number | null,
  estimate: OptimizeDurationEstimate,
  runtimeEstimate: OptimizeRuntimeEstimate,
): OptimizationJobSnapshot {
  const status = job.status === 'running' ? 'running' : job.status;
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
    attemptCount: job.attempt_count,
    failureCount: job.failure_count,
    cancellationRequested: Boolean(job.cancel_requested_at),
    canCancel: job.status === 'queued' || job.status === 'running',
    canRetry: job.status === 'failed' || job.status === 'cancelled' || job.status === 'dead_lettered',
  };
  if (status === 'succeeded') {
    return { ...base, status, result: job.result_json as OptimizeResult };
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

function getOptimizeJobKind(job: OptimizeJobRecord): 'schedule' | 'upgrade_suggestions' | 'scenario_comparison' {
  const payload = job.payload_json && typeof job.payload_json === 'object' ? job.payload_json as Record<string, unknown> : {}
  if (payload.kind === 'scenario_comparison') return 'scenario_comparison'
  const request = payload.request && typeof payload.request === 'object' ? payload.request as Record<string, unknown> : {}
  return request.suggestions_only === true ? 'upgrade_suggestions' : 'schedule'
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

export function formatJobPriority(job: Pick<OptimizeJobRecord, 'priority'>): OptimizeJobPriority {
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

export function formatJobPriorityLabel(job: Pick<OptimizeJobRecord, 'priority'>): string {
  return job.priority >= 20 ? '优先计算券' : job.priority >= 10 ? '付费优先' : job.priority > 0 ? '高级分析' : '普通队列';
}

export function getOptimizeJobEstimate(job: OptimizeJobRecord): OptimizeDurationEstimate {
  const payload = job.payload_json as Partial<OptimizationJobPayload> | null;
  if (isOptimizeDurationEstimate(payload?.estimate)) return payload.estimate;
  const bucket = payload?.effectiveConfig ? getOptimizeEstimateBucket(payload.effectiveConfig) : 'maa_plain';
  return buildFallbackOptimizeEstimate(bucket);
}

export function getOptimizeRuntimeEstimate(
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

export function parseOptimizeJobTime(value: string | null | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function isOptimizeDurationEstimate(value: unknown): value is OptimizeDurationEstimate {
  if (!value || typeof value !== 'object') return false;
  const estimate = value as Partial<OptimizeDurationEstimate>;
  return typeof estimate.estimated_duration_ms === 'number'
    && isOptimizeEstimateBucket(estimate.estimate_bucket)
    && (estimate.estimate_source === 'history_p95' || estimate.estimate_source === 'fallback_p95')
    && typeof estimate.estimate_sample_count === 'number';
}

export function isOptimizeEstimateBucket(value: unknown): value is OptimizeEstimateBucket {
  return value === 'maa_fiammetta' || value === 'maa_plain' || value === 'rotation' || value === 'scenario_comparison';
}

export function getOptimizeEstimateBucket(config: LicenseConfig): OptimizeEstimateBucket {
  const mode = String(config.schedule_mode ?? 'maa').toLowerCase();
  if (mode === 'rotation') return 'rotation';
  return config.Fiammetta?.enable === true ? 'maa_fiammetta' : 'maa_plain';
}

export function getEstimateScheduleMode(bucket: OptimizeEstimateBucket): 'maa' | 'rotation' {
  return bucket === 'rotation' ? 'rotation' : 'maa';
}

export function isEstimateFiammettaEnabled(bucket: OptimizeEstimateBucket): boolean {
  return bucket === 'maa_fiammetta';
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
    estimated_duration_ms: clampOptimizeEstimateMs(
      fixedCount * 4_000 + variableCount * SCENARIO_VARIABLE_SHIFT_CANDIDATE_LIMIT * 4_000 + estimatedVerifications * 9_000,
      OPTIMIZE_ANALYSIS_ESTIMATE_MAX_MS,
    ),
    estimate_bucket: 'scenario_comparison',
    estimate_source: 'fallback_p95',
    estimate_sample_count: 0,
  }
}

export function buildFallbackOptimizeEstimate(bucket: OptimizeEstimateBucket): OptimizeDurationEstimate {
  return {
    estimated_duration_ms: clampOptimizeEstimateMs(OPTIMIZE_ESTIMATE_FALLBACK_MS[bucket]),
    estimate_bucket: bucket,
    estimate_source: 'fallback_p95',
    estimate_sample_count: 0,
  };
}

export function clampOptimizeEstimateMs(value: number, maxMs = OPTIMIZE_ESTIMATE_MAX_MS): number {
  if (!Number.isFinite(value)) return OPTIMIZE_ESTIMATE_FALLBACK_MS.maa_plain;
  return Math.max(OPTIMIZE_ESTIMATE_MIN_MS, Math.min(maxMs, Math.round(value)));
}
