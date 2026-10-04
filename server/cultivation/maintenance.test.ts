import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeCultivationMaintenance, shutdownCultivationMaintenance } from './maintenance'

const mocks = vi.hoisted(() => ({ read: vi.fn(), sync: vi.fn() }))
vi.mock('./catalog', () => ({ readPrtsSnapshot: mocks.read }))
vi.mock('../../scripts/prts-planning-sync.mjs', () => ({ syncPrtsPlanning: mocks.sync }))

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime('2026-10-04T00:00:00Z')
  vi.clearAllMocks()
  mocks.sync.mockResolvedValue({ changed: 0 })
})
afterEach(async () => { await shutdownCultivationMaintenance(); vi.useRealTimers() })

describe('cultivation incremental maintenance', () => {
  it('does not start a full crawl before the deployment seed exists', async () => {
    mocks.read.mockRejectedValue(new Error('ENOENT'))
    initializeCultivationMaintenance()
    await vi.advanceTimersByTimeAsync(3600000)
    expect(mocks.sync).not.toHaveBeenCalled()
  })

  it('updates stale data without overlapping updates and cancels on shutdown', async () => {
    mocks.read.mockResolvedValue({ updatedAt: '2026-10-01T00:00:00Z' })
    let resolve: () => void = () => {}
    mocks.sync.mockImplementationOnce(() => new Promise<void>((done) => { resolve = done }))
    initializeCultivationMaintenance()
    await vi.advanceTimersByTimeAsync(7200000)
    expect(mocks.sync).toHaveBeenCalledOnce()
    const stopped = shutdownCultivationMaintenance()
    expect(mocks.sync.mock.calls[0][0].signal.aborted).toBe(true)
    resolve()
    await stopped
    await vi.advanceTimersByTimeAsync(7200000)
    expect(mocks.sync).toHaveBeenCalledOnce()
  })

  it('keeps a fresh imported snapshot until its next update is due', async () => {
    mocks.read.mockResolvedValue({ updatedAt: '2026-10-04T00:00:00Z' })
    initializeCultivationMaintenance()
    await vi.advanceTimersByTimeAsync(23 * 3600000)
    expect(mocks.sync).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(3600000)
    expect(mocks.sync).toHaveBeenCalledOnce()
  })
})
