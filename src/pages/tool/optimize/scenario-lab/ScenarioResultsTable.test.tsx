// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONFIG_PRESETS } from '../../../../lib/config'
import type { ScenarioComparisonPoint, ScenarioMetrics } from '../../../../lib/scenario-comparison'
import ScenarioResultsTable from './ScenarioResultsTable'

afterEach(cleanup)

describe('ScenarioResultsTable', () => {
  it('sorts by sustainable orundum with accessible sort state and keeps row selection', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<ScenarioResultsTable points={[point('low', 20), point('high', 80)]} selectedId={null} onSelect={onSelect} />)

    const sortButton = screen.getByRole('button', { name: '合成玉 长期/短期' })
    await user.click(sortButton)
    expect(sortButton.closest('th')).toHaveAttribute('aria-sort', 'descending')
    let rows = screen.getAllByRole('row')
    expect(rows[1]).toHaveTextContent('80 / 80')
    expect(rows[2]).toHaveTextContent('20 / 20')

    await user.click(sortButton)
    expect(sortButton.closest('th')).toHaveAttribute('aria-sort', 'ascending')
    rows = screen.getAllByRole('row')
    expect(rows[1]).toHaveTextContent('20 / 20')
    await user.click(within(rows[1]!).getByRole('button'))
    expect(onSelect).toHaveBeenCalledWith('low')
  })

  it('sorts opportunity cost ascending by default and always keeps missing values last', async () => {
    const user = userEvent.setup()
    render(<ScenarioResultsTable
      points={[point('missing', 20, null), point('high-cost', 30, 30), point('low-cost', 40, 5)]}
      selectedId={null}
      onSelect={vi.fn()}
    />)

    const sortButton = screen.getByRole('button', { name: '搓玉成本 理智/龙门币（越低越优）' })
    await user.click(sortButton)
    let rows = screen.getAllByRole('row')
    expect(rows[1]).toHaveTextContent('5 / 1,000')
    expect(rows[3]).not.toHaveTextContent(/(?:5|30) \/ 1,000/)

    await user.click(sortButton)
    rows = screen.getAllByRole('row')
    expect(rows[1]).toHaveTextContent('30 / 1,000')
    expect(rows[3]).not.toHaveTextContent(/(?:5|30) \/ 1,000/)
  })
})

function point(id: string, sustainablePerDay: number, opportunityCost: number | null = 10): ScenarioComparisonPoint {
  return {
    id,
    label: id,
    config: CONFIG_PRESETS['243'],
    layout: '243',
    productionPlan: {
      trading: { lmd: 1, orundum: 1 },
      manufacturing: { pureGold: 2, battleRecord: 0, originiumShard: 2 },
    },
    scheduleMode: 'maa',
    scheduleStrategy: '8x3',
    shiftHours: [8, 8, 8],
    operationsPerDay: 3,
    variableShiftFallback: false,
    droneStrategy: 'off',
    status: 'succeeded',
    screening: metrics(sustainablePerDay, opportunityCost),
    isFrontier: false,
  }
}

function metrics(sustainablePerDay: number, opportunityCost: number | null): ScenarioMetrics {
  return {
    productionSanityPerDay: 100 + sustainablePerDay,
    totalEfficiency: 0,
    lmdPerDay: 1_000,
    orundumPerDay: sustainablePerDay,
    battleRecordPerDay: 0,
    pureGoldProducedPerDay: 100,
    pureGoldConsumedPerDay: 100,
    pureGoldNetPerDay: 0,
    originiumShardProducedPerDay: 20,
    originiumShardConsumedPerDay: 20,
    originiumShardNetPerDay: 0,
    dronesGeneratedPerDay: 180,
    dronesUsedPerDay: 0,
    dronesDiscardedPerDay: 180,
    orundumEconomy: opportunityCost === null ? null : {
      sustainablePerDay,
      shortTermPerDay: sustainablePerDay,
      hardLmdCostPerDay: 1_000,
      opportunityCostSanityPerDay: opportunityCost,
      inventoryDepletionDays: null,
      bottleneck: 'trading',
      case: 'capacity_limited',
      dailySanityBudget: 240,
      monthlyCard: false,
    },
  }
}
