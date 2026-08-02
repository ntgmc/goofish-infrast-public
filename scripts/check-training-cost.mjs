import * as esbuild from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const bundleDir = resolve('.cache/check-training-cost')
const modulePath = resolve(bundleDir, 'training-cost.mjs')

await mkdir(bundleDir, { recursive: true })
await esbuild.build({
  entryPoints: ['server/handlers/training-cost.ts'],
  outfile: modulePath,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  logLevel: 'silent',
})

const training = await import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`)

const operators = [
  { id: 'char_test_a', name: '测试干员A', own: true, elite: 0, level: 1, rarity: 2 },
  { id: 'char_test_b', name: '测试干员B', own: true, elite: 1, level: 1, rarity: 4 },
]

const calInfo = {
  items: {
    3001: { name: '固源岩', rarity: 2, sortId: 1 },
    3002: { name: '装置', rarity: 2, sortId: 2 },
  },
}

const characterCostA = {
  evolvePhaseCost: [
    {
      items: [
        { id: '3002', count: 1 },
        { id: '3001', count: 2 },
        { id: '3001', count: 1 },
        { id: '4001', count: 10000 },
      ],
    },
  ],
}

const characterCostB = {
  evolvePhaseCost: [
    { items: [] },
    { items: [{ id: '4001', count: 120000 }, { id: '3002', count: 4 }] },
  ],
}

const priced = {
  status: 'fresh',
  prices: new Map([['3001', 18], ['3002', 24]]),
  fetched_at: '2026-07-31T00:00:00.000Z',
  age_ms: 0,
  snapshot_id: 'test-snapshot',
  valuation_version: 'depot-v2:test:test-snapshot',
}
const unpriced = {
  status: 'unavailable',
  prices: new Map(),
  fetched_at: null,
  age_ms: null,
  snapshot_id: null,
  valuation_version: 'depot-v2:test:unavailable',
}

const partial = training.calculateEliteTrainingCostForTest({
  target: { id: 'char_test_a', name: '测试干员A', currentElite: 0, targetElite: 1 },
  operators,
  calInfo,
  calPlayer: {
    items: [
      { id: '4001', count: 5000 },
      { id: '2004', count: 1 },
      { id: '3001', count: 1 },
    ],
    characters: [{ id: 'char_test_a', evolvePhase: 0, level: 1, rarity: 2 }],
  },
  characterCost: characterCostA,
  pricing: priced,
})

if (partial.status !== 'available') throw new Error(`expected priced partial stock to be available, got ${partial.status}`)
if (partial.totals.cash <= 10000 || partial.totals.exp <= 0) throw new Error('E0->E1 should include leveling and promotion costs')
if (partial.totals.materials[0]?.id !== '3001' || partial.totals.materials[0].count !== 3) {
  throw new Error('materials should merge duplicate ids and sort by sortId')
}
if (partial.missing.materials.find((item) => item.id === '3001')?.count !== 2) {
  throw new Error('material inventory should be deducted from missing count')
}
if (!partial.available || partial.available.cash !== partial.totals.cash - partial.missing.cash || partial.available.exp !== partial.totals.exp - partial.missing.exp) {
  throw new Error('available bucket should reflect stocked cash and exp')
}
if (partial.available.materials.find((item) => item.id === '3001')?.count !== 1) {
  throw new Error('available bucket should keep stocked material counts')
}
if (partial.equivalent_sanity === null || partial.equivalent_sanity <= 0) {
  throw new Error('priced missing materials should produce equivalent sanity')
}
if (partial.equivalent_sanity !== partial.totals.equivalent_sanity) {
  throw new Error('top-level equivalent sanity should use total demand')
}
if (partial.equivalent_sanity === partial.missing.equivalent_sanity) {
  throw new Error('top-level equivalent sanity should not use inventory gap')
}
const oldGrossSanity =
  (partial.totals.cash + partial.totals.exp) * (36 / 10000) +
  partial.totals.materials.reduce((sum, item) => sum + (item.equivalent_sanity ?? 0), 0)
if (partial.equivalent_sanity >= oldGrossSanity) {
  throw new Error('LMD equivalent sanity should deduct pure gold consumed by trading post')
}

const enough = training.calculateEliteTrainingCostForTest({
  target: { id: 'char_test_a', name: '测试干员A', currentElite: 0, targetElite: 1 },
  operators,
  calInfo,
  calPlayer: {
    items: [
      { id: '4001', count: 999999 },
      { id: '2004', count: 999999 },
      { id: '3001', count: 99 },
      { id: '3002', count: 99 },
    ],
    characters: [{ id: 'char_test_a', evolvePhase: 0, level: 1, rarity: 2 }],
  },
  characterCost: characterCostA,
  pricing: priced,
})

if (enough.missing.cash !== 0 || enough.missing.exp !== 0 || enough.missing.materials.length !== 0) {
  throw new Error('fully stocked inventory should have no missing resources')
}
if (!enough.available || enough.available.cash !== enough.totals.cash || enough.available.exp !== enough.totals.exp) {
  throw new Error('fully stocked inventory should expose available cash and exp equal to totals')
}
if (enough.available.materials.find((item) => item.id === '3001')?.count !== enough.totals.materials.find((item) => item.id === '3001')?.count) {
  throw new Error('fully stocked inventory should expose available materials equal to totals')
}
if (enough.equivalent_sanity === null || enough.equivalent_sanity <= 0 || enough.totals.equivalent_sanity !== enough.equivalent_sanity) {
  throw new Error('fully stocked inventory should still keep total-demand equivalent sanity')
}
if (enough.missing.equivalent_sanity !== 0) {
  throw new Error('fully stocked inventory should keep missing equivalent sanity at zero')
}

const secondPromotion = training.calculateEliteTrainingCostForTest({
  target: { id: 'char_test_b', name: '测试干员B', currentElite: 1, targetElite: 2 },
  operators,
  calInfo,
  calPlayer: {
    items: [],
    characters: [{ id: 'char_test_b', evolvePhase: 1, level: 1, rarity: 4 }],
  },
  characterCost: characterCostB,
  pricing: priced,
})

if (secondPromotion.totals.cash <= 60000 || secondPromotion.missing.materials[0]?.id !== '3002') {
  throw new Error('E1->E2 should include second promotion costs and materials')
}

const degraded = training.calculateEliteTrainingCostForTest({
  target: { id: 'char_test_a', name: '测试干员A', currentElite: 0, targetElite: 1 },
  operators,
  calInfo,
  calPlayer: { items: [], characters: [{ id: 'char_test_a', evolvePhase: 0, level: 1, rarity: 2 }] },
  characterCost: characterCostA,
  pricing: unpriced,
})

if (degraded.status !== 'partial' || degraded.equivalent_sanity !== null || degraded.unpriced_items.length === 0) {
  throw new Error('unavailable Yituliu pricing should degrade without failing material counts')
}

const nested = training.calculateEliteTrainingCostForTest({
  target: { id: 'char_test_a', name: '测试干员A', currentElite: 0, targetElite: 1 },
  operators,
  calInfo: { data: calInfo },
  calPlayer: {
    data: {
      items: [],
      characters: [{ characterId: 'char_test_a', evolvePhase: 0, level: 1, rarity: 2 }],
    },
  },
  characterCost: { data: { character: characterCostA } },
  pricing: priced,
})

if (nested.totals.materials.find((item) => item.id === '3001')?.count !== 3) {
  throw new Error('nested Skland cultivate payloads should be unwrapped before calculating costs')
}

const priceMap = training.buildYituliuPriceMap({
  code: 200,
  msg: '操作成功',
  data: [
    { itemId: '3003', itemName: '糖', itemValue: 8, itemValueAp: 12 },
  ],
  recommendedStageList: [
    { itemId: '3001', stageResultList: [{ apExpect: 21 }, { apExpect: 19 }] },
  ],
  stageResultList: [
    { itemId: '3001', apExpect: 25 },
    { itemId: '3002', apExpect: 31 },
  ],
})

if (priceMap.get('3001') !== 19 || priceMap.get('3002') !== 31 || priceMap.get('3003') !== 12) {
  throw new Error('Yituliu price map should read itemValueAp and prefer the lowest positive apExpect')
}

const missingOperator = training.calculateEliteTrainingCostForTest({
  target: { id: 'char_missing', name: '不存在干员', currentElite: 0, targetElite: 1 },
  operators,
  calInfo,
  calPlayer: { items: [], characters: [] },
  characterCost: {},
  pricing: priced,
})
if (missingOperator.status !== 'unavailable'
  || missingOperator.operators[0]?.status !== 'unavailable'
  || missingOperator.operators[0]?.error_code !== 'operator_not_found') {
  throw new Error('missing operator must be unavailable instead of a zero-cost available result')
}

const invalidRarity = training.calculateEliteTrainingCostForTest({
  target: { id: 'char_invalid', name: '异常稀有度', currentElite: 0, targetElite: 1 },
  operators: [{ id: 'char_invalid', name: '异常稀有度', own: true, elite: 0, level: 1, rarity: 99 }],
  calInfo,
  calPlayer: { items: [], characters: [{ id: 'char_invalid', evolvePhase: 0, level: 1 }] },
  characterCost: characterCostA,
  pricing: priced,
})
if (invalidRarity.status !== 'unavailable' || invalidRarity.operators[0]?.error_code !== 'invalid_rarity') {
  throw new Error('invalid rarity must be unavailable instead of a zero-cost available result')
}

const eliteOutOfRange = training.calculateEliteTrainingCostForTest({
  target: { id: 'char_test_a', name: '测试干员A', currentElite: 0, targetElite: 9 },
  operators,
  calInfo,
  calPlayer: { items: [], characters: [{ id: 'char_test_a', evolvePhase: 0, level: 1 }] },
  characterCost: characterCostA,
  pricing: priced,
})
if (eliteOutOfRange.status !== 'unavailable' || eliteOutOfRange.operators[0]?.error_code !== 'elite_out_of_range') {
  throw new Error('elite phase overflow must be unavailable instead of a zero-cost available result')
}

const missingPromotionMaterials = training.calculateEliteTrainingCostForTest({
  target: { id: 'char_test_b', name: '测试干员B', currentElite: 1, targetElite: 2 },
  operators,
  calInfo,
  calPlayer: { items: [], characters: [{ id: 'char_test_b', evolvePhase: 1, level: 1 }] },
  characterCost: { evolvePhaseCost: [{ items: [] }] },
  pricing: priced,
})
if (missingPromotionMaterials.status !== 'partial'
  || missingPromotionMaterials.operators[0]?.status !== 'partial'
  || missingPromotionMaterials.operators[0]?.error_code !== 'missing_promotion_materials') {
  throw new Error('missing material details for any required phase must keep the aggregate cost partial')
}

console.log('training cost smoke check ok')
