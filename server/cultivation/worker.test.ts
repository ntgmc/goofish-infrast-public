import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { planningFixture } from '../../scripts/prts-planning-fixture.mjs'
import { defaultCultivationQuery } from '../../src/lib/cultivation-contract'

let directory: string
let client: typeof import('./worker-client')
const input = { credential: 'private-credential', uid: 'player-uid', query: { ...defaultCultivationQuery, stageId: 'main_01' } }

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'cultivation-worker-'))
  const snapshot = { ...planningFixture(), updatedAt: new Date().toISOString() }
  await writeFile(join(directory, 'snapshot.json'), JSON.stringify(snapshot))
  vi.stubEnv('MAA_PRTS_PLANNING_PATH', join(directory, 'snapshot.json'))
  await build({ entryPoints: { client: 'server/cultivation/worker-client.ts', 'cultivation-worker': 'server/cultivation/cultivation-worker.ts' },
    outdir: directory, outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
    plugins: [{ name: 'public-cultivation-fixture', setup(builder) {
      builder.onResolve({ filter: /handlers\/(?:skland-client|material-value)$|cultivation\/(?:references|special-items)$|\.\/(?:references|special-items)$/ }, (args) => ({ path: args.path.split('/').at(-1)!, namespace: 'fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: {
        'skland-client': `export class SklandClientError extends Error {};
          export class SklandClient { async getGamePlayerInfo() { const end = Date.now() + 100; while (Date.now() < end) {};
            return {data:{chars:[{charId:'char_test',evolvePhase:0,level:1,mainSkillLvl:1,skills:[{skillId:'s1',specializeLevel:0}],equip:[],potentialRank:0}]}} }
            async getCultivatePlayer() { return {items:[{id:'rock',count:2}]} } }`,
        'material-value': `export async function getYituliuPricing() {return {status:'fresh',prices:new Map([['rock',5],['book',2]])}};
          export const getExpSanity = n => n * 0.006; export const getNetLmdSanity = () => 0.0036;
          export const EXP_ITEM_VALUES = {'2001':200,'2002':400,'2003':1000,'2004':2000};`,
        references: `export async function getCultivationStatistics() {return {status:'unavailable',updatedAt:null,operators:{}}}`,
        'special-items': `export async function getSpecialItemCatalog() {return {status:'fresh',items:[]}}; export const buildSpecialItemRecommendations = () => [];`,
      }[args.path]! }))
    } }],
  })
  // The production client resolves this filename beside its bundled entry point.
  const { rename } = await import('node:fs/promises')
  await rename(join(directory, 'cultivation-worker.mjs'), join(directory, 'cultivation-worker.js'))
  await writeFile(join(directory, 'package.json'), '{"type":"module"}')
  client = await import(pathToFileURL(join(directory, 'client.mjs')).href)
}, 15_000)

afterAll(async () => {
  await client?.shutdownCultivationWorker()
  vi.unstubAllEnvs()
  if (directory) await rm(directory, { recursive: true, force: true })
})

describe('cultivation worker integration', () => {
  it('returns current recommendations while CPU work leaves the API event loop responsive', async () => {
    const pending = client.readCultivationPlan(input)
    let completed = false
    void pending.then(() => { completed = true })
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(completed).toBe(false)
    const data = await pending
    expect(data).toBeInstanceOf(ArrayBuffer)
    const text = new TextDecoder().decode(data)
    expect(JSON.parse(text).candidates[0]).toMatchObject({ operatorId: 'char_test', items: { rock: 2, book: 6, exp: 300, '4001': 130 } })
    expect(text).not.toContain('private-credential')
    expect(text).not.toContain('player-uid')
  })

  it('keeps a fresh snapshot without attempting an incremental crawl', async () => {
    await expect(client.refreshCultivationSnapshot(new AbortController().signal)).resolves.toBeUndefined()
  })

  it('reports a missing seed through the reader without crashing the API process', async () => {
    await client.shutdownCultivationWorker()
    vi.stubEnv('MAA_PRTS_PLANNING_PATH', join(directory, 'missing.json'))
    await expect(client.readCultivationPlan(input)).rejects.toMatchObject({ status: 503, code: 'prts_data_unavailable' })
  })
})
