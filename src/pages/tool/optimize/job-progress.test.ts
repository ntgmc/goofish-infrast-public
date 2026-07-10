// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import type { OptimizeJobAccepted, OptimizeJobStatusResponse } from '../../../lib/types'
import { buildOptimizeJobStorageKey, isActiveOptimizeJob, mergeOptimizeJobProgress, readActiveOptimizeJob, writeActiveOptimizeJob } from './job-progress'

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
  it('keeps active state and maps server estimates', () => {
    expect(isActiveOptimizeJob(accepted)).toBe(true)
    const progress = mergeOptimizeJobProgress(null, accepted, 'generate', Date.parse(accepted.submitted_at))
    expect(progress.jobId).toBe('job-1')
    expect(progress.queueStatus).toBe('queued')
    expect(progress.estimatedRemainingMs).toBe(10_000)
  })
})
