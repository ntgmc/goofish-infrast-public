// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OptimizationJobBroadcast } from './optimization-job-events'
import { listOptimizationJobs } from './optimization-api'
import { useOptimizationTaskCenter } from './useOptimizationTaskCenter'

let broadcastListener: ((event: OptimizationJobBroadcast) => void) | null = null
const setOptimizationAppBadge = vi.fn()

vi.mock('./optimization-api', () => ({
  listOptimizationJobs: vi.fn(),
  cancelOptimizationJob: vi.fn(),
}))

vi.mock('./optimization-job-events', () => ({
  optimizationNotificationsEnabled: () => false,
  publishOptimizationJobUpdate: vi.fn(),
  setOptimizationAppBadge: (...args: unknown[]) => setOptimizationAppBadge(...args),
  setOptimizationNotificationsEnabled: vi.fn(),
  subscribeOptimizationJobUpdates: (listener: (event: OptimizationJobBroadcast) => void) => {
    broadcastListener = listener
    return () => { broadcastListener = null }
  },
}))

beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(listOptimizationJobs).mockResolvedValue({ jobs: [], nextCursor: null })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
  broadcastListener = null
})

describe('useOptimizationTaskCenter', () => {
  it('keeps low-frequency reconciliation running while the dialog is closed', async () => {
    const { result } = renderHook(() => useOptimizationTaskCenter('profile-1', false))
    await flushPromises()
    expect(listOptimizationJobs).toHaveBeenCalledTimes(1)
    expect(result.current.loading).toBe(false)

    await act(async () => { vi.advanceTimersByTime(29_999) })
    expect(listOptimizationJobs).toHaveBeenCalledTimes(1)
    await act(async () => { vi.advanceTimersByTime(1) })
    await flushPromises()
    expect(listOptimizationJobs).toHaveBeenCalledTimes(2)
  })

  it('uses high-frequency reconciliation while open and reacts to broadcasts while closed', async () => {
    const { rerender } = renderHook(({ open }) => useOptimizationTaskCenter('profile-1', open), { initialProps: { open: false } })
    await flushPromises()
    rerender({ open: true })

    await act(async () => { vi.advanceTimersByTime(10_000) })
    await flushPromises()
    expect(listOptimizationJobs).toHaveBeenCalledTimes(2)

    rerender({ open: false })
    act(() => broadcastListener?.({ type: 'job-updated', profileId: 'profile-1', jobId: 'job-1', status: 'running', kind: 'schedule', at: Date.now() }))
    await flushPromises()
    expect(listOptimizationJobs).toHaveBeenCalledTimes(3)
  })

  it('summarizes active and attention states and updates the app badge', async () => {
    vi.mocked(listOptimizationJobs).mockResolvedValue({
      jobs: [
        { id: 'queued', status: 'queued' },
        { id: 'running', status: 'running' },
        { id: 'failed', status: 'failed' },
        { id: 'dead', status: 'dead_lettered' },
        { id: 'cancelled', status: 'cancelled' },
      ] as never,
      nextCursor: null,
    })
    const { result } = renderHook(() => useOptimizationTaskCenter('profile-1', false))
    await flushPromises()

    expect(result.current.activeCount).toBe(2)
    expect(result.current.attentionCount).toBe(2)
    expect(setOptimizationAppBadge).toHaveBeenCalledWith(2)
  })
})

async function flushPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}
