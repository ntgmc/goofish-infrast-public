import { describe, expect, it } from 'vitest'
import {
  calculateVerifiedParetoIds,
  expandScenarioComparison,
  freezeVariableScenarioConfig,
  selectVerificationScenarioIds,
  type ScenarioComparisonFactors,
  type ScenarioComparisonPoint,
  type ScenarioMetrics,
  type ScenarioProductionPlan,
} from './scenario-comparison'
import { CONFIG_PRESETS } from './config'

const balancedPlan: ScenarioProductionPlan = {
  trading: { lmd: 2, orundum: 0 },
  manufacturing: { pureGold: 2, battleRecord: 2, originiumShard: 0 },
}

const orundumPlan: ScenarioProductionPlan = {
  trading: { lmd: 1, orundum: 1 },
  manufacturing: { pureGold: 2, battleRecord: 0, originiumShard: 2 },
}

const baseFactors: ScenarioComparisonFactors = {
  layouts: [{ layout: '243', plans: [balancedPlan] }],
  maaSchedules: ['variable', '8x3', '12x2'],
  includeRotation: true,
  droneStrategies: ['off', 'auto', 'lmd', 'orundum', 'pure_gold', 'battle_record', 'originium_shard'],
}

describe('expandScenarioComparison', () => {
  it('expands automatic, fixed and rotation schedules with exact production plans', () => {
    const base = {
      ...CONFIG_PRESETS['243'],
      orundum_planning: { daily_sanity_budget: 300, monthly_card: true },
    }
    const result = expandScenarioComparison(base, baseFactors)
    expect(result.scenarios).toHaveLength(16)
    expect(result.variableScenarioCount).toBe(5)
    expect(result.scenarios.filter((item) => item.scheduleStrategy === 'rotation')).toHaveLength(1)
    const variable = result.scenarios.find((item) => item.scheduleStrategy === 'variable')
    expect(variable?.config.variable_shift_schedule).toEqual(expect.objectContaining({
      enable: true,
      max_shifts: 4,
      shift_step_minutes: 60,
      min_low_hours: 3,
      beam_width: 4,
    }))
    expect(variable?.config.orundum_planning).toEqual(base.orundum_planning)
    expect(result.scenarios.find((item) => item.scheduleStrategy === '8x3')?.shiftHours).toEqual([8, 8, 8])
    expect(result.scenarios.find((item) => item.scheduleStrategy === '12x2')?.shiftHours).toEqual([12, 12])
  })

  it('supports sustainable, inventory-only, and shard-stockpiling production plans', () => {
    const factors: ScenarioComparisonFactors = {
      layouts: [{
        layout: '243',
        plans: [
          orundumPlan,
          { ...orundumPlan, manufacturing: { pureGold: 2, battleRecord: 2, originiumShard: 0 } },
          { ...balancedPlan, manufacturing: { pureGold: 1, battleRecord: 1, originiumShard: 2 } },
        ],
      }],
      maaSchedules: ['8x3'],
      includeRotation: false,
      droneStrategies: ['off'],
    }
    const result = expandScenarioComparison(CONFIG_PRESETS['243'], factors)
    expect(result.scenarios).toHaveLength(3)
    expect(result.scenarios[0]?.config.product_requirements.trading_stations).toBeDefined()
  })

  it('skips each missing drone target with a specific reason', () => {
    const result = expandScenarioComparison(CONFIG_PRESETS['243'], {
      ...baseFactors,
      maaSchedules: ['8x3'],
      includeRotation: false,
    })
    expect(result.rawCombinationCount).toBe(7)
    expect(result.scenarios.map((item) => item.droneStrategy)).toEqual(['off', 'auto', 'lmd', 'pure_gold', 'battle_record'])
    expect(result.skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'missing_product', droneStrategy: 'orundum', count: 1 }),
      expect.objectContaining({ code: 'missing_product', droneStrategy: 'originium_shard', count: 1 }),
    ]))
  })

  it.each([
    ['153', { trading: { lmd: 1, orundum: 0 }, manufacturing: { pureGold: 2, battleRecord: 2, originiumShard: 1 } }],
    ['243', balancedPlan],
    ['333', { trading: { lmd: 2, orundum: 1 }, manufacturing: { pureGold: 1, battleRecord: 1, originiumShard: 1 } }],
  ] as const)('accepts legal %s station totals', (layout, plan) => {
    expect(() => expandScenarioComparison(CONFIG_PRESETS['243'], {
      layouts: [{ layout, plans: [plan] }],
      maaSchedules: ['8x3'],
      includeRotation: false,
      droneStrategies: ['off'],
    })).not.toThrow()
  })

  it('rejects invalid totals and more than 24 effective scenarios', () => {
    expect(() => expandScenarioComparison(CONFIG_PRESETS['243'], {
      ...baseFactors,
      layouts: [{ layout: '333', plans: [balancedPlan] }],
    })).toThrow(/贸易线数合计必须为 3/)

    expect(() => expandScenarioComparison(CONFIG_PRESETS['243'], {
      ...baseFactors,
      layouts: [{ layout: '243', plans: [balancedPlan, orundumPlan] }],
    })).toThrow(/最多允许 24/)
  })

  it('rejects legacy and unknown factor fields instead of silently ignoring them', () => {
    expect(() => expandScenarioComparison(CONFIG_PRESETS['243'], {
      ...baseFactors,
      maaShiftHours: [6],
    } as unknown as ScenarioComparisonFactors)).toThrow(/未知字段：maaShiftHours/)
    expect(() => expandScenarioComparison(CONFIG_PRESETS['243'], {
      ...baseFactors,
      layouts: [{ layout: '243', plans: [{ ...balancedPlan, extra: true } as unknown as ScenarioProductionPlan] }],
    })).toThrow(/未知字段：extra/)
  })

  it('deduplicates repeated plans and keeps stable ids', () => {
    const result = expandScenarioComparison(CONFIG_PRESETS['243'], {
      layouts: [{ layout: '243', plans: [balancedPlan, balancedPlan] }],
      maaSchedules: ['8x3'],
      includeRotation: false,
      droneStrategies: ['off'],
    })
    expect(result.scenarios).toHaveLength(1)
    expect(result.scenarios[0]?.id).toBe('243-t2-0-m2-2-0-8x3-off')
    expect(result.skipped).toContainEqual(expect.objectContaining({ code: 'duplicate', count: 1 }))
  })

  it('freezes a selected automatic pattern into a reproducible MAA config', () => {
    const expanded = expandScenarioComparison(CONFIG_PRESETS['243'], {
      ...baseFactors,
      maaSchedules: ['variable'],
      droneStrategies: ['off'],
      includeRotation: false,
    })
    const frozen = freezeVariableScenarioConfig(expanded.scenarios[0]!.config, [12, 6, 6], '自动场景')
    expect(frozen.schedule_mode).toBe('maa')
    expect(frozen.shift_hours).toEqual([12, 6, 6])
    expect(frozen.variable_shift_schedule).toEqual(expect.objectContaining({ enable: false, enabled: false }))
    expect(frozen.desc).toMatch(/12h-6h-6h/)
  })
})

describe('two-stage Pareto helpers', () => {
  it('selects at most the top three screening points per actual operation cost', () => {
    const points = [10, 40, 30, 20].map((output, index) => point(`p${index}`, 3, output))
    expect(selectVerificationScenarioIds(points)).toEqual(['p1', 'p2', 'p3'])
  })

  it('keeps non-dominated verified points and respects the output epsilon', () => {
    const points = [
      verifiedPoint('low', 2, 100),
      verifiedPoint('balanced', 3, 120),
      verifiedPoint('dominated', 4, 119),
      verifiedPoint('tie', 3, 120.005),
      point('screening-only', 2, 1000),
    ]
    expect(calculateVerifiedParetoIds(points)).toEqual(['low', 'balanced', 'tie'])
  })
})

function point(id: string, operationsPerDay: number, output: number): ScenarioComparisonPoint {
  return {
    id,
    label: id,
    config: CONFIG_PRESETS['243'],
    layout: '243',
    productionPlan: balancedPlan,
    scheduleMode: 'maa',
    scheduleStrategy: '8x3',
    shiftHours: [8, 8, 8],
    operationsPerDay,
    variableShiftFallback: false,
    droneStrategy: 'off',
    status: 'succeeded',
    screening: metrics(output),
    isFrontier: false,
  }
}

function verifiedPoint(id: string, operationsPerDay: number, output: number): ScenarioComparisonPoint {
  return { ...point(id, operationsPerDay, output), verified: metrics(output) }
}

function metrics(productionSanityPerDay: number): ScenarioMetrics {
  return {
    productionSanityPerDay,
    totalEfficiency: 0,
    lmdPerDay: 0,
    orundumPerDay: 0,
    battleRecordPerDay: 0,
    pureGoldProducedPerDay: 0,
    pureGoldConsumedPerDay: 0,
    pureGoldNetPerDay: 0,
    originiumShardProducedPerDay: 0,
    originiumShardConsumedPerDay: 0,
    originiumShardNetPerDay: 0,
    dronesGeneratedPerDay: 0,
    dronesUsedPerDay: 0,
    dronesDiscardedPerDay: 0,
    orundumEconomy: null,
  }
}
