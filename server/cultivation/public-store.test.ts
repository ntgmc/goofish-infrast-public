import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { planningFixture } from '../../scripts/prts-planning-fixture.mjs'
import { defaultCultivationQuery } from '../../src/lib/cultivation-contract'
import { prtsSnapshotSchema } from './catalog'
import { calculateCultivationRecommendations } from './recommendations'
import { compactRecommendations } from './public-evidence'

let directory: string, store: typeof import('./public-store')
const signal = () => new AbortController().signal
const query = { ...defaultCultivationQuery, stageId: 'main_01' }
const day = Date.parse('2026-10-07T16:00:00Z')

beforeEach(async () => {
  vi.resetModules()
  vi.spyOn(Date, 'now').mockReturnValue(day + 3600000)
  directory = await mkdtemp(join(tmpdir(), 'public-evidence-'))
  vi.stubEnv('MAA_PRTS_PLANNING_PATH', join(directory, 'source.json'))
  const source = { ...planningFixture(), updatedAt: new Date(day).toISOString() }
  source.homeworks[0].uploadedAt = new Date(day - 7 * 86400000).toISOString()
  await writeFile(join(directory, 'source.json'), JSON.stringify(source))
  store = await import('./public-store')
})
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }) })

function sql(work: (database: DatabaseSync) => void) {
  const database = new DatabaseSync(store.publicEvidencePath())
  try { work(database) } finally { database.close() }
}

describe('persistent public recommendation evidence', () => {
  it('survives restarts and answers new queries using compact evidence without the original snapshot', async () => {
    await store.buildPublicEvidence(query, signal())
    const original = prtsSnapshotSchema.parse(JSON.parse(await readFile(join(directory, 'source.json'), 'utf8')))
    const expected = compactRecommendations(calculateCultivationRecommendations(original, { ...query, rarityGroup: 'all' }, day))
    const first = store.readStoredRecommendations(query)
    expect(first.recommendation).toEqual(expected)
    expect(first.snapshot.homeworks).toEqual([])
    await rm(join(directory, 'source.json'))
    vi.resetModules()
    store = await import('./public-store')
    expect(store.hasStoredRecommendation(query)).toBe(true)
    expect(store.readStoredRecommendations(query)).toEqual(first)
    const secondQuery = { ...query, coverage: 0.9 }
    await store.buildPublicEvidence(secondQuery, signal())
    expect(store.hasStoredRecommendation(secondQuery)).toBe(true)
    expect(store.readStoredRecommendations({ ...query, rarityGroup: 'low', search: 'CSGY', profession: 'WARRIOR' })).toEqual(first)
  })

  it('marks results stale at Beijing midnight and rebuilds their daily time calculations from persisted evidence', async () => {
    await store.buildPublicEvidence(query, signal())
    const original = store.readStoredRecommendations(query)
    vi.mocked(Date.now).mockReturnValue(day + 86400000)
    expect(store.hasStoredRecommendation(query)).toBe(false)
    expect(store.hasStoredRecommendation(query, true)).toBe(true)
    expect(store.readStoredRecommendations(query)).toEqual(original)
    await rm(join(directory, 'source.json'))
    await store.buildPublicEvidence(query, signal())
    expect(store.hasStoredRecommendation(query)).toBe(true)
    expect(store.readStoredRecommendations(query).recommendation.samples[0][3]).not.toBe(original.recommendation.samples[0][3])
  })

  it('publishes catalog and queries together and rolls back a failed refresh without losing the old result', async () => {
    await store.buildPublicEvidence(query, signal())
    const first = store.readStoredRecommendations(query)
    await writeFile(join(directory, 'source.json'), '{broken')
    await expect(store.buildPublicEvidence(query, signal(), true)).rejects.toThrow()
    expect(store.readStoredRecommendations(query)).toEqual(first)
    await writeFile(join(directory, 'source.json'), JSON.stringify({ ...planningFixture(), updatedAt: new Date(day).toISOString(), homeworks: [] }))
    await store.buildPublicEvidence(query, signal(), true)
    expect(store.readStoredRecommendations(query).recommendation.recommendations).toEqual([])
    expect(store.readStoredRecommendations(query).snapshot.homeworks).toEqual([])
  })

  it('keeps reads available while another writer builds and rejects duplicate builders without corrupting the database', async () => {
    await store.buildPublicEvidence(query, signal())
    const first = store.readStoredRecommendations(query)
    const writer = new DatabaseSync(store.publicEvidencePath())
    try {
      writer.exec('BEGIN IMMEDIATE')
      expect(store.readStoredRecommendations(query)).toEqual(first)
      await expect(store.buildPublicEvidence({ ...query, coverage: 0.9 }, signal())).rejects.toThrow(/locked/)
    } finally { writer.close() }
    await store.buildPublicEvidence({ ...query, coverage: 0.9 }, signal())
    expect(store.hasStoredRecommendation(query)).toBe(true)
  })

  it('repairs corrupt persisted evidence from the source and does not retain corrupt hot payloads', async () => {
    await store.buildPublicEvidence(query, signal())
    const first = store.readStoredRecommendations(query)
    sql((database) => { database.exec("UPDATE snapshot SET prepared = x'00'; UPDATE queries SET result = x'00'") })
    vi.resetModules()
    store = await import('./public-store')
    expect(() => store.readStoredRecommendations(query)).toThrow()
    await store.buildPublicEvidence(query, signal())
    expect(store.readStoredRecommendations(query)).toEqual(first)
  })

  it('bounds stored query combinations and keeps public caches independent of selected operators', async () => {
    await store.buildPublicEvidence(query, signal())
    for (let index = 0; index < 65; index++) await store.buildPublicEvidence({ ...query, stageId: `other_${index}` }, signal())
    expect(store.hasStoredRecommendation(query)).toBe(false)
    expect(store.hasStoredRecommendation({ ...query, stageId: 'other_64' })).toBe(true)
    sql((database) => { expect(database.prepare('SELECT count(*) AS count FROM queries').get()).toEqual({ count: 64 }) })
  })
})
