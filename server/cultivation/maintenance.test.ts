import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeCultivationMaintenance, shutdownCultivationMaintenance } from './maintenance'

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), shutdown: vi.fn() }))
vi.mock('./worker-client', () => ({ refreshCultivationSnapshot: mocks.refresh, shutdownCultivationWorker: mocks.shutdown }))

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.refresh.mockReset().mockResolvedValue(undefined)
  mocks.shutdown.mockResolvedValue(undefined)
})
afterEach(async () => { await shutdownCultivationMaintenance(); vi.useRealTimers() })

describe('cultivation incremental maintenance', () => {
  it('delegates snapshot reads and updates to the isolated reader once per hour', async () => {
    initializeCultivationMaintenance()
    initializeCultivationMaintenance()
    await vi.advanceTimersByTimeAsync(3600000)
    expect(mocks.refresh).toHaveBeenCalledTimes(2)
  })

  it('does not overlap updates and releases the reader after cancellation', async () => {
    let resolve!: () => void
    mocks.refresh.mockImplementationOnce(() => new Promise<void>((done) => { resolve = done }))
    initializeCultivationMaintenance()
    await vi.advanceTimersByTimeAsync(7200000)
    expect(mocks.refresh).toHaveBeenCalledOnce()
    const stopped = shutdownCultivationMaintenance()
    expect(mocks.refresh.mock.calls[0][0].aborted).toBe(true)
    expect(mocks.shutdown).not.toHaveBeenCalled()
    resolve()
    await stopped
    expect(mocks.shutdown).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(7200000)
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })

  it('does not log absent seeds or a reader busy with a user request', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mocks.refresh.mockRejectedValueOnce(Object.assign(new Error('absent'), { code: 'prts_data_unavailable' }))
      .mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'cultivation_busy' }))
    initializeCultivationMaintenance()
    await vi.advanceTimersByTimeAsync(3600000)
    expect(warn).not.toHaveBeenCalled()
  })
})
