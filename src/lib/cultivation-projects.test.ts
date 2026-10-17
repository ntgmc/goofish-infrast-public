import { describe, expect, it } from 'vitest'
import type { CultivationCandidate, CultivationData } from './cultivation-contract'
import { CONFIG_PRESETS } from './config'
import { buildProjectRoute, isCultivationProject, prepareProjectProduction, projectDaysEarlier, readProjectIncome, type CultivationProject } from './cultivation-projects'

const project = (operatorId: string): CultivationProject => ({ operatorId, elite: 2, level: 60, skill: 1, skillLevel: 7, paused: false, deadline: '' })
const candidate = (id: string, items: Record<string, number>): CultivationCandidate => ({
  key: id, operatorId: id, name: id, items, warnings: [], satisfied: false, frequency: 0, fixedFrequency: 0, stageCount: 0, examples: [], skillId: 's1',
  current: { elite: 0, level: 1, skillLevel: 1, masteries: {}, modules: {}, potential: 1 },
  target: { elite: 2, level: 60, skill: 1, skillLevel: 7, potential: 1, moduleId: null, moduleLevel: 0 },
})
const data = (candidates: CultivationCandidate[], overrides: Partial<CultivationData> = {}): CultivationData => ({
  candidates, inventory: {}, itemNames: {}, prices: {}, recipes: {}, farms: {}, potions: [],
  stats: { homeworks: 0, owned: 2, missingOperators: 0, incomplete: 0 }, updatedAt: '', importedAt: '', pricingStatus: 'fresh', warnings: [], ...overrides,
})
const settings = { startDate: '2026-10-06', dailySanity: 0, days: 30, allOpen: false }
const normal = { lmd: 100, exp: 100, goldNet: 0 }

describe('goal-driven resource routes', () => {
  it('uses shared inventory, crafting costs and daily income exactly once; pausing reallocates stock', () => {
    const input = data([candidate('a', { high: 1, exp: 200 }), candidate('b', { rock: 2, exp: 200 })], {
      inventory: { rock: 3, exp: 100 }, recipes: { high: { count: 1, items: { rock: 3, '4001': 100 } } },
      farms: { rock: [{ stage: '1-7', sanity: 6, quantity: 1, days: [1, 2, 3, 4, 5, 6, 7] }] },
    })
    const route = buildProjectRoute(input, [project('a'), project('b')], { ...settings, dailySanity: 6 }, normal)
    expect(route.missing).toEqual({ exp: 300, '4001': 100, rock: 2 })
    expect(route.rows.map((row) => row.estimatedDate)).toEqual(['2026-10-06', '2026-10-08'])
    expect(route.supplied).toEqual({ exp: 300, '4001': 100 })
    expect(route.farmed.rock).toBe(2)
    expect(route.readyDate).toBe('2026-10-08')
    expect(input.inventory).toEqual({ rock: 3, exp: 100 })
    const paused = buildProjectRoute(input, [{ ...project('a'), paused: true }, project('b')], settings, normal)
    expect(paused.missing).toEqual({ exp: 100 })
    expect(paused.readyDate).toBe('2026-10-06')
  })

  it('changes production only until the focused resource is ready and then restores normal income', () => {
    const input = data([candidate('a', { exp: 500, '4001': 900 })])
    const ordinary = { lmd: 300, exp: 100, goldNet: 0 }
    const baseline = buildProjectRoute(input, [project('a')], settings, ordinary)
    const phase = buildProjectRoute(input, [project('a')], settings, ordinary, { lmd: 100, exp: 500, goldNet: 0 })
    expect(baseline.readyDate).toBe('2026-10-10')
    expect(phase.phases.map((day) => day.temporary)).toEqual([true, false, false, false])
    expect(phase.switchDate).toBe('2026-10-07')
    expect(phase.readyDate).toBe('2026-10-09')
    expect(projectDaysEarlier(baseline.readyDate, phase.readyDate)).toBe(1)
  })

  it('checks actual completion rather than assuming extra experience makes the plan faster', () => {
    const input = data([candidate('a', { exp: 1000, '4001': 1000 })])
    const baseline = buildProjectRoute(input, [project('a')], settings, normal)
    const phase = buildProjectRoute(input, [project('a')], settings, normal, { lmd: 0, exp: 500, goldNet: 0 })
    expect(projectDaysEarlier(baseline.readyDate, phase.readyDate)).toBeLessThan(0)
  })

  it('uses whole runs on open weekdays and shares surplus drops between goals', () => {
    const input = data([candidate('a', { chip: 1 }), candidate('b', { chip: 1 })], { farms: { chip: [{ stage: 'PR-A', sanity: 18, quantity: 2, days: [4] }] } })
    const route = buildProjectRoute(input, [project('a'), project('b')], { ...settings, dailySanity: 18 }, null)
    expect(route.readyDate).toBe('2026-10-08')
    expect(route.phases.map((day) => day.spent)).toEqual([0, 0, 18])
    expect(route.farmed.chip).toBe(2)
    expect(buildProjectRoute(input, [project('a')], { ...settings, dailySanity: 17 }, null).readyDate).toBeNull()
    expect(buildProjectRoute(input, [project('a')], { ...settings, dailySanity: 18, allOpen: true }, null).readyDate).toBe('2026-10-06')
  })

  it('bounds stock-limited gold income and never gives dates for unknown costs or missing sources', () => {
    const input = data([candidate('a', { '4001': 300 }), candidate('b', { token: 1 })], { inventory: { '3003': 15 } })
    const route = buildProjectRoute(input, [project('a'), project('b')], settings, { lmd: 100, exp: 0, goldNet: -10 })
    expect(route.supplied['4001']).toBe(150)
    expect(route.goldLimited).toBe(true)
    expect(route.readyDate).toBeNull()
    expect(route.blocked.map((task) => task.item)).toEqual(['token'])
    input.candidates[0].warnings = ['unknown skill level']
    const unknown = buildProjectRoute(input, [project('a')], settings, normal)
    expect(unknown.rows[0].estimatedDate).toBeNull()
    expect(unknown.readyDate).toBeNull()
    const changed = buildProjectRoute(input, [{ ...project('a'), level: 90 }], settings, normal)
    expect(changed.rows[0].candidate).toBeUndefined()
    expect(changed.readyDate).toBeNull()
  })

  it('preserves completed dates, handles no active projects and rejects invalid settings or stored goals', () => {
    const input = data([candidate('a', { exp: 100 })], { inventory: { exp: 100 } })
    expect(buildProjectRoute(input, [project('a')], settings, null).phases).toEqual([])
    expect(buildProjectRoute(input, [project('a')], settings, null).readyDate).toBe(settings.startDate)
    expect(buildProjectRoute(input, [{ ...project('a'), paused: true }], settings, normal).readyDate).toBeNull()
    for (const invalid of [{ dailySanity: NaN }, { dailySanity: -1 }, { dailySanity: 1.2 }, { startDate: '2026-02-30' }, { days: 181 }]) {
      expect(() => buildProjectRoute(input, [project('a')], { ...settings, ...invalid }, null)).toThrow('invalid_project_settings')
    }
    expect(isCultivationProject(project('a'))).toBe(true)
    expect(isCultivationProject({ ...project('a'), deadline: '2026-02-30' })).toBe(false)
    expect(isCultivationProject({ ...project('a'), level: 91 })).toBe(false)
  })

  it('prepares a focused production config without changing factory count or the original config', () => {
    const original = structuredClone(CONFIG_PRESETS['243'])
    const focused = prepareProjectProduction(original, 'exp')!
    expect(focused.product_requirements.manufacturing_stations).toEqual({ 'Pure Gold': 1, 'Battle Record': 3 })
    expect(focused.manufacturing_stations_count).toBe(4)
    expect(focused.allow_product_rebalance).toBe(false)
    expect(prepareProjectProduction(focused, '4001')!.product_requirements).toEqual(original.product_requirements)
    expect(original).toEqual(CONFIG_PRESETS['243'])
    expect(prepareProjectProduction(CONFIG_PRESETS['333-lmd'], '4001')).toBeNull()
  })

  it('reads production in experience points and treats absent or invalid production as unknown', () => {
    expect(readProjectIncome({ manufacturing: { 'Battle Record': 12 }, trading: { LMD: 30000 }, net: { 'Pure Gold': -10 } })).toEqual({ lmd: 30000, exp: 12000, goldNet: -10 })
    expect(readProjectIncome({ manufacturing: {}, trading: {} })).toEqual({ lmd: 0, exp: 0, goldNet: null })
    expect(readProjectIncome({ manufacturing: {}, trading: { LMD: 100 }, consumption: { LMD: 30 } })?.lmd).toBe(70)
    expect(readProjectIncome({ manufacturing: {}, trading: { LMD: 100 }, net: { LMD: 40 } })?.lmd).toBe(40)
    expect(readProjectIncome(undefined)).toBeNull()
    expect(readProjectIncome({ trading: { LMD: 100 } })).toBeNull()
    expect(readProjectIncome({ manufacturing: { 'Battle Record': NaN }, trading: {} })).toBeNull()
  })
})
