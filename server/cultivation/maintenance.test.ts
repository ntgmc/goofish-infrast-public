import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeCultivationMaintenance, shutdownCultivationMaintenance } from './maintenance'

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), shutdown: vi.fn() }))
vi.mock('./worker-client', () => ({ refreshCultivationSnapshot: mocks.refresh, shutdownCultivationWorker: mocks.shutdown }))

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-08T12:00:00Z'))
  vi.clearAllMocks()
  mocks.refresh.mockReset().mockResolvedValue(undefined)
  mocks.shutdown.mockResolvedValue(undefined)
})
afterEach(async () => { await shutdownCultivationMaintenance(); vi.useRealTimers() })

describe('cultivation incremental maintenance', () => {
  it('updates on startup and each Beijing midnight without hourly reads', async () => {
    initializeCultivationMaintenance()
    initializeCultivationMaintenance()
    await vi.advanceTimersByTimeAsync(4 * 3600000 - 1)
    expect(mocks.refresh).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.refresh).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(86400000)
    expect(mocks.refresh).toHaveBeenCalledTimes(3)
  })

  it('does not overlap updates and releases the reader after cancellation', async () => {
    let resolve!: () => void
    mocks.refresh.mockImplementationOnce(() => new Promise<void>((done) => { resolve = done }))
    initializeCultivationMaintenance()
    await vi.advanceTimersByTimeAsync(2 * 86400000)
    expect(mocks.refresh).toHaveBeenCalledOnce()
    const stopped = shutdownCultivationMaintenance()
    expect(mocks.refresh.mock.calls[0][0].aborted).toBe(true)
    expect(mocks.shutdown).not.toHaveBeenCalled()
    resolve()
    await stopped
    expect(mocks.shutdown).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(2 * 86400000)
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })

  it('does not log absent seeds or a duplicate refresh', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mocks.refresh.mockRejectedValueOnce(Object.assign(new Error('absent'), { code: 'prts_data_unavailable' }))
      .mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'cultivation_busy' }))
    initializeCultivationMaintenance()
    await vi.advanceTimersByTimeAsync(4 * 3600000)
    expect(mocks.refresh).toHaveBeenCalledTimes(2)
    expect(warn).not.toHaveBeenCalled()
  })
})
