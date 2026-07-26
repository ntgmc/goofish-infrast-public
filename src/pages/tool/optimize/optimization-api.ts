import { apiJson } from '../../../lib/api-client'
import type { CreateOptimizationJobRequest, CreateOptimizationJobResponse, CreateReorderCheckJobResponse, CreateReorderCheckRequest, OptimizationJobListResponse, OptimizationJobMutationResponse, OptimizationJobSnapshot, ReorderCheckJobSnapshot } from '../../../lib/optimization-contracts'
import type { ReorderCheckResult } from '../../../lib/types'
import type { OptimizeJobAccepted, OptimizeJobStatusResponse } from '../../../lib/types'
import { copy } from '../../../copy/index'

export const OPTIMIZE_SUBMIT_TIMEOUT_MS = 30_000

export async function submitOptimizationJob(
  request: CreateOptimizationJobRequest,
  fallbackMessage: string,
  idempotencyKey: string = crypto.randomUUID(),
): Promise<OptimizeJobAccepted> {
  const response = await apiJson<CreateOptimizationJobResponse>('/api/optimization/jobs', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    json: request,
    signal: AbortSignal.timeout(OPTIMIZE_SUBMIT_TIMEOUT_MS),
    fallbackMessage,
  })
  return toLegacyJobView(response.job, response.pollToken) as OptimizeJobAccepted
}

export async function fetchOptimizationJob(
  jobId: string,
  fallbackMessage: string,
  pollToken?: string,
  signal?: AbortSignal,
): Promise<OptimizeJobStatusResponse> {
  const job = await apiJson<OptimizationJobSnapshot>(
    '/api/optimization/jobs/' + encodeURIComponent(jobId),
    { signal, fallbackMessage, ...(pollToken && { headers: { 'X-Optimize-Job-Token': pollToken } }) },
  )
  return toLegacyJobView(job)
}

export async function fetchOptimizationJobSnapshot<TResult = import('../../../lib/types').OptimizeResult>(
  jobId: string,
  fallbackMessage: string,
  pollToken?: string,
  signal?: AbortSignal,
): Promise<OptimizationJobSnapshot<TResult>> {
  return await apiJson<OptimizationJobSnapshot<TResult>>(
    '/api/optimization/jobs/' + encodeURIComponent(jobId),
    { signal, fallbackMessage, ...(pollToken && { headers: { 'X-Optimize-Job-Token': pollToken } }) },
  )
}

export async function listOptimizationJobs(profileId: string, before?: string): Promise<OptimizationJobListResponse> {
  const params = new URLSearchParams({ profile_id: profileId, limit: '50' })
  if (before) params.set('before', before)
  return await apiJson<OptimizationJobListResponse>(`/api/optimization/jobs?${params.toString()}`, {
    fallbackMessage: copy.optimize.pages_tool_optimize_optimization_api_001,
  })
}

export async function cancelOptimizationJob(jobId: string): Promise<OptimizationJobSnapshot> {
  const response = await apiJson<OptimizationJobMutationResponse>(
    `/api/optimization/jobs/${encodeURIComponent(jobId)}/cancel`,
    { method: 'POST', fallbackMessage: copy.optimize.pages_tool_optimize_optimization_api_002 },
  )
  return response.job
}

export async function requestReorderCheck(
  request: CreateReorderCheckRequest,
  fallbackMessage: string,
  idempotencyKey = crypto.randomUUID(),
): Promise<ReorderCheckResult> {
  const response = await apiJson<CreateReorderCheckJobResponse>('/api/optimization/reorder-checks', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    json: request,
    signal: AbortSignal.timeout(OPTIMIZE_SUBMIT_TIMEOUT_MS),
    fallbackMessage,
  })
  let job: ReorderCheckJobSnapshot = response.job
  while (job.status === 'queued' || job.status === 'running') {
    await delay(job.pollAfterMs)
    job = await fetchOptimizationJobSnapshot<ReorderCheckResult>(job.id, fallbackMessage, response.pollToken)
  }
  if (job.status === 'succeeded') return job.result
  throw new Error(job.error.message || fallbackMessage)
}

export async function requestMaaExport(profileId: string, resultId: string): Promise<void> {
  const response = await apiJson<{ result: unknown; filename: string }>('/api/user/maa-export', {
    method: 'POST',
    json: { profile_id: profileId, result_id: resultId, idempotency_key: crypto.randomUUID() },
    fallbackMessage: copy.inventory.maa_export_failed,
  })
  downloadJsonPayload(response, `maa_schedule_${resultId.slice(0, 8)}.json`)
}

export async function requestFullResultExport(profileId: string, resultId: string): Promise<void> {
  const response = await apiJson<{ result: unknown; filename: string }>('/api/user/full-result-export', {
    method: 'POST',
    json: { profile_id: profileId, result_id: resultId, idempotency_key: crypto.randomUUID() },
    fallbackMessage: copy.inventory.full_result_export_failed,
  })
  downloadJsonPayload(response, `maatool_full_result_${resultId.slice(0, 8)}.json`)
}

function downloadJsonPayload(response: { result: unknown; filename: string }, fallbackFilename: string): void {
  const blob = new Blob([JSON.stringify(response.result, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = response.filename || fallbackFilename
  link.click()
  URL.revokeObjectURL(url)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}

function toLegacyJobView(job: OptimizationJobSnapshot, pollToken?: string): OptimizeJobStatusResponse {
  const common = {
    job_id: job.id,
    status: job.status,
    priority: job.priority.kind,
    priority_label: job.priority.label,
    queue_position: job.queuePosition,
    submitted_at: job.timestamps.submittedAt,
    started_at: job.timestamps.startedAt,
    finished_at: job.timestamps.finishedAt,
    poll_after_ms: job.pollAfterMs,
    estimated_duration_ms: job.estimate.durationMs,
    estimate_bucket: job.estimate.bucket,
    estimate_source: job.estimate.source,
    estimate_sample_count: job.estimate.sampleCount,
    estimated_remaining_ms: job.estimate.remainingMs,
    estimated_total_ms: job.estimate.totalMs,
    estimate_phase: job.estimate.phase,
    estimate_updated_at: job.estimate.updatedAt,
    calculation_stage: job.calculationStage,
    calculation_stage_updated_at: job.timestamps.stageUpdatedAt ?? null,
    upgrade_suggestions_requested: job.upgradeSuggestions.requested,
    upgrade_suggestions_allowed: job.upgradeSuggestions.allowed,
    job_kind: job.kind,
    source: job.source,
    execution_phase: job.executionPhase,
    attempt_count: job.attemptCount,
    failure_count: job.failureCount,
    next_attempt_at: job.timestamps.nextAttemptAt,
    cancellation_requested: job.cancellationRequested,
    can_cancel: job.canCancel,
    can_retry: job.canRetry,
    ...(pollToken && { poll_token: pollToken }),
  }
  if (job.status === 'succeeded') return { ...common, status: job.status, result: job.result }
  if (job.status === 'failed' || job.status === 'cancelled' || job.status === 'dead_lettered') {
    return {
      ...common,
      status: job.status,
      error: job.error.message,
      error_code: job.error.code,
      error_retryable: job.error.retryable,
      recovery_action: job.error.recoveryAction,
      support_reference: job.error.supportReference,
      failure_kind: job.error.failureKind,
    }
  }
  return common
}
