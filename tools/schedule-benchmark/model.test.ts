import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calculateProductionSanity } from '../../src/lib/production-sanity'
import { createState, parseBackup, readSimulation as importSimulation, readOperators, comparison, summary, compare, exportCsv, exportReport } from './model'
import type { State, Simulation } from './model'

const artifact = { name: 'simulation.json', sha256: 'a'.repeat(64) }
function result() {
  return {
    plans: Array.from({ length: 3 }, () => ({ shift_hours: 12, mood_valid: true, mood_assumptions: { cyclic_mood_simulation: true },
      rooms: { trading: [{ level: 3, product: 'LMD' }, { level: 3, product: 'LMD' }],
        manufacture: [0, 1, 2, 3].map(i => ({ level: 3, product: i < 2 ? 'Pure Gold' : 'Battle Record' })),
        power: [{ level: 3 }, { level: 3 }, { level: 3 }] },
    })),
    daily_production: { hours: 24, source_hours: 36, manufacturing: { 'Battle Record': 30, 'Pure Gold': 100 }, trading: { LMD: 50000 }, consumption: { 'Pure Gold': 120 }, recycling: {} },
  }
}
function readSimulation(value: unknown, source: typeof artifact, valuation: string) {
  return importSimulation(value, source, valuation, 'S1')
}
function simulation(score: number): Simulation {
  return { ...artifact, importedAt: '', valuation: 'same-version', checks: [], moodInvalid: false, metrics: { sanity: score, lmd: 0, experience: 0, gold: 0, goldConsumed: 0, goldNet: 0, recycling: 0 } }
}
function scores(state: State, account: string, a: number, b: number, c: number) {
  for (const row of state.rows.filter(row => row.account === account && row.scenario === 'S1')) {
    row.simulation = simulation(({ maatool: a, yituliu: b, riic: c })[row.site]); row.status = 'valid'
  }
}

test('creates 18 pilot and 90 formal combinations and validates backup identity atomically', () => {
  const state = createState()
  assert.equal(state.rows.filter(row => row.account.startsWith('P')).length, 18)
  assert.equal(state.rows.filter(row => row.account.startsWith('A')).length, 90)
  assert.deepEqual(parseBackup(JSON.parse(JSON.stringify(state))), state)
  const duplicate = structuredClone(state); duplicate.rows[1] = duplicate.rows[0]
  assert.throws(() => parseBackup(duplicate), /重复或缺失/)
  const grouped = structuredClone(state); grouped.accounts[0].stage = 'formal'
  assert.throws(() => parseBackup(grouped), /分组/)
  const invalid = structuredClone(state); invalid.rows[0].status = 'valid'
  assert.throws(() => parseBackup(invalid), /缺少模拟/)
})

test('extracts daily output using actual MaaTool valuation, including gold deficit', () => {
  const source = result()
  const imported = readSimulation(source, artifact, 'valuation-a')
  assert.equal(imported.metrics.sanity, calculateProductionSanity(source.daily_production).value)
  assert.equal(imported.metrics.experience, 30000)
  assert.equal(imported.metrics.goldNet, -20)
  assert.equal(imported.valuation, 'valuation-a')
  assert.equal(imported.checks.length, 0)
  assert.deepEqual(readSimulation({ result: source }, artifact, 'valuation-a').metrics, imported.metrics)
})

test('rejects missing, unnormalized or wrong-shift results instead of creating zero scores', () => {
  assert.throws(() => readSimulation({ plans: [] }, artifact, 'a'), /完整模拟结果/)
  const raw = result(); raw.daily_production.hours = 36
  assert.throws(() => readSimulation(raw, artifact, 'a'), /24 小时/)
  const shifts = result(); shifts.plans[1].shift_hours = 6
  assert.throws(() => readSimulation(shifts, artifact, 'a'), /12\/12\/12/)
  const missing = result() as unknown as { daily_production: { manufacturing: Record<string, number> } }
  delete missing.daily_production.manufacturing['Battle Record']
  assert.throws(() => readSimulation(missing, artifact, 'a'), /缺少龙门币/)
  const malformed = result(); malformed.daily_production.trading.LMD = Number.NaN
  assert.throws(() => readSimulation(malformed, artifact, 'a'), /完整模拟结果/)
  const negative = result(); negative.daily_production.trading.LMD = -1
  assert.throws(() => readSimulation(negative, artifact, 'a'), /负值/)
  assert.throws(() => importSimulation(result(), artifact, 'a', 'S2'), /设施数量/)
  const levels = result(); levels.plans[0].rooms.trading[0].level = 2
  assert.throws(() => readSimulation(levels, artifact, 'a'), /等级或产物/)
})

test('retains mood warnings for explicit review', () => {
  const raw = result(); raw.plans[0].mood_valid = false
  assert.match(readSimulation(raw, artifact, 'a').checks[0], /心情异常/)
  assert.equal(readSimulation(raw, artifact, 'a').moodInvalid, true)
  const state = createState(); scores(state, 'A01', 110, 100, 100)
  state.fixtures.S1.confirmed = true; state.meta.simulatorVersion = 'test'
  state.rows.find(row => row.account === 'A01' && row.scenario === 'S1' && row.site === 'maatool')!.simulation!.moodInvalid = true
  assert.equal(comparison(state, 'A01', 'S1'), null)
  assert.throws(() => parseBackup(state), /心情无效/)
})

test('excludes pilots, pending fixtures, missing rivals and mixed valuation versions from summary', () => {
  const state = createState()
  scores(state, 'P01', 999, 100, 100)
  scores(state, 'A01', 110, 100, 100)
  scores(state, 'A02', 95, 100, 100)
  assert.equal(summary(state, 'S1').count, 0)
  state.fixtures.S1.confirmed = true; state.meta.simulatorVersion = 'v-test'
  assert.deepEqual(summary(state, 'S1'), { count: 2, median: 2.5, wins: 1, ties: 0, losses: 1 })
  state.rows.find(row => row.account === 'A02' && row.scenario === 'S1' && row.site === 'riic')!.status = 'failed'
  assert.equal(summary(state, 'S1').count, 1)
  assert.equal(summary(state, 'S1', 'yituliu').count, 2)
  state.rows.find(row => row.account === 'A01' && row.scenario === 'S1' && row.site === 'riic')!.simulation!.valuation = 'other'
  assert.equal(comparison(state, 'A01', 'S1'), null)
  assert.throws(() => parseBackup(state), /多个估值版本/)
})

test('uses inclusive one-percent bands and does not divide by nonpositive baseline', () => {
  assert.equal(compare(101, 100)?.label, '接近')
  assert.equal(compare(99, 100)?.label, '接近')
  assert.equal(compare(101.01, 100)?.label, '领先')
  assert.equal(compare(98.99, 100)?.label, '落后')
  assert.equal(compare(10, 0), null)
})

test('exports pending and failed cases without CSV formulas or misleading completed reports', () => {
  const state = createState()
  state.rows[0].note = '=HYPERLINK("https://example.invalid")'
  const csv = exportCsv(state)
  assert.match(csv, /'\=HYPERLINK/)
  assert.equal(csv.split('\r\n').length, 109)
  const report = exportReport(state)
  assert.match(report, /已记录：0/)
  assert.match(report, /待确认/)
  assert.match(report, /\| A10 \| S3 \| 可露希尔/)
  assert.doesNotMatch(report, /\| P01 \| S1/)
  assert.match(report, /文件名、SHA-256/)
})

test('counts actual owned operators and rejects duplicate or malformed snapshots', () => {
  assert.deepEqual(readOperators([{ id: 'one', own: true, elite: 2 }, { id: 'two', own: false, elite: 2 }]), { owned: 1, elite2: 1 })
  assert.throws(() => readOperators([{ id: 'one', own: true, elite: 2 }, { id: 'one', own: true, elite: 2 }]), /重复/)
  assert.throws(() => readOperators({ operators: [] }), /干员数组/)
})
