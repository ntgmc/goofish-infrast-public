import { describe, expect, it } from 'vitest'
import type { CultivationCandidate, CultivationData, CultivationOptions } from './cultivation-contract'
import { allocateCultivationMaterials, recommendCultivationTargets } from './cultivation-planner'

const candidate = (id: string, frequency: number, items: Record<string, number>): CultivationCandidate => ({
  key: id, operatorId: id, name: id, frequency, fixedFrequency: frequency, stageCount: 1, examples: [1], items, warnings: [], satisfied: false,
  current: { elite: 0, level: 1, skillLevel: 1, masteries: {}, modules: {}, potential: 1 },
  target: { elite: 1, level: 1, skill: 1, skillLevel: 1, moduleId: null, moduleLevel: 0, potential: 1 }, skillId: 's1',
})
const data = (overrides: Partial<CultivationData> = {}): CultivationData => ({
  candidates: [], inventory: {}, itemNames: {}, prices: { rock: 5, chip: 18 }, recipes: {}, farms: {},
  potions: [], stats: { owned: 2, homeworks: 10, missingOperators: 0, incomplete: 0 }, updatedAt: '', importedAt: '', pricingStatus: 'fresh', warnings: [], ...overrides,
})
const options = (overrides: Partial<CultivationOptions> = {}): CultivationOptions => ({ preference: 'coverage', limit: 3, excluded: [], ...overrides })

describe('cultivation recommendations and project resource allocation', () => {
  it('ranks by homework demand independently of stock, material pricing and farming sources', () => {
    const input = data({ candidates: [candidate('popular', 10, { unpriced: 4 }), candidate('ready', 2, { rock: 2 })], inventory: { rock: 2 } })
    expect(recommendCultivationTargets(input, options()).map((row) => row.key)).toEqual(['popular', 'ready'])
    expect(recommendCultivationTargets({ ...input, inventory: { unpriced: 1000 }, prices: {} }, options()).map((row) => row.key)).toEqual(['popular', 'ready'])
    expect(input.inventory).toEqual({ rock: 2 })
    expect(recommendCultivationTargets(input, options({ excluded: ['popular'] })).map((row) => row.key)).toEqual(['ready'])
  })

  it('uses weighted demand and subtracts only fulfilled alternative group weights', () => {
    const old = { ...candidate('old', 100, { rock: 1 }), demandKeys: ['old'], demandWeights: { old: 0.1 }, weightedFrequency: 0.1 }
    const recent = { ...candidate('recent', 1, { rock: 1 }), demandKeys: ['recent'], demandWeights: { recent: 1 }, weightedFrequency: 1 }
    expect(recommendCultivationTargets(data({ candidates: [old, recent] }), options({ limit: 1 }))[0].key).toBe('recent')
    const a = { ...candidate('a', 2, { rock: 1 }), demandKeys: ['group', 'a-fixed'], demandWeights: { group: 5, 'a-fixed': 1 }, weightedFrequency: 6 }
    const b = { ...candidate('b', 2, { rock: 1 }), demandKeys: ['group', 'b-fixed'], demandWeights: { group: 5, 'b-fixed': 0.1 }, weightedFrequency: 5.1 }
    const c = { ...candidate('c', 1, { rock: 1 }), demandKeys: ['c-fixed'], demandWeights: { 'c-fixed': 0.5 }, weightedFrequency: 0.5 }
    const input = data({ candidates: [b, a, c], groups: [{ key: 'group', options: [a, b].map((row) => ({ operatorId: row.operatorId, target: row.target, skillId: row.skillId })) }] })
    expect(recommendCultivationTargets(input, options()).map((row) => [row.key, row.frequency, row.weightedFrequency])).toEqual([['a', 2, 6], ['c', 1, 0.5], ['b', 1, 0.1]])
  })

  it('reserves shared direct requirements and includes crafting currency in project shortages', () => {
    const input = data({ recipes: { high: { count: 1, items: { rock: 3, '4001': 100 } } }, prices: { rock: 5, '4001': 0.0036 } })
    const result = allocateCultivationMaterials({ high: 2, rock: 2 }, { rock: 6, '4001': 100 }, input)
    expect(result.missing).toEqual({ rock: 2, '4001': 100 })
    expect(result.sanity).toBeCloseTo(10.36)
  })

  it('exchanges catalysts using shared procurement certificates and includes missing certificates', () => {
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
    expect(recommendCultivationTargets(input, options()).map((row) => row.key)).toEqual(['a'])
    b.demandKeys.push('fixed')
    expect(recommendCultivationTargets(input, options()).map((row) => [row.key, row.frequency])).toEqual([['b', 2]])
    a.demandKeys.push('other-fixed')
    expect(recommendCultivationTargets(input, options())).toHaveLength(2)
  })

  it('uses training strength to adjust homework priorities and recalculates fulfilled group demand', () => {
    const popular = { ...candidate('popular', 10, {}), communityScore: 0.1 }
    const strong = { ...candidate('strong', 8, {}), communityScore: 0.9 }
    const essential = { ...candidate('essential', 30, {}), communityScore: 0.1 }
    expect(recommendCultivationTargets(data({ candidates: [popular, strong, essential] }), options()).map((row) => row.key)).toEqual(['essential', 'strong', 'popular'])

    const a = { ...strong, demandKeys: ['group'], demandWeights: { group: 8 } }
    const b = { ...popular, demandKeys: ['group', 'fixed'], demandWeights: { group: 8, fixed: 0.1 } }
    const c = { ...candidate('c', 1, {}), communityScore: 0.5 }
    const input = data({ candidates: [a, b, c], groups: [{ key: 'group', options: [a, b].map((row) => ({ operatorId: row.operatorId, target: row.target, skillId: row.skillId })) }] })
    expect(recommendCultivationTargets(input, options()).map((row) => row.key)).toEqual(['strong', 'c', 'popular'])
  })

  it('keeps community recommendations separate and ranks by strength before target adoption', () => {
    const community = { ...candidate('manual', 0, { rock: 2 }), source: 'community' as const, communityRate: 0.8 }
    const higher = { ...candidate('higher', 0, { unknown: 100 }), source: 'community' as const, communityRate: 0.9 }
    const input = data({ candidates: [candidate('homework', 1, { rock: 1 }), community, higher] })
    expect(recommendCultivationTargets(input, options()).map((row) => row.key)).toEqual(['homework'])
    expect(recommendCultivationTargets(input, options({ preference: 'community' })).map((row) => row.key)).toEqual(['higher', 'manual'])
    community.communityRate = 0.7
    const scored = data({ candidates: [{ ...community, communityScore: 0.9 }, { ...higher, communityScore: 0.2 }] })
    expect(recommendCultivationTargets(scored, options({ preference: 'community' })).map((row) => row.key)).toEqual(['manual', 'higher'])
  })

  it('excludes incomplete and satisfied targets and selects at most one target per operator', () => {
    const a = candidate('a', 4, { rock: 1 })
    const b = { ...a, key: 'a-high', frequency: 9, items: { rock: 2 } }
    const unknown = { ...candidate('unknown', 20, { rock: 1 }), warnings: ['module rank missing'] }
    const satisfied = { ...candidate('done', 30, { rock: 1 }), satisfied: true }
    expect(recommendCultivationTargets(data({ candidates: [a, b, unknown, satisfied] }), options()).map((row) => row.key)).toEqual(['a-high'])
  })
})
