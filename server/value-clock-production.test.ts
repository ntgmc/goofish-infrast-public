import { describe, expect, it } from 'vitest'
import type { WorkspaceResultHistoryExportItem } from '../src/lib/types'
import { freezeValueClockProduction } from './value-clock-production'
import { SAMPLE_CONFIG, SAMPLE_RESULT } from '../src/pages/v2/sample-result'

function saved(daily: Record<string, unknown> = {}): WorkspaceResultHistoryExportItem {
  return {
    id: 'result', name: '排班', created_at: '2026-11-22T00:00:00Z', archived_at: null, operator_count: 1,
    config: null, result: {
      plans: [{ rooms: { manufacture: [{}] } }], mood_simulation: { valid: true, daily_loop_stable: true },
      daily_production: { hours: 24, manufacturing: {}, trading: { LMD: 240_000 }, consumption: {}, ...daily },
    },
  } as WorkspaceResultHistoryExportItem
}

describe('freeze value clock production', () => {
  it('accepts the existing generated result format and its per-shift cyclic mood checks', () => {
    const item = { ...saved(), result: structuredClone(SAMPLE_RESULT), config: SAMPLE_CONFIG }
    expect(item.result.mood_simulation).toBeUndefined()
    expect(freezeValueClockProduction(item, null).daily.sanity).toBeGreaterThan(0)
    item.result.plans[0].mood_valid = false
    expect(() => freezeValueClockProduction(item, null)).toThrow()
  })
  it('uses net sanity and the constrained shard ledger without counting gold twice', () => {
    expect(freezeValueClockProduction(saved(), null).daily.sanity).toBeCloseTo(864)
    expect(freezeValueClockProduction(saved({ source_hours: 12, normalization_factor: 2 }), null).daily.sanity).toBeCloseTo(864)
    const item = saved({ manufacturing: { 'Originium Shard': 10, 'Battle Record': 12, 'Pure Gold': 20 }, trading: { LMD: 10_000, Orundum: 200 }, consumption: { 'Originium Shard': 20, 'Pure Gold': 20 }, originium_shard_inventory: 0 })
    item.result.orundum_economy = { case: 'budget_limited' } as never
    const { daily } = freezeValueClockProduction(item, null)
    expect(daily.orundum).toBe(100)
    expect(daily.shards_consumed).toBe(10)
    expect(daily.experience_points).toBe(12_000)
    expect(daily.sanity).toBeCloseTo(154.2)
  })
  it('normalizes legacy cycles and rejects missing, nonfinite and unsustainable results', () => {
    expect(freezeValueClockProduction(saved({ hours: 12 }), null).daily.sanity).toBeCloseTo(1728)
    const legacy = saved(); delete legacy.result.mood_simulation
    expect(freezeValueClockProduction(legacy, null).daily.sanity).toBeCloseTo(864)
    for (const daily of [{ hours: 0 }, { trading: { LMD: NaN } }, { consumption: undefined }]) expect(() => freezeValueClockProduction(saved(daily), null)).toThrow()
    const unstable = saved(); unstable.result.mood_simulation!.daily_loop_stable = false
    expect(() => freezeValueClockProduction(unstable, null)).toThrow()
    expect(freezeValueClockProduction(saved({ trading: { LMD: 0 } }), null).daily.sanity).toBe(0)
  })
  it('keeps negative net income and bounds it by known stock', () => {
    const item = saved({ trading: { LMD: 0 }, consumption: { LMD: 1000 } })
    expect(() => freezeValueClockProduction(item, null)).toThrow('inventory')
    item.config = { intermediate_inventory: { LMD: 2000 } } as never
    const frozen = freezeValueClockProduction(item, null)
    expect(frozen.daily.lmd_net).toBe(-1000)
    expect(frozen.daily.sanity).toBeCloseTo(-3.6)
    expect(frozen.inventory?.durationMs).toBe(2 * 86_400_000)
    expect(freezeValueClockProduction(item, '2026-11-22T01:00:00Z').daily).toEqual(frozen.daily)
  })
})
