import { describe, expect, it } from 'vitest'
import { CONFIG_PRESETS, normalizeConfig } from './config'
import { createManualPlans } from './manual-schedule'
import { createBlankManualSchedule, isManualScheduleProfileAvailable, parseManualScheduleJson, resolveManualScheduleConfig } from './manual-schedule-tool'
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
})
