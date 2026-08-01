import type { CreateReorderCheckRequest, ReorderCheckJobSnapshot } from '../../../lib/optimization-contracts'
import type { ReorderCheckResult } from '../../../lib/types'
import { canonicalJson } from '../../../lib/crypto'
import { getOptimizePollRetryDelayMs } from '../../../lib/optimize-poll'
import {
  fetchOptimizeJobSnapshotStatus,
  isOptimizeJobPollCancelled,
  isRetryableOptimizePollError,
  OptimizeJobPollCancelledError,
  waitForOptimizePoll,
} from './job-progress'
import { cancelOptimizationJob, submitReorderCheckJob } from './optimization-api'

const REORDER_POINTER_PREFIX = 'maa-optimize-reorder-current-v1:'
const REORDER_STATE_PREFIX = 'maa-optimize-reorder-job-v1:'

interface ReorderJobState {
  version: 1
  profileId: string
  storageKey: string
  request: CreateReorderCheckRequest
  idempotencyKey: string
  job?: ReorderCheckJobSnapshot
  pollToken?: string
  updatedAt: number
}

export async function runReorderCheckJob(
  request: CreateReorderCheckRequest,
  fallbackMessage: string,
  isCancelled?: () => boolean,
): Promise<ReorderCheckResult> {
  const current = readCurrentReorderJob(request.profileId)
  if (current) return continueReorderJob(current, fallbackMessage, isCancelled)
  const storageKey = buildReorderStorageKey(request)
  const existing = readReorderState(storageKey)
  const state: ReorderJobState = existing ?? {
    version: 1,
    profileId: request.profileId,
    storageKey,
    request,
    idempotencyKey: crypto.randomUUID(),
    updatedAt: Date.now(),
  }
  writeReorderState(state)
  return continueReorderJob(state, fallbackMessage, isCancelled)
}

export async function resumeReorderCheckJob(
  profileId: string,
  fallbackMessage: string,
  isCancelled?: () => boolean,
): Promise<ReorderCheckResult | null> {
  const state = readCurrentReorderJob(profileId)
  if (!state) return null
  return continueReorderJob(state, fallbackMessage, isCancelled)
}

export async function cancelCurrentReorderCheckJob(profileId: string): Promise<boolean> {
  const state = readCurrentReorderJob(profileId)
  if (!state?.job?.canCancel) return false
  const job = await cancelOptimizationJob(state.job.id) as ReorderCheckJobSnapshot
  writeReorderState({ ...state, job, updatedAt: Date.now() })
  return true
}

async function continueReorderJob(
  initialState: ReorderJobState,
  fallbackMessage: string,
  isCancelled?: () => boolean,
): Promise<ReorderCheckResult> {
  let state = initialState
  throwIfCancelled(isCancelled)
  let job = state.job
  if (!job) {
    let accepted
    try {
      accepted = await submitReorderCheckJob(state.request, fallbackMessage, state.idempotencyKey)
    } catch (error) {
      if (!isRetryableOptimizePollError(error)) clearReorderState(state)
      throw error
    }
    state = { ...state, job: accepted.job, pollToken: accepted.pollToken, updatedAt: Date.now() }
    writeReorderState(state)
    job = accepted.job
  }

  let consecutivePollFailures = 0
  let pollAfterMs = job.pollAfterMs || (job.status === 'queued' ? 3_000 : 1_500)
  while (job.status === 'queued' || job.status === 'running') {
    throwIfCancelled(isCancelled)
    await waitForOptimizePoll(pollAfterMs, isCancelled)
    throwIfCancelled(isCancelled)
    try {
      job = await fetchOptimizeJobSnapshotStatus<ReorderCheckResult>(
        job.id,
        fallbackMessage,
        state.pollToken,
        isCancelled,
      )
      state = { ...state, job, updatedAt: Date.now() }
      writeReorderState(state)
      consecutivePollFailures = 0
      pollAfterMs = job.pollAfterMs || (job.status === 'queued' ? 3_000 : 1_500)
    } catch (error) {
      if (isOptimizeJobPollCancelled(error)) throw error
      if (!isRetryableOptimizePollError(error)) {
        clearReorderState(state)
        throw error
      }
      consecutivePollFailures += 1
      pollAfterMs = getOptimizePollRetryDelayMs(consecutivePollFailures)
    }
  }

  clearReorderState(state)
  if (job.status === 'succeeded') return job.result
  if (job.status === 'cancelled') throw new OptimizeJobPollCancelledError()
  throw new Error(job.error.message || fallbackMessage)
}

function buildReorderStorageKey(request: CreateReorderCheckRequest): string {
  const fingerprint = hashForStorage(canonicalJson(request))
  return `${REORDER_STATE_PREFIX}${request.profileId}:${request.baselineHistoryId}:${fingerprint}`
}

function pointerKey(profileId: string): string {
  return `${REORDER_POINTER_PREFIX}${profileId}`
}

function writeReorderState(state: ReorderJobState): void {
  try {
    window.sessionStorage.setItem(state.storageKey, JSON.stringify(state))
    window.sessionStorage.setItem(pointerKey(state.profileId), state.storageKey)
  } catch {
    // Session storage is best-effort; server idempotency remains authoritative.
  }
}

function readCurrentReorderJob(profileId: string): ReorderJobState | null {
  try {
    const storageKey = window.sessionStorage.getItem(pointerKey(profileId))
    return storageKey ? readReorderState(storageKey) : null
  } catch {
    return null
  }
}

function readReorderState(storageKey: string): ReorderJobState | null {
  try {
    const raw = window.sessionStorage.getItem(storageKey)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<ReorderJobState>
    if (value.version !== 1 || value.storageKey !== storageKey || typeof value.profileId !== 'string'
      || typeof value.idempotencyKey !== 'string' || !isReorderRequest(value.request)) return null
    if (value.job && (typeof value.job.id !== 'string'
      || (value.job.status !== 'queued' && value.job.status !== 'running'
        && value.job.status !== 'succeeded' && value.job.status !== 'failed'
        && value.job.status !== 'cancelled' && value.job.status !== 'dead_lettered'))) return null
    return value as ReorderJobState
  } catch {
    return null
  }
}

function clearReorderState(state: ReorderJobState): void {
  try {
    window.sessionStorage.removeItem(state.storageKey)
    if (window.sessionStorage.getItem(pointerKey(state.profileId)) === state.storageKey) {
      window.sessionStorage.removeItem(pointerKey(state.profileId))
    }
  } catch {
    // Session storage is best-effort only.
  }
}

function isReorderRequest(value: unknown): value is CreateReorderCheckRequest {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && typeof (value as Record<string, unknown>).profileId === 'string'
    && typeof (value as Record<string, unknown>).baselineHistoryId === 'string'
    && (value as Record<string, unknown>).config
    && typeof (value as Record<string, unknown>).config === 'object')
}

function hashForStorage(value: string): string {
  let hash = 2_166_136_261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return (hash >>> 0).toString(36)
}

function throwIfCancelled(isCancelled?: () => boolean): void {
  if (isCancelled?.()) throw new OptimizeJobPollCancelledError()
}
