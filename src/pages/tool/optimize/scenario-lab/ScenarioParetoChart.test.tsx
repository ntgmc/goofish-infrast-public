// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONFIG_PRESETS } from '../../../../lib/config'
import type { ScenarioComparisonPoint } from '../../../../lib/scenario-comparison'
import ScenarioParetoChart from './ScenarioParetoChart'

afterEach(cleanup)

describe('ScenarioParetoChart', () => {
  it('selects an automatic-shift point with the keyboard and exposes its actual cost', () => {
    const onSelect = vi.fn()
    render(<ScenarioParetoChart points={[point()]} selectedId={null} onSelect={onSelect} />)
    const mark = screen.getByRole('button')
    expect(mark).toHaveAttribute('aria-label', expect.stringContaining('3 次换班'))
    fireEvent.keyDown(mark, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith('variable')
  })

  it('derives a safe x-axis from finite points instead of assuming the 2-4 range', () => {
    render(<ScenarioParetoChart points={[point(8)]} selectedId={null} onSelect={vi.fn()} />)

    const mark = screen.getByRole('button')
    const circle = mark.querySelector('circle')
    expect(Number(circle?.getAttribute('cx'))).toBeGreaterThanOrEqual(70)
    expect(Number(circle?.getAttribute('cx'))).toBeLessThanOrEqual(690)
    expect(mark).toHaveAttribute('aria-label', expect.stringContaining('8 次换班'))
  })
})

function point(operationsPerDay = 3): ScenarioComparisonPoint {
  return {
    id: 'variable',
    label: '自动非固定 12-6-6',
    config: CONFIG_PRESETS['243'],
    layout: '243',
    productionPlan: {
      trading: { lmd: 2, orundum: 0 },
      manufacturing: { pureGold: 2, battleRecord: 2, originiumShard: 0 },
    },
    scheduleMode: 'maa',
    scheduleStrategy: 'variable',
    shiftHours: [12, 6, 6],
    operationsPerDay,
    variableShiftFallback: false,
    droneStrategy: 'off',
    status: 'succeeded',
    screening: {
      productionSanityPerDay: 300,
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
    },
    isFrontier: false,
  }
}
