// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ScenarioFactors from './ScenarioFactors'

afterEach(cleanup)

describe('ScenarioFactors', () => {
  it('emits exact split and rotation changes through native controls', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const factors = {
      layouts: [{ layout: '243' as const, splits: [{ pureGold: 2, battleRecord: 2 }] }],
      maaShiftHours: [8 as const],
      includeRotation: false,
      droneStrategies: ['off' as const],
    }
    render(<ScenarioFactors factors={factors} disabled={false} onChange={onChange} />)
    await user.click(screen.getByLabelText('游戏内轮换 12 小时 × 2'))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ includeRotation: true }))
    await user.click(screen.getByLabelText('赤金 1 线 + 经验 4 线'))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      layouts: expect.arrayContaining([expect.objectContaining({ layout: '153' })]),
    }))
  })

  it('disables every factor control while a task is running', () => {
    render(<ScenarioFactors factors={{ layouts: [], maaShiftHours: [], includeRotation: false, droneStrategies: [] }} disabled onChange={vi.fn()} />)
    expect(screen.getByRole('group', { name: '场景组合因子' })).toBeDisabled()
  })
})
