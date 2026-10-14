// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { apiJson, apiJsonOrNull } from '../../lib/api-client'
import { copy } from '../../copy'
import { FIRST_SCHEDULE_INTENT_KEY } from '../../lib/first-schedule'
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
  window.localStorage.removeItem(FIRST_SCHEDULE_INTENT_KEY)
  vi.resetAllMocks()
  vi.restoreAllMocks()
})

it('continues from login and Skland import through saved configuration to the first generation', async () => {
  const user = userEvent.setup()
  const firstWorkspace = { ...workspace, latest_result: null, result_history: [] }
  const firstProfile: UserGameAccount = { ...profile, kind: 'free_preview', skland_binding: { uid: '12345678', nickname: '首次博士', channel_name: '官服',
    bound_at: profile.created_at, last_imported_at: profile.created_at, credential_status: 'available', credential_invalid_at: null, credential_invalid_reason: null } }
  const firstAuth = { ...auth, active_profile: firstProfile, profiles: [firstProfile], workspace: firstWorkspace }
  let signedIn = false
  let saveConfig!: (payload: AuthSuccessResponse) => void
  const configSave = new Promise<AuthSuccessResponse>((resolve) => { saveConfig = resolve })
  vi.mocked(apiJson).mockImplementation(async (url, options) => {
    if (url === '/api/auth/me') return signedIn ? { ...auth, profiles: [], active_profile: null, workspace: null } : { user: null }
    if (url === '/api/auth/login') { signedIn = true; return { ...auth, profiles: [], active_profile: null, workspace: null } }
    if (url.startsWith('/api/user/personal-use-declaration')) return { accepted: true }
    if (url.startsWith('/api/user/notifications')) return { notifications: [], unread_count: 0, next_cursor: null }
    if (url === '/api/user/skland/free-preview/credential/preview') return { status: 'confirm_required', confirmation_id: 'first-import',
      skland_preview: { uid: '12345678', nickname: '首次博士', channel_name: '官服', operator_count: SAMPLE_OPERATORS.length } }
    if (url === '/api/user/skland/free-preview/login/confirm') return firstAuth
    if (url === '/api/user/workspace' && options?.method === 'PATCH') return configSave
    if (url.startsWith('/api/user/status?')) return {}
    if (url.startsWith('/api/optimization/jobs?')) return { jobs: [], nextCursor: null }
    if (url === '/api/optimization/jobs' && options?.method === 'POST') return { job: queued }
    if (url === '/api/optimization/jobs/new-job') return new Promise(() => {})
    if (url === '/api/user/inventory') return { stacks: [], capacities: [], recent_events: [] }
    if (url === '/api/user/priority-coupon-balance') return { balances: [] }
    throw new Error(`Unexpected API request: ${url}`)
  })
  render(<MemoryRouter initialEntries={['/']}><MotionPreferenceProvider><V2Page /></MotionPreferenceProvider></MemoryRouter>)
  await user.click(await screen.findByRole('button', { name: copy.v2.generateMine }))
  fireEvent.change(screen.getByLabelText(copy.auth.components_AuthForm_011), { target: { value: 'doctor@example.test' } })
  fireEvent.change(screen.getByLabelText(copy.auth.components_AuthForm_012), { target: { value: 'password123' } })
  await user.click(document.querySelector('.v2-login-panel button[type="submit"]')!)
  await user.click(await screen.findByRole('button', { name: copy.v2.firstSchedule.importAction }))
  await user.click(await screen.findByRole('button', { name: copy.workspace.components_SklandBindingDialog_004 }))
  fireEvent.change(screen.getByPlaceholderText(copy.workspace.components_SklandBindingDialog_037), { target: { value: 'test-credential' } })
  await user.click(screen.getByRole('button', { name: copy.workspace.components_SklandBindingDialog_038 }))
  await user.click(await screen.findByRole('button', { name: copy.workspace.components_SklandBindingDialog_024 }))
  await user.click(await screen.findByRole('button', { name: copy.v2.firstSchedule.configAction }))
  const dialog = within(await screen.findByRole('dialog'))
  await user.click(dialog.getByRole('button', { name: copy.common.components_ConfigEditor_035 }))
  await user.click(dialog.getByRole('button', { name: copy.v2.firstSchedule.confirmConfig }))
  expect(screen.getByRole('button', { name: copy.v2.firstSchedule.confirming })).toBeDisabled()
  expect(vi.mocked(apiJson).mock.calls.some(([url, options]) => url === '/api/optimization/jobs' && options?.method === 'POST')).toBe(false)
  const patch = vi.mocked(apiJson).mock.calls.find(([url, options]) => url === '/api/user/workspace' && options?.method === 'PATCH')![1]!.json as { config: typeof SAMPLE_CONFIG }
  await act(async () => saveConfig({ ...firstAuth, workspace: { ...firstWorkspace, config: patch.config } }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByRole('complementary', { name: copy.v2.firstSchedule.title }).querySelector('[aria-current="step"]')).toHaveTextContent(copy.v2.firstSchedule.generate)
  await user.click(await screen.findByRole('button', { name: copy.optimize.pages_tool_optimize_GenerateControlBar_030 }))
  await waitFor(() => expect(apiJson).toHaveBeenCalledWith('/api/optimization/jobs', expect.objectContaining({ method: 'POST' })))
  expect(vi.mocked(apiJson).mock.calls.filter(([url, options]) => url === '/api/optimization/jobs' && options?.method === 'POST')).toHaveLength(1)
}, 15_000)

it.each([false, true])('loads the saved schedule on entry without a retry (StrictMode: %s)', async (strict) => {
  let restoreHistory!: (payload: { item: typeof previous & { config: typeof SAMPLE_CONFIG; result: typeof newResult } }) => void
  const historyResponse = new Promise<Parameters<typeof restoreHistory>[0]>((resolve) => { restoreHistory = resolve })
  vi.mocked(apiJson).mockImplementation(async (url) => {
    if (url === '/api/auth/me') return auth
    if (url.startsWith('/api/user/results/previous-result?')) return historyResponse
    if (url.startsWith('/api/optimization/jobs?')) return { jobs: [], nextCursor: null }
    if (url.startsWith('/api/user/status?')) return {}
    if (url === '/api/user/inventory') return { stacks: [], capacities: [], recent_events: [] }
    if (url === '/api/user/priority-coupon-balance') return { balances: [] }
    throw new Error(`Unexpected API request: ${url}`)
  })
  const page = <MemoryRouter initialEntries={['/']}><MotionPreferenceProvider><V2Page /></MotionPreferenceProvider></MemoryRouter>
  render(strict ? <StrictMode>{page}</StrictMode> : page)
  await waitFor(() => expect(apiJson).toHaveBeenCalledWith(
    '/api/user/results/previous-result?profile_id=profile-1', expect.anything(),
  ))
  expect(screen.getByText(copy.v2.loading)).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.queryByText(copy.v2.sampleSource)).not.toBeInTheDocument()

  await act(async () => restoreHistory({ item: { ...previous, config: SAMPLE_CONFIG, result: newResult } }))
  expect(await screen.findByText(copy.v2.ownSource)).toBeInTheDocument()
  expect(within(screen.getByRole('region', { name: copy.v2.lmd })).getByText('12,345')).toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(vi.mocked(apiJson).mock.calls.filter(([url]) => url.startsWith('/api/user/results/previous-result?'))).toHaveLength(1)
  expect(vi.mocked(apiJson).mock.calls.some(([_url, options]) => options?.method === 'POST')).toBe(false)
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

it.each(['generation', 'overview'])('shows a failed configuration save beside the %s action and retries without starting a task or losing input', async (section) => {
  const user = userEvent.setup()
  let failSave!: (error: Error) => void
  const firstSave = new Promise<never>((_resolve, reject) => { failSave = reject })
  let failRetry!: (error: Error) => void
  const failedRetry = new Promise<never>((_resolve, reject) => { failRetry = reject })
  let finishRetry!: (payload: AuthSuccessResponse) => void
  const successfulRetry = new Promise<AuthSuccessResponse>((resolve) => { finishRetry = resolve })
  const patches: Array<{ config: typeof SAMPLE_CONFIG }> = []
  vi.mocked(apiJson).mockImplementation(async (url, options) => {
    if (url === '/api/auth/me') return auth
    if (url.startsWith('/api/user/results/previous-result?')) return { item: { ...previous, config: SAMPLE_CONFIG, result: SAMPLE_RESULT } }
    if (url === '/api/user/workspace' && options?.method === 'PATCH') {
      patches.push(options.json as { config: typeof SAMPLE_CONFIG })
      return patches.length === 1 ? firstSave : patches.length === 2 ? failedRetry : successfulRetry
    }
    if (url.startsWith('/api/optimization/jobs?')) return { jobs: [], nextCursor: null }
    if (url === '/api/optimization/jobs' && options?.method === 'POST') return { job: queued }
    if (url === '/api/optimization/jobs/new-job') return new Promise(() => {})
    if (url.startsWith('/api/user/status?')) return {}
    if (url === '/api/user/inventory') return { stacks: [], capacities: [], recent_events: [] }
    if (url === '/api/user/priority-coupon-balance') return { balances: [] }
    throw new Error(`Unexpected API request: ${url}`)
  })
  const submissions = () => vi.mocked(apiJson).mock.calls.filter(([url, options]) => url === '/api/optimization/jobs' && options?.method === 'POST')
  render(<MemoryRouter initialEntries={[`/v2?section=${section}`]}><MotionPreferenceProvider><V2Page /></MotionPreferenceProvider></MemoryRouter>)
  await screen.findByText(copy.v2.ownSource)
  await user.click(screen.getByRole('button', { name: copy.v2.facilities }))
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: copy.common.components_ConfigEditor_030 }))
  await user.click(screen.getByRole('button', { name: copy.v2.done }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await waitFor(() => expect(patches).toHaveLength(1))
  const generateLabel = section === 'generation' ? copy.optimize.pages_tool_optimize_GenerateControlBar_029 : copy.v2.regenerate
  await user.click(screen.getByRole('button', { name: generateLabel }))
  expect(submissions()).toHaveLength(0)
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  await act(async () => failSave(new Error('Configuration save unavailable')))
  const alert = await screen.findByRole('alert')
  expect(alert).toBeVisible()
  expect(alert).toHaveTextContent(copy.optimize.generation.save_failed)
  const actionArea = section === 'generation' ? document.querySelector('.v2-generation-execution')!
    : screen.getByRole('button', { name: generateLabel }).closest('.v2-ready-banner')!.parentElement!
  expect(actionArea).toContainElement(alert)
  expect(patches[0]!.config.layout).toBe('2-4-3')
  expect(submissions()).toHaveLength(0)

  await user.click(within(alert).getByRole('button', { name: copy.optimize.generation.retry_save }))
  await waitFor(() => expect(patches).toHaveLength(2))
  expect(within(alert).getByRole('button', { name: copy.optimize.generation.saving })).toBeDisabled()
  expect(alert).toHaveTextContent(copy.optimize.generation.save_failed)
  expect(submissions()).toHaveLength(0)
  await act(async () => failRetry(new Error('Configuration save still unavailable')))
  errors.mockRestore()
  await user.click(within(alert).getByRole('button', { name: copy.optimize.generation.retry_save }))
  await waitFor(() => expect(patches).toHaveLength(3))
  expect(patches.map((patch) => patch.config)).toEqual([patches[0]!.config, patches[0]!.config, patches[0]!.config])
  await act(async () => finishRetry({ ...auth, workspace: { ...workspace, config: patches[0]!.config } }))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  expect(submissions()).toHaveLength(0)
  await user.click(screen.getByRole('button', { name: generateLabel }))
  await waitFor(() => expect(submissions()).toHaveLength(1))
  expect(submissions()[0]![1]!.json).toEqual(expect.objectContaining({ config: patches[0]!.config }))
}, 15_000)

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
    fireEvent.click(screen.getByRole('button', { name: copy.v2.regenerate }))
  }
  await waitFor(() => expect(apiJson).toHaveBeenCalledWith('/api/optimization/jobs/new-job', expect.anything()))
  expect(within(screen.getByRole('region', { name: copy.v2.lmd })).getByText('53,595')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: copy.v2.facilities }))
  const configDialog = await screen.findByRole('dialog')
  expect(within(configDialog).getByRole('group', { name: copy.common.components_ConfigEditor_021 })).toBeDisabled()
  fireEvent.click(within(configDialog).getByRole('button', { name: copy.v2.done }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await act(async () => completeJob({
    ...queued, status: 'succeeded', result: newResult, historyResultId: latest.id,
    executionPhase: 'terminal', calculationStage: 'completed', canCancel: false,
    estimate: { ...queued.estimate, phase: 'completed', remainingMs: 0 },
  }))
  await waitFor(() => expect(within(screen.getByRole('region', { name: copy.v2.lmd })).getByText('12,345')).toBeInTheDocument())
  expect(screen.queryByText(copy.common.components_ScheduleProgress_060)).not.toBeInTheDocument()
  await act(async () => refreshWorkspace({ ...auth, workspace: { ...workspace, latest_result: latest, result_history: [latest, previous] } }))
  await within(screen.getByRole('region', { name: copy.v2.lmd })).findByText('比上次 -41,249.99 龙门币 / 天')
  expect(screen.getByRole('region', { name: copy.v2.exp })).toHaveTextContent('比上次 -42,426.6 经验 / 天')
  await waitFor(() => expect(screen.getByRole('button', { name: copy.v2.regenerate })).not.toBeDisabled())
  fireEvent.click(screen.getByRole('button', { name: copy.v2.facilities }))
  const unlockedDialog = await screen.findByRole('dialog')
  expect(within(unlockedDialog).getByRole('group', { name: copy.common.components_ConfigEditor_021 })).toBeEnabled()
  fireEvent.click(within(unlockedDialog).getByRole('button', { name: copy.v2.done }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(vi.mocked(apiJson).mock.calls.filter(([url, options]) => url === '/api/optimization/jobs' && options?.method === 'POST'))
    .toHaveLength(mode === 'submitted' ? 1 : 0)
  expect(vi.mocked(apiJson).mock.calls.some(([url]) => url.startsWith('/api/user/results/new-result?'))).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: copy.v2.history }))
  const previousCard = (await screen.findByText('Previous schedule')).closest('.v2-record')!
  fireEvent.click(within(previousCard as HTMLElement).getByRole('button', { name: copy.optimize.pages_tool_optimize_PlansSection_030 }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await waitFor(() => expect(within(screen.getByRole('region', { name: copy.v2.lmd })).getByText('53,595')).toBeInTheDocument())
  expect(vi.mocked(apiJson).mock.calls.some(([url]) => url.startsWith('/api/user/results/new-result?'))).toBe(false)
})
