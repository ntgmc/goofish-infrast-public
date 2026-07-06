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
const sanityDebugLogs = []
const originalConsoleInfo = console.info
console.info = (...args) => {
  if (args[0] === '[training-cost sanity debug]') {
    sanityDebugLogs.push(args)
    return
  }
  originalConsoleInfo(...args)
}

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

const priced = { status: 'ok', prices: new Map([['3001', 18], ['3002', 24]]) }
const unpriced = { status: 'unavailable', prices: new Map() }

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
const firstSanityDebug = JSON.parse(sanityDebugLogs[0]?.[1] ?? '{}')
if (!String(firstSanityDebug.formula ?? '').includes(' * ') || !String(firstSanityDebug.formula ?? '').includes('龙门币')) {
  throw new Error('sanity debug log should include a readable multiplication formula')
}
if (!String(firstSanityDebug.lmd?.unit_formula ?? '').includes('0.002')) {
  throw new Error('sanity debug log should show pure gold deduction in LMD unit formula')
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

console.info = originalConsoleInfo
console.log('training cost smoke check ok')
