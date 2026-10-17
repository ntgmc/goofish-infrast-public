import { describe, expect, it } from 'vitest'
import { analyzeTrainingBalance, calculateTrainingCost } from './training-ratio'

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
