// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONFIG_PRESETS } from '../../lib/config'
import type { OptimizeResult } from '../../lib/types'
import ResultPanel from './ResultPanel'
import ManualScheduleEditor from './ManualScheduleEditor'
import { createManualPlans, saveManualDraft } from '../../lib/manual-schedule'

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
async function editor(result = source) {
  const user = userEvent.setup()
  render(<ResultPanel result={result} operators={['芬', '克洛丝', 'Castle-3'].map((name) => ({ id: name, name, own: true, elite: 1, rarity: 3 }))}
    manualEditProfile={{ id: 'manual-test', kind: 'cdk', permission: 'advanced' }}
    manualSimulationBaseline={{ id: 'history-1', config: CONFIG_PRESETS['243'] }} />)
  await user.click(screen.getByRole('tab', { name: '手动排班' }))
  return { user, scope: within(await screen.findByRole('region', { name: '手动调整排班' })) }
}
describe('manual simulation lifecycle', () => {
  it.each(['manual', 'tool:manual'])('clears only the draft at %s when resetting a reopened schedule', async (draftStorageKey) => {
    const user = userEvent.setup()
    const operators = ['芬', '克洛丝'].map((name) => ({ id: name, name, own: true, elite: 1, rarity: 3 }))
    const plans = createManualPlans(source)
    plans[0].rooms.manufacture[0][0] = '克洛丝'
    const otherKey = draftStorageKey === 'manual' ? 'tool:manual' : 'manual'
    saveManualDraft(draftStorageKey, source, plans, operators)
    saveManualDraft(otherKey, source, plans, operators)
    const otherDraft = localStorage.getItem(`manual-schedule:${otherKey}`)
    try {
      render(<ManualScheduleEditor source={source} profileId="manual" draftStorageKey={draftStorageKey} operators={operators} />)
      expect(screen.getByRole('button', { name: '恢复已保存草稿' })).toBeEnabled()
      await user.click(screen.getByRole('button', { name: '还原原始排班' }))
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '完成' }))
      expect(localStorage.getItem(`manual-schedule:${draftStorageKey}`)).toBeNull()
      expect(localStorage.getItem(`manual-schedule:${otherKey}`)).toBe(otherDraft)
      expect(source.plans[0].rooms.manufacture[0].operators).toEqual(['芬'])
      expect(screen.getByRole('button', { name: '恢复已保存草稿' })).toBeDisabled()
      expect(screen.getByRole('button', { name: '还原原始排班' })).toBeDisabled()
    } finally {
      localStorage.removeItem(`manual-schedule:${draftStorageKey}`)
      localStorage.removeItem(`manual-schedule:${otherKey}`)
    }
  })

  it('names mood shortfalls and fills suggested beds before remeasuring', async () => {
    const baseline = structuredClone(source)
    baseline.plans[0].rooms.dormitory = [{ operators: ['Castle-3'] }]
    const measured: OptimizeResult = {
      ...baseline,
      plans: [{
        ...baseline.plans[0],
        rooms: {
          ...baseline.plans[0].rooms,
          manufacture: [{ ...baseline.plans[0].rooms.manufacture[0], mood: {
            芬: { start: 3, consumed: 8, end: 0, red_face: true },
          } }],
        },
      }],
      mood_simulation: {
        valid: false, daily_loop_stable: true, iterations: 2, degrading_operators: [],
        dormitory_recovery: {
          additions: [{ shift_index: 0, room_index: 0, operator: '克洛丝' }], unassigned: [],
        },
      },
    }
    const filled = structuredClone(measured)
    filled.plans[0].rooms.dormitory[0].operators = ['Castle-3', '克洛丝']
    filled.mood_simulation!.dormitory_recovery!.additions = []
    mocks.snapshot.mockResolvedValueOnce({ status: 'succeeded', result: measured })
      .mockResolvedValueOnce({ status: 'succeeded', result: filled })
    const { user, scope } = await editor(baseline)
    await user.click(scope.getByRole('button', { name: '模拟测算' }))
    const mood = within(await scope.findByRole('region', { name: '干员心情测算' }))
    expect(mood.getByText('需要调整的干员：芬')).toBeVisible()
    expect(mood.getAllByText(/本班缺少 5 点心情/)[0]).toBeVisible()
    expect(mood.getByRole('table')).toBeVisible()
    expect(mood.getByText('Shift · 宿舍 1：克洛丝')).toBeVisible()
    await user.click(mood.getByRole('button', { name: '补齐宿舍并重新测算' }))
    expect(mocks.submit).toHaveBeenCalledTimes(2)
    expect(mocks.submit.mock.calls[1][0].manualSchedule.plans[0].rooms.dormitory[0])
      .toEqual(['Castle-3', '克洛丝', '', '', ''])
    expect(await scope.findByRole('button', { name: '补齐宿舍并重新测算' })).toBeDisabled()
  })
  it('submits the current plan and shows mood warnings only until the next edit', async () => {
    mocks.snapshot.mockResolvedValue({ status: 'succeeded', result: simulated })
    const { user, scope } = await editor()
    await user.click(scope.getByRole('button', { name: '模拟测算' }))
    expect(await scope.findByText(/部分干员的心情无法充分恢复/)).toBeInTheDocument()
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({
      manualSchedule: expect.objectContaining({ baselineHistoryId: 'history-1' }),
      includeUpgradeSuggestions: false,
    }), expect.any(String))
    expect(scope.getByText('175.00')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: '数据' }))
    const data = within(screen.getByRole('tabpanel'))
    expect(data.queryByText('175.00')).not.toBeInTheDocument()
    expect(data.getByText('0.00')).toBeInTheDocument()
    expect(source.total_efficiency).toBeUndefined()
    await user.click(screen.getByRole('tab', { name: '手动排班' }))
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
