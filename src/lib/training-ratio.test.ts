import { describe, expect, it } from 'vitest'
import { analyzeTrainingBalance, calculateTrainingCost, estimateTrainingRecovery } from './training-ratio'

const base = { rarity: 6, currentElite: 0, currentLevel: 1, targetElite: 2, targetLevel: 60 }
describe('shared game training costs', () => {
  it.each([
    [4, 0, 1, 40, 264506, 242936], [5, 0, 1, 50, 476260, 390161],
    [6, 0, 1, 1, 589841, 361400], [6, 0, 1, 60, 761409, 588286],
    [6, 2, 1, 60, 171568, 226886], [6, 0, 1, 90, 1334796, 1111400],
  ])('matches game costs for rarity %i E%i L%i to E2 L%i', (rarity, currentElite, currentLevel, targetLevel, lmd, exp) => {
    expect(calculateTrainingCost({ ...base, rarity, currentElite, currentLevel, targetLevel })).toMatchObject({ lmd, exp })
  })
  it('adds promotion once and composes consecutive upgrades without losing costs', () => {
    const first = calculateTrainingCost({ ...base, targetElite: 1, targetLevel: 80 })
    const second = calculateTrainingCost({ ...base, currentElite: 1, currentLevel: 80 })
    const total = calculateTrainingCost(base)
    expect(first.lmd + second.lmd).toBe(total.lmd)
    expect(first.exp + second.exp).toBe(total.exp)
    expect(second.promotionLmd).toBe(180000)
    expect(calculateTrainingCost({ ...base, currentElite: 2, currentLevel: 60 })).toMatchObject({ lmd: 0, exp: 0 })
  })
  it('rejects impossible goals and incomplete tables', () => {
    for (const goal of [{ ...base, rarity: 3 }, { ...base, currentElite: 2, currentLevel: 70 }, { ...base, targetLevel: 91 }, { ...base, currentElite: -1 }]) {
      expect(() => calculateTrainingCost(goal)).toThrow('invalid_training_goal')
    }
    expect(() => calculateTrainingCost(base, { maxLevel: [[], [], [], [], [], [50, 80, 90]], characterExpMap: [], characterUpgradeCostMap: [], evolveGoldCost: [] })).toThrow('incomplete_training_levels')
  })
})

describe('time to restore inventory balance', () => {
  const monday = new Date('2026-10-19T04:00:00+08:00')
  it('counts both base resources while farming EXP instead of dividing the initial shortage by EXP output', () => {
    const inventory = { lmd: 13000000, exp: 0 }
    const income = { lmd: 65000, exp: 20000 }
    const result = estimateTrainingRecovery(inventory, income, monday)!
    expect(result).toEqual({ stage: 'LS-6', days: 291 })
    const dailyGain = (income.exp + 240 / 36 * 10000) * 1.3 - income.lmd - 240 / 36 * 432
    expect((result.days! - 1) * dailyGain).toBeLessThan(inventory.lmd)
    expect(result.days! * dailyGain).toBeGreaterThanOrEqual(inventory.lmd)
  })
  it('counts CE-6 closed days and uses the CN 04:00 reset', () => {
    const inventory = { lmd: 0, exp: 100000 }
    expect(estimateTrainingRecovery(inventory, null, monday)).toEqual({ stage: 'CE-6', days: 4 })
    expect(estimateTrainingRecovery(inventory, null, new Date('2026-10-20T03:59:59+08:00'))?.days).toBe(4)
    expect(estimateTrainingRecovery(inventory, null, new Date('2026-10-20T04:00:00+08:00'))?.days).toBe(3)
  })
  it('finds the earliest day across repeated weeks, including temporary gains with an adverse weekly trend', () => {
    for (const inventory of [{ lmd: 0, exp: 1000000 }, { lmd: 0, exp: 10000 }, { lmd: 2000000, exp: 0 }]) {
      for (const income of [{ lmd: 10000, exp: 30000 }, { lmd: 0, exp: 35000 }, { lmd: 100000, exp: 10000 }]) {
        const result = estimateTrainingRecovery(inventory, income, monday)!
        let gap = inventory.lmd - inventory.exp * 1.3
        let days: number | null = null
        for (let day = 1; day <= 3650; day++) {
          const open = result.stage === 'LS-6' || [0, 2, 4, 6].includes(day % 7)
          const farm = open ? 240 / 36 : 0
          gap += income.lmd + (result.stage === 'CE-6' ? farm * 10000 : farm * 432)
            - (income.exp + (result.stage === 'LS-6' ? farm * 10000 : 0)) * 1.3
          if (result.stage === 'CE-6' ? gap >= -1e-6 : gap <= 1e-6) { days = day; break }
        }
        expect(result.days).toBe(days)
      }
    }
  })
  it('handles unavailable production, non-converging income, balanced stock and invalid inputs', () => {
    expect(estimateTrainingRecovery({ lmd: 13000000, exp: 0 }, null, monday)).toEqual({ stage: 'LS-6', days: 156 })
    expect(estimateTrainingRecovery({ lmd: 13000000, exp: 0 }, { lmd: 100000, exp: 0 }, monday)?.days).toBeNull()
    expect(estimateTrainingRecovery({ lmd: 0, exp: 1000000 }, { lmd: 0, exp: 100000 }, monday)?.days).toBeNull()
    expect(estimateTrainingRecovery({ lmd: 130000, exp: 100000 }, null, monday)).toBeNull()
    expect(estimateTrainingRecovery({ lmd: 0, exp: 0 }, null, monday)).toBeNull()
    expect(() => estimateTrainingRecovery({ lmd: 0, exp: 1 }, { lmd: NaN, exp: 0 }, monday)).toThrow('invalid_training_income')
  })
})

describe('inventory balance advice', () => {
  it.each([
    [0, 0, 'empty', 0], [100000, 100000, 'lmd', 30000], [200000, 100000, 'exp', 53847],
    [120000, 100000, 'balanced', 0], [140000, 100000, 'balanced', 0],
    [119999, 100000, 'lmd', 10001], [140001, 100000, 'exp', 7694],
    [0, 10000, 'lmd', 13000], [13000, 0, 'exp', 10000],
  ])('classifies LMD %i and EXP %i as %s', (lmd, exp, focus, supplement) => {
    const result = analyzeTrainingBalance({ lmd, exp })
    expect(result).toMatchObject({ focus, supplement })
    if (focus === 'lmd') expect(analyzeTrainingBalance({ lmd: lmd + result.supplement, exp }).focus).toBe('balanced')
    if (focus === 'exp') expect(analyzeTrainingBalance({ lmd, exp: exp + result.supplement }).focus).toBe('balanced')
  })
  it('rejects invalid inventory and never represents a zero denominator as infinity', () => {
    expect(analyzeTrainingBalance({ lmd: 1000, exp: 0 }).ratio).toBeNull()
    for (const value of [-1, NaN, Infinity]) expect(() => analyzeTrainingBalance({ lmd: value, exp: 1 })).toThrow('invalid_training_resources')
  })
})
