import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { planningFixture } from '../../scripts/prts-planning-fixture.mjs'

const files = vi.hoisted(() => ({ stat: vi.fn(), readFile: vi.fn() }))
vi.mock('node:fs/promises', () => files)
const now = Date.parse('2026-10-08T12:00:00Z')
const midnight = Date.parse('2026-10-08T16:00:00Z')

beforeEach(() => {
  vi.resetModules()
  vi.spyOn(Date, 'now').mockReturnValue(now)
  files.stat.mockReset().mockResolvedValue({ mtimeMs: 1, size: 1000 })
  files.readFile.mockReset().mockResolvedValue(JSON.stringify(planningFixture()))
})
afterEach(() => { vi.unstubAllEnvs() })

describe('cultivation snapshot loading', () => {
  it('shares one parsed snapshot and performs no file IO for the rest of the Beijing day', async () => {
    const { readPrtsSnapshot } = await import('./catalog')
    const snapshots = await Promise.all(Array.from({ length: 10 }, () => readPrtsSnapshot()))
    expect(snapshots.every((snapshot) => snapshot === snapshots[0])).toBe(true)
    files.stat.mockResolvedValue({ mtimeMs: 2, size: 1100 })
    vi.mocked(Date.now).mockReturnValue(midnight - 1)
    expect(await readPrtsSnapshot()).toBe(snapshots[0])
    expect(files.stat).toHaveBeenCalledOnce()
    expect(files.readFile).toHaveBeenCalledOnce()
  })

  it('allows another attempt after a failed shared initial read', async () => {
    files.readFile.mockRejectedValueOnce(new Error('unavailable'))
    const { readPrtsSnapshot } = await import('./catalog')
    const results = await Promise.allSettled([readPrtsSnapshot(), readPrtsSnapshot()])
    expect(results.every((result) => result.status === 'rejected')).toBe(true)
    expect(files.readFile).toHaveBeenCalledOnce()
    expect((await readPrtsSnapshot()).cursor).toBe(20)
    expect(files.readFile).toHaveBeenCalledTimes(2)
  })

  it('checks once at midnight and reparses only when the imported file changes', async () => {
    const { readPrtsSnapshot } = await import('./catalog')
    const first = await readPrtsSnapshot()
    vi.mocked(Date.now).mockReturnValue(midnight)
    expect(await readPrtsSnapshot()).toBe(first)
    expect(files.stat).toHaveBeenCalledTimes(2)
    expect(files.readFile).toHaveBeenCalledOnce()
    vi.mocked(Date.now).mockReturnValue(midnight + 86400000)
    files.stat.mockResolvedValue({ mtimeMs: 2, size: 1100 })
    files.readFile.mockResolvedValue(JSON.stringify({ ...planningFixture(), cursor: 21 }))
    const replacements = await Promise.all([readPrtsSnapshot(), readPrtsSnapshot()])
    expect(replacements[0]).not.toBe(first)
    expect(replacements[0].cursor).toBe(21)
    expect(replacements[1]).toBe(replacements[0])
    expect(files.stat).toHaveBeenCalledTimes(3)
    expect(files.readFile).toHaveBeenCalledTimes(2)
  })

  it.each(['stat', 'readFile', 'validation'] as const)('keeps validated data on %s failure and retries after five minutes', async (failure) => {
    const { readPrtsSnapshot } = await import('./catalog')
    const first = await readPrtsSnapshot()
    vi.mocked(Date.now).mockReturnValue(midnight)
    files.stat.mockResolvedValue({ mtimeMs: 2, size: 1100 })
    if (failure === 'validation') files.readFile.mockResolvedValueOnce('{"invalid":true}')
    else files[failure].mockRejectedValueOnce(new Error('unavailable'))
    expect(await readPrtsSnapshot()).toBe(first)
    expect(await readPrtsSnapshot()).toBe(first)
    expect(files.stat).toHaveBeenCalledTimes(2)
    vi.mocked(Date.now).mockReturnValue(midnight + 300000)
    files.readFile.mockResolvedValue(JSON.stringify({ ...planningFixture(), cursor: 21 }))
    expect((await readPrtsSnapshot()).cursor).toBe(21)
    expect(files.stat).toHaveBeenCalledTimes(3)
  })

  it('does not let an invalidated in-flight read overwrite the newer snapshot', async () => {
    let resolveOld!: (content: string) => void
    files.readFile.mockImplementationOnce(() => new Promise<string>((resolve) => { resolveOld = resolve }))
    const { invalidatePrtsSnapshot, readPrtsSnapshot } = await import('./catalog')
    const old = readPrtsSnapshot()
    await vi.waitFor(() => expect(files.readFile).toHaveBeenCalledOnce())
    invalidatePrtsSnapshot()
    files.stat.mockResolvedValue({ mtimeMs: 2, size: 1100 })
    files.readFile.mockResolvedValue(JSON.stringify({ ...planningFixture(), cursor: 21 }))
    const latest = await readPrtsSnapshot()
    resolveOld(JSON.stringify(planningFixture()))
    await old
    expect(await readPrtsSnapshot()).toBe(latest)
    expect(files.readFile).toHaveBeenCalledTimes(2)
  })

  it('reloads after a successful background sync and never serves another path as fallback', async () => {
    const { invalidatePrtsSnapshot, readPrtsSnapshot, releasePrtsSnapshot } = await import('./catalog')
    await readPrtsSnapshot()
    invalidatePrtsSnapshot()
    files.stat.mockResolvedValue({ mtimeMs: 2, size: 1100 })
    files.readFile.mockResolvedValue(JSON.stringify({ ...planningFixture(), cursor: 21 }))
    expect((await readPrtsSnapshot()).cursor).toBe(21)
    releasePrtsSnapshot()
    await readPrtsSnapshot()
    expect(files.readFile).toHaveBeenCalledTimes(3)
    vi.stubEnv('MAA_PRTS_PLANNING_PATH', '/missing.json')
    files.stat.mockRejectedValueOnce(new Error('missing'))
    await expect(readPrtsSnapshot()).rejects.toThrow('missing')
  })
})
