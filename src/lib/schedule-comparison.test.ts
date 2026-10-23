import { describe, expect, it } from 'vitest'
import { createBlankManualSchedule } from './manual-schedule-tool'
import { CONFIG_PRESETS, normalizeConfig } from './config'
import { compareScheduleOperators, scheduleProductionMetrics } from './schedule-comparison'

const schedule = () => createBlankManualSchedule(normalizeConfig(CONFIG_PRESETS['243']))

describe('schedule operator comparison', () => {
  it('distinguishes added, removed and moved operators without treating room slot order or names as changes', () => {
    const before = schedule()
    before.plans[0].rooms.manufacture[0].operators = ['芬', '香草']
    before.plans[1].rooms.trading[0].operators = ['克洛丝', '米格鲁']
    const after = structuredClone(before)
    after.title = 'Another title'
    after.plans[0].name = 'Another shift name'
    after.plans[0].rooms.manufacture[0].operators = ['香草', '芬']
    after.plans[1].rooms.trading[0].operators = ['玫兰莎']
    after.plans[1].rooms.dormitory[0].operators = ['米格鲁']
    const rows = compareScheduleOperators(before, after)
    const status = Object.fromEntries(rows.map((row) => [row.name, row.status]))
    expect(status).toEqual({ 芬: 'unchanged', 香草: 'unchanged', 克洛丝: 'removed', 米格鲁: 'changed', 玫兰莎: 'added' })
    expect(rows.find((row) => row.name === '米格鲁')).toMatchObject({
      before: [{ start: 8, end: 16, roomType: 'trading', roomIndex: 0 }],
      after: [{ start: 8, end: 16, roomType: 'dormitory', roomIndex: 0 }],
    })
  })

  it('detects shift time changes and implicit Fiammetta recovery assignments', () => {
    const before = schedule()
    before.plans[0].rooms.manufacture[0].operators = ['芬']
    const after = structuredClone(before)
    after.plans[0].shift_hours = 12
    after.plans[0].Fiammetta = { enable: true, target: '芬', order: 'pre' }
    const rows = compareScheduleOperators(before, after)
    expect(rows.find((row) => row.name === '芬')).toMatchObject({ status: 'changed', after: [
      { start: 0, end: 12, roomType: 'fiammetta-target' }, { start: 0, end: 12, roomType: 'manufacture' },
    ] })
    expect(rows.find((row) => row.name === '菲亚梅塔')?.status).toBe('added')
    expect(compareScheduleOperators(after, after).every((row) => row.status === 'unchanged')).toBe(true)
  })
})

describe('schedule production metrics', () => {
  it('uses daily simulation output, converts experience and preserves negative balances', () => {
    const result = { ...schedule(), daily_production: {
      hours: 24, manufacturing: { 'Battle Record': 12.5, 'Pure Gold': 20, 'Originium Shard': 6 },
      trading: { LMD: 30_000, Orundum: 100 }, consumption: { 'Pure Gold': 30, 'Originium Shard': 8 },
      net: { 'Pure Gold': -12 },
    } }
    expect(scheduleProductionMetrics(result)).toMatchObject({
      lmd: 30_000, experience: 12_500, orundum: 100, gold: 20, goldConsumed: 30, goldNet: -12,
      shard: 6, shardConsumed: 8, shardNet: -2,
    })
    expect(scheduleProductionMetrics(null)).toBeNull()
    expect(scheduleProductionMetrics(schedule())).toBeNull()
  })
})
