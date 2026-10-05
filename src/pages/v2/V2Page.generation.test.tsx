// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { apiJson, apiJsonOrNull } from '../../lib/api-client'
import { copy } from '../../copy'
import { MotionPreferenceProvider } from '../../lib/motion-preference'
import type { OptimizationJobSnapshot } from '../../lib/optimization-contracts'
import type { AuthSuccessResponse, OptimizeJobAccepted, UserGameAccount, UserWorkspace, WorkspaceResultHistorySummary } from '../../lib/types'
import { createAccountLicense } from '../tool/tool-utils'
import { buildOptimizeJobStorageKey, writeActiveOptimizeJob } from '../tool/optimize/job-progress'
import { buildOptimizeSignature } from '../tool/optimize/workflow-utils'
import { SAMPLE_CONFIG, SAMPLE_OPERATORS, SAMPLE_RESULT } from './sample-result'
import V2Page from './V2Page'

vi.mock('../../lib/api-client', async (original) => ({
  ...await original<typeof import('../../lib/api-client')>(),
  apiJson: vi.fn(),
  apiJsonOrNull: vi.fn(),
}))

const profile: UserGameAccount = {
  id: 'profile-1', user_id: 'user-1', kind: 'cdk', permission: 'ultimate', status: 'active',
  cdk_order_hash: 'order', display_name: 'Doctor', note: '', operator_count: SAMPLE_OPERATORS.length,
  updated_at: null, created_at: '2026-10-04T00:00:00Z',
}
const previous: WorkspaceResultHistorySummary = {
  id: 'previous-result', name: 'Previous schedule', created_at: profile.created_at,
  operator_count: SAMPLE_OPERATORS.length, source: 'generated', archived: false,
  schedule_mode: 'maa', maa_exportable: true, has_config: true,
}
const latest = { ...previous, id: 'new-result', job_id: 'new-job', name: 'New schedule' }
const workspace: UserWorkspace = {
  profile_id: profile.id, operators: SAMPLE_OPERATORS, config: SAMPLE_CONFIG, elite_overrides: {},
  latest_result: previous, result_history: [previous], archived_results: [], saved_configs: [],
  result_history_next_cursor: null, archived_results_next_cursor: null,
  free_schedule_entitlement: null, updated_at: profile.created_at,
}
const auth: AuthSuccessResponse = {
  user: { id: profile.user_id, email: 'doctor@example.test', permission: profile.permission,
    status: 'active', cdk_status: 'active', cdk_order_hash: 'order', created_at: profile.created_at },
  profiles: [profile], active_profile: profile, workspace,
}
const accepted: OptimizeJobAccepted = {
  job_id: 'new-job', status: 'queued', priority: 'standard', priority_label: '', queue_position: 1,
  submitted_at: profile.created_at, poll_after_ms: 500, estimated_duration_ms: 1000,
  estimate_bucket: 'maa_plain', estimate_source: 'fallback_p95', estimate_sample_count: 0,
  estimated_remaining_ms: 1000, estimated_total_ms: 1000, estimate_phase: 'queued',
  estimate_updated_at: profile.created_at, calculation_stage: null, calculation_stage_updated_at: null,
  upgrade_suggestions_requested: false, upgrade_suggestions_allowed: false,
}
const queued: OptimizationJobSnapshot = {
  id: accepted.job_id, status: 'queued', kind: 'schedule', source: 'generated',
  priority: { kind: 'standard', label: '' }, queuePosition: 1, pollAfterMs: 500,
  timestamps: { submittedAt: profile.created_at }, executionPhase: 'initial_queue', calculationStage: null,
  estimate: { durationMs: 1000, bucket: 'maa_plain', source: 'fallback_p95', sampleCount: 0,
    remainingMs: 1000, totalMs: 1000, phase: 'queued', updatedAt: profile.created_at },
  upgradeSuggestions: { requested: false, allowed: false }, attemptCount: 0, failureCount: 0,
  cancellationRequested: false, canCancel: true, canRetry: false,
}
const newResult = { ...SAMPLE_RESULT, daily_production: { trading: { LMD: 12345 } } }

beforeEach(() => {
  window.localStorage.setItem('maatool-reduce-motion', 'true')
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  vi.mocked(apiJsonOrNull).mockResolvedValue(null)
})

afterEach(() => {
  cleanup()
  window.sessionStorage.clear()
  window.localStorage.removeItem('maatool-reduce-motion')
  vi.resetAllMocks()
})

it('waits for login and saved-result detail, then retries a failed read without showing example data', async () => {
  let restoreAuth!: (payload: AuthSuccessResponse) => void
  const authResponse = new Promise<AuthSuccessResponse>((resolve) => { restoreAuth = resolve })
  let failHistory!: (error: Error) => void
  const firstHistory = new Promise<never>((_resolve, reject) => { failHistory = reject })
  let restoreHistory!: (payload: { item: typeof previous & { config: typeof SAMPLE_CONFIG; result: typeof newResult } }) => void
  const secondHistory = new Promise<Parameters<typeof restoreHistory>[0]>((resolve) => { restoreHistory = resolve })
  let historyReads = 0
  vi.mocked(apiJson).mockImplementation(async (url) => {
    if (url === '/api/auth/me') return authResponse
    if (url.startsWith('/api/user/results/previous-result?')) return ++historyReads === 1 ? firstHistory : secondHistory
    if (url.startsWith('/api/optimization/jobs?')) return { jobs: [], nextCursor: null }
    if (url.startsWith('/api/user/status?')) return {}
    if (url === '/api/user/inventory') return { stacks: [], capacities: [], recent_events: [] }
    if (url === '/api/user/priority-coupon-balance') return { balances: [] }
    throw new Error(`Unexpected API request: ${url}`)
  })
  render(<MemoryRouter initialEntries={['/v2']}><MotionPreferenceProvider><V2Page /></MotionPreferenceProvider></MemoryRouter>)
  expect(screen.getByRole('status')).toHaveTextContent(copy.v2.loading)
  expect(screen.queryByText(copy.v2.sampleSource)).not.toBeInTheDocument()

  await act(async () => restoreAuth(auth))
  await waitFor(() => expect(historyReads).toBe(1))
  expect(screen.getByText(copy.v2.loading)).toBeInTheDocument()
  expect(screen.queryByText(copy.v2.sampleSource)).not.toBeInTheDocument()
  expect(screen.queryByRole('region', { name: copy.v2.lmd })).not.toBeInTheDocument()

  await act(async () => failHistory(new Error('Cannot read saved schedule')))
  expect(await screen.findByRole('alert')).toHaveTextContent('Cannot read saved schedule')
  expect(screen.queryByText(copy.v2.sampleSource)).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: copy.v2.retry }))
  expect(screen.getByText(copy.v2.loading)).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()

  await act(async () => restoreHistory({ item: { ...previous, config: SAMPLE_CONFIG, result: newResult } }))
  expect(await screen.findByText(copy.v2.ownSource)).toBeInTheDocument()
  expect(within(screen.getByRole('region', { name: copy.v2.lmd })).getByText('12,345')).toBeInTheDocument()
  expect(screen.queryByText(copy.v2.loading)).not.toBeInTheDocument()
  expect(screen.queryByText(copy.v2.sampleSource)).not.toBeInTheDocument()
  expect(historyReads).toBe(2)
  expect(vi.mocked(apiJson).mock.calls.some(([_url, options]) => options?.method === 'POST')).toBe(false)
})

it.each(['submitted', 'restored'])('automatically displays a %s job result and dismisses completed progress', async (mode) => {
  let completeJob!: (job: OptimizationJobSnapshot) => void
  const completion = new Promise<OptimizationJobSnapshot>((resolve) => { completeJob = resolve })
  let refreshWorkspace!: (payload: AuthSuccessResponse) => void
  const workspaceRefresh = new Promise<AuthSuccessResponse>((resolve) => { refreshWorkspace = resolve })
  vi.mocked(apiJson).mockImplementation(async (url, options) => {
    if (url === '/api/auth/me') return auth
    if (url === '/api/optimization/jobs' && options?.method === 'POST') return { job: queued }
    if (url === '/api/optimization/jobs/new-job') return completion
    if (url.startsWith('/api/optimization/jobs?')) return { jobs: [], nextCursor: null }
    if (url.startsWith('/api/user/workspace?')) return workspaceRefresh
    if (url.startsWith('/api/user/results/previous-result?')) return { item: { ...previous, config: SAMPLE_CONFIG, result: SAMPLE_RESULT } }
    if (url.startsWith('/api/user/results/new-result?')) return { item: { ...latest, config: SAMPLE_CONFIG, result: newResult } }
    if (url.startsWith('/api/user/status?')) return {}
    if (url === '/api/user/inventory') return { stacks: [], capacities: [], recent_events: [] }
    if (url === '/api/user/priority-coupon-balance') return { balances: [] }
    throw new Error(`Unexpected API request: ${url}`)
  })
  if (mode === 'restored') {
    const license = createAccountLicense(profile, SAMPLE_OPERATORS, SAMPLE_CONFIG)
    writeActiveOptimizeJob(buildOptimizeJobStorageKey(profile.id, license.order_hash,
      buildOptimizeSignature(SAMPLE_OPERATORS, SAMPLE_CONFIG), 'generate'), accepted)
  }
  render(<MemoryRouter initialEntries={['/v2']}><MotionPreferenceProvider><V2Page /></MotionPreferenceProvider></MemoryRouter>)
  await screen.findByText(copy.v2.ownSource)
  if (mode === 'submitted') {
    await waitFor(() => expect(screen.getByRole('button', { name: copy.v2.regenerate })).not.toBeDisabled())
    await userEvent.click(screen.getByRole('button', { name: copy.v2.regenerate }))
  }
  await waitFor(() => expect(apiJson).toHaveBeenCalledWith('/api/optimization/jobs/new-job', expect.anything()))
  expect(within(screen.getByRole('region', { name: copy.v2.lmd })).getByText('54,720')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: copy.v2.facilities }))
  const configDialog = await screen.findByRole('dialog')
  expect(within(configDialog).getByText(copy.common.configGenerationReadOnly)).toBeInTheDocument()
  const editor = within(configDialog).getByRole('group', { name: copy.common.components_ConfigEditor_021 })
  for (const control of editor.querySelectorAll('button, input, select, textarea')) expect(control).toBeDisabled()
  await userEvent.click(within(configDialog).getByRole('button', { name: copy.v2.done }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await act(async () => completeJob({
    ...queued, status: 'succeeded', result: newResult, historyResultId: latest.id,
    executionPhase: 'terminal', calculationStage: 'completed', canCancel: false,
    estimate: { ...queued.estimate, phase: 'completed', remainingMs: 0 },
  }))
  await waitFor(() => expect(within(screen.getByRole('region', { name: copy.v2.lmd })).getByText('12,345')).toBeInTheDocument())
  expect(screen.queryByText(copy.common.components_ScheduleProgress_060)).not.toBeInTheDocument()
  await act(async () => refreshWorkspace({ ...auth, workspace: { ...workspace, latest_result: latest, result_history: [latest, previous] } }))
  await waitFor(() => expect(screen.getByRole('button', { name: copy.v2.regenerate })).not.toBeDisabled())
  await userEvent.click(screen.getByRole('button', { name: copy.v2.facilities }))
  const unlockedDialog = await screen.findByRole('dialog')
  expect(within(unlockedDialog).queryByText(copy.common.configGenerationReadOnly)).not.toBeInTheDocument()
  expect(within(unlockedDialog).getByRole('button', { name: copy.common.components_ConfigEditor_007 })).toBeEnabled()
  await userEvent.click(within(unlockedDialog).getByRole('button', { name: copy.v2.done }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(vi.mocked(apiJson).mock.calls.filter(([url, options]) => url === '/api/optimization/jobs' && options?.method === 'POST'))
    .toHaveLength(mode === 'submitted' ? 1 : 0)
  expect(vi.mocked(apiJson).mock.calls.some(([url]) => url.startsWith('/api/user/results/new-result?'))).toBe(false)
  await userEvent.click(screen.getByRole('button', { name: copy.v2.history }))
  const previousCard = (await screen.findByText('Previous schedule')).closest('.tool-inset')!
  await userEvent.click(within(previousCard as HTMLElement).getByRole('button', { name: copy.optimize.pages_tool_optimize_PlansSection_030 }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await waitFor(() => expect(within(screen.getByRole('region', { name: copy.v2.lmd })).getByText('54,720')).toBeInTheDocument())
  expect(vi.mocked(apiJson).mock.calls.some(([url]) => url.startsWith('/api/user/results/new-result?'))).toBe(false)
})
