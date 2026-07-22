import * as esbuild from 'esbuild'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const bundleDir = resolve('.cache/check-depot-value')
const priceCachePath = resolve(bundleDir, 'yituliu-cache.json')
await mkdir(bundleDir, { recursive: true })
await rm(priceCachePath, { force: true })
process.env.NODE_ENV = 'test'
process.env.MAA_MATERIAL_VALUE_CACHE_PATH = priceCachePath
process.env.DEPOT_SAMPLE_HASH_SECRET = 'check-depot-sample-secret'
const sampleStore = createMemoryDepotValueSampleStore()
globalThis.__maaDepotValueSampleStoreForTesting = sampleStore
const originalConsoleError = console.error
const originalConsoleWarn = console.warn
console.error = (...args) => {
  if (String(args[0] ?? '').startsWith('depot value error:')) return
  originalConsoleError(...args)
}
console.warn = (...args) => {
  if (String(args[0] ?? '').startsWith('depot value skland sample fetch failed:')) return
  originalConsoleWarn(...args)
}

const handlerPath = await bundleHandler()
let handler = await loadHandler(handlerPath)

const FLAT_SAMPLE = {
  '2001': 16000,
  '2002': 7477,
  '2003': 9419,
  '2004': 44,
  '30011': 982,
  '30012': 7658,
  '30013': 208,
  '30014': 18,
  '30021': 602,
  '30022': 999,
  '30023': 214,
  '30024': 38,
  '30031': 633,
  '30032': 971,
  '30033': 128,
  '30034': 25,
  '30041': 458,
  '30042': 346,
  '30043': 94,
  '30044': 6,
  '30051': 419,
  '30052': 892,
  '30053': 154,
  '30054': 19,
  '30061': 372,
  '30062': 882,
  '30063': 120,
  '30073': 1,
  '30083': 69,
  '30084': 3,
  '30093': 98,
  '30103': 199,
  '30104': 1,
  '30135': 3,
  '30145': 22,
  '30155': 1,
  '30165': 12,
  '31013': 58,
  '31023': 235,
  '31024': 11,
  '31033': 174,
  '31034': 40,
  '31043': 236,
  '31053': 197,
  '31054': 5,
  '31063': 164,
  '31064': 12,
  '31073': 138,
  '31074': 25,
  '31083': 211,
  '31084': 23,
  '31093': 213,
  '31094': 15,
  '31103': 8,
  '31104': 4,
  '31113': 10,
  '32001': 1,
  '3221': 20,
  '3222': 8,
  '3231': 10,
  '3232': 1,
  '3241': 34,
  '3242': 13,
  '3251': 16,
  '3261': 9,
  '3271': 14,
  '3272': 6,
  '3281': 28,
  '3282': 1,
  '3301': 2485,
  '3302': 1645,
  '3303': 18,
  mod_unlock_token: 130,
  mod_update_token_1: 2333,
  mod_update_token_2: 686,
}

const PENGUIN_SAMPLE = {
  '@type': '@penguin-statistics/depot',
  items: Object.entries(FLAT_SAMPLE).map(([id, have]) => ({
    id,
    have,
    name: sampleName(id),
  })),
}

globalThis.fetch = async (url) => {
  if (String(url) === 'https://backend.yituliu.cn/item/v7/value') {
    return jsonResponse({
      data: [
        { itemId: '30011', itemValueAp: 2 },
        { itemId: '31013', itemValueAp: 4 },
      ],
    })
  }
  throw new Error(`unexpected fetch ${url}`)
}

await assertUploadFormats()
await assertPriceCacheFallback()
await assertUploadErrors()
await assertSklandFlow()

console.log('depot value smoke check ok')

async function assertUploadFormats() {
  const flat = await callDepot({ source: 'upload', inventory: FLAT_SAMPLE })
  const penguin = await callDepot({ source: 'upload', inventory: PENGUIN_SAMPLE })
  if (flat.status !== 200 || penguin.status !== 200) {
    throw new Error(`upload formats: expected 200, got ${flat.status}/${penguin.status}`)
  }
  if (flat.body.total_equivalent_sanity !== penguin.body.total_equivalent_sanity) {
    throw new Error('upload formats: flat and penguin samples should have the same valuation')
  }
  if (!flat.body.top_items.some((item) => item.id === '2001' && item.name === '基础作战记录')) {
    throw new Error('upload formats: flat sample should identify 2001 by built-in name')
  }
  if (!flat.body.top_items.some((item) => item.id === '30011' && item.name === '源岩')) {
    throw new Error('upload formats: flat sample should identify and price 30011')
  }
  if (!flat.body.unpriced_items.some((item) => item.id === 'mod_unlock_token' && item.name === '模组数据块')) {
    throw new Error('upload formats: mod token should be unpriced by policy')
  }
  const furniture = await callDepot({ source: 'upload', inventory: { '3401': 100 } })
  if (!furniture.body.unpriced_items.some((item) => item.id === '3401' && item.name === '家具零件')) {
    throw new Error('upload formats: furniture parts should be unpriced by policy')
  }
  if (flat.body.percentile < 1 || flat.body.percentile > 99) {
    throw new Error('upload formats: percentile should be clamped to 1-99')
  }
  if (flat.body.ranking.contribution_status !== 'not_applicable') {
    throw new Error(`upload formats: expected not_applicable contribution, got ${flat.body.ranking.contribution_status}`)
  }
  if (sampleStore.records.size !== 0) {
    throw new Error('upload formats: upload input should not write sample records')
  }

  const duplicate = await callDepot({
    source: 'upload',
    inventory: {
      '@type': '@penguin-statistics/depot',
      items: [
        { id: '30011', have: 1, name: '源岩' },
        { id: '30011', count: 2, name: '源岩' },
      ],
    },
  })
  const sourceRock = duplicate.body.top_items.find((item) => item.id === '30011')
  if (duplicate.status !== 200 || sourceRock?.count !== 3 || sourceRock.equivalent_sanity !== 6) {
    throw new Error('upload formats: duplicate ids should be merged')
  }
}

async function assertPriceCacheFallback() {
  globalThis.fetch = async () => {
    throw new Error('remote price source down')
  }
  handler = await loadHandler(handlerPath)
  const fallback = await callDepot({ source: 'upload', inventory: { '30011': 2, '31013': 3 } })
  if (fallback.status !== 200) {
    throw new Error(`price cache fallback: expected 200, got ${fallback.status}`)
  }
  if (fallback.body.sources.yituliu !== 'ok') {
    throw new Error(`price cache fallback: expected cached yituliu ok, got ${fallback.body.sources.yituliu}`)
  }
  if (fallback.body.warnings.some((warning) => warning.includes('材料价值源暂不可用'))) {
    throw new Error('price cache fallback: should not downgrade to fixed-only warning when disk cache exists')
  }
  const sourceRock = fallback.body.top_items.find((item) => item.id === '30011')
  const gel = fallback.body.top_items.find((item) => item.id === '31013')
  if (sourceRock?.equivalent_sanity !== 4 || gel?.equivalent_sanity !== 12) {
    throw new Error('price cache fallback: should price materials from persisted cache when remote fails')
  }
}

async function assertUploadErrors() {
  await expectDepotStatus({ source: 'upload', inventory: {} }, 400, 'empty object')
  await expectDepotStatus({ source: 'upload', inventory: { '2001': -1 } }, 400, 'negative count')
  await expectDepotStatus({ source: 'upload', inventory: { '2001': '1' } }, 400, 'string count')
  await expectDepotStatus({ source: 'upload', inventory: { nested: { count: 1 } } }, 400, 'unknown structure')
  await expectRawStatus('{"source":', 400, 'invalid json')

  const tooLarge = JSON.stringify({
    source: 'upload',
    inventory: {
      '2001': 1,
      padding: 'x'.repeat(1024 * 1024),
    },
  })
  await expectRawStatus(tooLarge, 413, 'oversized body')
}

async function assertSklandFlow() {
  globalThis.__depotProfiles = [{
    id: 'unbound-profile',
    status: 'active',
    skland_binding: null,
  }, {
    id: 'bound-profile',
    status: 'active',
    skland_binding: {
      uid: '12345678',
      encrypted_cred: 'bound-secret',
    },
  }]

  const missingAuth = await callDepot({ source: 'skland', profile_id: 'bound-profile' }, { auth: false })
  if (missingAuth.status !== 401) throw new Error(`skland auth: expected 401, got ${missingAuth.status}`)

  const unbound = await callDepot({ source: 'skland', profile_id: 'unbound-profile' })
  if (unbound.status !== 404) throw new Error(`skland unbound: expected 404, got ${unbound.status}`)

  const imported = await callDepot({ source: 'skland', profile_id: 'bound-profile' })
  assertNoSecretLeak(imported.body, 'skland import response')
  if (imported.body.ranking.contribution_status !== 'saved') {
    throw new Error(`skland import: expected default saved contribution, got ${imported.body.ranking.contribution_status}`)
  }
  if (imported.status !== 200 || imported.body.source !== 'skland') {
    throw new Error(`skland import: expected 200 skland result, got ${imported.status}`)
  }
  if (imported.body.sources.ranking !== 'sample_adjusted_curve_v1' || imported.body.ranking.sample_count !== 1) {
    throw new Error('skland import: expected default sample-adjusted ranking with one sample')
  }
  if (sampleStore.records.size !== 1) {
    throw new Error(`skland import: expected one default sample record, got ${sampleStore.records.size}`)
  }
  if (globalThis.__depotSklandUid !== '12345678' || globalThis.__depotClientCred !== 'decrypted-skland-cred') {
    throw new Error('skland import: did not read expected bound account')
  }
  if (!imported.body.unpriced_items.some((item) => item.id === 'mod_unlock_token')) {
    throw new Error('skland import: mod token should remain unpriced')
  }
  const gel = imported.body.top_items.find((item) => item.id === '31013')
  if (gel?.count !== 58 || gel.equivalent_sanity !== 232) {
    throw new Error('skland import: should accept numeric string counts from cultivate inventory')
  }
  const record = [...sampleStore.records.values()][0]
  if (record.account_level !== 120 || record.operator_count !== 3 || record.six_star_count !== 2 || record.elite2_count !== 2) {
    throw new Error('skland import: invalid aggregate operator/account stats')
  }
  assertNoRawSampleLeak(record, 'skland import sample record')

  const repeated = await callDepot({ source: 'skland', profile_id: 'bound-profile' })
  if (repeated.status !== 200 || sampleStore.records.size !== 1) {
    throw new Error('skland import: repeated same uid should update one sample record')
  }

  globalThis.__depotGameInfoFails = true
  const unavailable = await callDepot({ source: 'skland', profile_id: 'bound-profile' })
  globalThis.__depotGameInfoFails = false
  if (unavailable.status !== 200 || unavailable.body.ranking.contribution_status !== 'unavailable') {
    throw new Error(`skland import: game info failure should not block analysis, got ${unavailable.status}/${unavailable.body.ranking.contribution_status}`)
  }
}

async function callDepot(body, init = {}) {
  const request = new Request('http://local/api/depot-value', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: init.auth === false ? '' : 'maa_session=test-session',
    },
    body: JSON.stringify(body),
  })
  const response = await handler(request)
  return { status: response.status, body: await response.json() }
}

async function expectDepotStatus(body, status, label) {
  const result = await callDepot(body)
  if (result.status !== status || !result.body.error) {
    throw new Error(`${label}: expected ${status} error, got ${result.status}`)
  }
}

async function expectRawStatus(body, status, label) {
  const request = new Request('http://local/api/depot-value', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(body)),
    },
    body,
  })
  const response = await handler(request)
  const data = await response.json()
  if (response.status !== status || !data.error) {
    throw new Error(`${label}: expected ${status} error, got ${response.status}`)
  }
}

function assertNoSecretLeak(value, label) {
  const serialized = JSON.stringify(value)
  for (const secret of ['bound-secret', 'decrypted-skland-cred', 'SKLAND-V1:', 'SKLAND-V2:', '12345678', '博士']) {
    if (serialized.includes(secret)) {
      throw new Error(`${label}: leaked ${secret}`)
    }
  }
}

function assertNoRawSampleLeak(value, label) {
  const serialized = JSON.stringify(value)
  for (const secret of ['bound-secret', 'decrypted-skland-cred', 'SKLAND-V1:', 'SKLAND-V2:', '12345678', '博士', 'char_002_amiya', '阿米娅', '源岩']) {
    if (serialized.includes(secret)) {
      throw new Error(`${label}: leaked raw value ${secret}`)
    }
  }
}

async function bundleHandler() {
  const outputPath = resolve(bundleDir, 'server-handlers-depot-value.mjs')
  const result = await esbuild.build({
    entryPoints: ['server/handlers/depot-value.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    plugins: [memorySklandPlugin()],
  })
  await writeFile(outputPath, result.outputFiles[0].text, 'utf8')
  return outputPath
}

async function loadHandler(outputPath) {
  const handlerModule = await import(`${pathToFileURL(outputPath).href}?t=${Date.now()}-${Math.random()}`)
  return handlerModule.default ?? handlerModule
}

function memorySklandPlugin() {
  return {
    name: 'depot-value-memory-skland',
    setup(build) {
      build.onResolve({ filter: /(^|[\\/])user-auth(\.ts)?$/ }, () => ({
        path: 'memory-user-auth',
        namespace: 'depot-smoke',
      }))
      build.onResolve({ filter: /(^|[\\/])skland-client(\.ts)?$/ }, () => ({
        path: 'memory-skland-client',
        namespace: 'depot-smoke',
      }))
      build.onResolve({ filter: /(^|[\\/])depot-value-sample-store(\.ts)?$/ }, () => ({
        path: 'memory-depot-value-sample-store',
        namespace: 'depot-smoke',
      }))
      build.onResolve({ filter: /(^|[\\/])feature-settings-store(\.ts)?$/ }, () => ({
        path: 'memory-feature-settings-store',
        namespace: 'depot-smoke',
      }))
      build.onLoad({ filter: /.*/, namespace: 'depot-smoke' }, (args) => ({
        contents: args.path === 'memory-user-auth'
          ? memoryUserAuthModule()
          : args.path === 'memory-depot-value-sample-store'
            ? memoryDepotValueSampleStoreModule()
            : args.path === 'memory-feature-settings-store'
              ? memoryFeatureSettingsStoreModule()
            : memorySklandClientModule(),
        loader: 'js',
      }))
    },
  }
}

function memoryFeatureSettingsStoreModule() {
  return `
    export async function getSiteFeatureSettings() {
      return {
        version: 1,
        features: {
          site: true,
          registration: true,
          login: true,
          profiles: true,
          tools: true,
          cdk_redemption: true,
          free_preview: true,
          schedule_generation: true,
          depot_value: true,
          skland: true,
          invitations: true,
          announcements: true,
        },
        updated_at: null,
      }
    }
  `
}

function memoryUserAuthModule() {
  return `
    export async function requireUserSession(req) {
      if (!req.headers.get('cookie')?.includes('maa_session=test-session')) return null
      return { user: { id: 'user-1' }, profiles: globalThis.__depotProfiles ?? [] }
    }
  `
}

function memoryDepotValueSampleStoreModule() {
  return `
    export function getDepotValueSampleStore() {
      return globalThis.__maaDepotValueSampleStoreForTesting ?? null
    }
  `
}

function memorySklandClientModule() {
  return `
    export function convertSklandCharactersToOperators(gamePlayerInfo) {
      const chars = gamePlayerInfo?.data?.chars ?? []
      const charInfoMap = gamePlayerInfo?.data?.charInfoMap ?? {}
      return chars
        .filter((item) => item?.charId?.startsWith('char_'))
        .map((item) => ({
          id: item.charId,
          name: item.name ?? charInfoMap[item.charId]?.name,
          own: true,
          elite: Number(item.evolvePhase) || 0,
          level: Number(item.level) || 0,
          potential: Number(item.potentialRank) || 0,
          rarity: Number(charInfoMap[item.charId]?.rarity) || 0,
        }))
    }
    export function decryptSklandCredential(encrypted) {
      if (encrypted !== 'bound-secret') throw new Error('unexpected encrypted credential')
      return 'decrypted-skland-cred'
    }
    export class SklandClient {
      constructor(cred) {
        globalThis.__depotClientCred = cred
      }
      async getCultivateInfo() {
        return {
          data: {
            items: {
              '2001': { name: '基础作战记录' },
              '30011': { name: '源岩' },
              '31013': { name: '凝胶' },
              mod_unlock_token: { name: '模组数据块' },
            },
          },
        }
      }
      async getCultivatePlayer(uid) {
        globalThis.__depotSklandUid = uid
        return {
          data: {
            items: [
              { id: '2001', count: 10 },
              { id: '30011', count: 2 },
              { id: '31013', count: '58' },
              { id: 'mod_unlock_token', count: 1 },
            ],
          },
        }
      }
      async getGamePlayerInfo(uid) {
        globalThis.__depotGameInfoUid = uid
        if (globalThis.__depotGameInfoFails) throw new Error('game player info down')
        return {
          data: {
            status: { level: 120 },
            chars: [
              { charId: 'char_002_amiya', name: '阿米娅', evolvePhase: 2, level: 90, potentialRank: 5 },
              { charId: 'char_010_chen', name: '陈', evolvePhase: 2, level: 80, potentialRank: 2 },
              { charId: 'char_4080_lin', name: '林', evolvePhase: 1, level: 70, potentialRank: 1 },
              { charId: 'token_10002_kalts_mon3tr', name: 'Mon3tr', evolvePhase: 0, level: 1 },
            ],
            charInfoMap: {
              char_002_amiya: { name: '阿米娅', rarity: 4 },
              char_010_chen: { name: '陈', rarity: 5 },
              char_4080_lin: { name: '林', rarity: 5 },
            },
          },
        }
      }
    }
  `
}

function createMemoryDepotValueSampleStore() {
  const records = new Map()
  return {
    records,
    save: async (record) => {
      records.set(record.uid_hash, record)
    },
    getDistribution: async (totalEquivalentSanity) => {
      const values = [...records.values()]
      return {
        sample_count: values.length,
        less_count: values.filter((record) => record.total_equivalent_sanity < totalEquivalentSanity).length,
        equal_count: values.filter((record) => record.total_equivalent_sanity === totalEquivalentSanity).length,
      }
    },
  }
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function sampleName(id) {
  const names = {
    '2001': '基础作战记录',
    '2002': '初级作战记录',
    '2003': '中级作战记录',
    '2004': '高级作战记录',
    '30011': '源岩',
    mod_unlock_token: '模组数据块',
    mod_update_token_1: '数据增补条',
    mod_update_token_2: '数据增补仪',
  }
  return names[id] ?? `物品 ${id}`
}
