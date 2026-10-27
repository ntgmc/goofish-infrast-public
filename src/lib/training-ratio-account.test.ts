import { describe, expect, it } from 'vitest'
import levels from '../data/training-level-data.json'
import { accountTrainingRequirements, analyzeAccountTraining, defaultTrainingSettings, estimateAccountTrainingDays, type TrainingAccountData } from './training-ratio-account'

const account: TrainingAccountData = { snapshotVersion: '1', importedAt: '2026-10-27T00:00:00Z', inventory: { lmd: 0, exp: 0 }, levels, warnings: [], operators: [
  { id: 'a', name: 'A', rarity: 6, elite: 0, level: 1, modules: [
    { id: 'x', name: 'X', elite: 2, level: 60, current: 1, costs: [80000, 100000, 120000], common: true },
    { id: 'y', name: 'Y', elite: 2, level: 60, current: 0, costs: [80000, 100000, 120000], common: false },
  ] },
] }

describe('account cultivation budget', () => {
  it('counts remaining levels once and only the unfinished ranks of selected modules', () => {
    const common = accountTrainingRequirements(account, { ...defaultTrainingSettings, modules: 'common', moduleLevel: 3 })
    expect(common).toMatchObject({ lmd: 981409, exp: 588286, moduleLmd: 220000, operators: 1, issues: [] })
    expect(common.modules).toEqual([{ operator: 'A', name: 'X', from: 1, to: 3, lmd: 220000 }])
    const all = accountTrainingRequirements(account, { ...defaultTrainingSettings, modules: 'all', moduleLevel: 3 })
    expect(all).toMatchObject({ lmd: 1281409, exp: 588286, moduleLmd: 520000, operators: 1 })
    expect(accountTrainingRequirements(account, { ...defaultTrainingSettings, six: 'none', modules: 'all', moduleLevel: 3 })).toMatchObject({ lmd: 0, exp: 0, operators: 0, modules: [] })
  })
  it('includes module prerequisites and never charges already completed training', () => {
    const current = { ...account.operators[0], elite: 2, level: 70 }
    const data = { ...account, operators: [current] }
    expect(accountTrainingRequirements(data, defaultTrainingSettings)).toMatchObject({ lmd: 0, exp: 0, operators: 0 })
    expect(accountTrainingRequirements(data, { ...defaultTrainingSettings, six: 'max' }).exp).toBeGreaterThan(0)
    const normal = accountTrainingRequirements(account, defaultTrainingSettings)
    const higherUnlock = { ...account, operators: [{ ...account.operators[0], modules: [{ ...account.operators[0].modules[1], level: 80 }] }] }
    expect(accountTrainingRequirements(higherUnlock, { ...defaultTrainingSettings, modules: 'all' }).exp).toBeGreaterThan(normal.exp)
  })
  it('does not treat missing module state, statistics, or cost tables as zero', () => {
    for (const [patch, reason] of [[{ current: null }, 'modules'], [{ common: null }, 'common'], [{ costs: [null, 0, 0] }, 'costs']] as const) {
      const data = { ...account, operators: [{ ...account.operators[0], modules: [{ ...account.operators[0].modules[1], common: true, ...patch, costs: patch.costs ? [...patch.costs] : account.operators[0].modules[1].costs }] }] }
      expect(accountTrainingRequirements(data, { ...defaultTrainingSettings, modules: 'common' }).issues).toEqual([{ name: 'A', reason }])
    }
  })
  it('uses remaining cultivation costs for the reference, and caps stock deductions at the actual needs', () => {
    expect(analyzeAccountTraining({ lmd: 800000, exp: 100000 }, { lmd: 1000000, exp: 500000 })).toEqual({ ratio: 2, focus: 'exp', missing: { lmd: 200000, exp: 400000 } })
    expect(analyzeAccountTraining({ lmd: 1000000, exp: 1000000 }, { lmd: 100, exp: 200 }).focus).toBe('ready')
    expect(analyzeAccountTraining({ lmd: 0, exp: 1000000 }, { lmd: 100, exp: 0 })).toEqual({ ratio: null, focus: 'lmd', missing: { lmd: 100, exp: 0 } })
    expect(analyzeAccountTraining({ lmd: 0, exp: 0 }, { lmd: 0, exp: 0 }).focus).toBe('ready')
  })
})

describe('time to cover the chosen goals', () => {
  const monday = new Date('2026-10-19T04:00:00+08:00')
  it('splits sanity between both resources, includes LS-6 cash, and stops once the requirements are covered', () => {
    expect(estimateAccountTrainingDays({ lmd: 0, exp: 0 }, { lmd: 2880, exp: 66666 }, null, monday)).toBe(2)
    expect(estimateAccountTrainingDays({ lmd: 0, exp: 0 }, { lmd: 2879, exp: 66666 }, null, monday)).toBe(1)
    expect(estimateAccountTrainingDays({ lmd: 0, exp: 0 }, { lmd: 100000, exp: 100000 }, null, monday)).toBe(4)
    expect(estimateAccountTrainingDays({ lmd: 100, exp: 200 }, { lmd: 100, exp: 200 }, null, monday)).toBe(0)
  })
  it('keeps the earliest feasible date when later base EXP replaces LS-6 and its incidental cash', () => {
    expect(estimateAccountTrainingDays({ lmd: 0, exp: 0 }, { lmd: 267000, exp: 400000 }, { lmd: 0, exp: 50000 }, monday)).toBe(7)
  })
  it('respects CE-6 open days and the CN reset, while base income accrues on every day', () => {
    expect(estimateAccountTrainingDays({ lmd: 0, exp: 0 }, { lmd: 10000, exp: 0 }, null, monday)).toBe(2)
    expect(estimateAccountTrainingDays({ lmd: 0, exp: 0 }, { lmd: 10000, exp: 0 }, null, new Date('2026-10-20T03:59:59+08:00'))).toBe(2)
    expect(estimateAccountTrainingDays({ lmd: 0, exp: 0 }, { lmd: 10000, exp: 0 }, null, new Date('2026-10-20T04:00:00+08:00'))).toBe(1)
    expect(estimateAccountTrainingDays({ lmd: 0, exp: 0 }, { lmd: 10000, exp: 0 }, { lmd: 10000, exp: 0 }, monday)).toBe(1)
    expect(() => estimateAccountTrainingDays({ lmd: 0, exp: 0 }, { lmd: -1, exp: 0 }, null, monday)).toThrow('invalid_training_resources')
  })
})
