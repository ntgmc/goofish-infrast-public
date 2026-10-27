// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '../../../test/query-render'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { CONFIG_PRESETS, normalizeConfig } from '../../../lib/config'
import type { AuthSuccessResponse, OptimizeJobAccepted, UserGameAccount, UserWorkspace, WorkspaceResultHistoryItem, WorkspaceResultHistorySummary } from '../../../lib/types'
import { copy } from '../../../copy'
import { tourStorageKey } from '../../../components/GuidedTour'
import { SCHEDULE_PROGRESS_COMPLETION_DURATION_MS } from '../../../components/ScheduleProgress'
import { useToolSession } from '../useToolSession'
import { createAccountLicense } from '../tool-utils'
import Comparison from '../../v2/pages/Comparison'
import type { V2Workflow } from '../../v2/WorkspaceSections'
import { SAMPLE_RESULT } from '../../v2/sample-result'
import OptimizeWorkflowPage from './OptimizeWorkflowPage'
import { useOptimizeWorkflow, type Props } from './useOptimizeWorkflow'
import { buildOptimizeJobStorageKey, writeActiveOptimizeJob } from './job-progress'
import { buildOptimizeSignature } from './workflow-utils'

const config = normalizeConfig(CONFIG_PRESETS['243'])
const operators = [{ id: 'char_002_amiya', name: '阿米娅', own: true, elite: 2, rarity: 4, level: 80 }]
const profile: UserGameAccount = { id: 'race-profile', user_id: 'user', kind: 'cdk', permission: 'advanced', status: 'active',
  cdk_order_hash: 'order', display_name: 'Doctor', note: '', operator_count: 1, updated_at: null, created_at: '2026-10-01T00:00:00Z' }
const workspace = { profile_id: profile.id, operators, config, elite_overrides: {}, saved_configs: [], result_history: [], archived_results: [],
  result_history_next_cursor: null, archived_results_next_cursor: null, latest_result: null, free_schedule_entitlement: null, updated_at: null } as UserWorkspace
const payload = (stored = config): AuthSuccessResponse => ({ user: { id: profile.user_id }, profiles: [profile], active_profile: profile,
  workspace: { ...workspace, config: stored }, announcement_unread_count: 0 } as AuthSuccessResponse)
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }
function propsFor(selected = profile): Props {
  return { profileId: selected.id, profile: selected, license: createAccountLicense(selected, operators, config), workspace, setLicense: vi.fn(),
    eliteOverrides: {}, configOverride: null, setConfigOverride: vi.fn(), configSyncStatus: 'idle', flushConfigSave: vi.fn(async () => true),
    retryConfigSave: vi.fn(), onWorkspacePatch: vi.fn(), onWorkspaceUpdated: vi.fn(), section: 'plans', onSectionChange: vi.fn(),
    onReset: vi.fn(), onLogout: vi.fn(), announcement: null, redeemedNotice: null, onProfileUpgraded: vi.fn() }
}
function detail(id: string): WorkspaceResultHistoryItem & WorkspaceResultHistorySummary {
  return { id, name: id, created_at: '2026-10-01T00:00:00Z', operator_count: 1, source: 'generated', archived: false,
    schedule_mode: 'maa', maa_exportable: true, has_config: true, config: { ...config, desc: id }, result: SAMPLE_RESULT }
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); localStorage.clear(); sessionStorage.clear() })

it.each(['late', 'ordered', 'view', 'leave'])('keeps the latest history choice and auto-saved configuration (%s)', async (mode) => {
  const older = deferred<Response>(), newer = deferred<Response>()
  const patches: Array<{ config: { desc: string } }> = []
  vi.stubGlobal('fetch', vi.fn(async (input, init) => {
    const path = String(input)
    if (path.startsWith('/api/auth/me')) return json(payload())
    if (path.startsWith('/api/user/results/older')) return older.promise
    if (path.startsWith('/api/user/results/newer')) return newer.promise
    if (init?.method === 'PATCH') { const patch = JSON.parse(String(init.body)); patches.push(patch); return json(payload(patch.config)) }
    return json({ stacks: [], capacities: [], balances: [] })
  }))
  const props = propsFor()
  const { result, rerender } = renderHook(({ id }) => {
    const session = useToolSession(profile.id, false, false)
    const workflow = useOptimizeWorkflow({ ...props, profileId: id, license: session.license ?? props.license, workspace: session.workspace,
      configOverride: session.configOverride, setConfigOverride: session.setConfigOverride, onWorkspacePatch: session.persistWorkspacePatch })
    return { session, workflow }
  }, { initialProps: { id: profile.id } })
  await waitFor(() => expect(result.current.session.authStatus).toBe('authenticated'))
  vi.useFakeTimers()
  let first!: Promise<void>, second!: Promise<void>
  act(() => { first = result.current.workflow.handleUseHistoryConfig(detail('older')) })
  if (mode === 'ordered') await act(async () => { older.resolve(json({ item: detail('older') })); await first })
  if (mode === 'leave') rerender({ id: 'other-profile' })
  else {
    act(() => { second = mode === 'view' ? result.current.workflow.handleViewHistory(detail('newer')) : result.current.workflow.handleUseHistoryConfig(detail('newer')) })
    await act(async () => { newer.resolve(json({ item: detail('newer') })); await second })
  }
  if (mode !== 'ordered') await act(async () => { older.resolve(json({ item: detail('older') })); await first })
  await act(async () => { await vi.advanceTimersByTimeAsync(700) })
  if (mode === 'leave') {
    expect(result.current.session.configOverride).toBeNull()
    expect(result.current.workflow.historyItem).toBeNull()
    expect(patches).toEqual([])
  } else {
    expect(result.current.workflow.historyItem?.id).toBe('newer')
    expect(patches.map((patch) => patch.config.desc)).toEqual(mode === 'view' ? [] : ['newer'])
    expect(result.current.workflow.activeConfig.desc).toBe(mode === 'view' ? config.desc : 'newer')
  }
})

it.each(['V1', 'V2'])('requires explicit coupon selection in %s and preserves included entitlements', async (version) => {
  for (const permission of ['recommended', 'advanced'] as const) {
    const requests: Array<{ use_items?: string[] }> = []
    localStorage.setItem(tourStorageKey('optimize-overview', 2), 'done')
    localStorage.setItem(tourStorageKey('optimize-tab-lab', 1), 'done')
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      if (String(input) === '/api/optimization/jobs' && init?.method === 'POST') {
        requests.push(JSON.parse(String(init.body)))
        return json({ error: { message: 'fixture submission failed', code: 'fixture' } }, 503)
      }
      return json({ stacks: [{ item: { code: 'scenario_simulation_coupon' }, quantity: 1 }], capacities: [], balances: [], jobs: [] })
    }))
    const props = { ...propsFor({ ...profile, permission }), section: 'lab' as const }
    const hook = renderHook(() => useOptimizeWorkflow(props))
    await waitFor(() => expect(hook.result.current.inventoryLoaded).toBe(true))
    expect(hook.result.current.scenarioCouponRequired).toBe(permission === 'recommended')
    const page = render(<MemoryRouter>{version === 'V1' ? <OptimizeWorkflowPage {...props} /> : <Comparison workflow={hook.result.current as V2Workflow} onConfig={() => {}} />}</MemoryRouter>)
    const run = await screen.findByRole('button', { name: version === 'V2' ? copy.v2.comparison.run : new RegExp(copy.optimize.pages_tool_optimize_ScenarioLabSection_011) })
    if (permission === 'recommended') {
      expect(run).toBeDisabled()
      const coupon = screen.getByRole('checkbox', { name: new RegExp(copy.inventory.scenario_coupon) })
      fireEvent.click(coupon)
      expect(run).toBeEnabled()
      fireEvent.click(coupon)
      expect(run).toBeDisabled()
      expect(requests).toHaveLength(0)
      fireEvent.click(coupon)
    } else expect(screen.queryByRole('checkbox', { name: new RegExp(copy.inventory.scenario_coupon) })).toBeNull()
    fireEvent.click(run)
    await waitFor(() => expect(requests).toHaveLength(1))
    expect(requests[0]!.use_items).toEqual(permission === 'recommended' ? ['scenario_simulation_coupon'] : undefined)
    page.unmount(); hook.unmount(); sessionStorage.clear()
  }
})

const accepted: OptimizeJobAccepted = { job_id: 'race-job', status: 'queued', priority: 'paid', priority_label: 'paid', queue_position: 1,
  submitted_at: '2026-10-01T00:00:00Z', poll_after_ms: 500, estimated_duration_ms: 1000, estimate_bucket: 'maa_plain', estimate_source: 'fallback_p95',
  estimate_sample_count: 0, estimated_remaining_ms: 1000, estimated_total_ms: 1000, estimate_phase: 'queued', estimate_updated_at: '2026-10-01T00:00:00Z',
  calculation_stage: null, calculation_stage_updated_at: null, upgrade_suggestions_requested: false, upgrade_suggestions_allowed: false }

it.each(['handleGenerate', 'handleIncrementalRecompute'] as const)('waits for configuration save and preserves the draft when %s cannot start', async (action) => {
  const save = deferred<boolean>()
  const props = propsFor()
  props.configOverride = { ...config, desc: 'Unsaved draft' }
  props.workspace = { ...workspace, latest_result: detail('previous') }
  props.configSyncStatus = 'saving'
  props.flushConfigSave = vi.fn(() => save.promise)
  const submit = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json({ stacks: [], capacities: [], balances: [] }))
  vi.stubGlobal('fetch', submit)
  const hook = renderHook((current) => useOptimizeWorkflow(current), { initialProps: props })
  await waitFor(() => expect(hook.result.current.licenseSyncing).toBe(false))
  let generation!: Promise<void>
  act(() => {
    generation = hook.result.current[action]()
    void hook.result.current[action]()
  })
  await waitFor(() => expect(props.flushConfigSave).toHaveBeenCalledOnce())
  expect(hook.result.current.loading).toBe(true)
  expect(hook.result.current.progress).toBeNull()
  expect(submit.mock.calls.some(([url, options]) => url === '/api/optimization/jobs' && options?.method === 'POST')).toBe(false)
  await act(async () => { save.resolve(false); await generation })
  hook.rerender({ ...props, configSyncStatus: 'failed' })
  expect(hook.result.current.inlineError).toEqual({ scope: 'generate', message: copy.optimize.generation.save_failed, retry: 'save' })
  expect(hook.result.current.loading).toBe(false)
  expect(hook.result.current.progress).toBeNull()
  expect(hook.result.current.activeConfig.desc).toBe('Unsaved draft')
  expect(props.setConfigOverride).not.toHaveBeenCalled()
  expect(submit.mock.calls.some(([url, options]) => url === '/api/optimization/jobs' && options?.method === 'POST')).toBe(false)
  hook.rerender({ ...props, configSyncStatus: 'idle' })
  expect(hook.result.current.inlineError).toBeNull()
})

it('does not submit a task when the profile changes while its configuration is saving', async () => {
  const save = deferred<boolean>()
  const props: Props = { ...propsFor(), flushConfigSave: vi.fn(() => save.promise) }
  const requests: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input) => { requests.push(String(input)); return json({ stacks: [], capacities: [], balances: [] }) }))
  const hook = renderHook((current) => useOptimizeWorkflow(current), { initialProps: props })
  await waitFor(() => expect(hook.result.current.licenseSyncing).toBe(false))
  let generation!: Promise<void>
  act(() => { generation = hook.result.current.handleGenerate() })
  await waitFor(() => expect(props.flushConfigSave).toHaveBeenCalledOnce())
  hook.rerender(propsFor({ ...profile, id: 'other-profile' }))
  await act(async () => { save.resolve(true); await generation })
  expect(requests).not.toContain('/api/optimization/jobs')
  expect(hook.result.current.loading).toBe(false)
  expect(hook.result.current.inlineError).toBeNull()
})

it.each(['restore', 'generate'])('stops %s callbacks if the workflow leaves during completion or workspace refresh', async (source) => {
  for (const leave of ['unmount', 'profile', 'refresh', 'none']) {
    vi.useFakeTimers()
    const props = propsFor()
    if (source === 'restore') writeActiveOptimizeJob(buildOptimizeJobStorageKey(profile.id, props.license.order_hash, buildOptimizeSignature(operators, config), 'generate'), accepted)
    const refresh = deferred<Response>()
    const reads: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input, init) => {
      const path = String(input); reads.push(path)
      if (path.startsWith('/api/user/workspace')) return refresh.promise
      const job = { id: accepted.job_id, kind: 'schedule', status: init?.method === 'POST' ? 'queued' : 'succeeded', priority: { kind: 'paid', label: 'paid' },
        timestamps: { submittedAt: accepted.submitted_at }, pollAfterMs: 500, estimate: { phase: init?.method === 'POST' ? 'queued' : 'completed' },
        upgradeSuggestions: { requested: false, allowed: false }, result: init?.method === 'POST' ? null : SAMPLE_RESULT }
      if (path === '/api/optimization/jobs') return json({ job })
      if (path === '/api/optimization/jobs/race-job') return json(job)
      return json({ stacks: [], capacities: [], balances: [] })
    }))
    const hook = renderHook((current) => useOptimizeWorkflow(current), { initialProps: props })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    if (source === 'generate') act(() => { void hook.result.current.handleGenerate() })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(hook.result.current.progress?.estimatePhase).toBe('completed')
    expect(props.onSectionChange).not.toHaveBeenCalled()
    if (leave === 'unmount') hook.unmount()
    if (leave === 'profile') hook.rerender(propsFor({ ...profile, id: 'other' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(SCHEDULE_PROGRESS_COMPLETION_DURATION_MS + 500) })
    if (leave === 'refresh') hook.unmount()
    await act(async () => { refresh.resolve(json(payload())); await vi.advanceTimersByTimeAsync(0) })
    expect(props.onSectionChange).toHaveBeenCalledTimes(leave === 'none' || leave === 'refresh' ? 1 : 0)
    expect(props.onWorkspaceUpdated).toHaveBeenCalledTimes(leave === 'none' ? 1 : 0)
    expect(reads.filter((path) => path.startsWith('/api/user/workspace'))).toHaveLength(leave === 'none' || leave === 'refresh' ? 1 : 0)
    hook.unmount(); sessionStorage.clear(); vi.useRealTimers()
  }
})
