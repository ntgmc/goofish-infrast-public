// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import type { OptimizeJobAccepted, OptimizeJobStatusResponse } from '../../../lib/types'
import { buildOptimizeJobStorageKey, clearOptimizeSubmissionKey, getOrCreateOptimizeSubmissionKey, isActiveOptimizeJob, mergeOptimizeJobProgress, OPTIMIZE_POLL_REQUEST_TIMEOUT_MS, readActiveOptimizeJob, waitForOptimizePoll, writeActiveOptimizeJob } from './job-progress'
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
  calculation_stage: null,
  calculation_stage_updated_at: null,
  upgrade_suggestions_requested: true,
  upgrade_suggestions_allowed: true,
  billing: {
    status: 'reserved',
    billing_kind: 'metered_personal',
    pricing_version: '2026-07-31-v1',
    list_price: '600.00',
    tier: null,
    discount_bps: 0,
    charge: '600.00',
  },
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
    expect(progress.billing).toMatchObject({ status: 'reserved', charge: '600.00' })
  })

  it('maps the persisted history result id from a successful job', () => {
    const progress = mergeOptimizeJobProgress(null, {
      ...accepted,
      status: 'succeeded',
      history_result_id: 'history-1',
      queue_position: null,
      estimated_remaining_ms: 0,
      estimate_phase: 'completed',
    } as OptimizeJobStatusResponse, 'generate', Date.parse(accepted.submitted_at))

    expect(progress.historyResultId).toBe('history-1')
  })

  it('wakes a long poll when an external terminal update arrives', async () => {
    let shouldRefresh = true
    await expect(waitForOptimizePoll(10_000, undefined, () => {
      const current = shouldRefresh
      shouldRefresh = false
      return current
    })).resolves.toBeUndefined()
  })

  it('maps cancellation over a previously overdue progress state', () => {
    const now = Date.parse('2026-07-10T00:01:00.000Z')
    const overdue = {
      ...mergeOptimizeJobProgress(null, accepted, 'generate', now),
      estimatePhase: 'overdue' as const,
      estimatedRemainingMs: null,
      observedRunning: true,
      queueStatus: 'running' as const,
    }
    const cancelled = mergeOptimizeJobProgress(overdue, {
      ...accepted,
      status: 'cancelled',
      queue_position: null,
      estimated_remaining_ms: null,
      estimated_total_ms: null,
      estimate_phase: 'cancelled',
      cancellation_requested: true,
      execution_phase: 'terminal',
      error: '任务已由用户取消。',
      error_code: 'cancelled_by_user',
      error_retryable: true,
      recovery_action: 'retry',
      support_reference: 'OPT-CANCEL',
    } as OptimizeJobStatusResponse, 'generate', now)

    expect(cancelled).toMatchObject({
      jobId: 'job-1',
      estimatePhase: 'cancelled',
      estimatedRemainingMs: null,
      cancellationRequested: true,
      executionPhase: 'terminal',
    })
  })

  it('maps the persisted calculation stage and suggestion intent', () => {
    const progress = mergeOptimizeJobProgress(null, {
      ...accepted,
      status: 'running',
      estimate_phase: 'running',
      calculation_stage: 'simulating_upgrades',
      calculation_stage_updated_at: '2026-07-10T00:00:03.000Z',
    } as OptimizeJobStatusResponse, 'generate', Date.parse('2026-07-10T00:00:03.000Z'))

    expect(progress).toMatchObject({
      calculationStage: 'simulating_upgrades',
      calculationStageUpdatedAt: '2026-07-10T00:00:03.000Z',
      upgradeSuggestionsRequested: true,
      upgradeSuggestionsAllowed: true,
    })
  })
})
