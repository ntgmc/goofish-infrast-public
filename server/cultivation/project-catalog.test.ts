import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { planningFixture } from '../../scripts/prts-planning-fixture.mjs'
import { defaultCultivationQuery } from '../../src/lib/cultivation-contract'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), assets: vi.fn() }))
vi.mock('../../scripts/prts-planning-lib.mjs', () => ({ fetchJson: mocks.fetch, loadPlanningAssets: mocks.assets }))
let directory: string
const sha = 'a'.repeat(40)
const saved = () => ({ ...planningFixture(), gameSha: sha, catalogVersion: 2, homeworks: [], updatedAt: new Date().toISOString() })

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  directory = await mkdtemp(join(tmpdir(), 'project-catalog-'))
  vi.stubEnv('MAA_PRTS_PLANNING_PATH', join(directory, 'missing-homeworks.json'))
  mocks.fetch.mockResolvedValue({ object: { sha } })
  mocks.assets.mockResolvedValue(planningFixture())
})
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }) })

describe('homework-independent project catalog', () => {
  it('refreshes game data independently of a recently updated homework snapshot', async () => {
    const imported = planningFixture()
    imported.updatedAt = new Date().toISOString()
    imported.operators.char_test.name = '旧的游戏资料'
    await writeFile(join(directory, 'missing-homeworks.json'), JSON.stringify(imported))
    const { buildPublicEvidence } = await import('./public-store')
    await buildPublicEvidence(defaultCultivationQuery, new AbortController().signal)
    const { readProjectCatalog } = await import('./project-catalog')
    expect((await readProjectCatalog(new AbortController().signal)).operators.char_test.name).toBe('测试干员')
    expect(mocks.fetch).toHaveBeenCalledOnce()
    expect(mocks.assets).toHaveBeenCalledOnce()
  })

  it('initializes a pinned public catalog with no homework seed and reuses it after a worker restart', async () => {
    const { readProjectCatalog } = await import('./project-catalog')
    const signal = new AbortController().signal
    const catalog = await readProjectCatalog(signal)
    expect(catalog.homeworks).toEqual([])
    expect(catalog.costs.cultivate.test).toEqual(planningFixture().costs.cultivate.test)
    expect(mocks.assets).toHaveBeenCalledWith(sha, signal, true)
    const cached = JSON.parse(await readFile(join(directory, 'project-game-data.json'), 'utf8'))
    expect(cached.gameSha).toBe(sha)
    expect(cached.operators.char_test.name).toBe('测试干员')
    await expect(readFile(join(directory, 'missing-homeworks.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readProjectCatalog(signal)).toBe(catalog)
    vi.resetModules()
    mocks.fetch.mockRejectedValue(new Error('offline'))
    const restarted = await import('./project-catalog')
    expect((await restarted.readProjectCatalog(signal)).costs).toEqual(catalog.costs)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.assets).toHaveBeenCalledTimes(1)
  })

  it('keeps validated stale public data during upstream failure and preserves the disk cache', async () => {
    const stale = { ...saved(), updatedAt: new Date(Date.now() - 2 * 86400000).toISOString() }
    const path = join(directory, 'project-game-data.json')
    await writeFile(path, JSON.stringify(stale))
    mocks.fetch.mockRejectedValue(new Error('offline'))
    const { readProjectCatalog } = await import('./project-catalog')
    const result = await readProjectCatalog(new AbortController().signal)
    expect(result.operators).toEqual(stale.operators)
    expect(result.warnings).toEqual(['养成资料更新暂不可用，当前使用上次资料。'])
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(stale)
    await readProjectCatalog(new AbortController().signal)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid or incomplete public assets and retries without persisting them', async () => {
    const path = join(directory, 'project-game-data.json')
    await writeFile(path, '{broken')
    mocks.assets.mockResolvedValueOnce({ ...planningFixture(), operators: {} })
    const { readProjectCatalog } = await import('./project-catalog')
    await expect(readProjectCatalog(new AbortController().signal)).rejects.toThrow('养成资料缺少干员或消耗表')
    expect(await readFile(path, 'utf8')).toBe('{broken')
    expect((await readProjectCatalog(new AbortController().signal)).operators.char_test.name).toBe('测试干员')
    expect(mocks.assets).toHaveBeenCalledTimes(2)
  })

  it('rebuilds legacy catalogs that did not include alternate forms or module costs', async () => {
    const legacy = { ...saved(), catalogVersion: undefined, costs: { ...planningFixture().costs, modules: { equipDict: {}, charEquip: {} } } }
    await writeFile(join(directory, 'project-game-data.json'), JSON.stringify(legacy))
    const { readProjectCatalog } = await import('./project-catalog')
    const data = await readProjectCatalog(new AbortController().signal)
    expect(data.costs.modules.equipDict.mod_x).toBeDefined()
    expect(mocks.assets).toHaveBeenCalledOnce()
    expect(JSON.parse(await readFile(join(directory, 'project-game-data.json'), 'utf8')).catalogVersion).toBe(2)
  })

  it('refreshes a current catalog when an owned operator was released after it was cached', async () => {
    const path = join(directory, 'project-game-data.json')
    await writeFile(path, JSON.stringify(saved()))
    const { readProjectCatalog } = await import('./project-catalog')
    const signal = new AbortController().signal
    await readProjectCatalog(signal)
    expect(mocks.fetch).not.toHaveBeenCalled()
    const updated = planningFixture()
    updated.operators.char_new = { ...updated.operators.char_test, name: '新干员' }
    updated.costs.cultivate.new = updated.costs.cultivate.test
    mocks.assets.mockResolvedValueOnce(updated)
    expect((await readProjectCatalog(signal, ['char_test', 'char_new'])).operators.char_new.name).toBe('新干员')
    expect(mocks.fetch).toHaveBeenCalledOnce()
    expect(JSON.parse(await readFile(path, 'utf8')).operators.char_new.name).toBe('新干员')
  })

  it('does not substitute an incomplete cache when owned operators are missing upstream', async () => {
    const path = join(directory, 'project-game-data.json')
    const original = JSON.stringify(saved())
    await writeFile(path, original)
    const { readProjectCatalog } = await import('./project-catalog')
    await expect(readProjectCatalog(new AbortController().signal, ['char_missing'])).rejects.toThrow('养成资料缺少已持有干员')
    expect(await readFile(path, 'utf8')).toBe(original)
  })

  it('does not fall back to stale data when the request is cancelled', async () => {
    await writeFile(join(directory, 'project-game-data.json'), JSON.stringify({ ...saved(), updatedAt: '2020-01-01T00:00:00Z' }))
    const controller = new AbortController()
    mocks.fetch.mockImplementationOnce(() => { controller.abort(); throw controller.signal.reason })
    const { readProjectCatalog } = await import('./project-catalog')
    await expect(readProjectCatalog(controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.assets).not.toHaveBeenCalled()
  })
})
