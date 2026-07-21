// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OptimizeJobAccepted, OptimizeJobStatusResponse } from '../../../lib/types'
import type { ScheduleProgressState } from '../../../components/ScheduleProgress'
import { useOptimizationJob } from './useOptimizationJob'

const mocks = vi.hoisted(() => ({
  fetchOptimizationJob: vi.fn(),
  listener: null as ((event: {
    profileId: string
    jobId: string
    status: string
    kind: string
    at: number
  }) => void) | null,
}))

vi.mock('./optimization-api', () => ({
  fetchOptimizationJob: (...args: unknown[]) => mocks.fetchOptimizationJob(...args),
  fetchOptimizationJobSnapshot: vi.fn(),
  submitOptimizationJob: vi.fn(),
}))

vi.mock('./optimization-job-events', () => ({
  publishLegacyOptimizationJobUpdate: vi.fn(),
  subscribeOptimizationJobUpdates: (listener: typeof mocks.listener) => {
    mocks.listener = listener
    return () => { mocks.listener = null }
  },
  withOptimizationSubmissionLock: async (_profileId: string, operation: () => Promise<unknown>) => await operation(),
}))

const accepted: OptimizeJobAccepted = {
  job_id: 'job-cancelled',
  status: 'queued',
  priority: 'standard',
  priority_label: '普通队列',
  queue_position: 5,
  submitted_at: '2026-07-10T00:00:00.000Z',
  poll_after_ms: 10_000,
  estimated_duration_ms: 10_000,
  estimate_bucket: 'maa_plain',
  estimate_source: 'fallback_p95',
  estimate_sample_count: 0,
  estimated_remaining_ms: 50_000,
  estimated_total_ms: 50_000,
  estimate_phase: 'queued',
  estimate_updated_at: '2026-07-10T00:00:00.000Z',
  calculation_stage: null,
  calculation_stage_updated_at: null,
  upgrade_suggestions_requested: false,
  upgrade_suggestions_allowed: false,
}

const cancelled = {
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
} as OptimizeJobStatusResponse

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-07-10T00:00:00.000Z'))
  window.sessionStorage.clear()
  mocks.fetchOptimizationJob.mockResolvedValue(cancelled)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
  mocks.listener = null
})

describe('useOptimizationJob cancellation synchronization', () => {
  it('wakes polling and exposes cancelled progress after a task-center broadcast', async () => {
    const progressRef = { current: null as ScheduleProgressState | null }
    const setProgress = vi.fn()
    const { result } = renderHook(() => useOptimizationJob({
      profileId: 'profile-1',
      orderHash: 'order-1',
      signature: 'signature-1',
      progressRef,
      setProgress,
    }))

    let polling!: Promise<unknown>
    act(() => {
      polling = result.current.pollOptimizationJob(
        accepted,
        'active-job-key',
        'generate',
        '同步任务失败',
      )
    })
    const rejected = expect(polling).rejects.toMatchObject({ status: 'cancelled' })

    expect(mocks.fetchOptimizationJob).not.toHaveBeenCalled()
    act(() => {
      mocks.listener?.({
        profileId: 'profile-1',
        jobId: accepted.job_id,
        status: 'cancelled',
        kind: 'schedule',
        at: Date.now(),
      })
      vi.advanceTimersByTime(250)
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    await rejected
    expect(mocks.fetchOptimizationJob).toHaveBeenCalledTimes(1)
    expect(progressRef.current).toMatchObject({
      jobId: accepted.job_id,
      estimatePhase: 'cancelled',
      cancellationRequested: true,
      executionPhase: 'terminal',
    })
    expect(setProgress).toHaveBeenLastCalledWith(expect.objectContaining({ estimatePhase: 'cancelled' }))
    expect(mocks.listener).toBeNull()
  })
})
