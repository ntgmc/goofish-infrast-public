import { describe, expect, it } from 'vitest'
import type { CultivationCandidate, CultivationData, CultivationOptions } from './cultivation-contract'
import { allocateCultivationMaterials, buildCultivationPlan } from './cultivation-planner'

const candidate = (id: string, frequency: number, items: Record<string, number>): CultivationCandidate => ({
  key: id, operatorId: id, name: id, frequency, fixedFrequency: frequency, stageCount: 1, examples: [1], items, warnings: [], satisfied: false,
  current: { elite: 0, level: 1, skillLevel: 1, masteries: {}, modules: {}, potential: 1 },
  target: { elite: 1, level: 1, skill: 1, skillLevel: 1, moduleId: null, moduleLevel: 0, potential: 1 }, skillId: 's1',
})
const data = (overrides: Partial<CultivationData> = {}): CultivationData => ({
  candidates: [], inventory: {}, itemNames: {}, prices: { rock: 5, chip: 18 }, recipes: {},
  farms: { rock: [{ stage: '1-7', quantity: 1, sanity: 6, days: [1, 2, 3, 4, 5, 6, 7] }], chip: [{ stage: 'PR-A-1', quantity: 1, sanity: 18, days: [1, 4, 5, 7] }] },
  potions: [], stats: { owned: 2, homeworks: 10, missingOperators: 0, incomplete: 0 }, updatedAt: '', importedAt: '', pricingStatus: 'fresh', warnings: [], ...overrides,
})
const options = (overrides: Partial<CultivationOptions> = {}): CultivationOptions => ({ preference: 'coverage', dailySanity: 18, startDate: '2026-10-06', days: 7, limit: 3, excluded: [], potions: {}, allOpen: false, ...overrides })

describe('cultivation planning with shared resources', () => {
  it('changes priorities and allocates stock only once across consecutive targets', () => {
    const input = data({ candidates: [candidate('popular', 10, { rock: 4 }), candidate('ready', 2, { rock: 2 })], inventory: { rock: 2 } })
    const coverage = buildCultivationPlan(input, options())
    expect(coverage.selected.map((row) => row.candidate.key)).toEqual(['popular', 'ready'])
    expect(coverage.selected.map((row) => row.allocation.missing)).toEqual([{ rock: 2 }, { rock: 2 }])
    const ready = buildCultivationPlan(input, options({ preference: 'materials' }))
    expect(ready.selected.map((row) => row.candidate.key)).toEqual(['ready', 'popular'])
    expect(ready.selected[0].allocation.missing).toEqual({})
    expect(input.inventory).toEqual({ rock: 2 })
  })

  it('reserves shared direct requirements and includes crafting currency', () => {
    const input = data({ recipes: { high: { count: 1, items: { rock: 3, '4001': 100 } } }, prices: { rock: 5, '4001': 0.0036 } })
    const result = allocateCultivationMaterials({ high: 2, rock: 2 }, { rock: 6, '4001': 100 }, input)
    expect(result.missing).toEqual({ rock: 2, '4001': 100 })
    expect(result.sanity).toBeCloseTo(10.36)
  })

  it('exchanges catalysts using shared procurement certificates and farms only the missing certificates', () => {
    const input = data({ prices: { '4006': 1 }, recipes: { double: { count: 1, items: { '32001': 1, chip: 2 } } } })
    const result = allocateCultivationMaterials({ double: 2, '4006': 30 }, { '32001': 1, '4006': 100, chip: 4 }, input)
    expect(result.exchanges).toEqual([{ item: '32001', count: 1, currency: '4006', cost: 90 }])
    expect(result.missing).toEqual({ '4006': 20 })
    expect(result.sanity).toBe(20)
    expect(allocateCultivationMaterials({ '32001': 10 }, { '4006': 900 }, input).missing).toEqual({})
  })

  it('fulfills an alternative group once while retaining an independent fixed demand', () => {
    const a = { ...candidate('a', 1, { rock: 2 }), demandKeys: ['group'] }
    const b = { ...candidate('b', 1, { rock: 3 }), demandKeys: ['group'] }
    const input = data({ candidates: [a, b], groups: [{ key: 'group', options: [a, b].map((row) => ({ operatorId: row.operatorId, target: row.target, skillId: row.skillId })) }] })
    expect(buildCultivationPlan(input, options()).selected.map((row) => row.candidate.key)).toEqual(['a'])
    b.demandKeys.push('fixed')
    const result = buildCultivationPlan(input, options())
    expect(result.selected.map((row) => [row.candidate.key, row.candidate.frequency])).toEqual([['b', 2]])
    a.demandKeys.push('other-fixed')
    const independent = buildCultivationPlan(input, options())
    expect(independent.selected).toHaveLength(2)
    expect(independent.totalMaterials).toEqual({ rock: 5 })
    expect(independent.missingMaterials).toEqual({ rock: 5 })
    expect(independent.totalTrainingSanity).toBe(25)
  })

  it('recommends community targets with no homework only under the statistics preference', () => {
    const community = { ...candidate('manual', 0, { rock: 2 }), source: 'community' as const, communityRate: 0.8 }
    const input = data({ candidates: [candidate('homework', 1, { rock: 1 }), community] })
    expect(buildCultivationPlan(input, options()).selected.map((row) => row.candidate.key)).toEqual(['homework'])
    expect(buildCultivationPlan(input, options({ preference: 'community' })).selected.map((row) => row.candidate.key)).toEqual(['manual'])
  })

  it('waits for open days and spends only whole runs within the budget', () => {
    const input = data({ candidates: [candidate('a', 10, { chip: 2, rock: 1 })] })
    const result = buildCultivationPlan(input, options())
    expect(result.days[0].farms[0].stage).toBe('1-7')
    expect(result.days.find((day) => day.date === '2026-10-07')?.farms).toEqual([])
    expect(result.selected[0].estimatedDate).toBe('2026-10-09')
    expect(result.days.every((day) => day.spent <= day.budget)).toBe(true)
    expect(buildCultivationPlan(input, options({ dailySanity: 17 })).remaining.some((task) => task.item === 'chip')).toBe(true)
  })

  it('uses opted-in potions once, excludes expired potions, and permits zero natural budget', () => {
    const input = data({ candidates: [candidate('a', 10, { rock: 12 })], potions: [
      { key: 'expired', name: 'expired', count: 10, sanity: 60, expiresAt: '2026-10-05T20:00:00Z' },
      { key: 'valid', name: 'valid', count: 1, sanity: 60, expiresAt: '2026-10-08T20:00:00Z' },
    ] })
    const result = buildCultivationPlan(input, options({ dailySanity: 0, potions: { expired: 10, valid: 20 } }))
    expect(result.days[0].potions).toEqual([{ name: 'valid', count: 1 }])
    expect(result.days.flatMap((day) => day.potions).length).toBe(1)
    expect(result.remaining[0].remaining).toBe(2)
    expect(buildCultivationPlan(input, options({ dailySanity: 0 })).days.every((day) => day.spent === 0)).toBe(true)
  })

  it('does not rank unpriced or time-gated resources as free, or claim a finish date', () => {
    const input = data({ candidates: [candidate('unpriced', 20, { module_token: 1 }), candidate('cheap', 2, { rock: 1 })] })
    const result = buildCultivationPlan(input, options({ preference: 'cost' }))
    expect(result.selected[0].candidate.key).toBe('cheap')
    expect(result.selected[1].allocation.sanity).toBeNull()
    expect(result.selected[1].estimatedDate).toBeNull()
    expect(result.blocked[0].item).toBe('module_token')
  })

  it('excludes incomplete targets and selects at most one target for each operator', () => {
    const a = candidate('a', 4, { rock: 1 })
    const b = { ...a, key: 'a-high', frequency: 9, items: { rock: 2 } }
    const unknown = { ...candidate('unknown', 20, { rock: 1 }), warnings: ['module rank missing'] }
    const result = buildCultivationPlan(data({ candidates: [a, b, unknown] }), options())
    expect(result.selected.map((row) => row.candidate.key)).toEqual(['a-high'])
  })
})
