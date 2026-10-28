import { describe, expect, it } from 'vitest'
import { CONFIG_PRESETS, normalizeConfig } from './config'
import { copy } from '../copy'
import { createManualPlans, manualResult, manualSourceKey, parseManualDraft, validateManualPlans } from './manual-schedule'
import { changeManualFacility, createBlankManualSchedule, isManualScheduleProfileAvailable, parseManualScheduleJson, resolveManualScheduleConfig, UnownedScheduleOperatorsError } from './manual-schedule-tool'
import { FACILITY_IDS } from './facility-layout'
import type { LicenseOperator, UserGameAccount } from './types'

const config = normalizeConfig(CONFIG_PRESETS['243'])
const operators: LicenseOperator[] = [{ id: 'f', name: '芬', own: true, elite: 1, rarity: 3 }]
const profile: UserGameAccount = {
  id: 'p', user_id: 'u', kind: 'cdk', permission: 'advanced', status: 'active',
  cdk_order_hash: null, display_name: '档案', note: '', operator_count: 1, updated_at: null, created_at: '2026-01-01',
}

describe('standalone manual schedules', () => {
  it('requires a current advanced permission, including an active trial', () => {
    const now = Date.parse('2026-10-02T00:00:00Z')
    expect(isManualScheduleProfileAvailable(profile, now)).toBe(true)
    for (const changes of [
      { permission: 'recommended' }, { status: 'frozen' }, { status: 'revoked' },
      { archived_at: '2026-10-01' }, { expires_at: '2026-10-02T00:00:00Z' },
      { expires_at: 'invalid' }, { kind: 'depot_value' }, { kind: 'free_preview' },
    ] as Partial<UserGameAccount>[]) {
      expect(isManualScheduleProfileAvailable({ ...profile, ...changes }, now)).toBe(false)
    }
    const trial: UserGameAccount = { ...profile, kind: 'free_preview', permission: 'recommended', trial: {
      id: 't', active: true, effective_permission: 'advanced',
      starts_at: '2026-10-01T00:00:00Z', ends_at: '2026-10-03T00:00:00Z',
    } }
    expect(isManualScheduleProfileAvailable(trial, now)).toBe(true)
    expect(isManualScheduleProfileAvailable(trial, Date.parse(trial.trial!.ends_at))).toBe(false)
  })

  it('creates empty facilities and rejects invalid shift input instead of replacing it', () => {
    const source = createBlankManualSchedule({ ...config, shift_hours: [12, 6, 6] })
    expect(source.shift_hours).toEqual([12, 6, 6])
    expect(source.plans).toHaveLength(3)
    expect(source.plans[0].rooms.manufacture).toHaveLength(4)
    expect(createManualPlans(source)[0].rooms.control[0]).toEqual(['', '', '', '', ''])
    expect(source.plans.every((plan) => Object.values(plan.rooms).flat().every((room) => room.operators?.length === 0))).toBe(true)
    expect(() => createBlankManualSchedule({ ...config, shift_hours: 'invalid' })).toThrow()
  })

  it('round-trips recycling rooms and enforces their capacity and level', () => {
    const enabled = { ...config, recycling_station_level: 1 }
    const source = createBlankManualSchedule(enabled)
    const imported = parseManualScheduleJson(JSON.stringify(source), enabled, operators)
    expect(resolveManualScheduleConfig(imported, config, operators).recycling_station_level).toBe(1)
    expect(createManualPlans(imported)[0].rooms.recycling[0]).toHaveLength(1)
    source.plans[0].rooms.recycling[0].operators = ['芬', '芬']
    expect(() => parseManualScheduleJson(JSON.stringify(source), enabled, operators)).toThrow()
    source.plans.forEach((plan) => { plan.rooms.recycling[0] = { level: 4, operators: [] } })
    expect(() => parseManualScheduleJson(JSON.stringify(source), enabled, operators)).toThrow()
  })

  it('adds and removes recycling in every shift and rejects changes that would discard assignments', () => {
    const source = createBlankManualSchedule(config)
    source.plans.forEach((plan) => { delete plan.rooms.recycling })
    const added = changeManualFacility(source, 'recycling', 0, { level: 2 })
    expect(added.plans.every((plan) => plan.rooms.recycling[0].level === 2)).toBe(true)
    expect(createManualPlans(added).every((plan) => plan.rooms.recycling[0].length === 2)).toBe(true)
    added.plans[1].rooms.recycling[0].operators = ['', '芬']
    expect(() => changeManualFacility(added, 'recycling', 0, { level: 0 })).toThrow(copy.tools.manualSchedule.recyclingOccupied)
    expect(() => changeManualFacility(added, 'recycling', 0, { level: 1 })).toThrow(copy.tools.manualSchedule.occupiedSlots)
    expect(added.plans[1].rooms.recycling[0]).toMatchObject({ level: 2, operators: ['', '芬'] })
    added.plans[1].rooms.recycling[0].operators = []
    const removed = changeManualFacility(added, 'recycling', 0, { level: 0 })
    expect(removed.plans.every((plan) => plan.rooms.recycling.length === 0)).toBe(true)
    expect(resolveManualScheduleConfig(removed, config, operators).recycling_station_level).toBe(0)
    expect(parseManualScheduleJson(JSON.stringify(removed), config, operators).plans[0].rooms.recycling).toEqual([])
    expect(source.plans[0].rooms.recycling).toBeUndefined()
  })

  it('imports MAA and full result JSON while removing stale calculations', () => {
    const source = createBlankManualSchedule(config)
    source.plans[0].rooms.manufacture[0].operators = ['芬']
    const imported = parseManualScheduleJson(JSON.stringify({
      ...source, total_efficiency: 999, daily_production: { LMD: 999 },
      raw_results: [{ unexpected: true }],
    }), config, operators)
    expect(imported.total_efficiency).toBeUndefined()
    expect(imported.daily_production).toBeUndefined()
    expect(imported.raw_results).toEqual([])
    expect(imported.plans[0].rooms.manufacture[0].operators).toEqual(['芬'])
    const maa = { title: source.title, description: '', plans: source.plans.map(({ shift_hours: _hours, ...plan }) => plan) }
    expect(parseManualScheduleJson(JSON.stringify(maa), config, operators).shift_hours).toEqual([8, 8, 8])
  })

  it.each(['252', '333'])('imports MAA products with full-level facilities when the current layout is %s', (preset) => {
    const source = createBlankManualSchedule(config)
    source.plans[0].rooms.trading[1].operators = ['芬']
    const maa = { title: source.title, plans: source.plans.map(({ rooms, ...plan }) => ({
      ...plan, rooms: Object.fromEntries(Object.entries(rooms).map(([type, entries]) => [
        type, entries.map(({ level: _level, ...room }) => room),
      ])),
    })) }
    const current = normalizeConfig(CONFIG_PRESETS[preset])
    const imported = parseManualScheduleJson(JSON.stringify(maa), current, operators)
    const resolved = resolveManualScheduleConfig(imported, current, operators)
    expect(resolved.layout).toBe('2-4-3')
    expect(resolved.trading_station_levels).toEqual([3, 3])
    expect(resolved.manufacturing_station_levels).toEqual([3, 3, 3, 3])
    expect(resolved.product_requirements).toEqual(config.product_requirements)
    expect(imported.plans[0].rooms.trading[1].operators).toEqual(['芬'])
    maa.plans.forEach((plan) => { delete plan.rooms.manufacture[0].product })
    expect(() => parseManualScheduleJson(JSON.stringify(maa), current, operators)).toThrow(copy.tools.manualSchedule.importMissingProduct)
  })

  it.each([undefined, 'maa_pure_autofill'] as const)('preserves stationed dormitory operators with autofill and rule %s', (dormitory_rule) => {
    const source = createBlankManualSchedule(config)
    source.dormitory_rule = dormitory_rule
    source.plans.forEach((plan) => {
      plan.rooms.dormitory[0] = { level: 5, operators: ['芬'], autofill: true }
      plan.rooms.dormitory[1].autofill = true
    })
    const imported = parseManualScheduleJson(JSON.stringify(source), config, operators)
    expect(imported.dormitory_rule).toBe('fixed')
    expect(imported.plans[0].rooms.dormitory[0]).toMatchObject({ operators: ['芬'], autofill: false })
    expect(imported.plans.every((plan) => plan.rooms.dormitory.every((room) => room.autofill === false))).toBe(true)
    const plans = createManualPlans(imported)
    plans[0].rooms.dormitory[0][0] = ''
    expect(() => validateManualPlans(imported, plans, operators)).not.toThrow()
    source.plans.forEach((plan) => { plan.rooms.dormitory[0].operators = [] })
    expect(parseManualScheduleJson(JSON.stringify(source), config, operators).dormitory_rule).toBe('maa_pure_autofill')
  })

  it('uses JSON facilities independently of page presets, including fields supplied by another shift', () => {
    const source = createBlankManualSchedule(config)
    source.plans.forEach((plan) => { plan.rooms.manufacture[0].level = 2 })
    delete source.plans[0].rooms.manufacture[0].level
    delete source.plans[0].rooms.manufacture[0].product
    const text = JSON.stringify(source)
    const alternate = { ...config, manufacturing_station_levels: [1, 1, 1, 1],
      product_requirements: { trading_stations: { Orundum: 2 }, manufacturing_stations: { 'Originium Shard': 4 } } }
    expect(parseManualScheduleJson(text, alternate, operators)).toEqual(parseManualScheduleJson(text, config, operators))
    expect(parseManualScheduleJson(text, alternate, operators).plans[0].rooms.manufacture[0]).toMatchObject({ level: 2, product: 'Pure Gold' })
  })

  it('names missing operators once and admits the same schedule after the roster is updated', () => {
    const source = createBlankManualSchedule({ ...config, recycling_station_level: 1 })
    source.plans.forEach((plan) => { plan.rooms.recycling[0].operators = ['旅骨'] })
    const content = JSON.stringify(source)
    const missing = { id: 'recycler', name: '旅骨', own: false, elite: 2, rarity: 6 }
    expect(() => parseManualScheduleJson(content, config, [...operators, missing])).toThrow(UnownedScheduleOperatorsError)
    expect(() => parseManualScheduleJson(content, config, operators)).toThrow(copy.tools.manualSchedule.unownedOperators(['旅骨']))
    const updated = [...operators, { ...missing, own: true }]
    expect(parseManualScheduleJson(content, config, updated).plans[0].rooms.recycling[0].operators).toEqual(['旅骨'])
    expect(() => resolveManualScheduleConfig(source, config, operators)).toThrow(UnownedScheduleOperatorsError)
  })

  it('rejects unowned operators, excessive capacities, inconsistent facilities and invalid products', () => {
    const source = createBlankManualSchedule(config)
    for (const mutate of [
      () => { source.plans[0].rooms.manufacture[0].operators = ['未拥有'] },
      () => { source.plans[0].rooms.manufacture[0].operators = ['芬', '芬', '芬', '芬'] },
      () => { source.plans[0].rooms.manufacture[0].operators = []; source.plans[1].rooms.power.pop() },
    ]) {
      mutate()
      expect(() => parseManualScheduleJson(JSON.stringify(source), config, operators)).toThrow()
    }
    const invalid = createBlankManualSchedule(config)
    invalid.plans.forEach((plan) => { plan.rooms.manufacture[0].product = 'LMD' })
    expect(() => resolveManualScheduleConfig(invalid, config, operators)).toThrow()
    invalid.plans[0].Fiammetta = { enable: true, target: '未拥有', order: 'pre' }
    expect(() => parseManualScheduleJson(JSON.stringify(invalid), config, operators)).toThrow()
  })

  it('derives the simulation configuration from imported facilities and shifts', () => {
    const importedConfig = normalizeConfig(CONFIG_PRESETS['333'])
    const source = createBlankManualSchedule({ ...importedConfig, shift_hours: [12, 12, 12] })
    const resolved = resolveManualScheduleConfig(source, config, operators)
    expect(resolved.layout).toBe('3-3-3')
    expect(resolved.trading_stations_count).toBe(3)
    expect(resolved.manufacturing_stations_count).toBe(3)
    expect(resolved.shift_hours).toEqual([12, 12, 12])
    expect(resolved.product_requirements).toEqual(importedConfig.product_requirements)
  })

  it('preserves shift order, infers empty 252 facilities and requires products from the JSON', () => {
    const selected = { ...normalizeConfig(CONFIG_PRESETS['252']), facility_layout: [...FACILITY_IDS], shift_hours: [6, 12, 6] }
    const source = createBlankManualSchedule(selected)
    expect(source.shift_hours).toEqual([6, 12, 6])
    const maa = { title: 'MAA', plans: source.plans.map(({ shift_hours: _hours, ...plan }) => ({
      ...plan, rooms: Object.fromEntries(Object.entries(plan.rooms).map(([type, rooms]) => [
        type, rooms.map(({ operators }) => ({ operators })),
      ])),
    })) }
    expect(() => parseManualScheduleJson(JSON.stringify(maa), selected, operators)).toThrow(copy.tools.manualSchedule.importMissingProduct)
    maa.plans.forEach((plan, shift) => {
      for (const type of ['trading', 'manufacture']) {
        plan.rooms[type].forEach((room, index) => Object.assign(room, { product: source.plans[shift].rooms[type][index].product }))
      }
    })
    const imported = parseManualScheduleJson(JSON.stringify(maa), selected, operators)
    expect(imported.shift_hours).toEqual([6, 12, 6])
    expect(imported.plans[0].rooms.trading.map((room) => room.level)).toEqual([1, 1])
    expect(imported.plans[0].rooms.manufacture.map((room) => room.product)).toEqual(['Pure Gold', 'Pure Gold', 'Battle Record', 'Battle Record', 'Battle Record'])
    expect(imported.facility_layout).toEqual(FACILITY_IDS)
    expect(parseManualScheduleJson(JSON.stringify(maa), config, operators).plans.map((plan) => plan.rooms))
      .toEqual(imported.plans.map((plan) => plan.rooms))
    const withProducts = structuredClone(source)
    withProducts.plans.forEach((plan) => Object.values(plan.rooms).flat().forEach((room) => { delete room.level }))
    expect(parseManualScheduleJson(JSON.stringify(withProducts), config, operators).plans[0].rooms.manufacture.map((room) => room.level)).toEqual([1, 1, 1, 1, 1])
    expect(() => createBlankManualSchedule({ ...selected, facility_layout: undefined })).toThrow()
  })

  it.each(['243', '252', '333'])('infers 252 levels across shifts and preserves room order under a %s configuration', (preset) => {
    const source = createBlankManualSchedule({ ...normalizeConfig(CONFIG_PRESETS['252']), facility_layout: [...FACILITY_IDS] })
    delete source.facility_layout
    const counts = [
      { trading: [1, 1], manufacture: [1, 2, 0, 1, 0] },
      { trading: [3, 0], manufacture: [3, 1, 2, 0, 0] },
      { trading: [2, 1], manufacture: [2, 2, 0, 0, 0] },
    ]
    source.plans.forEach((plan, shift) => {
      for (const type of ['trading', 'manufacture'] as const) {
        plan.rooms[type].forEach((room, index) => {
          delete room.level
          room.operators = Array.from({ length: counts[shift][type][index] }, (_, slot) => `${shift}-${type}-${index}-${slot}`)
        })
      }
      plan.drones = { enable: true, room: 'manufacture', index: 3, order: 'pre' }
    })
    source.plans[0].rooms.trading[0].operators!.unshift('')
    source.plans[1].rooms.manufacture[4].level = 2
    const owned = source.plans.flatMap((plan) => Object.values(plan.rooms).flatMap((rooms) => rooms.flatMap((room) => room.operators ?? [])))
      .filter(Boolean).map((name) => ({ id: name, name, own: true, elite: 2, rarity: 6 }))
    const current = { ...normalizeConfig(CONFIG_PRESETS[preset]), facility_layout: [...FACILITY_IDS].reverse() }
    const imported = parseManualScheduleJson(JSON.stringify(source), current, owned)
    const resolved = resolveManualScheduleConfig(imported, current, owned)
    expect(resolved.layout).toBe('2-5-2')
    expect(resolved.trading_station_levels).toEqual([3, 1])
    expect(resolved.manufacturing_station_levels).toEqual([3, 2, 2, 1, 2])
    expect(imported.facility_layout).toEqual(FACILITY_IDS)
    imported.plans.forEach((plan, shift) => {
      expect(plan.rooms.trading.map((room) => room.level)).toEqual([3, 1])
      expect(plan.rooms.manufacture.map((room) => room.level)).toEqual([3, 2, 2, 1, 2])
      for (const type of ['trading', 'manufacture']) {
        expect(plan.rooms[type].map((room) => room.operators)).toEqual(source.plans[shift].rooms[type].map((room) => room.operators?.filter(Boolean)))
      }
      expect(plan.drones).toEqual(source.plans[shift].drones)
    })
    expect(source.facility_layout).toBeUndefined()
    expect(source.plans[0].rooms.trading[0].level).toBeUndefined()
    const invalid = structuredClone(source)
    invalid.plans[0].rooms.manufacture.pop()
    expect(() => parseManualScheduleJson(JSON.stringify(invalid), current, owned)).toThrow()
    const overCapacity = structuredClone(source)
    overCapacity.plans[0].rooms.trading[0].operators = owned.slice(0, 4).map((operator) => operator.name)
    expect(() => parseManualScheduleJson(JSON.stringify(overCapacity), current, owned)).toThrow()
  })

  it('synchronizes facility products and refuses lowering capacity with occupied slots', () => {
    const source = createBlankManualSchedule(config)
    source.plans[1].rooms.manufacture[0].operators = ['A', 'B', 'C']
    expect(() => changeManualFacility(source, 'manufacture', 0, { level: 2 })).toThrow()
    const changed = changeManualFacility(source, 'manufacture', 0, { product: 'Originium Shard' })
    expect(changed.plans.every((plan) => plan.rooms.manufacture[0].product === 'Originium Shard')).toBe(true)
    expect(source.plans[0].rooms.manufacture[0].product).toBe('Pure Gold')
  })

  it('allows Fiammetta targets outside the current shift while validating ownership and compatible shifts', () => {
    const source = createBlankManualSchedule(config)
    const withFiammetta = [...operators, { id: 'char_300_phenxi', name: '菲亚梅塔', own: true, elite: 0, level: 1, rarity: 6 }]
    source.plans[0].rooms.manufacture[0].operators = ['芬']
    source.plans[0].Fiammetta = { enable: true, target: '芬', order: 'post' }
    expect(resolveManualScheduleConfig(source, config, withFiammetta).Fiammetta?.enable).toBe(true)
    expect(() => resolveManualScheduleConfig(source, config, operators)).toThrow()
    const noWork = structuredClone(source)
    noWork.plans[0].rooms.manufacture[0].operators = []
    expect(resolveManualScheduleConfig(noWork, config, withFiammetta).Fiammetta?.enable).toBe(true)
    expect(parseManualScheduleJson(JSON.stringify(noWork), config, withFiammetta).plans[0].Fiammetta).toEqual(source.plans[0].Fiammetta)
    expect(() => resolveManualScheduleConfig(noWork, config, withFiammetta.filter((operator) => operator.name !== '芬'))).toThrow()
    const ownTarget = structuredClone(source)
    ownTarget.plans[0].Fiammetta!.target = '菲亚梅塔'
    expect(() => resolveManualScheduleConfig(ownTarget, config, withFiammetta)).toThrow()
    const short = createBlankManualSchedule({ ...config, shift_hours: [6, 6, 6, 6] })
    short.plans[0].Fiammetta = source.plans[0].Fiammetta
    expect(() => resolveManualScheduleConfig(short, config, withFiammetta)).toThrow()
  })

  it('round-trips standalone settings with sparse operator slots and keeps historical settings locked', () => {
    const initial = createBlankManualSchedule(config)
    const changed = changeManualFacility(initial, 'manufacture', 0, { product: 'Battle Record', level: 2 })
    const plans = createManualPlans(changed)
    plans[0].rooms.manufacture[0] = ['', '芬']
    changed.plans[0].Fiammetta = { enable: true, target: '芬', order: 'post' }
    const backup = JSON.stringify({
      version: 1, source: manualSourceKey(initial), savedAt: '2026-10-02',
      plans, schedule: manualResult(changed, plans, true),
    })
    const restored = parseManualDraft(backup, initial, operators, true)
    expect(restored.schedule?.plans[0].rooms.manufacture[0]).toMatchObject({ level: 2, product: 'Battle Record' })
    expect(restored.plans[0].rooms.manufacture[0]).toEqual(['', '芬'])
    expect(restored.schedule?.plans[0].rooms.manufacture[0].operators).toEqual(['', '芬'])
    expect(restored.schedule?.plans[0].Fiammetta?.target).toBe('芬')
    expect(() => parseManualDraft(backup, initial, operators)).toThrow()
  })
})
