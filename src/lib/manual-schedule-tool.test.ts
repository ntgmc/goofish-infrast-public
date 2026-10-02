import { describe, expect, it } from 'vitest'
import { CONFIG_PRESETS, normalizeConfig } from './config'
import { createManualPlans, manualResult, manualSourceKey, parseManualDraft } from './manual-schedule'
import { changeManualFacility, createBlankManualSchedule, isManualScheduleProfileAvailable, parseManualScheduleJson, resolveManualScheduleConfig } from './manual-schedule-tool'
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

  it('preserves shift order and fills missing MAA levels and products from the matching configuration', () => {
    const selected = { ...normalizeConfig(CONFIG_PRESETS['252']), facility_layout: [...FACILITY_IDS], shift_hours: [6, 12, 6] }
    const source = createBlankManualSchedule(selected)
    expect(source.shift_hours).toEqual([6, 12, 6])
    const maa = { title: 'MAA', plans: source.plans.map(({ shift_hours: _hours, ...plan }) => ({
      ...plan, rooms: Object.fromEntries(Object.entries(plan.rooms).map(([type, rooms]) => [
        type, rooms.map(({ operators }) => ({ operators })),
      ])),
    })) }
    const imported = parseManualScheduleJson(JSON.stringify(maa), selected, operators)
    expect(imported.shift_hours).toEqual([6, 12, 6])
    expect(imported.plans[0].rooms.trading.map((room) => room.level)).toEqual(selected.trading_station_levels)
    expect(imported.plans[0].rooms.manufacture.map((room) => room.product)).toEqual(['Pure Gold', 'Pure Gold', 'Battle Record', 'Battle Record', 'Battle Record'])
    expect(imported.facility_layout).toEqual(FACILITY_IDS)
    expect(() => parseManualScheduleJson(JSON.stringify(maa), config, operators)).toThrow()
    expect(() => createBlankManualSchedule({ ...selected, facility_layout: undefined })).toThrow()
  })

  it('synchronizes facility products and refuses lowering capacity with occupied slots', () => {
    const source = createBlankManualSchedule(config)
    source.plans[1].rooms.manufacture[0].operators = ['A', 'B', 'C']
    expect(() => changeManualFacility(source, 'manufacture', 0, { level: 2 })).toThrow()
    const changed = changeManualFacility(source, 'manufacture', 0, { product: 'Originium Shard' })
    expect(changed.plans.every((plan) => plan.rooms.manufacture[0].product === 'Originium Shard')).toBe(true)
    expect(source.plans[0].rooms.manufacture[0].product).toBe('Pure Gold')
  })

  it('validates Fiammetta ownership, active target and compatible shifts', () => {
    const source = createBlankManualSchedule(config)
    const withFiammetta = [...operators, { id: 'char_300_phenxi', name: '菲亚梅塔', own: true, elite: 0, level: 1, rarity: 6 }]
    source.plans[0].rooms.manufacture[0].operators = ['芬']
    source.plans[0].Fiammetta = { enable: true, target: '芬', order: 'post' }
    expect(resolveManualScheduleConfig(source, config, withFiammetta).Fiammetta?.enable).toBe(true)
    expect(() => resolveManualScheduleConfig(source, config, operators)).toThrow()
    const noWork = structuredClone(source)
    noWork.plans[0].rooms.manufacture[0].operators = []
    expect(() => resolveManualScheduleConfig(noWork, config, withFiammetta)).toThrow()
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
