// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ScenarioComparisonFactors } from '../../../../lib/scenario-comparison'
import ScenarioFactors from './ScenarioFactors'

afterEach(cleanup)

const factors: ScenarioComparisonFactors = {
  layouts: [{
    layout: '243',
    plans: [{
      trading: { lmd: 2, orundum: 0 },
      manufacturing: { pureGold: 2, battleRecord: 2, originiumShard: 0 },
    }],
  }],
  maaSchedules: ['8x3'],
  includeRotation: false,
  droneStrategies: ['off'],
}

describe('ScenarioFactors', () => {
  it('uses the available container width instead of forcing three narrow columns on wide screens', () => {
    render(<ScenarioFactors factors={factors} disabled={false} onChange={vi.fn()} />)
    const layoutGrid = screen.getByTestId('scenario-layout-grid')
    expect(layoutGrid).toHaveClass('grid-cols-[repeat(auto-fit,minmax(220px,1fr))]')
    expect(layoutGrid).not.toHaveClass('xl:grid-cols-3')
  })

  it('adds exact orundum plans and emits automatic schedule and drone changes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ScenarioFactors factors={factors} disabled={false} onChange={onChange} />)
    const layout = screen.getByRole('region', { name: '243' })
    await user.selectOptions(within(layout).getByLabelText('合成玉贸易线'), '1')
    await user.selectOptions(within(layout).getByLabelText('源石碎片制造线'), '2')
    await user.click(within(layout).getByRole('button', { name: '添加生产方案' }))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      layouts: expect.arrayContaining([expect.objectContaining({
        layout: '243',
        plans: expect.arrayContaining([expect.objectContaining({
          trading: { lmd: 1, orundum: 1 },
          manufacturing: { pureGold: 2, battleRecord: 0, originiumShard: 2 },
        })]),
      })]),
    }))

    await user.click(screen.getByLabelText('MAA 自动非固定间隔（2–4 班）'))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ maaSchedules: ['variable', '8x3'] }))
    await user.click(screen.getByLabelText('合成玉'))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ droneStrategies: ['off', 'orundum'] }))
  })

  it('disables every factor control while a task is running', () => {
    render(<ScenarioFactors factors={{ layouts: [], maaSchedules: [], includeRotation: false, droneStrategies: [] }} disabled onChange={vi.fn()} />)
    expect(screen.getByRole('group', { name: '场景组合因子' })).toBeDisabled()
  })
})
