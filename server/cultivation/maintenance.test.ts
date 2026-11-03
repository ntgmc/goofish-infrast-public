import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SITE_FEATURE_SETTINGS } from '../../src/lib/site-features'
import { initializeCultivationMaintenance, shutdownCultivationMaintenance } from './maintenance'

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), shutdown: vi.fn(), features: vi.fn() }))
vi.mock('./worker-client', () => ({ refreshCultivationSnapshot: mocks.refresh, shutdownCultivationWorker: mocks.shutdown }))
vi.mock('../storage/feature-settings-store', () => ({ getSiteFeatureSettings: mocks.features }))

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-08T12:00:00Z'))
  vi.clearAllMocks()
  mocks.refresh.mockReset().mockResolvedValue(undefined)
  mocks.shutdown.mockResolvedValue(undefined)
  mocks.features.mockReset().mockResolvedValue(DEFAULT_SITE_FEATURE_SETTINGS)
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

  it.each(['cultivation_plan', 'tools', 'site'] as const)('skips startup and daily rebuilding while %s is disabled', async (feature) => {
    mocks.features.mockResolvedValue({ ...DEFAULT_SITE_FEATURE_SETTINGS,
      features: { ...DEFAULT_SITE_FEATURE_SETTINGS.features, [feature]: false } })
    initializeCultivationMaintenance()
    await vi.advanceTimersByTimeAsync(4 * 3600000)
    expect(mocks.features).toHaveBeenCalledTimes(2)
    expect(mocks.refresh).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(86400000)
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('observes disabling and re-enabling without restarting the API', async () => {
    initializeCultivationMaintenance()
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.refresh).toHaveBeenCalledOnce()
    mocks.features.mockResolvedValue({ ...DEFAULT_SITE_FEATURE_SETTINGS,
      features: { ...DEFAULT_SITE_FEATURE_SETTINGS.features, cultivation_plan: false } })
    await vi.advanceTimersByTimeAsync(4 * 3600000 + 86400000)
    expect(mocks.refresh).toHaveBeenCalledOnce()
    mocks.features.mockResolvedValue(DEFAULT_SITE_FEATURE_SETTINGS)
    await vi.advanceTimersByTimeAsync(86400000)
    expect(mocks.refresh).toHaveBeenCalledTimes(2)
  })

  it('skips rebuilding if settings cannot be read and retries the next day', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mocks.features.mockRejectedValueOnce(new Error('settings unavailable'))
    initializeCultivationMaintenance()
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.refresh).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith('PRTS cultivation incremental update failed:', 'settings unavailable')
    await vi.advanceTimersByTimeAsync(4 * 3600000)
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })

  it('does not start rebuilding if shutdown happens while reading settings', async () => {
    let resolve!: (settings: typeof DEFAULT_SITE_FEATURE_SETTINGS) => void
    mocks.features.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    initializeCultivationMaintenance()
    const stopped = shutdownCultivationMaintenance()
    resolve(DEFAULT_SITE_FEATURE_SETTINGS)
    await stopped
    expect(mocks.refresh).not.toHaveBeenCalled()
    expect(mocks.shutdown).toHaveBeenCalledOnce()
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
