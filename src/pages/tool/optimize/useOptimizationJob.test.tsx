// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreateOptimizationJobRequest } from '../../../lib/optimization-contracts'
import type { OptimizeJobAccepted, OptimizeJobStatusResponse } from '../../../lib/types'
import { buildOptimizeJobStorageKey, readActiveOptimizeJob } from './job-progress'
import type { ScheduleProgressState } from '../../../components/ScheduleProgress'
import { useOptimizationJob } from './useOptimizationJob'

const mocks = vi.hoisted(() => ({
  fetchOptimizationJob: vi.fn(),
  submitOptimizationJob: vi.fn(),
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
  submitOptimizationJob: (...args: unknown[]) => mocks.submitOptimizationJob(...args),
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
  mocks.submitOptimizationJob.mockReset()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
  mocks.listener = null
})

describe('useOptimizationJob cancellation synchronization', () => {
  it.each(['unmount', 'switch profile'])('stops a new job polling loop on %s while retaining the resumable job', async (action) => {
    mocks.submitOptimizationJob.mockResolvedValue(accepted)
    const progressRef = { current: null as ScheduleProgressState | null }
    const { result, unmount, rerender } = renderHook(({ profileId }) => useOptimizationJob({
      profileId, orderHash: 'order-1', signature: 'signature-1', progressRef, setProgress: vi.fn(),
    }), { initialProps: { profileId: 'profile-1' } })
    let polling!: Promise<unknown>
    await act(async () => {
      polling = result.current.runOptimizationJob({} as CreateOptimizationJobRequest, 'generate', '同步任务失败')
      await Promise.resolve()
    })
    const rejected = expect(polling).rejects.toMatchObject({ name: 'OptimizeJobPollCancelledError' })
    expect(mocks.listener).not.toBeNull()

    if (action === 'unmount') unmount()
    else rerender({ profileId: 'profile-2' })
    await act(async () => { await vi.advanceTimersByTimeAsync(250) })
    await rejected

    expect(mocks.fetchOptimizationJob).not.toHaveBeenCalled()
    expect(mocks.listener).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
    expect(readActiveOptimizeJob(buildOptimizeJobStorageKey('profile-1', 'order-1', 'signature-1', 'generate'))?.job.job_id).toBe(accepted.job_id)
  })

  it('persists a submission accepted after unmount without starting another polling loop', async () => {
    let accept!: (job: OptimizeJobAccepted) => void
    mocks.submitOptimizationJob.mockImplementation(() => new Promise<OptimizeJobAccepted>((resolve) => { accept = resolve }))
    const { result, unmount } = renderHook(() => useOptimizationJob({
      profileId: 'profile-1', orderHash: 'order-1', signature: 'signature-1',
      progressRef: { current: null }, setProgress: vi.fn(),
    }))
    const running = result.current.runOptimizationJob({} as CreateOptimizationJobRequest, 'generate', '同步任务失败')
    const rejected = expect(running).rejects.toMatchObject({ name: 'OptimizeJobPollCancelledError' })
    unmount()
    accept(accepted)
    await rejected
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    expect(readActiveOptimizeJob(buildOptimizeJobStorageKey('profile-1', 'order-1', 'signature-1', 'generate'))?.job.job_id).toBe(accepted.job_id)
    expect(mocks.listener).toBeNull()
    expect(mocks.fetchOptimizationJob).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('aborts an in-flight poll request and releases its subscription on unmount', async () => {
    let signal!: AbortSignal
    mocks.fetchOptimizationJob.mockImplementation((_id, _message, _token, requestSignal: AbortSignal) => {
      signal = requestSignal
      return new Promise((_resolve, reject) => {
        requestSignal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
    })
    const { result, unmount } = renderHook(() => useOptimizationJob({
      profileId: 'profile-1', orderHash: 'order-1', signature: 'signature-1',
      progressRef: { current: null }, setProgress: vi.fn(),
    }))
    const polling = result.current.pollOptimizationJob({ ...accepted, poll_after_ms: 500 }, 'active-job-key', 'generate', '同步任务失败')
    const rejected = expect(polling).rejects.toMatchObject({ name: 'OptimizeJobPollCancelledError' })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(signal.aborted).toBe(false)
    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    await rejected

    expect(signal.aborted).toBe(true)
    expect(mocks.listener).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

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
