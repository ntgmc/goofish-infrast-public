import { describe, expect, it } from 'vitest'
import {
  calculateVerifiedParetoIds,
  expandScenarioComparison,
  selectVerificationScenarioIds,
  type ScenarioComparisonFactors,
  type ScenarioComparisonPoint,
} from './scenario-comparison'
import { CONFIG_PRESETS } from './config'

const baseFactors: ScenarioComparisonFactors = {
  layouts: [{ layout: '243', splits: [{ pureGold: 2, battleRecord: 2 }] }],
  maaShiftHours: [6, 8, 12],
  includeRotation: true,
  droneStrategies: ['off', 'auto', 'lmd', 'pure_gold', 'battle_record'],
}

describe('expandScenarioComparison', () => {
  it('expands MAA shifts and a single rotation scenario', () => {
    const result = expandScenarioComparison(CONFIG_PRESETS['243'], baseFactors)
    expect(result.scenarios).toHaveLength(16)
    expect(result.scenarios.filter((item) => item.scheduleMode === 'rotation')).toHaveLength(1)
    expect(result.scenarios.find((item) => item.id.includes('maa-6'))?.shiftHours).toEqual([6, 6, 6, 6])
    expect(result.scenarios.find((item) => item.id.includes('maa-8'))?.shiftHours).toEqual([8, 8, 8])
    expect(result.scenarios.find((item) => item.id.includes('maa-12'))?.shiftHours).toEqual([12, 12])
  })

  it('skips missing drone products instead of producing duplicates', () => {
    const result = expandScenarioComparison(CONFIG_PRESETS['243'], {
      ...baseFactors,
      layouts: [{ layout: '153', splits: [{ pureGold: 5, battleRecord: 0 }] }],
      maaShiftHours: [8],
    })
    expect(result.rawCombinationCount).toBe(6)
    expect(result.scenarios.map((item) => item.droneStrategy)).toEqual(['off', 'auto', 'lmd', 'pure_gold', 'off'])
    expect(result.skipped).toContainEqual(expect.objectContaining({ code: 'missing_product', count: 1 }))
  })

  it('rejects invalid splits and more than 24 effective scenarios', () => {
    expect(() => expandScenarioComparison(CONFIG_PRESETS['243'], {
      ...baseFactors,
      layouts: [{ layout: '333', splits: [{ pureGold: 2, battleRecord: 2 }] }],
    })).toThrow(/合计 3/)

    expect(() => expandScenarioComparison(CONFIG_PRESETS['243'], {
      ...baseFactors,
      layouts: [
        { layout: '153', splits: [{ pureGold: 1, battleRecord: 4 }] },
        { layout: '243', splits: [{ pureGold: 2, battleRecord: 2 }] },
      ],
    })).toThrow(/最多允许 24/)
  })
})

describe('two-stage Pareto helpers', () => {
  it('selects at most the top three screening points per operation cost', () => {
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
    pureGoldLines: 2,
    battleRecordLines: 2,
    scheduleMode: 'maa',
    shiftHours: [8, 8, 8],
    operationsPerDay,
    droneStrategy: 'off',
    status: 'succeeded',
    screening: metrics(output),
    isFrontier: false,
  }
}

function verifiedPoint(id: string, operationsPerDay: number, output: number): ScenarioComparisonPoint {
  return { ...point(id, operationsPerDay, output), verified: metrics(output) }
}

function metrics(productionSanityPerDay: number) {
  return {
    productionSanityPerDay,
    totalEfficiency: 0,
    lmdPerDay: 0,
    battleRecordPerDay: 0,
    pureGoldProducedPerDay: 0,
    pureGoldConsumedPerDay: 0,
    pureGoldNetPerDay: 0,
    dronesGeneratedPerDay: 0,
    dronesUsedPerDay: 0,
    dronesDiscardedPerDay: 0,
  }
}
