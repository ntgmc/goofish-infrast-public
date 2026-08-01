// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReorderCheckJobSnapshot } from '../../../lib/optimization-contracts'
import type { ReorderCheckResult } from '../../../lib/types'
import { fetchOptimizeJobSnapshotStatus, waitForOptimizePoll } from './job-progress'
import { submitReorderCheckJob } from './optimization-api'
import { resumeReorderCheckJob, runReorderCheckJob } from './reorder-job-progress'

vi.mock('./optimization-api', () => ({ submitReorderCheckJob: vi.fn() }))
vi.mock('./job-progress', () => ({
  fetchOptimizeJobSnapshotStatus: vi.fn(),
  waitForOptimizePoll: vi.fn(async () => undefined),
  isOptimizeJobPollCancelled: vi.fn(() => false),
  isRetryableOptimizePollError: vi.fn((error: unknown) => error instanceof TypeError),
  OptimizeJobPollCancelledError: class OptimizeJobPollCancelledError extends Error {},
}))

beforeEach(() => {
  window.sessionStorage.clear()
  vi.clearAllMocks()
})

afterEach(() => {
  window.sessionStorage.clear()
})

describe('reorder job progress', () => {
  it('persists an accepted job while polling and clears it after success', async () => {
    vi.mocked(submitReorderCheckJob).mockResolvedValue({ job: snapshot('queued') })
    vi.mocked(fetchOptimizeJobSnapshotStatus).mockResolvedValue(snapshot('succeeded'))

    await expect(runReorderCheckJob(request(), 'failed')).resolves.toEqual(result)

    expect(submitReorderCheckJob).toHaveBeenCalledOnce()
    expect(fetchOptimizeJobSnapshotStatus).toHaveBeenCalledWith('job-1', 'failed', undefined, undefined)
    expect(window.sessionStorage.length).toBe(0)
  })

  it('reuses the pending idempotency key after a lost submit response and page resume', async () => {
    vi.mocked(submitReorderCheckJob).mockRejectedValueOnce(new TypeError('connection lost'))
    await expect(runReorderCheckJob(request(), 'failed')).rejects.toThrow('connection lost')
    const firstKey = vi.mocked(submitReorderCheckJob).mock.calls[0]?.[2]
    expect(window.sessionStorage.length).toBeGreaterThan(0)

    vi.mocked(submitReorderCheckJob).mockResolvedValueOnce({ job: snapshot('queued') })
    vi.mocked(fetchOptimizeJobSnapshotStatus).mockResolvedValueOnce(snapshot('succeeded'))
    await expect(resumeReorderCheckJob('profile-1', 'failed')).resolves.toEqual(result)

    expect(vi.mocked(submitReorderCheckJob).mock.calls[1]?.[2]).toBe(firstKey)
    expect(window.sessionStorage.length).toBe(0)
  })

  it('clears persisted submission state after a non-retryable submit failure', async () => {
    vi.mocked(submitReorderCheckJob).mockRejectedValueOnce(new Error('request rejected'))

    await expect(runReorderCheckJob(request(), 'failed')).rejects.toThrow('request rejected')

    expect(window.sessionStorage.length).toBe(0)
  })

  it('backs off and continues after a retryable polling failure', async () => {
    vi.mocked(submitReorderCheckJob).mockResolvedValue({ job: snapshot('queued') })
    vi.mocked(fetchOptimizeJobSnapshotStatus)
      .mockRejectedValueOnce(new TypeError('temporary network error'))
      .mockResolvedValueOnce(snapshot('succeeded'))

    await expect(runReorderCheckJob(request(), 'failed')).resolves.toEqual(result)

    expect(fetchOptimizeJobSnapshotStatus).toHaveBeenCalledTimes(2)
    expect(waitForOptimizePoll).toHaveBeenCalledTimes(2)
    expect(vi.mocked(waitForOptimizePoll).mock.calls[1]?.[0]).toBeGreaterThan(0)
  })
})

const result: ReorderCheckResult = {
  recommendation: 'no_need',
  estimated_gain_range: { min: null, max: null, unit: 'room_change_only', label: '无需换班' },
  changed_room_count: 0,
  affected_facility_types: [],
  key_operators: [],
  current_plan_usable: true,
  quota: { limit: 2, used: 1, remaining: 1, reset_at: '2026-09-01T00:00:00.000Z', timezone: 'Asia/Shanghai' },
  baseline: { history_id: 'history-1', created_at: '2026-07-31T00:00:00.000Z', name: 'History' },
  reasons: [],
}

function request() {
  return {
    profileId: 'profile-1',
    baselineHistoryId: 'history-1',
    config: {
      layout: '243', desc: 'test', trading_stations_count: 2, manufacturing_stations_count: 4,
      product_requirements: { trading_stations: { lmd: 2 }, manufacturing_stations: { pure_gold: 4 } },
    },
  }
}

function snapshot(status: 'queued' | 'succeeded'): ReorderCheckJobSnapshot {
  const base = {
    id: 'job-1', kind: 'reorder_check' as const, source: 'reorder_check',
    priority: { kind: 'standard' as const, label: '普通队列' }, queuePosition: status === 'queued' ? 1 : null,
    pollAfterMs: 1, timestamps: { submittedAt: '2026-07-31T00:00:00.000Z' },
    estimate: {
      durationMs: 1, bucket: 'maa_plain' as const, source: 'fallback_p95' as const, sampleCount: 0,
      remainingMs: status === 'queued' ? 1 : 0, totalMs: 1, phase: status === 'queued' ? 'queued' as const : 'completed' as const,
      updatedAt: '2026-07-31T00:00:00.000Z',
    },
    executionPhase: status === 'queued' ? 'initial_queue' as const : 'terminal' as const,
    calculationStage: null, upgradeSuggestions: { requested: false, allowed: false }, attemptCount: 0,
    failureCount: 0, cancellationRequested: false, canCancel: status === 'queued', canRetry: false,
  }
  return status === 'queued' ? { ...base, status } : { ...base, status, result }
}
