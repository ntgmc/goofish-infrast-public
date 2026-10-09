import { beforeEach, describe, expect, it, vi } from 'vitest'
import { planningFixture } from '../../scripts/prts-planning-fixture.mjs'

const files = vi.hoisted(() => ({ stat: vi.fn(), readFile: vi.fn() }))
vi.mock('node:fs/promises', () => files)

beforeEach(() => {
  vi.resetModules()
  files.stat.mockReset().mockResolvedValue({ mtimeMs: 1, size: 1000 })
  files.readFile.mockReset().mockResolvedValue(JSON.stringify(planningFixture()))
})

describe('cultivation snapshot loading', () => {
  it('shares one parsed snapshot across concurrent requests and caches unchanged files', async () => {
    const { readPrtsSnapshot } = await import('./catalog')
    const snapshots = await Promise.all(Array.from({ length: 10 }, () => readPrtsSnapshot()))
    expect(snapshots.every((snapshot) => snapshot === snapshots[0])).toBe(true)
    expect(await readPrtsSnapshot()).toBe(snapshots[0])
    expect(files.readFile).toHaveBeenCalledTimes(1)
  })

  it('allows another attempt after a failed shared read', async () => {
    files.readFile.mockRejectedValueOnce(new Error('unavailable'))
    const { readPrtsSnapshot } = await import('./catalog')
    const results = await Promise.allSettled([readPrtsSnapshot(), readPrtsSnapshot()])
    expect(results.every((result) => result.status === 'rejected')).toBe(true)
    expect(files.readFile).toHaveBeenCalledTimes(1)
    expect((await readPrtsSnapshot()).cursor).toBe(20)
    expect(files.readFile).toHaveBeenCalledTimes(2)
  })

  it('replaces the snapshot when the imported file changes', async () => {
    const { readPrtsSnapshot } = await import('./catalog')
    const first = await readPrtsSnapshot()
    files.stat.mockResolvedValue({ mtimeMs: 2, size: 1100 })
    files.readFile.mockResolvedValue(JSON.stringify({ ...planningFixture(), cursor: 21 }))
    const replacements = await Promise.all([readPrtsSnapshot(), readPrtsSnapshot()])
    expect(replacements[0]).not.toBe(first)
    expect(replacements[0].cursor).toBe(21)
    expect(replacements[1]).toBe(replacements[0])
    expect(files.readFile).toHaveBeenCalledTimes(2)
  })

  it('does not let an older read overwrite a newer cached snapshot', async () => {
    let resolveOld!: (content: string) => void
    files.readFile.mockImplementationOnce(() => new Promise<string>((resolve) => { resolveOld = resolve }))
    const { readPrtsSnapshot } = await import('./catalog')
    const old = readPrtsSnapshot()
    await vi.waitFor(() => expect(files.readFile).toHaveBeenCalledTimes(1))
    files.stat.mockResolvedValue({ mtimeMs: 2, size: 1100 })
    files.readFile.mockResolvedValue(JSON.stringify({ ...planningFixture(), cursor: 21 }))
    const latest = await readPrtsSnapshot()
    resolveOld(JSON.stringify(planningFixture()))
    await old
    expect(await readPrtsSnapshot()).toBe(latest)
    expect(files.readFile).toHaveBeenCalledTimes(2)
  })
})
