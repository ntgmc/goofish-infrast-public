// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONFIG_PRESETS } from '../../lib/config'
import type { OptimizeResult } from '../../lib/types'
import ResultPanel from './ResultPanel'

const mocks = vi.hoisted(() => ({ submit: vi.fn(), snapshot: vi.fn() }))
vi.mock('../../pages/tool/optimize/optimization-api', async (original) => ({
  ...await original<typeof import('../../pages/tool/optimize/optimization-api')>(),
  submitOptimizationJob: mocks.submit,
}))
vi.mock('../../pages/tool/optimize/job-progress', async (original) => ({
  ...await original<typeof import('../../pages/tool/optimize/job-progress')>(),
  fetchOptimizeJobSnapshotStatus: mocks.snapshot,
}))
const source: OptimizeResult = {
  author: 'test', title: 'Manual', description: '', buildingType: 243, planTimes: '8×3',
  raw_results: [], plans: [{ name: 'Shift', rooms: {
    manufacture: [{ level: 3, product: 'Battle Record', operators: ['芬'] }],
  } }],
}
const simulated: OptimizeResult = {
  ...source, total_efficiency: 175,
  mood_simulation: { valid: false, daily_loop_stable: false, iterations: 12, degrading_operators: [] },
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.submit.mockResolvedValue({ job_id: 'manual-job' })
})
afterEach(cleanup)
async function editor() {
  const user = userEvent.setup()
  render(<ResultPanel result={source} operators={[{ id: '芬', name: '芬', own: true, elite: 1, rarity: 3 }]}
    manualEditProfile={{ id: 'manual-test', kind: 'cdk', permission: 'advanced' }}
    manualSimulationBaseline={{ id: 'history-1', config: CONFIG_PRESETS['243'] }} />)
  await user.click(screen.getByRole('tab', { name: '手动排班' }))
  return { user, scope: within(await screen.findByRole('region', { name: '手动调整排班' })) }
}
describe('manual simulation lifecycle', () => {
  it('submits the current plan and shows mood warnings only until the next edit', async () => {
    mocks.snapshot.mockResolvedValue({ status: 'succeeded', result: simulated })
    const { user, scope } = await editor()
    await user.click(scope.getByRole('button', { name: '模拟测算' }))
    expect(await scope.findByText(/部分干员的心情无法充分恢复/)).toBeInTheDocument()
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({
      manualSchedule: expect.objectContaining({ baselineHistoryId: 'history-1' }),
      includeUpgradeSuggestions: false,
    }), expect.any(String))
    await user.click(scope.getByRole('button', { name: /编辑 制造站.*芬/ }))
    await user.click(screen.getByRole('button', { name: '清空此位置' }))
    await user.click(screen.getByRole('button', { name: '完成' }))
    expect(scope.queryByText(/部分干员的心情无法充分恢复/)).not.toBeInTheDocument()
    expect(scope.getByText(/当前方案尚未模拟/)).toBeInTheDocument()
  })
  it('discards a completed simulation when the plan changes during the request', async () => {
    let finish!: (value: unknown) => void
    mocks.snapshot.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const { user, scope } = await editor()
    await user.click(scope.getByRole('button', { name: '模拟测算' }))
    expect(scope.getByRole('button', { name: '模拟测算' })).toBeDisabled()
    await user.click(scope.getByRole('button', { name: /编辑 制造站.*芬/ }))
    await user.click(screen.getByRole('button', { name: '清空此位置' }))
    await user.click(screen.getByRole('button', { name: '完成' }))
    await act(async () => { finish({ status: 'succeeded', result: simulated }) })
    expect(scope.queryByText(/部分干员的心情无法充分恢复/)).not.toBeInTheDocument()
    expect(scope.getByRole('button', { name: '模拟测算' })).toBeEnabled()
  })
})
