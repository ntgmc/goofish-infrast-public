import { ApiError } from '../../../lib/api-client'
import { isRetryableOptimizePollStatus } from '../../../lib/optimize-poll'
import type { OptimizeJobAccepted, OptimizeJobStatusResponse } from '../../../lib/types'
import type { ScheduleProgressState } from '../../../components/ScheduleProgress'
import { fetchOptimizationJob } from './optimization-api'
import { copy } from '../../../copy/index'

export const OPTIMIZE_POLL_REQUEST_TIMEOUT_MS = 20_000
export const OPTIMIZE_HIDDEN_POLL_MULTIPLIER = 3

export function waitForOptimizePoll(ms: number, isCancelled?: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const baseDelayMs = Math.max(500, ms)
    const startedAt = Date.now()
    const check = () => {
      if (isCancelled?.()) {
        reject(new OptimizeJobPollCancelledError())
        return
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        window.setTimeout(check, 250)
        return
      }
      const delayMs = document.visibilityState === 'hidden'
        ? baseDelayMs * OPTIMIZE_HIDDEN_POLL_MULTIPLIER
        : baseDelayMs
      const remainingMs = delayMs - (Date.now() - startedAt)
      if (remainingMs <= 0) {
        resolve()
        return
      }
      window.setTimeout(check, Math.min(250, remainingMs))
    }
    check()
  })
}

export async function fetchOptimizeJobStatus(
  jobId: string,
  fallbackMessage: string,
  isCancelled?: () => boolean,
): Promise<OptimizeJobStatusResponse> {
  const controller = new AbortController()
  let cancellationRequested = false
  const timeout = window.setTimeout(() => controller.abort(), OPTIMIZE_POLL_REQUEST_TIMEOUT_MS)
  const cancellationCheck = window.setInterval(() => {
    if (isCancelled?.()) {
      cancellationRequested = true
      controller.abort()
    }
  }, 100)

  try {
    return await fetchOptimizationJob(jobId, fallbackMessage, controller.signal)
  } catch (error) {
    if (cancellationRequested || isCancelled?.()) {
      throw new OptimizeJobPollCancelledError()
    }
    throw error
  } finally {
    window.clearTimeout(timeout)
    window.clearInterval(cancellationCheck)
  }
}

export function isRetryableOptimizePollError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return isRetryableOptimizePollStatus(error.status)
  }
  return error instanceof TypeError || (error instanceof DOMException && error.name === 'AbortError')
}

export function getOptimizeEstimateAdjustment(
  current: ScheduleProgressState | null | undefined,
  next: OptimizeJobAccepted | OptimizeJobStatusResponse,
): string | undefined {
  if (next.estimate_phase === 'overdue') return copy.optimize.pages_tool_optimize_job_progress_001
  if (!current) return undefined

  if (current.jobId === next.job_id && current.observedRunning && next.status === 'queued') {
    return copy.optimize.pages_tool_optimize_job_progress_002
  }

  if (current.queueStatus === 'queued' && next.status === 'running') {
    return copy.optimize.pages_tool_optimize_job_progress_003
  }

  if (
    current.queueStatus === 'queued'
    && next.status === 'queued'
    && typeof current.queuePosition === 'number'
    && typeof next.queue_position === 'number'
  ) {
    if (next.queue_position > current.queuePosition) return copy.optimize.pages_tool_optimize_job_progress_004
    if (next.queue_position < current.queuePosition) return copy.optimize.pages_tool_optimize_job_progress_005
  }

  return undefined
}

export function prepareOptimizeContinuationProgress(
  current: ScheduleProgressState | null | undefined,
  next: OptimizeJobAccepted | OptimizeJobStatusResponse,
  now: number,
): ScheduleProgressState | null | undefined {
  if (!current || current.jobId === next.job_id) return current
  return {
    ...current,
    jobId: next.job_id,
    completedAt: undefined,
    queueStatus: 'running',
    queuePosition: null,
    observedRunning: true,
    percentFloor: Math.max(92, current.percentFloor ?? 0, getOptimizeProgressPercent(current, now)),
    estimatedRemainingMs: next.estimated_remaining_ms,
    estimatedTotalMs: Math.max(
      current.estimatedTotalMs ?? 0,
      Math.max(0, now - current.startedAt) + Math.max(0, next.estimated_remaining_ms ?? 0),
    ),
    estimatePhase: next.estimate_phase === 'overdue' ? 'overdue' : 'running',
    estimateAdjustment: copy.optimize.pages_tool_optimize_job_progress_006,
    lastUpdatedAt: now,
  }
}

export function mergeOptimizeJobProgress(
  current: ScheduleProgressState | null | undefined,
  next: OptimizeJobAccepted | OptimizeJobStatusResponse,
  mode: ScheduleProgressState['mode'],
  now: number,
): ScheduleProgressState {
  const sameJob = current?.jobId === next.job_id
  const startedAt = sameJob && current ? current.startedAt : Date.parse(next.submitted_at) || now
  const observedRunning = Boolean(
    (sameJob && current?.observedRunning)
    || next.status === 'running'
    || next.estimate_phase === 'running'
    || next.estimate_phase === 'overdue'
    || getOptimizeJobStartedAt(next),
  )
  const queueStatus = getStableOptimizeQueueStatus(current, next, observedRunning)
  const estimatePhase = getStableOptimizeEstimatePhase(current, next, observedRunning)
  const estimatedRemainingMs = getStableOptimizeRemainingMs(current, next, now, observedRunning)
  const estimatedTotalMs = getStableOptimizeTotalMs(current, next, estimatedRemainingMs, startedAt, now, observedRunning)
  const previousPercentFloor = sameJob && current ? Math.max(current.percentFloor ?? 0, getOptimizeProgressPercent(current, now)) : 0

  return {
    mode: sameJob ? current?.mode ?? mode : mode,
    startedAt,
    queueStatus,
    queuePosition: observedRunning ? null : next.queue_position,
    priority: next.priority,
    jobId: next.job_id,
    observedRunning,
    percentFloor: Math.max(0, Math.min(96, previousPercentFloor)),
    estimatedDurationMs: next.estimated_duration_ms,
    estimatedRemainingMs,
    estimatedTotalMs,
    estimatePhase,
    estimateUpdatedAt: next.estimate_updated_at,
    estimateAdjustment: getOptimizeEstimateAdjustment(current, next),
    lastUpdatedAt: now,
  }
}

export function getStableOptimizeQueueStatus(
  current: ScheduleProgressState | null | undefined,
  next: OptimizeJobAccepted | OptimizeJobStatusResponse,
  observedRunning: boolean,
): ScheduleProgressState['queueStatus'] {
  if (next.status === 'running') return 'running'
  if (next.status === 'queued') return observedRunning ? 'running' : 'queued'
  return current?.queueStatus
}

export function getStableOptimizeEstimatePhase(
  current: ScheduleProgressState | null | undefined,
  next: OptimizeJobAccepted | OptimizeJobStatusResponse,
  observedRunning: boolean,
): ScheduleProgressState['estimatePhase'] {
  if (
    current?.jobId === next.job_id
    && current.estimatePhase === 'overdue'
    && next.estimate_phase !== 'completed'
    && next.estimate_phase !== 'failed'
  ) {
    return 'overdue'
  }
  if (next.estimate_phase === 'queued' && observedRunning) {
    return current?.estimatePhase === 'overdue' ? 'overdue' : 'running'
  }
  return next.estimate_phase
}

export function getStableOptimizeRemainingMs(
  current: ScheduleProgressState | null | undefined,
  next: OptimizeJobAccepted | OptimizeJobStatusResponse,
  now: number,
  observedRunning: boolean,
): number | null {
  const incoming = next.estimated_remaining_ms
  if (
    current?.jobId === next.job_id
    && current.estimatePhase === 'overdue'
    && next.estimate_phase !== 'completed'
    && next.estimate_phase !== 'failed'
  ) {
    return null
  }
  if (incoming === null || !Number.isFinite(incoming)) return incoming
  if (current?.jobId !== next.job_id) return incoming

  const projected = getProjectedOptimizeRemainingMs(current, now)
  if (projected === null) return incoming

  if (observedRunning) {
    if (next.status === 'queued' || incoming > projected) return Math.max(0, Math.round(projected))
    return incoming
  }

  const queuePositionWorsened = (
    current.queueStatus === 'queued'
    && next.status === 'queued'
    && typeof current.queuePosition === 'number'
    && typeof next.queue_position === 'number'
    && next.queue_position > current.queuePosition
  )
  if (!queuePositionWorsened && incoming > projected) return Math.max(0, Math.round(projected))
  return incoming
}

export function getStableOptimizeTotalMs(
  current: ScheduleProgressState | null | undefined,
  next: OptimizeJobAccepted | OptimizeJobStatusResponse,
  remainingMs: number | null,
  startedAt: number,
  now: number,
  observedRunning: boolean,
): number | null {
  const incomingTotalMs = next.estimated_total_ms
  if (remainingMs === null) {
    const currentTotalMs = current?.estimatedTotalMs
    if (
      current?.jobId === next.job_id
      && current.estimatePhase === 'overdue'
      && typeof currentTotalMs === 'number'
      && Number.isFinite(currentTotalMs)
      && next.estimate_phase !== 'completed'
      && next.estimate_phase !== 'failed'
    ) {
      return currentTotalMs
    }
    if (
      current?.jobId === next.job_id
      && typeof currentTotalMs === 'number'
      && Number.isFinite(currentTotalMs)
      && observedRunning
      && next.status === 'queued'
    ) {
      return currentTotalMs
    }
    return incomingTotalMs
  }

  const localTotalMs = Math.max(0, now - startedAt) + remainingMs
  if (current?.jobId === next.job_id && observedRunning && next.status === 'queued') {
    return current.estimatedTotalMs ?? localTotalMs
  }

  if (typeof incomingTotalMs === 'number' && Number.isFinite(incomingTotalMs) && incomingTotalMs > 0) {
    return shouldAllowOptimizeEstimateExtension(current, next, observedRunning)
      ? Math.max(incomingTotalMs, localTotalMs)
      : Math.min(incomingTotalMs, localTotalMs)
  }
  return localTotalMs
}

export function shouldAllowOptimizeEstimateExtension(
  current: ScheduleProgressState | null | undefined,
  next: OptimizeJobAccepted | OptimizeJobStatusResponse,
  observedRunning: boolean,
): boolean {
  return Boolean(
    current?.jobId === next.job_id
    && !observedRunning
    && current.queueStatus === 'queued'
    && next.status === 'queued'
    && typeof current.queuePosition === 'number'
    && typeof next.queue_position === 'number'
    && next.queue_position > current.queuePosition,
  )
}

export function getProjectedOptimizeRemainingMs(progress: ScheduleProgressState, now: number): number | null {
  if (typeof progress.estimatedRemainingMs !== 'number' || !Number.isFinite(progress.estimatedRemainingMs)) return null
  const updatedAt = parseOptimizeEstimateUpdatedAt(progress)
  const elapsedSinceUpdate = updatedAt === null ? 0 : Math.max(0, now - updatedAt)
  return Math.max(0, progress.estimatedRemainingMs - elapsedSinceUpdate)
}

export function getOptimizeProgressPercent(progress: ScheduleProgressState, now: number): number {
  const elapsed = Math.max(0, now - progress.startedAt)
  const estimatedTotalMs = getOptimizeProgressTotalMs(progress, now)
  return Math.min(96, (elapsed / estimatedTotalMs) * 96)
}

export function getOptimizeProgressTotalMs(progress: ScheduleProgressState, now: number): number {
  if (typeof progress.estimatedTotalMs === 'number' && Number.isFinite(progress.estimatedTotalMs) && progress.estimatedTotalMs > 0) {
    return progress.estimatedTotalMs
  }
  const fallback = progress.estimatedDurationMs ?? 28_000
  if (progress.estimatePhase === 'overdue') return Math.max(fallback, Math.max(1_000, now - progress.startedAt))
  return Math.max(1_000, fallback)
}

export function getOptimizeJobStartedAt(job: OptimizeJobAccepted | OptimizeJobStatusResponse): string | null | undefined {
  return 'started_at' in job ? job.started_at : undefined
}

export function parseOptimizeEstimateUpdatedAt(progress: ScheduleProgressState): number | null {
  const parsed = Date.parse(progress.estimateUpdatedAt ?? '')
  if (Number.isFinite(parsed)) return parsed
  return typeof progress.lastUpdatedAt === 'number' && Number.isFinite(progress.lastUpdatedAt) ? progress.lastUpdatedAt : null
}

export function buildOptimizeJobStorageKey(
  profileId: string,
  orderHash: string,
  signature: string,
  mode: ScheduleProgressState['mode'],
): string {
  return ['maa-optimize-job-v2', profileId || orderHash || 'anonymous', mode, signature].join(':')
}

export function clearLegacyOptimizeJobStorage(
  profileId: string,
  orderHash: string,
  signature: string,
  mode: ScheduleProgressState['mode'],
): void {
  try {
    const legacyKey = ['maa-optimize-job', profileId || orderHash || 'anonymous', mode, signature].join(':')
    window.sessionStorage.removeItem(legacyKey)
  } catch {
    // Session storage is best-effort only.
  }
}

export interface ActiveOptimizeJobStorageEntry {
  job: OptimizeJobAccepted | OptimizeJobStatusResponse;
  progress?: ScheduleProgressState;
}

export function writeActiveOptimizeJob(
  key: string,
  job: OptimizeJobAccepted | OptimizeJobStatusResponse,
  progress?: ScheduleProgressState,
): void {
  try {
    if (!isActiveOptimizeJob(job)) {
      window.sessionStorage.removeItem(key)
      return
    }
    window.sessionStorage.setItem(key, JSON.stringify({ version: 2, job, progress }))
  } catch {
    // Session storage is best-effort only.
  }
}

export function readActiveOptimizeJob(key: string): ActiveOptimizeJobStorageEntry | null {
  try {
    const raw = window.sessionStorage.getItem(key)
    if (!raw) return null
    const value = JSON.parse(raw) as unknown
    if (!isObjectRecord(value) || value.version !== 2 || !isObjectRecord(value.job)) return null
    const maybeRecord = value.job
    if (!isStoredOptimizeJob(maybeRecord)) return null
    const progress = isObjectRecord(value) && isStoredScheduleProgress(value.progress) ? value.progress : undefined
    return { job: maybeRecord, progress }
  } catch {
    // Session storage is best-effort only.
  }
  return null
}

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object')
}

export function isStoredOptimizeJob(value: unknown): value is OptimizeJobAccepted | OptimizeJobStatusResponse {
  if (!isObjectRecord(value)) return false
  return typeof value.job_id === 'string'
    && (value.status === 'queued' || value.status === 'running' || value.status === 'succeeded' || value.status === 'failed')
    && (value.priority === 'paid' || value.priority === 'standard')
    && typeof value.submitted_at === 'string'
}

export function isStoredScheduleProgress(value: unknown): value is ScheduleProgressState {
  if (!isObjectRecord(value)) return false
  return (value.mode === 'generate' || value.mode === 'apply')
    && typeof value.startedAt === 'number'
    && Number.isFinite(value.startedAt)
}

export function isActiveOptimizeJob(
  job: OptimizeJobAccepted | OptimizeJobStatusResponse | null,
): job is OptimizeJobAccepted | (OptimizeJobStatusResponse & { status: 'queued' | 'running' }) {
  return job?.status === 'queued' || job?.status === 'running'
}

export function clearActiveOptimizeJob(key: string): void {
  try {
    window.sessionStorage.removeItem(key)
  } catch {
    // Session storage is best-effort only.
  }
}

export class OptimizeJobPollCancelledError extends Error {
  constructor() {
    super('optimize job polling cancelled')
    this.name = 'OptimizeJobPollCancelledError'
  }
}

export function isOptimizeJobPollCancelled(error: unknown): boolean {
  return error instanceof OptimizeJobPollCancelledError
}
