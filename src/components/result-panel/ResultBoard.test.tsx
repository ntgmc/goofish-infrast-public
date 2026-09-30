// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import ResultBoard from './ResultBoard'
import type { PreparedResult } from './formatters'
import type { PreparedPlan, RoomRow } from './types'

afterEach(cleanup)

describe('ResultBoard Fiammetta targets', () => {
  it('lists enabled targets in plan order and omits disabled plans', () => {
    const prepared = createPreparedResult([], [
      createPreparedPlan('第1班', { enable: true, target: '但书', order: 'pre' }),
      createPreparedPlan('第2班', { enable: true, target: '龙舌兰', order: 'pre' }),
      createPreparedPlan('第3班', { enable: false, target: '不应显示', order: 'pre' }),
    ])

    render(<ResultBoard prepared={prepared} isRotationMode={false} />)

    expect(screen.getAllByText(/菲亚梅塔 →/).map((item) => item.textContent)).toEqual([
      '第1班 · 菲亚梅塔 → 但书',
      '第2班 · 菲亚梅塔 → 龙舌兰',
    ])
    expect(screen.queryByText(/不应显示/)).not.toBeInTheDocument()
  })

  it('omits enabled plans whose target is missing or blank', () => {
    const missingTarget = { enable: true, order: 'pre' } as NonNullable<PreparedPlan['Fiammetta']>
    const prepared = createPreparedResult([], [
      createPreparedPlan('缺少目标', missingTarget),
      createPreparedPlan('空白目标', { enable: true, target: '   ', order: 'pre' }),
    ])

    render(<ResultBoard prepared={prepared} isRotationMode={false} />)

    expect(screen.queryByText(/菲亚梅塔 →/)).not.toBeInTheDocument()
  })

  it('uses the localized plan fallback when the plan name is blank', () => {
    const prepared = createPreparedResult([], [
      createPreparedPlan('   ', { enable: true, target: '但书', order: 'pre' }),
    ])

    render(<ResultBoard prepared={prepared} isRotationMode={false} />)

    expect(screen.getByText('班次 1 · 菲亚梅塔 → 但书')).toBeInTheDocument()
  })

  it('does not show legacy Fiammetta data in rotation mode', () => {
    const prepared = createPreparedResult([], [
      createPreparedPlan('队列 1', { enable: true, target: '但书', order: 'pre' }),
    ])

    render(<ResultBoard prepared={prepared} isRotationMode />)

    expect(screen.queryByText(/菲亚梅塔 →/)).not.toBeInTheDocument()
  })
})

function createPreparedResult(rows: RoomRow[], plans?: PreparedPlan[]): PreparedResult {
  const preparedPlans = plans ?? [{ name: '班次 1', rooms: {}, rows }]
  return {
    totalEff: 0,
    rawTotalEff: 0,
    hasDailyProduction: false,
    plans: preparedPlans,
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
    detailStats: { planCount: preparedPlans.length, roomCount: rows.length },
  }
}

function createPreparedPlan(name: string, Fiammetta?: PreparedPlan['Fiammetta']): PreparedPlan {
  return {
    name,
    rooms: {},
    rows: [],
    ...(Fiammetta && { Fiammetta }),
  }
}
