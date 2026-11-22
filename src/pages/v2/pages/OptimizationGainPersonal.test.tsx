// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TaskDraftProvider } from '../../../lib/task-drafts'
import { CONFIG_PRESETS } from '../../../lib/config'
import OptimizationGainPersonal from './OptimizationGainPersonal'

const mocks = vi.hoisted(() => ({ session: {} as Record<string, unknown>, api: vi.fn(), submit: vi.fn(), poll: vi.fn(), cancel: vi.fn() }))
vi.mock('../../tool/useToolSession', () => ({ useToolSession: () => mocks.session }))
vi.mock('../../../lib/site-feature-context', () => ({ useSiteFeatures: () => ({ features: { schedule_comparison: true } }) }))
vi.mock('../../../lib/api-client', async (original) => ({ ...await original<typeof import('../../../lib/api-client')>(), apiJson: mocks.api }))
vi.mock('../../tool/optimize/optimization-api', () => ({ submitOptimizationJob: mocks.submit, cancelOptimizationJob: mocks.cancel,
  fetchResultHistoryDetail: async (_profile: string, id: string) => ({ id, config: CONFIG_PRESETS['243'], result: { plans: [{ name: '全天', rooms: { manufacture: [{ level: 3, operators: ['芬'] }] } }] } }),
  fetchResultHistoryPage: vi.fn(),
}))
vi.mock('../../tool/optimize/job-progress', async (original) => ({ ...await original<typeof import('../../tool/optimize/job-progress')>(), fetchOptimizeJobSnapshotStatus: mocks.poll }))
const current = { id: 'current', name: '当前方案', created_at: '2026-11-22T00:00:00Z' }
const comparison = { id: 'verified', current_result_id: 'current', baseline_result_id: 'baseline', baseline_name: '原安排', current_daily_sanity: 168, baseline_daily_sanity: 180, daily_gain_sanity: -12, confirmed_at: null, ends_at: null }
const clients: QueryClient[] = []
function scope(user = 'user', profile = 'profile') {
  mocks.session = { user: { id: user }, authStatus: 'authenticated', profiles: [{ id: profile, display_name: '账号', kind: 'cdk', permission: 'ultimate', status: 'active' }],
    activeProfile: { id: profile, display_name: '账号', kind: 'cdk', permission: 'ultimate', status: 'active' },
    workspace: { profile_id: profile, config: CONFIG_PRESETS['243'], operators: [{ id: '芬', name: '芬', own: true, elite: 1 }], result_history: [{ id: 'baseline', name: '原安排', created_at: '2026-11-21T00:00:00Z' }], archived_results: [] }, eliteOverrides: {} }
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); clients.push(client)
  const tree = () => <QueryClientProvider client={client}><TaskDraftProvider><MemoryRouter><OptimizationGainPersonal /></MemoryRouter></TaskDraftProvider></QueryClientProvider>
  const page = render(tree())
  return { ...page, client, refresh: () => page.rerender(tree()) }
}
async function calculate() {
  fireEvent.change(await screen.findByLabelText('选择原来使用的排班'), { target: { value: 'baseline' } })
  fireEvent.click(screen.getByRole('checkbox'))
  const button = screen.getByRole('button', { name: '核算原排班' })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
}
beforeEach(() => {
  vi.clearAllMocks(); scope()
  mocks.api.mockImplementation(async (_url, options) => options?.json?.action === 'verify' ? comparison : { revision: 0, comparison_state: 'not_set', current, comparison: null })
  mocks.submit.mockImplementation(async () => ({ job_id: `job-${mocks.submit.mock.calls.length}`, poll_token: `poll-${mocks.submit.mock.calls.length}` }))
  mocks.poll.mockResolvedValue({ status: 'succeeded', result: {} })
  mocks.cancel.mockResolvedValue({ status: 'cancelled' })
})
afterEach(async () => { cleanup(); await Promise.all(clients.splice(0).map(async (client) => { await client.cancelQueries(); client.clear() })) })
it('only calculates after explicit confirmation and waits for a separate activation, including negative gains', async () => {
  mount()
  await screen.findByLabelText('选择原来使用的排班')
  expect(mocks.submit).not.toHaveBeenCalled()
  await calculate()
  expect(await screen.findByRole('heading', { name: '核算结果' })).toBeVisible()
  expect(screen.getByText('-12.00')).toBeVisible()
  expect(mocks.submit).toHaveBeenCalledTimes(2)
  expect(mocks.poll).toHaveBeenCalledWith('job-1', expect.any(String), 'poll-1', expect.any(Function))
  expect(mocks.api.mock.calls.filter(([, options]) => options?.json?.action === 'activate')).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: '确认并开始累计' }))
  await waitFor(() => expect(mocks.api.mock.calls.some(([, options]) => options?.json?.action === 'activate')).toBe(true))
})
it('discards a late verification response when the user and profile change', async () => {
  let resolve!: (value: unknown) => void
  mocks.api.mockImplementation((_url, options) => options?.json?.action === 'verify' ? new Promise((done) => { resolve = done }) : Promise.resolve({ revision: 0, comparison_state: 'not_set', current, comparison: null }))
  const page = mount()
  await calculate()
  await waitFor(() => expect(resolve).toBeDefined())
  scope('other-user', 'other-profile'); page.refresh()
  await act(async () => resolve(comparison))
  expect(screen.queryByRole('heading', { name: '核算结果' })).not.toBeInTheDocument()
  expect(page.client.getQueryData(['user', 'other-user', 'other-profile', 'value-clock-comparison'])).not.toMatchObject({ comparison: { id: 'verified' } })
  expect(mocks.api.mock.calls.filter(([, options]) => options?.json?.action === 'activate')).toHaveLength(0)
})
it('cancels the current task without verifying or activating a partial calculation', async () => {
  mocks.poll.mockResolvedValue({ status: 'queued', pollAfterMs: 10_000 })
  mount(); await calculate()
  const cancel = await screen.findByRole('button', { name: '取消核算' })
  await waitFor(() => expect(mocks.poll).toHaveBeenCalled())
  fireEvent.click(cancel)
  await screen.findByText('核算已取消，原对照继续保留。')
  expect(mocks.cancel).toHaveBeenCalledWith('job-1')
  expect(mocks.api.mock.calls.filter(([, options]) => options?.json?.action)).toHaveLength(0)
})
