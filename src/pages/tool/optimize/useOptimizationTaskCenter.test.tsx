// @vitest-environment jsdom
import { act, cleanup, renderHook } from '../../../test/query-render'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OptimizationJobBroadcast } from './optimization-job-events'
import { cancelOptimizationJob, listOptimizationJobs } from './optimization-api'
import type { OptimizationJobListItem } from '../../../lib/optimization-contracts'
import { useOptimizationTaskCenter as useUserTaskCenter } from './useOptimizationTaskCenter'

const useOptimizationTaskCenter = (profileId: string, open: boolean) => useUserTaskCenter('user', profileId, open)

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
    await act(async () => { vi.advanceTimersByTime(250) })
    await flushPromises()
    expect(listOptimizationJobs).toHaveBeenCalledTimes(2)
  })

  it('uses high-frequency reconciliation while open and reacts to broadcasts while closed', async () => {
    const { rerender } = renderHook(({ open }) => useOptimizationTaskCenter('profile-1', open), { initialProps: { open: false } })
    await flushPromises()
    rerender({ open: true })

    await act(async () => { vi.advanceTimersByTime(10_000) })
    await act(async () => { vi.advanceTimersByTime(250) })
    await flushPromises()
    expect(listOptimizationJobs).toHaveBeenCalledTimes(2)

    rerender({ open: false })
    act(() => broadcastListener?.({ type: 'job-updated', profileId: 'profile-1', jobId: 'job-1', status: 'running', kind: 'schedule', at: Date.now() }))
    await act(async () => { vi.advanceTimersByTime(250) })
    await flushPromises()
    expect(listOptimizationJobs).toHaveBeenCalledTimes(3)
  })

  it('drops a queued refresh when the active profile changes', async () => {
    const { rerender } = renderHook(
      ({ profileId }) => useOptimizationTaskCenter(profileId, false),
      { initialProps: { profileId: 'profile-1' } },
    )
    await flushPromises()

    act(() => broadcastListener?.({
      type: 'job-updated', profileId: 'profile-1', jobId: 'job-1', status: 'running', kind: 'schedule', at: Date.now(),
    }))
    rerender({ profileId: 'profile-2' })
    await flushPromises()
    await act(async () => { vi.advanceTimersByTime(250) })
    await flushPromises()

    expect(listOptimizationJobs).toHaveBeenCalledTimes(2)
    expect(vi.mocked(listOptimizationJobs).mock.calls.map(([profileId]) => profileId)).toEqual(['profile-1', 'profile-2'])
  })

  it('pauses queued and periodic refreshes while hidden and reconciles when visible', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    renderHook(() => useOptimizationTaskCenter('profile-1', false))
    await flushPromises()
    const broadcast: OptimizationJobBroadcast = { type: 'job-updated', profileId: 'profile-1', jobId: 'job-1', status: 'running', kind: 'schedule', at: Date.now() }
    act(() => broadcastListener?.(broadcast))
    visibility.mockReturnValue('hidden')
    await act(async () => { await vi.advanceTimersByTimeAsync(60_250) })
    act(() => broadcastListener?.(broadcast))
    await act(async () => { await vi.advanceTimersByTimeAsync(250) })
    expect(listOptimizationJobs).toHaveBeenCalledTimes(1)

    visibility.mockReturnValue('visible')
    act(() => document.dispatchEvent(new Event('visibilitychange', { bubbles: true })))
    await act(async () => { await vi.advanceTimersByTimeAsync(250) })
    expect(listOptimizationJobs).toHaveBeenCalledTimes(2)
  })

  it('does not repeatedly abort a slow request at the periodic refresh interval', async () => {
    let finish!: (value: { jobs: []; nextCursor: null }) => void
    vi.mocked(listOptimizationJobs).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    renderHook(() => useOptimizationTaskCenter('profile-1', true))
    await act(async () => { await vi.advanceTimersByTimeAsync(10_250) })
    expect(listOptimizationJobs).toHaveBeenCalledTimes(1)
    expect(vi.mocked(listOptimizationJobs).mock.calls[0][2]?.aborted).toBe(false)

    await act(async () => { finish({ jobs: [], nextCursor: null }) })
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(listOptimizationJobs).toHaveBeenCalledTimes(2)
  })

  it('deduplicates pages and refreshes them in order using the latest cursors', async () => {
    const first = { id: 'first', status: 'queued' } as OptimizationJobListItem
    const second = { id: 'second', status: 'succeeded' } as OptimizationJobListItem
    vi.mocked(listOptimizationJobs)
      .mockResolvedValueOnce({ jobs: [first], nextCursor: 'old-cursor' })
      .mockResolvedValueOnce({ jobs: [first, second], nextCursor: null })
      .mockResolvedValueOnce({ jobs: [{ ...first, status: 'cancelled' } as OptimizationJobListItem], nextCursor: 'new-cursor' })
      .mockResolvedValueOnce({ jobs: [second], nextCursor: null })
    const { result } = renderHook(() => useOptimizationTaskCenter('profile-1', false))
    await flushPromises()
    await act(async () => { await result.current.loadMore() })
    await flushPromises()
    expect(result.current.jobs.map((job) => job.id)).toEqual(['first', 'second'])
    expect(result.current.hasMore).toBe(false)
    await act(async () => { await result.current.refresh() })
    await flushPromises()
    expect(result.current.jobs[0].status).toBe('cancelled')
    expect(vi.mocked(listOptimizationJobs).mock.calls.map(([, cursor]) => cursor)).toEqual([undefined, 'old-cursor', undefined, 'new-cursor'])
  })

  it('submits cancellation once and refreshes the cached list after success', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const job = { id: 'first', status: 'queued' } as OptimizationJobListItem
    vi.mocked(listOptimizationJobs)
      .mockResolvedValueOnce({ jobs: [job], nextCursor: null })
      .mockResolvedValueOnce({ jobs: [{ ...job, status: 'cancelled' } as OptimizationJobListItem], nextCursor: null })
    vi.mocked(cancelOptimizationJob).mockResolvedValue({} as never)
    const { result } = renderHook(() => useOptimizationTaskCenter('profile-1', false))
    await flushPromises()
    await act(async () => { await result.current.cancel(job) })
    await flushPromises()
    expect(cancelOptimizationJob).toHaveBeenCalledExactlyOnceWith('first')
    expect(result.current.jobs[0].status).toBe('cancelled')
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
    await vi.advanceTimersByTimeAsync(0)
  })
}
