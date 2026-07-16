import { apiJson } from '../../../lib/api-client'
import type { CreateOptimizationJobRequest, CreateOptimizationJobResponse, CreateReorderCheckRequest, OptimizationJobSnapshot, ReorderCheckResponse } from '../../../lib/optimization-contracts'
import type { OptimizeJobAccepted, OptimizeJobStatusResponse } from '../../../lib/types'

export async function submitOptimizationJob(
  request: CreateOptimizationJobRequest,
  fallbackMessage: string,
  idempotencyKey: string = crypto.randomUUID(),
): Promise<OptimizeJobAccepted> {
  const response = await apiJson<CreateOptimizationJobResponse>('/api/optimization/jobs', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    json: request,
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

export async function requestReorderCheck(
  request: CreateReorderCheckRequest,
  fallbackMessage: string,
  idempotencyKey = crypto.randomUUID(),
): Promise<ReorderCheckResponse['result']> {
  const response = await apiJson<ReorderCheckResponse>('/api/optimization/reorder-checks', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    json: request,
    fallbackMessage,
  })
  return response.result
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
    ...(pollToken && { poll_token: pollToken }),
  }
  if (job.status === 'succeeded') return { ...common, status: job.status, result: job.result }
  if (job.status === 'failed') return { ...common, status: job.status, error: job.error.message }
  return common
}
