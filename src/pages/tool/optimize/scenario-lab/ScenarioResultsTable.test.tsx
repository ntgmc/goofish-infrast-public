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
})

function point(id: string, sustainablePerDay: number): ScenarioComparisonPoint {
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
    screening: metrics(sustainablePerDay),
    isFrontier: false,
  }
}

function metrics(sustainablePerDay: number): ScenarioMetrics {
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
    orundumEconomy: {
      sustainablePerDay,
      shortTermPerDay: sustainablePerDay,
      hardLmdCostPerDay: 1_000,
      opportunityCostSanityPerDay: 10,
      inventoryDepletionDays: null,
      bottleneck: 'trading',
      case: 'capacity_limited',
      dailySanityBudget: 240,
      monthlyCard: false,
    },
  }
}
