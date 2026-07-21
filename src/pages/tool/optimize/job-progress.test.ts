// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import type { OptimizeJobAccepted, OptimizeJobStatusResponse } from '../../../lib/types'
import { buildOptimizeJobStorageKey, clearOptimizeSubmissionKey, getOrCreateOptimizeSubmissionKey, isActiveOptimizeJob, mergeOptimizeJobProgress, OPTIMIZE_POLL_REQUEST_TIMEOUT_MS, prepareOptimizeContinuationProgress, readActiveOptimizeJob, writeActiveOptimizeJob } from './job-progress'
import { getOptimizePollRetryDelayMs } from '../../../lib/optimize-poll'

const accepted: OptimizeJobAccepted = {
  job_id: 'job-1',
  status: 'queued',
  priority: 'standard',
  priority_label: '普通队列',
  queue_position: 1,
  submitted_at: '2026-07-10T00:00:00.000Z',
  poll_after_ms: 1_000,
  estimated_duration_ms: 10_000,
  estimate_bucket: 'maa_plain',
  estimate_source: 'fallback_p95',
  estimate_sample_count: 0,
  estimated_remaining_ms: 10_000,
  estimated_total_ms: 10_000,
  estimate_phase: 'queued',
  estimate_updated_at: '2026-07-10T00:00:00.000Z',
}

describe('optimization job persistence', () => {
  beforeEach(() => window.sessionStorage.clear())

  it('uses the v2 key and restores active jobs', () => {
    const key = buildOptimizeJobStorageKey('profile-1', 'order', 'signature', 'generate')
    expect(key.startsWith('maa-optimize-job-v2:')).toBe(true)
    writeActiveOptimizeJob(key, accepted)
    expect(readActiveOptimizeJob(key)?.job.job_id).toBe('job-1')
  })

  it('ignores malformed and legacy records', () => {
    const key = buildOptimizeJobStorageKey('profile-1', 'order', 'signature', 'generate')
    window.sessionStorage.setItem(key, JSON.stringify(accepted))
    expect(readActiveOptimizeJob(key)).toBeNull()
    window.sessionStorage.setItem(key, '{broken')
    expect(readActiveOptimizeJob(key)).toBeNull()
  })

  it('removes terminal jobs instead of persisting them', () => {
    const key = buildOptimizeJobStorageKey('profile-1', 'order', 'signature', 'generate')
    writeActiveOptimizeJob(key, accepted)
    writeActiveOptimizeJob(key, { ...accepted, status: 'failed', error: 'failed' } as OptimizeJobStatusResponse)
    expect(window.sessionStorage.getItem(key)).toBeNull()
  })
})

describe('optimization progress mapping', () => {
  it('uses a slow-network timeout and bounded retry jitter', () => {
    expect(OPTIMIZE_POLL_REQUEST_TIMEOUT_MS).toBe(20_000)
    expect(getOptimizePollRetryDelayMs(1, () => 0)).toBe(800)
    expect(getOptimizePollRetryDelayMs(1, () => 1)).toBe(1_200)
    expect(getOptimizePollRetryDelayMs(99, () => 0.5)).toBe(10_000)
  })

  it('preserves license poll credentials and every queue priority', () => {
    const key = buildOptimizeJobStorageKey('', 'order', 'signature', 'generate')
    for (const priority of ['priority_coupon', 'paid', 'analysis', 'standard'] as const) {
      writeActiveOptimizeJob(key, { ...accepted, priority, poll_token: 'poll-secret' })
      expect(readActiveOptimizeJob(key)?.job).toMatchObject({ priority, poll_token: 'poll-secret' })
    }
  })

  it('reuses an unknown-outcome submission key until acceptance or request change', () => {
    const key = buildOptimizeJobStorageKey('', 'order', 'signature', 'generate')
    const first = getOrCreateOptimizeSubmissionKey(key, { config: 1 })
    expect(getOrCreateOptimizeSubmissionKey(key, { config: 1 })).toBe(first)
    expect(getOrCreateOptimizeSubmissionKey(key, { config: 2 })).not.toBe(first)
    const changed = getOrCreateOptimizeSubmissionKey(key, { config: 2 })
    clearOptimizeSubmissionKey(key)
    expect(getOrCreateOptimizeSubmissionKey(key, { config: 2 })).not.toBe(changed)
  })

  it('keeps active state and maps server estimates', () => {
    expect(isActiveOptimizeJob(accepted)).toBe(true)
    const progress = mergeOptimizeJobProgress(null, accepted, 'generate', Date.parse(accepted.submitted_at))
    expect(progress.jobId).toBe('job-1')
    expect(progress.queueStatus).toBe('queued')
    expect(progress.estimatedRemainingMs).toBe(10_000)
  })

  it('keeps aggregate progress while a continuation job waits in its own queue', () => {
    const now = Date.parse('2026-07-10T00:00:20.000Z')
    const current = {
      ...mergeOptimizeJobProgress(null, {
        ...accepted,
        status: 'running',
        estimate_phase: 'running',
      }, 'generate', now),
      startedAt: now - 20_000,
      observedRunning: true,
      percentFloor: 92,
    }
    const continuation: OptimizeJobAccepted = {
      ...accepted,
      job_id: 'job-2',
      queue_position: 3,
      submitted_at: new Date(now).toISOString(),
      estimated_remaining_ms: 15_000,
      estimated_total_ms: 15_000,
      estimate_updated_at: new Date(now).toISOString(),
    }

    const seed = prepareOptimizeContinuationProgress(current, continuation, now)
    const queued = mergeOptimizeJobProgress(seed, continuation, 'generate', now)

    expect(queued).toMatchObject({
      jobId: 'job-2',
      startedAt: current.startedAt,
      queueStatus: 'queued',
      queuePosition: 3,
      observedRunning: false,
      estimatePhase: 'queued',
      estimatedRemainingMs: 15_000,
    })
    expect(queued.percentFloor).toBeGreaterThanOrEqual(92)

    const running = mergeOptimizeJobProgress(queued, {
      ...continuation,
      status: 'running',
      queue_position: null,
      estimate_phase: 'running',
      started_at: new Date(now + 1_000).toISOString(),
    } as OptimizeJobStatusResponse, 'generate', now + 1_000)

    expect(running).toMatchObject({
      queueStatus: 'running',
      queuePosition: null,
      observedRunning: true,
      estimatePhase: 'running',
    })
  })
})
