// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import ResultMetrics from './ResultMetrics'
import type { PreparedResult } from './formatters'

afterEach(cleanup)

describe('ResultMetrics', () => {
  it('omits the MAA default baseline and simulation hints from the data footer', () => {
    render(<ResultMetrics isRotationMode={false} prepared={createPreparedResult()} />)

    expect(screen.queryByText(/MAA 默认基准/)).not.toBeInTheDocument()
    expect(screen.queryByText(/模拟提示/)).not.toBeInTheDocument()
  })
})

function createPreparedResult(): PreparedResult {
  return {
    totalEff: 100,
    rawTotalEff: 100,
    hasDailyProduction: true,
    plans: [],
    productionStats: {
      manufacturing: {},
      manufacturingTotal: 0,
      lmd: 0,
      orundum: 0,
      goldNet: 0,
      droneGain: { value: '0', suffix: '', note: '' },
    },
    productionSanity: { value: 0, note: '' },
    intermediateDepletion: [],
    maaDefaultComparison: {
      sanityDelta: 0,
      sanityDeltaNote: '与默认配置持平',
      baselineSanity: 0,
      totalEfficiencyDelta: 0,
      rawTotalEfficiencyDelta: 0,
      lmdDelta: 0,
      goldNetDelta: 0,
      baselineTotalEfficiency: 100,
      baselineLmd: 0,
      baselineGoldNet: 0,
      warnings: ['测试模拟警告'],
    },
    detailStats: { planCount: 0, roomCount: 0 },
  }
}
