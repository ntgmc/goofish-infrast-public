// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import type { LicenseOperator, OptimizeResult } from '../../lib/types'
import {
  changeManualDrone, changeManualOperator, createManualPlans, manualResult, parseManualDraft,
  readManualDraft, saveManualDraft, validateManualPlans,
} from '../../lib/manual-schedule'

afterEach(() => localStorage.clear())

describe('manual schedule validation and storage', () => {
  it('swaps assigned operators and moves into empty positions without modifying the source', () => {
    const original = JSON.stringify(source)
    const base = createManualPlans(source)
    const swapped = changeManualOperator(source, base, operators, 0, 'trading', 0, 1, 'C')
    expect(swapped[0].rooms.trading[0]).toEqual(['locked', 'C', ''])
    expect(swapped[0].rooms.manufacture[0]).toEqual(['B', '', ''])
    const moved = changeManualOperator(source, swapped, operators, 0, 'trading', 0, 2, 'B')
    expect(moved[0].rooms.manufacture[0]).toEqual(['', '', ''])
    expect(moved[0].rooms.trading[0]).toEqual(['locked', 'C', 'B'])
    expect(base[0].rooms.trading[0]).toEqual(['locked', 'B', ''])
    expect(JSON.stringify(source)).toBe(original)
  })

  it('locks the Fiammetta target in all shifts and rejects unowned operators', () => {
    const base = createManualPlans(source)
    expect(() => changeManualOperator(source, base, operators, 0, 'trading', 0, 0, 'C')).toThrow()
    expect(() => changeManualOperator(source, base, operators, 1, 'manufacture', 0, 0, '')).toThrow()
    expect(() => changeManualOperator(source, base, operators, 0, 'trading', 0, 1, 'locked')).toThrow()
    expect(() => changeManualOperator(source, base, operators, 0, 'trading', 0, 1, 'unowned')).toThrow()
  })

  it('rejects tampered draft capacity, duplicate operators and changed locked positions', () => {
    const base = createManualPlans(source)
    const overCapacity = structuredClone(base)
    overCapacity[0].rooms.trading[0].push('D')
    expect(() => validateManualPlans(source, overCapacity, operators)).toThrow('capacity')
    const duplicate = structuredClone(base)
    duplicate[0].rooms.trading[0][2] = 'C'
    expect(() => validateManualPlans(source, duplicate, operators)).toThrow('duplicate')
    const movedTarget = structuredClone(base)
    movedTarget[0].rooms.trading[0] = ['B', 'locked', '']
    expect(() => validateManualPlans(source, movedTarget, operators)).toThrow('locked')
    expect(() => validateManualPlans(source, [{ rooms: null }], operators)).toThrow()
  })

  it('stores and restores a profile-scoped draft and rejects mismatched or tampered backups', () => {
    const plans = changeManualOperator(source, createManualPlans(source), operators, 0, 'trading', 0, 2, 'D')
    const draft = saveManualDraft('profile-a', source, plans, operators)
    expect(readManualDraft('profile-a', source, operators)?.plans).toEqual(plans)
    expect(readManualDraft('profile-b', source, operators)).toBeNull()
    expect(parseManualDraft(JSON.stringify(draft), source, operators).plans).toEqual(plans)
    expect(() => parseManualDraft(JSON.stringify(draft), { ...source, title: 'different' }, operators)).toThrow('match')
    draft.plans[0].rooms.trading[0][0] = ''
    expect(() => parseManualDraft(JSON.stringify(draft), source, operators)).toThrow('locked')
  })

  it('targets a one-based production room, disables acceleration, and rejects support rooms', () => {
    const base = createManualPlans(source)
    const next = changeManualDrone(source, base, operators, 0, 'manufacture', 0)
    expect(next[0].drones).toEqual({ enable: true, room: 'manufacture', index: 1, order: 'pre' })
    expect(changeManualDrone(source, next, operators, 0)[0].drones.enable).toBe(false)
    expect(() => changeManualDrone(source, base, operators, 0, 'control', 0)).toThrow('target')
    expect(() => changeManualDrone(source, base, operators, 0, 'trading', 9)).toThrow('target')
  })

  it('removes calculated production, efficiencies, mood and suggestions from the manual result', () => {
    const result = manualResult(source, createManualPlans(source))
    expect(result.daily_production).toBeUndefined()
    expect(result.total_efficiency).toBeUndefined()
    expect(result.raw_results).toEqual([])
    expect(result.plans[0].rooms.trading[0].efficiency).toBeUndefined()
    expect(result.plans[0].rooms.trading[0].mood).toBeUndefined()
    expect(result.plans[0].Fiammetta).toEqual(source.plans[0].Fiammetta)
    expect(result.plans[0].drones?.mode).toBe('manual')
  })

  it('preserves automatic dormitory anchors when moving the same operator in a work room', () => {
    const anchored = structuredClone(source)
    anchored.dormitory_rule = 'maa_pure_autofill'
    anchored.plans[0].rooms.dormitory = [{ operators: ['C'] }]
    const next = changeManualOperator(anchored, createManualPlans(anchored), operators, 0, 'trading', 0, 2, 'C')
    expect(next[0].rooms.trading[0]).toEqual(['locked', 'B', 'C'])
    expect(next[0].rooms.manufacture[0]).toEqual(['', '', ''])
    expect(next[0].rooms.dormitory[0][0]).toBe('C')
  })
})

const operators: LicenseOperator[] = ['locked', 'B', 'C', 'D', 'unowned'].map((name) => ({
  id: name, name, own: name !== 'unowned', elite: 2, rarity: 6,
}))
const source: OptimizeResult = {
  author: 'test', title: 'Original', description: '', buildingType: 243, planTimes: '12h-12h', schedule_mode: 'maa', raw_results: [],
  total_efficiency: 123, daily_production: { trading: { LMD: 1000 } },
  plans: [
    {
      name: 'Shift1', shift_hours: 12,
      rooms: { trading: [{ level: 3, operators: ['locked', 'B'], efficiency: 123 }], manufacture: [{ level: 3, operators: ['C'] }] },
      Fiammetta: { enable: true, target: 'locked', order: 'pre' },
      drones: { enable: true, room: 'trading', index: 1, order: 'pre' },
    },
    {
      name: 'Shift2', shift_hours: 12,
      rooms: { trading: [{ level: 3, operators: ['B'] }], manufacture: [{ level: 3, operators: ['locked', 'C'] }] },
    },
  ],
}
