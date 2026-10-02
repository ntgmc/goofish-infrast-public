// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONFIG_PRESETS, normalizeConfig } from '../lib/config'
import { createBlankManualSchedule } from '../lib/manual-schedule-tool'
import type { UserGameAccount } from '../lib/types'
import ManualSchedulePage from './ManualSchedulePage'
import { copy } from '../copy/index'

const mocks = vi.hoisted(() => ({ session: vi.fn(), submit: vi.fn(), snapshot: vi.fn() }))
vi.mock('./tool/useToolSession', () => ({ useToolSession: mocks.session }))
vi.mock('../pages/tool/optimize/optimization-api', async (original) => ({
  ...await original<typeof import('../pages/tool/optimize/optimization-api')>(), submitOptimizationJob: mocks.submit,
}))
vi.mock('../pages/tool/optimize/job-progress', async (original) => ({
  ...await original<typeof import('../pages/tool/optimize/job-progress')>(), fetchOptimizeJobSnapshotStatus: mocks.snapshot,
}))

const profile: UserGameAccount = {
  id: 'manual-profile', user_id: 'user', kind: 'cdk', permission: 'advanced', status: 'active',
  display_name: '我的档案', cdk_order_hash: null, note: '', operator_count: 1, updated_at: null, created_at: '2026-01-01',
}
const config = normalizeConfig(CONFIG_PRESETS['243'])
const workspace = { config, operators: [{ id: 'f', name: '芬', own: true, elite: 1, rarity: 3 }] }
const session = () => ({
  authStatus: 'authenticated', authLoading: false, profiles: [profile], activeProfile: profile, workspace,
  eliteOverrides: {}, openingProfileId: null, workspaceLoadError: null, refreshProfileWorkspace: vi.fn(),
})

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  mocks.session.mockReturnValue(session())
  mocks.submit.mockResolvedValue({ job_id: 'manual-job' })
  mocks.snapshot.mockResolvedValue({ status: 'succeeded', result: { ...createBlankManualSchedule(config), total_efficiency: 175 } })
})
afterEach(cleanup)
const page = () => render(<MemoryRouter><ManualSchedulePage /></MemoryRouter>)

describe('manual schedule tool', () => {
  it('shows an explanation with disabled actions when no current advanced permission exists', () => {
    mocks.session.mockReturnValue({ ...session(), profiles: [
      { ...profile, permission: 'recommended' }, { ...profile, status: 'frozen' },
      { ...profile, expires_at: '2026-01-01' }, { ...profile, archived_at: '2026-01-01' },
    ] })
    page()
    expect(screen.getByText(/当前账号没有可用的高级版权限/)).toBeVisible()
    expect(screen.getByRole('button', { name: '从零开始排班' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '导入排班 JSON' })).toBeDisabled()
    expect(screen.queryByRole('region', { name: '手动排班模式' })).not.toBeInTheDocument()
  })

  it('starts a blank schedule and submits simulation with the actual profile identity', async () => {
    const user = userEvent.setup()
    page()
    await user.click(screen.getByRole('button', { name: '从零开始排班' }))
    await user.click(screen.getByRole('button', { name: '模拟测算' }))
    expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({
      identity: { type: 'profile', profileId: profile.id },
      manualSchedule: expect.objectContaining({ source: expect.objectContaining({ plans: expect.any(Array) }) }),
    }), expect.any(String))
    const submitted = mocks.submit.mock.calls[0][0]
    expect(submitted.manualSchedule.baselineHistoryId).toBeUndefined()
    expect(submitted.manualSchedule.plans[0].rooms.manufacture[0]).toEqual(['', '', ''])
    expect(await screen.findByText(copy.domain.manual_schedule.simulated)).toBeVisible()
  })

  it('imports MAA JSON and preserves the current editor after invalid imports', async () => {
    const user = userEvent.setup()
    page()
    const source = createBlankManualSchedule(config)
    source.plans[0].rooms.manufacture[0].operators = ['芬']
    const maa = { title: '导入方案', description: '', plans: source.plans }
    const file = new File([JSON.stringify(maa)], 'schedule.json', { type: 'application/json' })
    Object.defineProperty(file, 'text', { value: async () => JSON.stringify(maa) })
    await user.upload(screen.getByLabelText('导入排班 JSON', { selector: 'input' }), file)
    await user.click(await screen.findByRole('button', { name: '模拟测算' }))
    expect(mocks.submit.mock.calls[0][0].manualSchedule.plans[0].rooms.manufacture[0]).toEqual(['芬', '', ''])
    const invalid = new File(['{}'], 'invalid.json', { type: 'application/json' })
    Object.defineProperty(invalid, 'text', { value: async () => '{}' })
    await user.upload(screen.getByLabelText('导入排班 JSON', { selector: 'input' }), invalid)
    expect(await screen.findByText(/排班 JSON 无效/)).toBeVisible()
    expect(screen.getByRole('button', { name: '模拟测算' })).toBeEnabled()
  })

  it('uses profile training and saves, restores and submits facility products and per-shift Fiammetta settings', async () => {
    const user = userEvent.setup()
    mocks.session.mockReturnValue({ ...session(), eliteOverrides: { f: 2 }, workspace: {
      config, operators: [...workspace.operators, { id: 'char_300_phenxi', name: '菲亚梅塔', own: true, elite: 0, level: 1, rarity: 6 }],
    } })
    page()
    const source = createBlankManualSchedule(config)
    source.plans[0].rooms.manufacture[0].operators = ['芬']
    const text = JSON.stringify(source)
    const file = new File([text], 'schedule.json', { type: 'application/json' })
    Object.defineProperty(file, 'text', { value: async () => text })
    await user.upload(screen.getByLabelText('导入排班 JSON', { selector: 'input' }), file)
    await user.selectOptions(await screen.findByLabelText('制造站 1 · 产物'), 'Originium Shard')
    await user.selectOptions(screen.getByLabelText('制造站 1 · 设施等级'), '2')
    await user.selectOptions(screen.getByLabelText('恢复心情对象'), '芬')
    await user.selectOptions(screen.getByLabelText('使用时机'), 'post')
    await user.click(screen.getByRole('button', { name: copy.domain.manual_schedule.save }))
    const saved = JSON.parse(localStorage.getItem('manual-schedule:tool:manual-profile')!)
    expect(saved.schedule.plans[0].rooms.manufacture[0]).toMatchObject({ level: 2, product: 'Originium Shard' })
    expect(saved.schedule.plans[0].Fiammetta).toMatchObject({ enable: true, target: '芬', order: 'post' })
    expect(saved.schedule.plans[1].Fiammetta).toBeUndefined()
    await user.selectOptions(screen.getByLabelText('制造站 1 · 产物'), 'Battle Record')
    await user.click(screen.getByRole('button', { name: '恢复已保存草稿' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: '完成' }))
    expect(screen.getByLabelText('制造站 1 · 产物')).toHaveValue('Originium Shard')
    await user.click(screen.getByRole('button', { name: '模拟测算' }))
    const submitted = mocks.submit.mock.calls[0][0]
    expect(submitted.operators.find((operator: { id: string }) => operator.id === 'f').elite).toBe(2)
    expect(submitted.manualSchedule.source.plans.every((plan: typeof source.plans[number]) =>
      plan.rooms.manufacture[0].product === 'Originium Shard' && plan.rooms.manufacture[0].level === 2)).toBe(true)
    expect(submitted.manualSchedule.source.plans[0].Fiammetta).toMatchObject({ target: '芬', order: 'post' })
    expect(await screen.findByText(copy.domain.manual_schedule.simulated)).toBeVisible()
    await user.selectOptions(screen.getByLabelText('制造站 1 · 产物'), 'Battle Record')
    expect(screen.queryByText(copy.domain.manual_schedule.simulated)).not.toBeInTheDocument()
  })

  it('keeps sparse assignments when settings change and prevents lowering capacity or using a removed Fiammetta target', async () => {
    const user = userEvent.setup()
    mocks.session.mockReturnValue({ ...session(), workspace: {
      config, operators: [...workspace.operators, { id: 'char_300_phenxi', name: '菲亚梅塔', own: true, elite: 0, level: 1, rarity: 6 }],
    } })
    page()
    const source = createBlankManualSchedule(config)
    source.plans[0].rooms.manufacture[0].operators = ['', '', '芬']
    const text = JSON.stringify(source)
    const file = new File([text], 'schedule.json', { type: 'application/json' })
    Object.defineProperty(file, 'text', { value: async () => text })
    await user.upload(screen.getByLabelText('导入排班 JSON', { selector: 'input' }), file)
    await user.selectOptions(await screen.findByLabelText('制造站 1 · 产物'), 'Battle Record')
    await user.selectOptions(screen.getByLabelText('制造站 1 · 设施等级'), '2')
    expect(await screen.findByText(copy.tools.manualSchedule.occupiedSlots)).toBeVisible()
    expect(screen.getByLabelText('制造站 1 · 设施等级')).toHaveValue('3')
    await user.selectOptions(screen.getByLabelText('恢复心情对象'), '芬')
    await user.click(screen.getByRole('button', { name: '模拟测算' }))
    expect(mocks.submit.mock.calls[0][0].manualSchedule.plans[0].rooms.manufacture[0]).toEqual(['', '', '芬'])
    await screen.findByText(copy.domain.manual_schedule.simulated)
    await user.click(screen.getByRole('button', { name: /编辑 制造站.*芬/ }))
    await user.click(screen.getByRole('button', { name: '清空此位置' }))
    await user.click(screen.getByRole('button', { name: '完成' }))
    expect(screen.getByText(copy.tools.manualSchedule.fiammettaInvalid)).toBeVisible()
    expect(screen.getByRole('button', { name: '模拟测算' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: copy.domain.manual_schedule.save }))
    await user.selectOptions(screen.getByLabelText('恢复心情对象'), '')
    expect(screen.getByRole('button', { name: '模拟测算' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: copy.domain.manual_schedule.restore }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: copy.domain.manual_schedule.done }))
    expect(screen.getByLabelText('恢复心情对象')).toHaveValue('芬')
    expect(screen.getByRole('button', { name: '模拟测算' })).toBeDisabled()
  })

  it('discards a simulation when facility settings change during the request', async () => {
    let finish!: (value: unknown) => void
    mocks.snapshot.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const user = userEvent.setup()
    page()
    await user.click(screen.getByRole('button', { name: copy.tools.manualSchedule.start }))
    await user.click(screen.getByRole('button', { name: copy.domain.manual_schedule.simulate }))
    await user.selectOptions(screen.getByLabelText('制造站 1 · 产物'), 'Originium Shard')
    await act(async () => { finish({ status: 'succeeded', result: createBlankManualSchedule(config) }) })
    expect(screen.queryByText(copy.domain.manual_schedule.simulated)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: copy.domain.manual_schedule.simulate })).toBeEnabled()
  })
  it('prevents starting before the selected profile has owned operators', () => {
    mocks.session.mockReturnValue({ ...session(), workspace: { config, operators: [] } })
    page()
    expect(screen.getByText(/请先在此档案中导入干员/)).toBeVisible()
    expect(screen.getByRole('button', { name: '从零开始排班' })).toBeDisabled()
    expect(within(screen.getByRole('main')).getByRole('link', { name: '前往导入干员' }))
      .toHaveAttribute('href', '/tool/setup/operators?profile_id=manual-profile')
  })
})
