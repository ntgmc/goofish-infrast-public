// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { copy } from '../../../copy'
import { CONFIG_PRESETS, normalizeConfig } from '../../../lib/config'
import { createBlankManualSchedule } from '../../../lib/manual-schedule-tool'
import type { LicenseOperator, UserGameAccount, UserWorkspace, WorkspaceResultHistoryItem } from '../../../lib/types'
import type { V2Session } from '../OptionsDrawer'
import ScheduleComparison from './ScheduleComparison'

const mocks = vi.hoisted(() => ({ detail: vi.fn(), page: vi.fn(), submit: vi.fn(), snapshot: vi.fn(), wait: vi.fn() }))
vi.mock('../../tool/optimize/optimization-api', async (original) => ({
  ...await original<typeof import('../../tool/optimize/optimization-api')>(),
  fetchResultHistoryDetail: mocks.detail, fetchResultHistoryPage: mocks.page, submitOptimizationJob: mocks.submit,
}))
vi.mock('../../tool/optimize/job-progress', async (original) => ({
  ...await original<typeof import('../../tool/optimize/job-progress')>(), fetchOptimizeJobSnapshotStatus: mocks.snapshot, waitForOptimizePoll: mocks.wait,
}))

const text = copy.tools.scheduleComparison
const profile: UserGameAccount = {
  id: 'first', user_id: 'user', kind: 'cdk', permission: 'advanced', status: 'active',
  display_name: 'Account', cdk_order_hash: null, note: '', operator_count: 3, updated_at: null, created_at: '2026-01-01',
}
const config = normalizeConfig(CONFIG_PRESETS['243'])
const operators: LicenseOperator[] = [
  { id: 'f', name: '芬', own: true, elite: 1, rarity: 3 },
  { id: 'k', name: '克洛丝', own: true, elite: 1, rarity: 3 },
  { id: 'v', name: '香草', own: true, elite: 1, rarity: 3 },
]
function record(id: string): WorkspaceResultHistoryItem {
  const source = createBlankManualSchedule(config)
  source.title = id
  source.plans[0].rooms.manufacture[0].operators = id === 'A' ? ['芬', '克洛丝'] : ['芬', '香草']
  if (id !== 'A') {
    source.plans[0].rooms.manufacture[0].operators = ['香草']
    source.plans[0].rooms.trading[0].operators = ['芬']
  }
  return { id, name: `Saved ${id}`, created_at: '2026-01-01', source: 'generated', operator_count: 3, config, result: source }
}
const summary = (id: string) => ({ id, name: `Saved ${id}`, created_at: '2026-01-01', source: 'generated' as const, operator_count: 3, schedule_mode: 'maa', maa_exportable: true, has_config: true, archived: false })
function session(overrides: Partial<V2Session> = {}): V2Session {
  return {
    authStatus: 'authenticated', authLoading: false, profiles: [profile], activeProfile: profile,
    workspace: { profile_id: profile.id, config, operators, result_history: [summary('A'), summary('B')], archived_results: [],
      result_history_next_cursor: null, archived_results_next_cursor: null } as unknown as UserWorkspace,
    eliteOverrides: { f: 2 }, openingProfileId: null, workspaceLoadError: null, refreshProfileWorkspace: vi.fn(),
    ...overrides,
  } as V2Session
}
const view = (value = session()) => <MemoryRouter><ScheduleComparison session={value} onOpenProfile={vi.fn()} /></MemoryRouter>
const selector = (side: 'before' | 'after') => screen.getByLabelText(`${text[side]} · ${text.select}`)
async function upload(user: ReturnType<typeof userEvent.setup>, side: 'before' | 'after', id: string, content = JSON.stringify(record(id).result)) {
  const file = new File([content], `${id}.json`, { type: 'application/json' })
  Object.defineProperty(file, 'text', { value: async () => content })
  await user.upload(screen.getByLabelText(`${text[side]} · ${text.import}`), file)
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.detail.mockImplementation(async (_profile: string, id: string) => record(id))
  mocks.submit.mockImplementation(async () => ({ job_id: `job-${mocks.submit.mock.calls.length}`, poll_token: 'poll-token' }))
  mocks.snapshot.mockImplementation(async (id: string) => ({ status: 'succeeded', result: {
    ...record(id.endsWith('1') ? 'A' : 'B').result,
    daily_production: { hours: 24, trading: { LMD: id.endsWith('1') ? 30_000 : 36_000 }, manufacturing: { 'Battle Record': 10 } },
  } }))
})
afterEach(cleanup)

it.each(['saved/saved', 'saved/json', 'json/json'])('compares %s using the same current operators and new simulation outputs', async (mode) => {
  const user = userEvent.setup()
  render(view())
  const start = screen.getByRole('button', { name: text.start })
  expect(start).toBeDisabled()
  if (mode.startsWith('saved')) await user.selectOptions(selector('before'), 'A')
  else await upload(user, 'before', 'A')
  if (mode.endsWith('saved')) await user.selectOptions(selector('after'), 'B')
  else await upload(user, 'after', 'B')
  await waitFor(() => expect(start).toBeEnabled())
  const differences = screen.getByRole('region', { name: text.operators })
  expect(within(differences).getByRole('row', { name: /香草/ })).toHaveTextContent(text.statuses.added)
  expect(within(differences).getByRole('row', { name: /克洛丝/ })).toHaveTextContent(text.statuses.removed)
  expect(within(differences).getByRole('row', { name: /芬/ })).toHaveTextContent(text.statuses.changed)
  await user.click(start)
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2))
  for (const [request] of mocks.submit.mock.calls) {
    expect(request).toMatchObject({ kind: 'schedule', identity: { type: 'profile', profileId: 'first' }, includeUpgradeSuggestions: false, manualSchedule: { purpose: 'comparison' } })
    expect(request.operators.find((operator: LicenseOperator) => operator.name === '芬').elite).toBe(2)
    expect(request.manualSchedule.source.daily_production).toBeUndefined()
  }
  const production = await screen.findByRole('region', { name: text.production })
  const row = within(production).getByRole('row', { name: /龙门币/ })
  expect(within(row).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['30,000', '36,000', '+6,000', '+20%'])
  const experience = within(production).getByRole('row', { name: /作战记录经验/ })
  expect(within(experience).getAllByRole('cell')[0]).toHaveTextContent('10,000')
})

it('keeps per-file errors local and clears prior results after replacing an input', async () => {
  const user = userEvent.setup()
  render(view())
  await upload(user, 'before', 'A')
  await upload(user, 'after', 'B')
  await user.click(screen.getByRole('button', { name: text.start }))
  await screen.findByRole('region', { name: text.production })
  await waitFor(() => expect(screen.getByRole('button', { name: text.start })).toBeEnabled())
  await upload(user, 'after', 'invalid', '{}')
  expect(await screen.findByText(copy.tools.manualSchedule.importFailed)).toBeVisible()
  expect(screen.getByText('A.json', { selector: 'strong' })).toBeVisible()
  expect(screen.queryByRole('region', { name: text.production })).not.toBeInTheDocument()
  expect(screen.queryByRole('region', { name: text.operators })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: text.start })).toBeDisabled()
})

it('uses configurable fallback hours for MAA JSON and preserves each table’s own configuration', async () => {
  const user = userEvent.setup()
  render(view())
  await user.click(screen.getByText(text.importSettings))
  await user.clear(screen.getByLabelText(copy.tools.manualSchedule.shiftHours))
  await user.type(screen.getByLabelText(copy.tools.manualSchedule.shiftHours), '12-6-6')
  const maa = record('A').result
  delete maa.shift_hours
  maa.plans.forEach((plan) => { delete plan.shift_hours })
  await upload(user, 'before', 'A', JSON.stringify(maa))
  await upload(user, 'after', 'B')
  await user.click(screen.getByRole('button', { name: text.start }))
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2))
  expect(mocks.submit.mock.calls[0][0].manualSchedule.source.shift_hours).toEqual([12, 6, 6])
  expect(mocks.submit.mock.calls[1][0].manualSchedule.source.shift_hours).toEqual([8, 8, 8])
})

it('can select archived and paginated schedules', async () => {
  const user = userEvent.setup()
  const value = session()
  value.workspace!.archived_results = [{ ...summary('archived'), archived: true }]
  value.workspace!.result_history_next_cursor = 'next'
  mocks.page.mockResolvedValue({ items: [summary('older')], next_cursor: null })
  render(view(value))
  await user.click(screen.getByRole('button', { name: copy.optimize.pages_tool_optimize_result_history_load_more }))
  await user.selectOptions(selector('before'), 'older')
  await user.selectOptions(selector('after'), 'archived')
  expect(mocks.page).toHaveBeenCalledWith('first', 'active', 'next', expect.any(AbortSignal))
  await waitFor(() => expect(screen.getByRole('button', { name: text.start })).toBeEnabled())
})

it('ignores a late history response after a different selection', async () => {
  let finish!: (value: WorkspaceResultHistoryItem) => void
  mocks.detail.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const user = userEvent.setup()
  render(view())
  await user.selectOptions(selector('before'), 'A')
  await upload(user, 'before', 'B')
  await act(async () => { finish(record('A')) })
  expect(screen.getByText('B.json', { selector: 'strong' })).toBeVisible()
  expect(screen.queryByText('Saved A', { selector: 'strong' })).not.toBeInTheDocument()
})

it('discards pending simulation when training changes and does not submit the second table', async () => {
  let finish!: (value: unknown) => void
  mocks.snapshot.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  const user = userEvent.setup()
  const value = session()
  const { rerender } = render(view(value))
  await upload(user, 'before', 'A')
  await upload(user, 'after', 'B')
  await user.click(screen.getByRole('button', { name: text.start }))
  await waitFor(() => expect(mocks.snapshot).toHaveBeenCalledTimes(1))
  rerender(view({ ...value, eliteOverrides: { f: 1 } }))
  await act(async () => { finish({ status: 'succeeded', result: record('A').result }) })
  expect(mocks.submit).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('region', { name: text.production })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: text.start })).toBeDisabled()
})

it('keeps completed A output when B fails and allows retry', async () => {
  mocks.snapshot.mockResolvedValueOnce({ status: 'succeeded', result: { ...record('A').result, daily_production: { trading: { LMD: 30_000 } } } })
    .mockResolvedValueOnce({ status: 'failed', error: { message: 'Simulation unavailable' } })
  const user = userEvent.setup()
  render(view())
  await upload(user, 'before', 'A')
  await upload(user, 'after', 'B')
  await user.click(screen.getByRole('button', { name: text.start }))
  expect(await screen.findByText(`${text.after} · Simulation unavailable`)).toBeVisible()
  const production = screen.getByRole('region', { name: text.production })
  expect(within(within(production).getByRole('row', { name: /龙门币/ })).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['30,000', '—', '—', '—'])
  expect(screen.getByRole('button', { name: text.start })).toBeEnabled()
})

it('requires an available advanced profile and owned operators', () => {
  const { rerender } = render(view(session({ profiles: [{ ...profile, permission: 'recommended' }] })))
  expect(screen.getByText(text.unavailable)).toBeVisible()
  expect(screen.queryByRole('button', { name: text.start })).not.toBeInTheDocument()
  const value = session()
  value.workspace!.operators = []
  rerender(view(value))
  expect(screen.getByText(text.operatorsRequired)).toBeVisible()
  expect(screen.queryByRole('button', { name: text.start })).not.toBeInTheDocument()
})
