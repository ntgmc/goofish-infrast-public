// @vitest-environment jsdom
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copy } from '../../copy'
import { MotionPreferenceProvider } from '../../lib/motion-preference'
import { CONFIG_PRESETS, normalizeConfig, validateScheduleConfig } from '../../lib/config'
import { DEFAULT_SITE_FEATURES } from '../../lib/site-features'
import { cloneDefaultPublicContentSettings } from '../../lib/public-content'
import { PublicContentProvider } from '../../lib/public-content-context'
import type { OptimizeResult, UserGameAccount, WorkspaceResultHistorySummary } from '../../lib/types'
import type { V2Session } from './OptionsDrawer'
import { SAMPLE_CONFIG, SAMPLE_OPERATORS, SAMPLE_RESULT } from './sample-result'
import { SANITY_PER_LMD, SANITY_PER_PURE_GOLD } from '../../lib/orundum-economy'
import { ApiError } from '../../lib/api-client'
import { FIRST_SCHEDULE_INTENT_KEY } from '../../lib/first-schedule'
import type { ResultExportFailure } from '../tool/optimize/useResultDownloads'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  workflow: vi.fn(),
  features: vi.fn(),
  tasks: vi.fn(),
  manual: vi.fn(),
  image: vi.fn(),
}))
vi.mock('../../components/result-panel/ManualScheduleEditor', () => ({ default: mocks.manual }))
vi.mock('../../components/result-panel/schedule-image', () => ({ downloadScheduleImage: mocks.image }))
vi.mock('../tool/useToolSession', () => ({ useToolSession: mocks.session }))
vi.mock('../tool/optimize/useOptimizeWorkflow', () => ({ useOptimizeWorkflow: mocks.workflow }))
vi.mock('../tool/optimize/useOptimizationTaskCenter', () => ({ useOptimizationTaskCenter: mocks.tasks }))
vi.mock('../../lib/site-feature-context', async (original) => ({
  ...await original<typeof import('../../lib/site-feature-context')>(),
  useSiteFeatures: mocks.features,
}))

import V2Page from './V2Page'

let session: V2Session
const summary: WorkspaceResultHistorySummary = {
  id: 'saved-result', name: 'My personal schedule', created_at: '2026-10-01T10:00:00Z',
  operator_count: SAMPLE_OPERATORS.length, source: 'generated', archived: false, schedule_mode: 'maa', maa_exportable: true, has_config: true,
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  mocks.features.mockReturnValue({ status: 'ready', features: DEFAULT_SITE_FEATURES, retry: vi.fn() })
  mocks.tasks.mockReturnValue({ jobs: [], cancel: vi.fn(), busyJobId: null, error: null, notice: null })
  mocks.image.mockReset().mockResolvedValue(undefined)
  session = {
    user: null, profiles: [], announcementUnreadCount: 0, popups: [], setAnnouncementUnreadCount: vi.fn(), activeProfile: null, license: null, workspace: null, configOverride: null,
    authStatus: 'anonymous', cdkProfiles: [], openingProfileId: null, workspaceLoadError: null,
    configSyncStatus: 'idle', eliteOverrides: {}, banner: null,
    retryAuth: vi.fn(), setLicense: vi.fn(), applyAuthPayload: vi.fn(),
    setConfigOverride: vi.fn(), flushConfigSave: vi.fn(async () => true), retryConfigSave: vi.fn(),
    persistWorkspacePatch: vi.fn(async () => undefined), applyWorkspaceSnapshot: vi.fn(),
    handleLogout: vi.fn(), refreshProfileWorkspace: vi.fn().mockResolvedValue(true),
  } as unknown as V2Session
  mocks.session.mockImplementation(() => session)
})

afterEach(() => {
  cleanup()
  window.localStorage.removeItem('maatool-reduce-motion')
  window.localStorage.removeItem(FIRST_SCHEDULE_INTENT_KEY)
  window.sessionStorage.clear()
  vi.restoreAllMocks()
})

function RouteLocation() {
  const location = useLocation()
  return <span data-testid="route-location" data-pathname={location.pathname}>{location.search}</span>
}

function mount(path = '/v2') {
  window.localStorage.setItem('maatool-reduce-motion', 'true')
  return render(<MemoryRouter initialEntries={[path]}><V2Page /><RouteLocation /></MemoryRouter>, { wrapper: MotionPreferenceProvider })
}

it.each(['/#release-v2.0.1016', '/v2#release-v2.0.1016'])('opens the changelog from a version anchor at %s', async (path) => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
    releases: [{ id: 'v2.0.1016', version: '2.0.1016', displayVersion: 'v2.0.1016', releasedAt: '2026-10-11', kind: 'release', sections: [] }],
    page: 1, pageSize: 10, total: 1,
  }), { headers: { 'Content-Type': 'application/json' } }))
  mount(path)
  await screen.findByRole('heading', { name: 'v2.0.1016' }, { timeout: 3000 })
  expect(screen.getByRole('region', { name: copy.v2.updates })).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: /v2.0.1016/ }))
  expect(screen.getByTestId('route-location')).toHaveTextContent('?section=updates&page=1')
  expect(screen.getByRole('heading', { name: 'v2.0.1016' })).toBeInTheDocument()
})

async function dismissDrawer(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard('{Escape}')
  await waitFor(() => expect(document.querySelector('[data-slot="dialog-content"]')).not.toBeInTheDocument())
}

it.each(['/#announcement-popup-21', '/v2#announcement-popup-21'])('opens announcements from an announcement anchor at %s without the popup feed', async (path) => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
    announcements: [{ announcement: {
      id: 'popup-21', kind: 'popup', active: true, title: '目标公告', body: '定位正文',
      created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
    }, read_at: null }], page: 3, pageSize: 10, total: 21,
  }), { headers: { 'Content-Type': 'application/json' } }))
  mount(path)
  await screen.findByRole('heading', { name: '目标公告' }, { timeout: 3000 })
  expect(screen.getByRole('region', { name: copy.v2.announcements })).toBeVisible()
  expect(mocks.session).toHaveBeenCalledWith(null, true, false)
  await waitFor(() => expect(screen.getByTestId('route-location')).toHaveTextContent('?section=announcements&page=3'))
})

function connect() {
  const profile = {
    id: 'profile-1', kind: 'cdk', permission: 'ultimate', display_name: 'My Doctor',
    status: 'active', cdk_order_hash: 'profile-order',
  } as UserGameAccount
  session = {
    ...session,
    authStatus: 'authenticated',
    user: { id: 'user-1', email: 'doctor@example.test' } as V2Session['user'],
    activeProfile: profile, cdkProfiles: [profile], profiles: [profile], announcementUnreadCount: 0, popups: [], setAnnouncementUnreadCount: vi.fn(),
    license: { version: 2, order_hash: 'order', operators: SAMPLE_OPERATORS, config: SAMPLE_CONFIG, issued_at: '', sig: '' },
  }
  const workflow = {
    profile, savedConfigs: [], archivedResults: [], suggestions: [], itemBalances: {} as Partial<Record<import('../../lib/inventory-contracts').SystemItemCode, number>>,
    userCanExportMaaWithoutCoupon: true, inventoryLoaded: true, inventoryError: null as string | null,
    latestWorkspaceResult: summary, handleViewHistory: vi.fn(async () => undefined),
    currentResult: null as OptimizeResult | null, finalResult: null, historyItem: { result: SAMPLE_RESULT },
    activeConfig: SAMPLE_CONFIG, mergedOperators: SAMPLE_OPERATORS, configDiffRows: [],
    updateConfig: vi.fn(), handleGenerate: vi.fn(async () => undefined), handleDownloadMAA: vi.fn(),
    permission: 'ultimate', userCanEditConfig: true, userCanUseIntermediateAutoConfig: true, userCanUseUpgradeFeatures: true,
    userCanUseScenarioLab: true, refreshInventory: vi.fn(async () => undefined),
    userCanViewFullData: true, userCanDownloadFullResult: true, handleDownloadFullResult: vi.fn(),
    configValidation: { ok: true } as ReturnType<typeof validateScheduleConfig>, configPresetLabel: '2-5-2', hasResult: true, resultIsCurrent: false,
    resultHistory: [summary], loading: false, isRestrictedPreview: false, workspaceError: null, inlineError: null,
    workspaceNotice: null, declarationDialog: null, exportFailure: null as ResultExportFailure | null, configToast: null as { message: string } | null,
    billingQuote: null as { charge: string; available: string; tier: number | null; sufficient: boolean } | null,
    billingQuoteLoading: false, billingQuoteError: null as string | null, refreshBillingQuote: vi.fn(async () => undefined),
    progress: null as import('../../components/ScheduleProgress').ScheduleProgressState | null,
  }
  mocks.workflow.mockImplementation(() => workflow)
  return workflow
}

describe('V2 results-first workspace', () => {
  it('continues from the homepage through login and account setup to generation without submitting early', async () => {
    const guest = session
    const workflow = connect()
    const readySession = session
    workflow.latestWorkspaceResult = null as unknown as typeof summary
    workflow.historyItem = null as unknown as typeof workflow.historyItem
    workflow.hasResult = false
    session = guest
    const loginPayload = { user: readySession.user!, profiles: [], active_profile: null, workspace: null }
    const accountPayload = { ...loginPayload, profiles: readySession.profiles, active_profile: readySession.activeProfile,
      workspace: { profile_id: 'profile-1', operators: null, config: null, elite_overrides: {}, latest_result: null,
        saved_configs: [], result_history: [], archived_results: [], result_history_next_cursor: null,
        archived_results_next_cursor: null, free_schedule_entitlement: null, updated_at: null } }
    vi.mocked(session.applyAuthPayload).mockImplementation((payload) => {
      if (!payload) return
      session = { ...session, ...payload, activeProfile: payload.active_profile, authStatus: 'authenticated', cdkProfiles: payload.profiles,
        license: payload.workspace?.operators && payload.workspace.config ? readySession.license : null }
    })
    vi.mocked(session.persistWorkspacePatch).mockImplementation(async (patch) => {
      const workspace = { ...accountPayload.workspace, ...patch }
      session = { ...session, workspace, license: readySession.license }
      return { ...accountPayload, workspace }
    })
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => new Response(JSON.stringify(
      String(url) === '/api/auth/login' ? loginPayload
        : String(url) === '/api/user/cdk/redeem' ? { redemption_type: 'profile', auth: accountPayload }
          : { notifications: [], unread_count: 0, next_cursor: null },
    ), { headers: { 'Content-Type': 'application/json' } }))
    const user = userEvent.setup()
    let page = mount('/')
    await user.click(screen.getByRole('button', { name: copy.v2.generateMine }))
    const login = await screen.findByText(copy.v2.generationSignIn)
    const guide = () => screen.getByRole('complementary', { name: copy.v2.firstSchedule.title })
    expect(guide().querySelector('[aria-current="step"]')).toHaveTextContent(copy.v2.firstSchedule.login)
    expect(window.localStorage.getItem(FIRST_SCHEDULE_INTENT_KEY)).toBe('true')
    const form = within(login.parentElement!)
    fireEvent.change(form.getByLabelText(copy.auth.components_AuthForm_011), { target: { value: 'doctor@example.test' } })
    fireEvent.change(form.getByLabelText(copy.auth.components_AuthForm_012), { target: { value: 'password123' } })
    await user.click(form.getAllByRole('button', { name: copy.auth.components_AuthForm_020 }).find((button) => button.getAttribute('type') === 'submit')!)
    await waitFor(() => expect(session.applyAuthPayload).toHaveBeenCalledWith(loginPayload))
    page.rerender(<MemoryRouter initialEntries={['/']}><V2Page /><RouteLocation /></MemoryRouter>)
    expect(screen.getByTestId('route-location')).toHaveTextContent('section=generation')
    expect(guide().querySelector('[aria-current="step"]')).toHaveTextContent(copy.v2.firstSchedule.import)
    // Cold imports of the lazy account and generation pages can exceed the default 1s wait in CI.
    expect(await screen.findByRole('button', { name: copy.v2.firstSchedule.importAction }, { timeout: 5_000 })).toBeVisible()
    await user.click(screen.getByText(copy.v2.firstSchedule.accountOptions))
    await user.click(await screen.findByRole('button', { name: copy.dashboard.pages_tool_dashboard_RedeemSection_005 }))
    expect(fetch.mock.calls.some(([url]) => String(url).includes('/personal-use-declaration'))).toBe(false)
    fireEvent.change(screen.getByRole('textbox', { name: 'CDK' }), { target: { value: 'MAA-FIRST-ACCOUNT' } })
    await user.click(screen.getByRole('button', { name: copy.dashboard.pages_tool_dashboard_RedeemSection_015 }))
    await waitFor(() => expect(session.applyAuthPayload).toHaveBeenCalledWith(accountPayload))
    page.rerender(<MemoryRouter initialEntries={['/']}><V2Page /><RouteLocation /></MemoryRouter>)
    await screen.findByText(copy.v2.generationImport)
    await user.click(screen.getByRole('button', { name: copy.public.pages_LandingPage_001 }))
    await user.upload(screen.getByLabelText(copy.v2.uploadMaa, { selector: 'input' }), new File([JSON.stringify(SAMPLE_OPERATORS)], 'operators.json', { type: 'application/json' }))
    await waitFor(() => expect(session.persistWorkspacePatch).toHaveBeenCalledWith(expect.objectContaining({ operators: SAMPLE_OPERATORS, config: expect.objectContaining({ layout: SAMPLE_CONFIG.layout }) })))
    page.rerender(<MemoryRouter initialEntries={['/']}><V2Page /><RouteLocation /></MemoryRouter>)
    await screen.findByText(copy.v2.firstSchedule.configTitle, {}, { timeout: 5_000 })
    expect(guide().querySelector('[aria-current="step"]')).toHaveTextContent(copy.v2.firstSchedule.config)
    expect(screen.queryByRole('button', { name: copy.optimize.pages_tool_optimize_GenerateControlBar_030 })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: copy.v2.firstSchedule.configAction }))
    vi.mocked(session.flushConfigSave).mockResolvedValueOnce(false)
    await user.click(screen.getByRole('button', { name: copy.v2.firstSchedule.confirmConfig }))
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(copy.v2.firstSchedule.configFailed)
    expect(workflow.handleGenerate).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: copy.v2.firstSchedule.confirmConfig }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await screen.findByText(copy.v2.prepare)
    expect(guide().querySelector('[aria-current="step"]')).toHaveTextContent(copy.v2.firstSchedule.generate)
    page.unmount()
    // Server snapshots may return the same configuration with a different key order.
    workflow.activeConfig = normalizeConfig(Object.fromEntries(Object.entries(SAMPLE_CONFIG).reverse()) as typeof SAMPLE_CONFIG)
    page = mount('/v2?section=generation&profile_id=profile-1')
    await screen.findByText(copy.v2.prepare)
    expect(guide().querySelector('[aria-current="step"]')).toHaveTextContent(copy.v2.firstSchedule.generate)
    expect(screen.getByTestId('route-location')).toHaveTextContent('section=generation&profile_id=profile-1')
    expect(workflow.handleGenerate).not.toHaveBeenCalled()
    expect(fetch.mock.calls.some(([url]) => String(url).includes('/api/optimization/jobs'))).toBe(false)
    await user.click(screen.getByRole('button', { name: copy.optimize.pages_tool_optimize_GenerateControlBar_030 }))
    await waitFor(() => expect(workflow.handleGenerate).toHaveBeenCalledOnce())
    workflow.currentResult = SAMPLE_RESULT
    workflow.hasResult = true
    page.rerender(<MemoryRouter initialEntries={['/']}><V2Page /><RouteLocation /></MemoryRouter>)
    expect(screen.queryByRole('complementary', { name: copy.v2.firstSchedule.title })).not.toBeInTheDocument()
    expect(window.localStorage.getItem(FIRST_SCHEDULE_INTENT_KEY)).toBeNull()
  }, 15_000)

  it.each(['252', '252-1', '252-full'])('uses fixed production counts when switching a custom comparison draft to %s', async (layout) => {
    connect()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      tasks: [], notifications: [], unread_count: 0, next_cursor: null,
    }), { headers: { 'Content-Type': 'application/json' } }))
    const user = userEvent.setup()
    mount('/v2?section=lab&profile_id=profile-1')
    const layoutSelect = await screen.findByRole('combobox', { name: copy.v2.comparison.layout })
    const orundum = screen.getByRole('combobox', { name: copy.v2.comparison.productCount('合成玉') })
    const shard = screen.getByRole('combobox', { name: copy.v2.comparison.productCount('源石碎片') })
    const gold = screen.getByRole('combobox', { name: copy.v2.comparison.productCount('赤金') })
    await user.selectOptions(orundum, '1')
    await user.selectOptions(shard, '1')
    await user.selectOptions(gold, '1')

    await user.selectOptions(layoutSelect, layout)
    expect(orundum).toBeDisabled()
    expect(shard).toBeDisabled()
    expect(gold).toBeDisabled()
    expect(orundum).toHaveValue('0')
    expect(shard).toHaveValue('0')
    expect(gold).toHaveValue('2')
    await user.click(screen.getByRole('button', { name: copy.v2.comparison.addPlan }))
    const stored = JSON.parse(window.sessionStorage.getItem('maa:scenario-lab:v2:profile-1')!)
    expect(stored.factors.layouts.find((entry: { layout: string }) => entry.layout === layout)?.plans).toEqual([{
      trading: { lmd: 2, orundum: 0 },
      manufacturing: { pureGold: 2, battleRecord: 3, originiumShard: 0 },
    }])

    await user.selectOptions(layoutSelect, '243')
    for (const select of [orundum, shard, gold]) {
      expect(select).toBeEnabled()
      expect(select).toHaveValue('1')
    }
  })

  it('lists historical comparisons and opens them in place without submitting another calculation', async () => {
    connect()
    const refresh = vi.fn(async () => undefined)
    const loadMore = vi.fn(async () => undefined)
    const job = { id: 'historical-comparison', kind: 'scenario_comparison', status: 'succeeded', resultAvailable: true,
      timestamps: { submittedAt: '2026-10-01T09:00:00Z', finishedAt: '2026-10-01T10:00:00Z' } }
    mocks.tasks.mockReturnValue({ jobs: [job, { ...job, id: 'unavailable-comparison', resultAvailable: false },
      { ...job, id: 'schedule', kind: 'schedule' }, { ...job, id: 'queued-comparison', status: 'queued' }],
    refresh, loadMore, hasMore: true, loading: false, error: null, notice: null })
    const historicalResult = {
      kind: 'scenario_comparison', scenarioCount: 0, screeningCount: 0, verifiedCount: 0, failedCount: 0,
      rawCombinationCount: 0, skipped: [], points: [], frontierScenarioIds: [], warnings: ['已恢复历史对比'],
      frontierBasis: 'fast_top_3_per_actual_operation_cost_then_layout_aware_verification',
      buildMeta: SAMPLE_RESULT.build_meta,
    }
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      return new Response(JSON.stringify(url.includes('/api/optimization/jobs/historical-comparison')
        ? { ...job, result: historicalResult }
        : { tasks: [], notifications: [], unread_count: 0, next_cursor: null }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    mount('/v2?section=lab&profile_id=profile-1')
    const history = within(await screen.findByRole('region', { name: copy.v2.comparison.historyTitle }))
    const viewButtons = history.getAllByRole('button', { name: copy.optimize.pages_tool_optimize_OptimizationTaskCenter_037 })
    expect(viewButtons).toHaveLength(2)
    expect(viewButtons[1]).toBeDisabled()
    await userEvent.click(viewButtons[0])
    expect(await screen.findByText('已恢复历史对比')).toBeVisible()
    expect(fetch).toHaveBeenCalledWith('/api/optimization/jobs/historical-comparison', expect.any(Object))
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
    expect(screen.getByTestId('route-location')).toHaveTextContent('section=lab')
    await userEvent.click(history.getByRole('button', { name: copy.optimize.pages_tool_optimize_OptimizationTaskCenter_003 }))
    await userEvent.click(history.getByRole('button', { name: copy.optimize.pages_tool_optimize_result_history_load_more }))
    expect(refresh).toHaveBeenCalledOnce()
    expect(loadMore).toHaveBeenCalledOnce()
  })

  it('waits for service and login restoration before showing a confirmed guest example', () => {
    session.authStatus = 'loading'
    mocks.features.mockReturnValue({ status: 'loading', features: DEFAULT_SITE_FEATURES, retry: vi.fn() })
    const page = mount()
    expect(screen.getByRole('status')).toHaveTextContent(copy.v2.loading)
    expect(screen.queryByText(copy.v2.sampleSource)).not.toBeInTheDocument()

    mocks.features.mockReturnValue({ status: 'ready', features: DEFAULT_SITE_FEATURES, retry: vi.fn() })
    page.rerender(<MemoryRouter><V2Page /></MemoryRouter>)
    expect(screen.getByRole('status')).toHaveTextContent(copy.v2.loading)
    expect(screen.queryByText(copy.v2.sampleSource)).not.toBeInTheDocument()

    session.authStatus = 'anonymous'
    page.rerender(<MemoryRouter><V2Page /></MemoryRouter>)
    expect(screen.getByText(copy.v2.sampleSource)).toBeInTheDocument()
    expect(screen.queryByText(copy.v2.loading)).not.toBeInTheDocument()
    expect(mocks.workflow).not.toHaveBeenCalled()
    const navigation = within(screen.getByRole('navigation', { name: copy.v2.navigation }))
    expect(navigation.getAllByRole('link').slice(0, 4).map((link) => link.textContent)).toEqual([
      copy.v2.guestNavigation.example, copy.v2.generateMine, copy.v2.guestNavigation.pricing, copy.v2.helpAction,
    ])
    const count = SAMPLE_OPERATORS.filter((operator) => operator.own).length
    expect(navigation.getByRole('button', { name: copy.v2.operators })).toHaveTextContent(copy.v2.guestNavigation.operatorCount(count))
    expect(screen.getByText(copy.v2.guestNavigation.sampleOwned(count))).toBeVisible()
    expect(navigation.getByText(copy.v2.guestNavigation.personal).closest('details')).not.toHaveAttribute('open')

    const workflow = connect()
    workflow.mergedOperators = [{ ...SAMPLE_OPERATORS[0], own: true }]
    workflow.historyItem = null as unknown as typeof workflow.historyItem
    workflow.latestWorkspaceResult = null as unknown as typeof summary
    page.rerender(<MemoryRouter><V2Page /></MemoryRouter>)
    const personalNavigation = within(screen.getByRole('navigation', { name: copy.v2.navigation }))
    expect(personalNavigation.queryByRole('link', { name: copy.v2.guestNavigation.example })).not.toBeInTheDocument()
    expect(personalNavigation.getByRole('button', { name: copy.v2.history })).toBeVisible()
    expect(personalNavigation.getByRole('button', { name: copy.v2.operators }).querySelector('small')).toHaveTextContent(/^1$/)
    expect(screen.getByText(copy.v2.owned(1))).toBeVisible()
    expect(screen.queryByText(copy.v2.guestNavigation.sampleOwned(1))).not.toBeInTheDocument()
  })

  it('shows common configuration first and opens other tasks on demand', async () => {
    const user = userEvent.setup()
    mount('/v2')
    await user.click(screen.getByRole('button', { name: copy.v2.facilities }))
    const dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByText(copy.workspace.config_sample, { exact: true })).toBeInTheDocument()
    expect(dialog.queryByText(copy.common.components_ConfigEditor_023)).not.toBeInTheDocument()
    expect(dialog.getByRole('tab', { name: copy.v2.configEditor.common })).toHaveAttribute('aria-selected', 'true')
    expect(dialog.getByRole('button', { name: '243 均衡' })).toBeInTheDocument()
    expect(dialog.queryByRole('switch', { name: '无人机' })).not.toBeInTheDocument()
    await user.click(dialog.getByRole('tab', { name: copy.v2.configEditor.strategy }))
    expect(dialog.getByRole('switch', { name: '无人机' })).toBeInTheDocument()
  })

  it('uses compact save states in the mobile configuration drawer', async () => {
    connect()
    session.configSyncStatus = 'pending'
    const user = userEvent.setup()
    mount('/v2')
    await user.click(screen.getByRole('button', { name: copy.v2.facilities }))
    expect(within(await screen.findByRole('dialog')).getByText(copy.workspace.config_save_pending_short, { exact: true })).toBeInTheDocument()
  })

  it('offers login recovery instead of switching to example data after a session error', async () => {
    session.authStatus = 'error'
    mount()
    expect(screen.getByRole('alert')).toHaveTextContent(copy.common.pages_ToolPage_003)
    expect(screen.queryByText(copy.v2.sampleSource)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: copy.v2.helpAction })).toHaveAttribute('href', '/v2?section=help')
    expect(screen.getByRole('link', { name: copy.public.pages_PublicInfoPage_061 })).toHaveAttribute('href', '/v2?section=support')
    expect(screen.getByRole('link', { name: copy.status.pages_StatusPage_002 })).toHaveAttribute('href', '/v2?section=status')
    await userEvent.click(screen.getByRole('button', { name: copy.common.pages_ToolPage_005 }))
    expect(session.retryAuth).toHaveBeenCalledOnce()
    expect(mocks.workflow).not.toHaveBeenCalled()
  })

  it.each(['loading', 'error'] as const)('keeps help and support usable while login status is %s', async (authStatus) => {
    session.authStatus = authStatus
    const user = userEvent.setup()
    mount('/v2?section=help')
    expect(await screen.findByRole('searchbox', { name: copy.public.faq_search_label })).toBeVisible()
    if (authStatus === 'error') {
      expect(screen.getByRole('alert')).toHaveTextContent(copy.v2.loginServiceUnavailable)
      await user.click(screen.getByRole('button', { name: copy.common.pages_ToolPage_005 }))
      expect(session.retryAuth).toHaveBeenCalledOnce()
    }
    const navigation = within(screen.getByRole('navigation', { name: copy.v2.navigation }))
    await user.click(navigation.getByRole('link', { name: copy.public.pages_PublicInfoPage_061 }))
    expect(await screen.findByRole('heading', { name: copy.public.pages_PublicInfoPage_067 })).toBeVisible()
    expect(screen.getByTestId('route-location')).toHaveTextContent('section=support')
    expect(mocks.workflow).not.toHaveBeenCalled()
  })

  it('reads service status after a 503 login failure and keeps the page visible during recovery', async () => {
    const { useToolSession } = await vi.importActual<typeof import('../tool/useToolSession')>('../tool/useToolSession')
    mocks.session.mockImplementation(useToolSession)
    let authReads = 0
    let finishRetry!: (response: Response) => void
    const retry = new Promise<Response>((resolve) => { finishRetry = resolve })
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url) === '/api/auth/me') {
        authReads += 1
        return authReads === 1 ? Response.json({ error: 'Service unavailable' }, { status: 503 }) : retry
      }
      return Response.json(String(url) === '/api/status' ? {
        generated_at: '2026-08-08T09:00:00.000Z', status: 'available',
        components: [{ id: 'optimization', status: 'available' }, { id: 'skland_import', status: 'available' }],
      } : { banner: null, popups: [] })
    })
    const user = userEvent.setup()
    mount()
    expect(await screen.findByRole('alert')).toHaveTextContent(copy.common.pages_ToolPage_003)
    await user.click(screen.getByRole('link', { name: copy.status.pages_StatusPage_002 }))
    const statusHeading = await screen.findByRole('heading', { name: '当前服务运行正常。' }, { timeout: 5_000 })
    expect(statusHeading).toBeVisible()
    expect(screen.getByRole('grid', { name: copy.status.pages_StatusPage_043 })).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent(copy.v2.loginServiceUnavailable)
    expect(fetch).toHaveBeenCalledWith('/api/status', expect.any(Object))
    await user.click(screen.getByRole('button', { name: copy.common.pages_ToolPage_005 }))
    await waitFor(() => expect(authReads).toBe(2))
    expect(screen.getByRole('heading', { name: '当前服务运行正常。' })).toBe(statusHeading)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await act(async () => { finishRetry(Response.json({ user: null })) })
    expect(screen.getByRole('heading', { name: '当前服务运行正常。' })).toBe(statusHeading)
    await user.click(within(screen.getByRole('navigation', { name: copy.v2.navigation })).getByRole('link', { name: copy.v2.guestNavigation.example }))
    expect(screen.getByText(copy.v2.sampleSource)).toBeVisible()
    expect(mocks.workflow).not.toHaveBeenCalled()
  })

  it.each(['generation', 'profiles', 'plans', 'inventory', 'settings', 'lab'])('blocks %s after a failed login check even with a retained account', (section) => {
    connect()
    session.authStatus = 'error'
    mount(`/v2?section=${section}`)
    expect(screen.getByRole('alert')).toHaveTextContent(copy.common.pages_ToolPage_003)
    expect(screen.queryByText(copy.v2.sampleSource)).not.toBeInTheDocument()
    expect(mocks.workflow).not.toHaveBeenCalled()
  })

  it('uses the public announcement feed when a previous account is retained after login failure', async () => {
    connect()
    session.authStatus = 'error'
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
      announcements: [{ announcement: {
        id: 'outage', kind: 'popup', active: true, title: '登录服务维护', body: '请稍后重试登录。',
        created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
      }, read_at: null }], page: 1, pageSize: 10, total: 1,
    }))
    mount('/v2?section=announcements')
    expect(await screen.findByRole('heading', { name: '登录服务维护' })).toBeVisible()
    expect(fetch).toHaveBeenCalledWith('/api/announcement?page=1', expect.any(Object))
    expect(fetch.mock.calls.some(([url]) => String(url).startsWith('/api/user/'))).toBe(false)
    expect(screen.queryByRole('button', { name: copy.dashboard.pages_tool_dashboard_AnnouncementsSection_011 })).not.toBeInTheDocument()
    expect(mocks.workflow).not.toHaveBeenCalled()
  })

  it('honors public service switches during login failure and hides disabled recovery links', async () => {
    session.authStatus = 'error'
    mocks.features.mockReturnValue({ status: 'ready', features: { ...DEFAULT_SITE_FEATURES, faq: false, support: false, service_status: false }, retry: vi.fn() })
    const user = userEvent.setup()
    mount('/v2?section=status')
    expect(await screen.findByText(copy.v2.featureUnavailable)).toBeVisible()
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
    await user.click(within(screen.getByRole('navigation', { name: copy.v2.navigation })).getByRole('link', { name: copy.v2.guestNavigation.example }))
    expect(screen.getByRole('alert')).toHaveTextContent(copy.common.pages_ToolPage_003)
    expect(screen.queryByRole('link', { name: copy.v2.helpAction })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: copy.public.pages_PublicInfoPage_061 })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: copy.status.pages_StatusPage_002 })).not.toBeInTheDocument()
  })

  it('offers preparation before generating when the personal workspace has no previous result', async () => {
    const workflow = connect()
    workflow.latestWorkspaceResult = null as unknown as typeof summary
    workflow.historyItem = null as unknown as typeof workflow.historyItem
    workflow.resultHistory = []
    mount()
    expect(screen.getByText(copy.v2.sampleSource)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(copy.v2.dataPending)
    await userEvent.click(screen.getByRole('button', { name: copy.v2.generateMine }))
    await screen.findByText(copy.v2.prepare)
    expect(screen.getByTestId('route-location')).toHaveTextContent('section=generation&profile_id=profile-1')
    expect(workflow.handleViewHistory).not.toHaveBeenCalled()
    expect(workflow.handleGenerate).not.toHaveBeenCalled()
  })

  it('keeps restored task progress and cancellation available while the first result is pending', async () => {
    const workflow = connect()
    workflow.historyItem = null as unknown as typeof workflow.historyItem
    workflow.loading = true
    workflow.progress = { mode: 'generate', startedAt: Date.now(), jobId: 'running-job', estimatePhase: 'running' }
    const job = { id: 'running-job', canCancel: true, cancellationRequested: false }
    const cancel = vi.fn(async () => undefined)
    mocks.tasks.mockReturnValue({ jobs: [job], cancel, busyJobId: null, error: null, notice: null })
    mount()
    expect(screen.getByText(copy.v2.loading)).toBeInTheDocument()
    expect(screen.queryByText(copy.v2.sampleSource)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: copy.v2.stopSchedule }))
    expect(cancel).toHaveBeenCalledWith(job)
    expect(workflow.handleGenerate).not.toHaveBeenCalled()
  })

  it('shows inventory depletion warnings without analysis access and opens configuration from the warning', async () => {
    const workflow = connect()
    workflow.userCanViewFullData = false
    workflow.historyItem = { result: { ...SAMPLE_RESULT,
      inventory_warnings: [{ product: 'Pure Gold', days_remaining: 0 }],
    } }
    mount()
    const warning = screen.getByRole('alert')
    expect(warning).toHaveTextContent('赤金库存已耗尽')
    expect(warning).toHaveTextContent('请补充库存或调整生产配置')
    await userEvent.click(within(warning).getByRole('button', { name: copy.v2.configure }))
    expect(await screen.findByRole('dialog', { name: copy.v2.facilities })).toBeInTheDocument()
    expect(workflow.handleGenerate).not.toHaveBeenCalled()
  })

  it.each([
    [129.02, copy.v2.goldInventoryDuration('129')],
    [0.5, copy.v2.goldInventoryToday],
    [0, copy.v2.goldInventoryDepleted],
    [null, copy.v2.goldInventoryUnknown],
  ])('keeps gold consumption, inventory duration (%s days), and configuration together without requiring analysis access', async (days, hint) => {
    const workflow = connect()
    workflow.userCanViewFullData = false
    workflow.historyItem = { result: { ...SAMPLE_RESULT, inventory_warnings: undefined,
      intermediate_depletion: [{ product: 'Pure Gold', stock: 772, net_per_day: -5.98, days_remaining: days }],
    } }
    mount()
    const gold = within(screen.getByRole('region', { name: copy.v2.goldNetChange }))
    expect(gold.getByText('-5.98')).toBeInTheDocument()
    expect(gold.getByText(hint)).toBeInTheDocument()
    await userEvent.click(gold.getByRole('button', { name: new RegExp(copy.v2.adjustProduction) }))
    expect(await screen.findByRole('dialog', { name: copy.v2.facilities })).toBeInTheDocument()
    expect(workflow.handleGenerate).not.toHaveBeenCalled()
  })

  it('uses normalized backend station output and drone consumption without rescaling or averaging', async () => {
    const workflow = connect()
    workflow.historyItem = { result: { ...SAMPLE_RESULT, daily_production: {
      hours: 24, source_hours: 16, normalization_factor: 1.5,
      manufacturing: { 'Pure Gold': 20, 'Battle Record': 32.4 }, trading: { LMD: 3000 }, consumption: { 'Pure Gold': 6 },
      details: [
        { shift: '早班', room_type: 'manufacture', room_index: 1, product: 'Pure Gold', amount: 20 },
        { shift: '早班', room_type: 'manufacture', room_index: 2, product: 'Battle Record', amount: 32.4 },
        { shift: '早班', room_type: 'trading', room_index: 2, product: 'LMD', amount: 2500, consume: { 'Pure Gold': 5 } },
        { shift: '早班', room_type: 'trading', room_index: 2, product: 'LMD', source: 'drones', amount: 500, consume: { 'Pure Gold': 1 } },
      ],
    } } }
    const user = userEvent.setup()
    mount()
    expect(screen.getByRole('region', { name: copy.v2.exp })).toHaveTextContent(`32,400${copy.v2.expUnit}`)
    const output = within(screen.getByRole('heading', { name: copy.v2.dailyOutput }).closest('section')!)
    expect(output.getByText('32,400').closest('.v2-output-row')).toHaveTextContent(`经验32,400${copy.v2.expUnit}`)
    expect(screen.queryByText(copy.v2.totalEfficiency)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: copy.v2.analysisTab }))
    const station = within(await screen.findByRole('region', { name: copy.v2.stationOutput }))
    const rows = station.getAllByRole('row').slice(1)
    expect(rows).toHaveLength(4)
    expect(rows[0]).toHaveTextContent('赤金 20')
    expect(rows[1]).toHaveTextContent('制造站 2早班经验 32,400')
    expect(rows[2]).toHaveTextContent('贸易站 2早班龙门币 2,500赤金 5')
    expect(rows[3]).toHaveTextContent(`贸易站 2早班${copy.v2.drones}龙门币 500赤金 1`)
    const sanity = (3000 + 32400) * SANITY_PER_LMD + 14 * SANITY_PER_PURE_GOLD
    const calculation = screen.getByRole('region', { name: copy.v2.sanityCalculation })
    expect(calculation).toHaveTextContent(sanity.toFixed(2))
    expect(screen.getByRole('region', { name: copy.v2.sanity })).toHaveTextContent(`${sanity.toFixed(2)}${copy.v2.sanityUnit}`)
    expect(calculation).toHaveTextContent('32,400 × 0.003600 ≈ 116.64')
    expect(calculation).toHaveTextContent(copy.v2.battleRecordEquivalent('32.4'))
    expect(workflow.handleGenerate).not.toHaveBeenCalled()
  })

  it('shows the selected room and shift output with the same units and drone amounts as income analysis', async () => {
    const workflow = connect()
    const result = structuredClone(SAMPLE_RESULT)
    result.plans[0].name = '早班'
    result.plans[1].name = '晚班'
    result.daily_production = { hours: 24, source_hours: 16, normalization_factor: 1.5, details: [
      { shift: '早班', room_type: 'manufacture', room_index: 1, product: 'Battle Record', amount: 32.4 },
      { shift: '早班', room_type: 'manufacture', room_index: 1, product: 'Battle Record', source: 'drones', amount: 0.5 },
      { shift: '早班', room_type: 'manufacture', room_index: 2, product: 'Pure Gold', amount: 999 },
      { shift: '早班', room_type: 'trading', room_index: 1, product: 'LMD', amount: 2500 },
      { shift: '晚班', room_type: 'manufacture', room_index: 1, product: 'Battle Record', amount: 7.5 },
    ] }
    workflow.historyItem = { result }
    const user = userEvent.setup()
    mount()
    await user.click(screen.getAllByRole('button', { name: /制造站/ })[0])
    let dialog = within(await screen.findByRole('dialog'))
    let output = within(dialog.getByText(copy.v2.estimatedAmount).parentElement!)
    expect(output.getByText('经验 32,400')).toBeInTheDocument()
    expect(output.getByText('经验 500')).toBeInTheDocument()
    expect(output.getByText(copy.v2.drones)).toBeInTheDocument()
    expect(output.queryByText(/999|2,500|7,500/)).not.toBeInTheDocument()
    await dismissDrawer(user)
    await user.click(screen.getByRole('tab', { name: /晚班/ }))
    await user.click(screen.getAllByRole('button', { name: /制造站/ })[0])
    dialog = within(await screen.findByRole('dialog'))
    output = within(dialog.getByText(copy.v2.estimatedAmount).parentElement!)
    expect(output.getByText('经验 7,500')).toBeInTheDocument()
    expect(output.queryByText(copy.v2.drones)).not.toBeInTheDocument()
    await dismissDrawer(user)
    await user.click(screen.getAllByRole('button', { name: /贸易站/ })[0])
    expect(within(await screen.findByRole('dialog')).queryByText(copy.v2.estimatedAmount)).not.toBeInTheDocument()
    expect(workflow.handleGenerate).not.toHaveBeenCalled()
  })

  it.each(['free', 'preview', 'sample', 'missing'] as const)('hides room production for %s results', async (restriction) => {
    if (restriction !== 'sample') {
      const workflow = connect()
      if (restriction === 'free') workflow.userCanViewFullData = false
      if (restriction === 'preview') workflow.historyItem = { result: { ...SAMPLE_RESULT, preview_limit: { room_limit: 1, hidden_room_count: 1, notice: 'Preview' } } }
      if (restriction === 'missing') workflow.historyItem = { result: { ...SAMPLE_RESULT, daily_production: undefined } }
    }
    mount()
    await userEvent.click(screen.getAllByRole('button', { name: /制造站/ })[0])
    expect(within(await screen.findByRole('dialog')).queryByText(copy.v2.estimatedAmount)).not.toBeInTheDocument()
  })

  it('compares the selected historical result with its predecessor and ignores a late response after switching results', async () => {
    const workflow = connect()
    const older = { ...summary, id: 'older', name: 'Older plan', created_at: '2026-09-30T10:00:00Z' }
    const newer = { ...summary, id: 'newer', created_at: '2026-10-02T10:00:00Z' }
    workflow.resultHistory = [newer, summary, older]
    workflow.latestWorkspaceResult = newer
    Object.assign(workflow.historyItem, { id: summary.id, config: SAMPLE_CONFIG })
    workflow.activeConfig = normalizeConfig({ ...SAMPLE_CONFIG, layout: 'unsaved-draft' })
    const priorConfig = normalizeConfig({ ...SAMPLE_CONFIG, drones: { ...SAMPLE_CONFIG.drones!, enable: false } })
    const priorResult = { ...SAMPLE_RESULT, daily_production: {
      trading: { LMD: 51000 }, manufacturing: { 'Battle Record': 30 }, net: { 'Pure Gold': -1 },
    } }
    let finish!: (response: Response) => void
    const delayed = new Promise<Response>((resolve) => { finish = resolve })
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => String(url).startsWith('/api/user/results/older?')
      ? delayed : new Response(JSON.stringify({ notifications: [], unread_count: 0, next_cursor: null }), { status: 200 }))
    const page = mount()
    const goldMetric = screen.getByRole('region', { name: copy.v2.goldNetChange })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: copy.v2.productionChanges })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: copy.v2.comparePrevious }))
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/user/results/older?profile_id=profile-1', expect.anything()))
    expect(screen.getByText(copy.v2.loadingPreviousProduction)).toBeInTheDocument()
    await act(async () => finish(Response.json({ item: { ...older, config: priorConfig, result: priorResult } })))
    const changes = screen.getByRole('region', { name: copy.v2.productionChanges })
    expect(changes).toHaveTextContent('龙门币+2,594.99 龙门币 / 天')
    expect(changes).toHaveTextContent('经验+12,426.6 经验 / 天')
    expect(changes).toHaveTextContent('赤金净变化-4.98 个 / 天')
    expect(changes).toHaveTextContent(`${copy.v2.sanity}+48.63 理智 / 天`)
    expect(goldMetric).toHaveTextContent('-5.98')
    const comparison = within(screen.getByRole('dialog', { name: copy.v2.resultComparison }))
    expect(comparison.getByText(/与「Older plan」/)).toBeInTheDocument()
    const configChanges = comparison.getByRole('region', { name: copy.v2.resultConfigChanges })
    expect(configChanges).toHaveTextContent(copy.common.lib_workspace_history_024)
    expect(configChanges).toHaveTextContent(copy.common.lib_workspace_history_037)
    expect(configChanges).not.toHaveTextContent('unsaved-draft')

    let finishNew!: (response: Response) => void
    const delayedNew = new Promise<Response>((resolve) => { finishNew = resolve })
    fetch.mockImplementation(async (url) => String(url).startsWith(`/api/user/results/${summary.id}?`)
      ? delayedNew : new Response(JSON.stringify({ notifications: [], unread_count: 0, next_cursor: null }), { status: 200 }))
    Object.assign(workflow.historyItem, { id: newer.id })
    page.rerender(<MemoryRouter initialEntries={['/v2']}><V2Page /><RouteLocation /></MemoryRouter>)
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(`/api/user/results/${summary.id}?profile_id=profile-1`, expect.anything()))
    expect(screen.queryByRole('region', { name: copy.v2.productionChanges })).not.toBeInTheDocument()
    Object.assign(workflow.historyItem, { id: older.id, result: priorResult })
    page.rerender(<MemoryRouter initialEntries={['/v2']}><V2Page /><RouteLocation /></MemoryRouter>)
    expect(screen.getByText(copy.v2.noPreviousProduction)).toBeInTheDocument()
    await act(async () => finishNew(Response.json({ item: { ...summary, result: SAMPLE_RESULT } })))
    expect(screen.queryByRole('region', { name: copy.v2.productionChanges })).not.toBeInTheDocument()
    await dismissDrawer(userEvent.setup())
    expect(screen.getByRole('region', { name: copy.v2.goldNetChange })).toHaveTextContent(copy.v2.goldInventoryDuration('129'))
    expect(workflow.handleGenerate).not.toHaveBeenCalled()
  })

  it('keeps yield comparisons available when reading the current saved configuration fails and retries the read', async () => {
    const workflow = connect()
    const older = { ...summary, id: 'older', created_at: '2026-09-30T10:00:00Z' }
    workflow.resultHistory = [summary, older]
    Object.assign(workflow.historyItem, { id: summary.id })
    let configReads = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).startsWith(`/api/user/results/${summary.id}?`)) {
        configReads += 1
        return Response.json(configReads === 1 ? { error: 'Read failed' } : { item: { ...summary, config: SAMPLE_CONFIG, result: SAMPLE_RESULT } }, { status: configReads === 1 ? 500 : 200 })
      }
      if (String(url).startsWith('/api/user/results/older?')) return Response.json({ item: { ...older, config: SAMPLE_CONFIG, result: SAMPLE_RESULT } })
      return Response.json({ notifications: [], unread_count: 0, next_cursor: null })
    })
    mount()
    await userEvent.click(screen.getByRole('button', { name: copy.v2.comparePrevious }))
    await screen.findByText(copy.v2.resultConfigReadFailed)
    expect(screen.getByRole('region', { name: copy.v2.productionChanges })).toHaveTextContent(copy.v2.sameAsPrevious)
    await userEvent.click(within(screen.getByRole('region', { name: copy.v2.resultConfigChanges })).getByRole('button', { name: copy.v2.retry }))
    await screen.findByText(copy.v2.resultConfigUnchanged)
    expect(configReads).toBe(2)
    expect(workflow.handleGenerate).not.toHaveBeenCalled()
  })

  it('retries a failed previous-result read and keeps missing production data distinct from zero yield', async () => {
    const workflow = connect()
    const older = { ...summary, id: 'older', created_at: '2026-09-30T10:00:00Z' }
    workflow.resultHistory = [summary, older]
    Object.assign(workflow.historyItem, { id: summary.id, config: SAMPLE_CONFIG })
    let historyReads = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).startsWith('/api/user/results/older?')) {
        historyReads += 1
        return Response.json(historyReads === 1 ? { error: 'Read failed' } : { item: { ...older, config: null, result: { ...SAMPLE_RESULT, daily_production: undefined } } }, { status: historyReads === 1 ? 500 : 200 })
      }
      return new Response(JSON.stringify({ notifications: [], unread_count: 0, next_cursor: null }), { status: 200 })
    })
    const page = mount()
    await userEvent.click(screen.getByRole('button', { name: copy.v2.comparePrevious }))
    const failed = await screen.findByText(copy.v2.previousProductionFailed)
    await userEvent.click(within(failed.closest('p')!).getByRole('button', { name: copy.v2.retry }))
    await screen.findByText(copy.v2.previousProductionUnavailable)
    expect(screen.getByRole('region', { name: copy.v2.resultConfigChanges })).toHaveTextContent(copy.v2.resultConfigUnavailable)
    expect(historyReads).toBe(2)
    expect(screen.queryByRole('region', { name: copy.v2.productionChanges })).toHaveTextContent(copy.v2.previousProductionUnavailable)
    await dismissDrawer(userEvent.setup())
    workflow.historyItem = { result: { ...SAMPLE_RESULT, daily_production: undefined } }
    page.rerender(<MemoryRouter initialEntries={['/v2']}><V2Page /><RouteLocation /></MemoryRouter>)
    expect(screen.getByRole('region', { name: copy.v2.lmd })).toHaveTextContent('—')
    expect(screen.getByRole('region', { name: copy.v2.exp })).toHaveTextContent('—')
    expect(screen.getByRole('region', { name: copy.v2.goldNetChange })).toHaveTextContent(copy.v2.goldNetUnavailable)
    expect(screen.getByRole('region', { name: copy.v2.sanity })).toHaveTextContent('—')
    expect(workflow.handleGenerate).not.toHaveBeenCalled()
  })

  it('reads facility levels and operator moods from the chosen result and resolves skills using saved training', async () => {
    const workflow = connect()
    const result = structuredClone(SAMPLE_RESULT)
    result.buildingType = 252
    const room = result.plans[0].rooms.trading[0]
    delete room.level
    room.facility_level = 2
    room.mood = { 但书: { start: 21.5, end: 7.2 } }
    room.overflow = { time: '7h', equivalent: { equivalent_efficiency: 304.2 } }
    workflow.historyItem = { result }
    const user = userEvent.setup()
    mount()
    const card = screen.getByRole('button', { name: /贸易站.*推进之王/ })
    expect(card).toHaveTextContent('Lv.2')
    expect(card).toHaveTextContent(`${copy.v2.equivalentEfficiency}304.2%`)
    await user.click(card)
    const dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByText('21.5')).toBeInTheDocument()
    expect(dialog.getByText('7.2')).toBeInTheDocument()
    expect(dialog.getAllByText(copy.v2.moodUnavailable)).toHaveLength(4)
    expect(dialog.getByText(`${copy.v2.expectedFullOrders}7h`)).toBeInTheDocument()
    await user.click(dialog.getAllByText(copy.domain.building_skills.title)[0])
    expect(dialog.getAllByText(new RegExp(copy.domain.building_skills.active))[0]).toBeVisible()
    expect(workflow.handleGenerate).not.toHaveBeenCalled()
  })

  it('waits for configuration saving before switching versions and stays in V2 when saving fails', async () => {
    connect()
    let finishSave!: (saved: boolean) => void
    vi.mocked(session.flushConfigSave).mockReturnValueOnce(new Promise((resolve) => { finishSave = resolve }))
    const user = userEvent.setup()
    mount('/')
    const legacyEntry = screen.getByRole('link', { name: copy.v2.legacyEntry })
    await user.click(legacyEntry)
    expect(screen.getByTestId('route-location')).toHaveAttribute('data-pathname', '/')
    await act(async () => finishSave(false))
    expect(screen.getByRole('alert')).toHaveTextContent(copy.v2.saveFailed)
    expect(screen.getByTestId('route-location')).toHaveAttribute('data-pathname', '/')
    await user.click(legacyEntry)
    await waitFor(() => expect(screen.getByTestId('route-location')).toHaveAttribute('data-pathname', '/v1'))
    expect(session.flushConfigSave).toHaveBeenCalledTimes(2)
  })

  it.each([
    '/?profile_id=profile-1',
    '/v2?profile_id=profile-1&panel=operators',
  ])('opens profile management and closes the operator drawer from %s', async (path) => {
    connect()
    const user = userEvent.setup()
    mount(path)
    if (!path.includes('panel=operators')) await user.click(screen.getByRole('button', { name: copy.v2.operators }))
    const dialog = within(await screen.findByRole('dialog'))
    await user.click(dialog.getByText(copy.v2.manageProfiles))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: copy.v2.account })).toBeVisible())
    expect(screen.getByTestId('route-location')).toHaveTextContent('?section=profiles&profile_id=profile-1')
    expect(screen.getByTestId('route-location')).not.toHaveTextContent('panel=')
  })

  it.each(['operators', 'config'] as const)('dismisses the %s drawer through the overlay despite its input controls', async (panel) => {
    const workflow = connect()
    const user = userEvent.setup()
    mount(`/v2?profile_id=profile-1&panel=${panel}`)
    const dialog = await screen.findByRole('dialog')
    if (panel === 'operators') await user.type(within(dialog).getByRole('textbox', { name: copy.v2.searchOperators }), '但书')
    else {
      await user.click(await within(dialog).findByRole('button', { name: copy.common.components_ConfigEditor_007 }))
      expect(workflow.updateConfig).toHaveBeenCalledOnce()
    }
    expect(dialog.querySelector('input, select, textarea')).not.toBeNull()
    await user.click(document.querySelector('[data-slot="dialog-overlay"]')!)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('route-location')).not.toHaveTextContent('panel=')
    expect(session.setConfigOverride).not.toHaveBeenCalled()
    expect(workflow.handleGenerate).not.toHaveBeenCalled()
  })

  it('refreshes cached teams and expanded skills when saved training and the result change', async () => {
    const workflow = connect()
    const user = userEvent.setup()
    const page = mount()
    await user.click(screen.getByRole('button', { name: copy.v2.operators }))
    const dialog = within(await screen.findByRole('dialog'))
    await user.type(dialog.getByRole('textbox', { name: copy.v2.searchOperators }), '但书')
    expect(dialog.queryByText('违约索赔·β')).not.toBeInTheDocument()
    await user.click(dialog.getByText(copy.domain.building_skills.title))
    expect((await dialog.findByText('违约索赔·β')).closest('.v2-skill')).toHaveClass('v2-skill-active')

    workflow.mergedOperators = SAMPLE_OPERATORS.map((operator) => operator.name === '但书' ? { ...operator, elite: 0, level: 1 } : operator)
    const nextResult = structuredClone(SAMPLE_RESULT)
    nextResult.plans[0].rooms.trading[0].level = 2
    workflow.historyItem = { result: nextResult }
    page.rerender(<MemoryRouter initialEntries={['/v2']}><V2Page /><RouteLocation /></MemoryRouter>)
    expect(dialog.getByText('违约索赔·β').closest('.v2-skill')).toHaveClass('v2-skill-locked')
    expect(dialog.getByText('违约索赔·α').closest('.v2-skill')).toHaveClass('v2-skill-active')
    await user.click(dialog.getByText(copy.domain.building_skills.title))
    await waitFor(() => expect(dialog.queryByText('违约索赔·β')).not.toBeInTheDocument())
    await dismissDrawer(user)
    const card = screen.getByRole('button', { name: /贸易站.*推进之王/ })
    expect(card).toHaveTextContent('Lv.2')
    expect(card.querySelector('[data-operator-name="但书"]')).toHaveAttribute('data-operator-elite', '0')
    expect(workflow.handleGenerate).not.toHaveBeenCalled()
    expect(session.persistWorkspacePatch).not.toHaveBeenCalled()
  })

  it('switches teams by mouse and keyboard and exposes room details on demand', async () => {
    const user = userEvent.setup()
    mount()
    const originalRoom = within(screen.getByRole('tabpanel')).getByRole('button', { name: /贸易站.*推进之王/ })
    const originalPane = originalRoom.closest('.v2-transition-pane')
    const second = screen.getByRole('tab', { name: /第2班/ })
    await user.click(second)
    expect(second).toHaveAttribute('aria-selected', 'true')
    expect(within(screen.getByRole('tabpanel')).getByText('推进之王')).toBeInTheDocument()
    expect(within(screen.getByRole('tabpanel')).getByRole('button', { name: /贸易站.*推进之王/ })).toBe(originalRoom)
    expect(originalRoom.closest('.v2-transition-pane')).toBe(originalPane)
    await user.keyboard('{ArrowRight}')
    const third = screen.getByRole('tab', { name: /第3班/ })
    expect(third).toHaveFocus()
    expect(third).toHaveAttribute('aria-selected', 'true')
    expect(within(screen.getByRole('tabpanel')).getByRole('button', { name: /贸易站.*巫恋/ })).toBe(originalRoom)
    await user.click(screen.getByRole('button', { name: /贸易站.*巫恋/ }))
    expect(await screen.findByRole('dialog')).toHaveTextContent(copy.v2.roomDetails)
    await dismissDrawer(user)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('preserves the selected shift, Fiammetta target and display mode across result views without generating', async () => {
    const workflow = connect()
    const result = structuredClone(SAMPLE_RESULT)
    result.plans[0].Fiammetta = { enable: true, target: ' 但书 ', order: 'pre' }
    result.plans[1].Fiammetta = { enable: true, target: '德克萨斯', order: 'post' }
    result.plans[2].Fiammetta = { enable: false, target: '但书', order: 'pre' }
    workflow.historyItem = { result }
    const user = userEvent.setup()
    const page = mount()
    expect(within(screen.getByRole('tabpanel')).getByText('菲亚梅塔 → 但书')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /第2班/ }))
    expect(within(screen.getByRole('tabpanel')).getByText('菲亚梅塔 → 德克萨斯')).toBeInTheDocument()
    expect(within(screen.getByRole('tabpanel')).queryByText('菲亚梅塔 → 但书')).not.toBeInTheDocument()
    const room = within(screen.getByRole('tabpanel')).getByRole('button', { name: /贸易站.*推进之王/ })
    const output = screen.getByRole('heading', { name: copy.v2.dailyOutput }).closest('section')
    const config = screen.getByRole('heading', { name: copy.v2.currentConfig }).closest('section')
    await user.click(screen.getByRole('button', { name: copy.v2.list }))
    expect(within(screen.getByRole('tabpanel')).getByRole('button', { name: /贸易站.*推进之王/ })).toBe(room)
    await user.click(screen.getByRole('button', { name: copy.v2.expandRooms }))
    expect(screen.getByRole('button', { name: copy.v2.compactRooms })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { name: copy.v2.dailyOutput }).closest('section')).toBe(output)
    expect(screen.getByRole('heading', { name: copy.v2.currentConfig }).closest('section')).toBe(config)
    expect(within(screen.getByRole('tabpanel')).getByRole('button', { name: /贸易站.*推进之王/ })).toBe(room)
    await user.click(screen.getByRole('button', { name: copy.v2.compactRooms }))
    expect(screen.getByRole('button', { name: copy.v2.expandRooms })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('heading', { name: copy.v2.dailyOutput }).closest('section')).toBe(output)
    expect(screen.getByRole('heading', { name: copy.v2.currentConfig }).closest('section')).toBe(config)
    await user.click(screen.getByRole('button', { name: copy.v2.expandRooms }))
    expect(screen.getByRole('tab', { name: /第2班/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: copy.v2.list })).toHaveAttribute('aria-pressed', 'true')
    expect(within(screen.getByRole('tabpanel')).getByText('推进之王')).toBeInTheDocument()
    expect(within(screen.getByRole('tabpanel')).getByText('菲亚梅塔 → 德克萨斯')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /第3班/ }))
    expect(within(screen.getByRole('tabpanel')).queryByText(/菲亚梅塔 →/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /第2班/ }))
    await user.click(screen.getByRole('button', { name: copy.v2.analysisTab }))
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: copy.v2.scheduleTab }))
    expect(screen.getByRole('button', { name: copy.v2.compactRooms })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('tab', { name: /第2班/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: copy.v2.list })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(screen.getByRole('tabpanel')).toBeVisible())
    expect(within(screen.getByRole('tabpanel')).getByText('菲亚梅塔 → 德克萨斯')).toBeInTheDocument()
    result.schedule_mode = 'rotation'
    workflow.historyItem = { result: { ...result } }
    page.rerender(<MemoryRouter initialEntries={['/v2']}><V2Page /><RouteLocation /></MemoryRouter>)
    expect(within(screen.getByRole('tabpanel')).queryByText(/菲亚梅塔 →/)).not.toBeInTheDocument()
    expect(workflow.handleGenerate).not.toHaveBeenCalled()
  })

  it('exposes only the current team during rapid shift changes and keeps keyboard focus on the selected tab', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('tab', { name: /第2班/ }))
    await user.keyboard('{ArrowRight}{Home}{End}')
    const third = screen.getByRole('tab', { name: /第3班/ })
    expect(third).toHaveFocus()
    expect(third).toHaveAttribute('aria-selected', 'true')
    const board = within(screen.getByRole('tabpanel'))
    expect(board.getByRole('button', { name: /贸易站.*巫恋/ })).toBeInTheDocument()
    expect(board.queryByRole('button', { name: /贸易站.*推进之王/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
  })

  it('applies the shared reduced-animation setting from V2 without generating or losing the selected team', async () => {
    // Keep CI frame delays from automatically enabling reduced motion before the manual toggle.
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(0)
    const user = userEvent.setup()
    render(<MotionPreferenceProvider><MemoryRouter initialEntries={['/v2']}><V2Page /></MemoryRouter></MotionPreferenceProvider>)
    await user.click(screen.getByRole('tab', { name: /第2班/ }))
    await user.click(screen.getByRole('button', { name: copy.dashboard.animation.settings }))
    const dialog = within(await screen.findByRole('dialog', { name: copy.dashboard.animation.settings }))
    const toggle = dialog.getByRole('switch', { name: copy.dashboard.animation.reduce })
    expect(toggle).not.toBeChecked()
    await user.click(toggle)
    expect(document.documentElement).toHaveAttribute('data-reduced-motion')
    expect(window.localStorage.getItem('maatool-reduce-motion')).toBe('true')
    await dismissDrawer(user)
    expect(screen.getByRole('tab', { name: /第2班/ })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('button', { name: copy.v2.list }))
    expect(screen.getByRole('button', { name: copy.v2.list })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('tab', { name: /第2班/ })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('button', { name: copy.dashboard.animation.settings }))
    expect(within(await screen.findByRole('dialog')).getByRole('switch', { name: copy.dashboard.animation.reduce })).toBeChecked()
    expect(mocks.workflow).not.toHaveBeenCalled()
  })

  it('restores focus and releases the modal before reopening', async () => {
    const user = userEvent.setup()
    mount()
    const opener = screen.getByRole('button', { name: copy.v2.operators })
    await user.click(opener)
    const dialog = await screen.findByRole('dialog', { name: copy.v2.operators })
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    await dismissDrawer(user)
    await waitFor(() => expect(opener).toHaveFocus())
    expect(document.body).not.toHaveAttribute('data-scroll-locked')
    await user.click(opener)
    expect(await screen.findByRole('dialog', { name: copy.v2.operators })).toBeInTheDocument()
    await dismissDrawer(user)
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('marks the correct drone target using one-based result indices in each shift', async () => {
    const user = userEvent.setup()
    mount()
    expect(within(screen.getByRole('button', { name: /制造站.*温蒂/ })).getByTitle(copy.v2.drones)).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: /制造站.*槐琥/ })).queryByTitle(copy.v2.drones)).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /第2班/ }))
    expect(within(screen.getByRole('button', { name: /制造站.*夜烟/ })).getByTitle(copy.v2.drones)).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: /制造站.*泡泡/ })).queryByTitle(copy.v2.drones)).not.toBeInTheDocument()
  })

  it('exports the selected result from one drawer and preserves the selected shift on close', async () => {
    const workflow = connect()
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('tab', { name: /第2班/ }))
    const opener = screen.getByRole('button', { name: copy.v2.export })
    await user.click(opener)
    const dialog = within(await screen.findByRole('dialog', { name: copy.v2.exportTitle }))
    expect(dialog.getByText(copy.v2.imageShift(SAMPLE_RESULT.plans[1].name))).toBeInTheDocument()
    await user.click(dialog.getByRole('button', { name: copy.v2.exportMaa }))
    expect(workflow.handleDownloadMAA).toHaveBeenCalledOnce()
    await user.click(dialog.getByRole('button', { name: copy.domain.components_result_panel_ResultPanel_039 }))
    expect(workflow.handleDownloadFullResult).toHaveBeenCalledOnce()
    expect(dialog.queryByRole('tablist')).not.toBeInTheDocument()
    await dismissDrawer(user)
    await waitFor(() => expect(opener).toHaveFocus())
    expect(screen.getByRole('tab', { name: /第2班/ })).toHaveAttribute('aria-selected', 'true')
    expect(workflow.handleGenerate).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'free', direct: false, balance: 0, loaded: true, error: null, enabled: true, mode: 'maa', message: copy.optimize.maa_export.free, available: false },
    { name: 'coupon', direct: false, balance: 1, loaded: true, error: null, enabled: true, mode: 'maa', message: copy.optimize.maa_export.coupon, available: true },
    { name: 'paid or active trial', direct: true, balance: 0, loaded: false, error: null, enabled: true, mode: 'maa', message: copy.optimize.maa_export.direct, available: true },
    { name: 'inventory loading', direct: false, balance: 0, loaded: false, error: null, enabled: true, mode: 'maa', message: copy.optimize.maa_export.checking, available: false },
    { name: 'inventory failed with stale coupon', direct: false, balance: 1, loaded: true, error: 'Inventory unavailable', enabled: true, mode: 'maa', message: copy.optimize.maa_export.failed, available: false },
    { name: 'service unavailable', direct: true, balance: 1, loaded: true, error: null, enabled: false, mode: 'maa', message: copy.optimize.maa_export.disabled, available: false },
    { name: 'rotation with export rights', direct: true, balance: 1, loaded: true, error: null, enabled: true, mode: 'rotation', message: copy.optimize.maa_export.rotation, available: false },
  ] as const)('explains $name exports before generation and inside the export drawer', async ({ direct, balance, loaded, error, enabled, mode, message, available }) => {
    const workflow = connect()
    workflow.userCanExportMaaWithoutCoupon = direct
    workflow.itemBalances = { maa_export_trial_coupon: balance }
    workflow.inventoryLoaded = loaded
    workflow.inventoryError = error
    workflow.activeConfig = { ...SAMPLE_CONFIG, schedule_mode: mode }
    workflow.historyItem = { result: { ...SAMPLE_RESULT, schedule_mode: mode } }
    mocks.features.mockReturnValue({ status: 'ready', features: { ...DEFAULT_SITE_FEATURES, maa_export: enabled }, retry: vi.fn() })
    const user = userEvent.setup()
    mount('/v2?section=generation')
    const generation = await screen.findByRole('region', { name: copy.v2.generation })
    expect(await within(generation).findByText(message)).toBeVisible()
    expect(workflow.handleGenerate).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: copy.v2.overview }))
    await user.click(screen.getByRole('button', { name: copy.v2.export }))
    const dialog = within(await screen.findByRole('dialog', { name: copy.v2.exportTitle }))
    expect(dialog.getByText(message)).toBeVisible()
    const download = dialog.queryByRole('button', { name: copy.v2.exportMaa })
    if (!enabled) expect(download).not.toBeInTheDocument()
    else if (mode === 'rotation') expect(download).toBeDisabled()
    else {
      expect(download).toBeEnabled()
      if (available) {
        await user.click(download!)
        expect(workflow.handleDownloadMAA).toHaveBeenCalledOnce()
      }
    }
    if (!available) expect(workflow.handleDownloadMAA).not.toHaveBeenCalled()
    expect(dialog.getByRole('button', { name: copy.domain.result_image.all })).toBeEnabled()
    expect(session.persistWorkspacePatch).not.toHaveBeenCalled()
  })

  it.each(['maa', 'full'] as const)('shows %s failures inside the drawer and retries the same export without losing the selected shift', async (format) => {
    const workflow = connect()
    workflow.exportFailure = { format, resultId: summary.id, error: new Error('连接中断，请检查网络。') }
    const user = userEvent.setup()
    const page = mount()
    await user.click(screen.getByRole('tab', { name: /第2班/ }))
    await user.click(screen.getByRole('button', { name: copy.v2.export }))
    const dialog = within(await screen.findByRole('dialog', { name: copy.v2.exportTitle }))
    expect(dialog.getByRole('alert')).toHaveTextContent('连接中断，请检查网络。')
    expect(dialog.getByRole('alert')).toHaveTextContent(copy.v2.exportRetryHelp)
    await user.click(dialog.getByRole('button', { name: copy.v2.exportRetry }))
    expect(format === 'maa' ? workflow.handleDownloadMAA : workflow.handleDownloadFullResult).toHaveBeenCalledOnce()
    workflow.exportFailure = null
    page.rerender(<MemoryRouter initialEntries={['/v2']}><V2Page /><RouteLocation /></MemoryRouter>)
    expect(dialog.queryByRole('alert')).not.toBeInTheDocument()
    expect(dialog.getByText(copy.v2.imageShift(SAMPLE_RESULT.plans[1].name))).toBeInTheDocument()
  })

  it.each([
    ['maa_export_coupon_required', 403, 'inventory', copy.v2.exportInventoryAction],
    ['result_not_found', 404, 'plans', copy.v2.exportPlansAction],
    ['full_result_export_forbidden', 403, 'pricing', copy.v2.comparePlans],
    ['maa_export_result_invalid', 422, 'generation', copy.v2.exportGenerateAction],
    ['login_required', 401, 'generation', copy.v2.exportLoginAction],
  ] as const)('offers recovery for %s without submitting another export', async (code, status, section, label) => {
    const workflow = connect()
    workflow.exportFailure = { format: 'maa', resultId: summary.id, error: new ApiError('本次导出失败', status, { code }, '/api/user/maa-export') }
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: copy.v2.export }))
    const dialog = within(await screen.findByRole('dialog', { name: copy.v2.exportTitle }))
    expect(dialog.getByRole('alert')).toHaveTextContent('本次导出失败')
    await user.click(dialog.getByRole('button', { name: label }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId('route-location')).toHaveTextContent(`section=${section}`))
    if (status === 401) expect(session.retryAuth).toHaveBeenCalledOnce()
    expect(workflow.handleDownloadMAA).not.toHaveBeenCalled()
    expect(workflow.handleGenerate).not.toHaveBeenCalled()
  })

  it('keeps failures attached to their original saved result when another result opens', async () => {
    const workflow = connect()
    workflow.exportFailure = { format: 'maa', resultId: 'another-result', error: new Error('另一份结果失败') }
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: copy.v2.export }))
    const dialog = within(await screen.findByRole('dialog', { name: copy.v2.exportTitle }))
    expect(dialog.queryByRole('alert')).not.toBeInTheDocument()
  })

  it.each(['service', 'permission', 'analysis', 'preview'] as const)('keeps complete calculation exports gated by %s', async (restriction) => {
    const workflow = connect()
    if (restriction === 'service') mocks.features.mockReturnValue({ status: 'ready', features: { ...DEFAULT_SITE_FEATURES, full_result_export: false }, retry: vi.fn() })
    if (restriction === 'permission') workflow.userCanDownloadFullResult = false
    if (restriction === 'analysis') workflow.userCanViewFullData = false
    if (restriction === 'preview') workflow.historyItem = { result: { ...SAMPLE_RESULT, preview_limit: { room_limit: 1, hidden_room_count: 1, notice: 'Preview' } } }
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: copy.v2.export }))
    const dialog = within(await screen.findByRole('dialog', { name: copy.v2.exportTitle }))
    expect(dialog.queryByRole('button', { name: copy.domain.components_result_panel_ResultPanel_039 })).not.toBeInTheDocument()
    expect(dialog.getByRole('button', { name: copy.domain.result_image.current })).toBeEnabled()
    expect(workflow.handleDownloadFullResult).not.toHaveBeenCalled()
  })

  it('keeps image exports and execution guidance available when MAA export is unavailable', async () => {
    const workflow = connect()
    workflow.historyItem = { result: { ...SAMPLE_RESULT, schedule_mode: 'rotation' } }
    const user = userEvent.setup()
    const page = mount()
    await user.click(screen.getByRole('button', { name: copy.v2.export }))
    const dialog = within(await screen.findByRole('dialog', { name: copy.v2.exportTitle }))
    expect(dialog.getByRole('button', { name: copy.v2.exportMaa })).toBeDisabled()
    expect(dialog.getByText(copy.optimize.maa_export.rotation)).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: copy.domain.result_image.all })).toBeEnabled()
    expect(dialog.getByText(copy.domain.components_result_panel_Guides_001)).toBeInTheDocument()
    mocks.features.mockReturnValue({ status: 'ready', features: { ...DEFAULT_SITE_FEATURES, maa_export: false }, retry: vi.fn() })
    page.rerender(<MemoryRouter initialEntries={['/v2']}><V2Page /><RouteLocation /></MemoryRouter>)
    expect(dialog.queryByRole('button', { name: copy.v2.exportMaa })).not.toBeInTheDocument()
    expect(workflow.handleDownloadMAA).not.toHaveBeenCalled()
  })

  it('retries failed image exports and locks concurrent downloads without losing the selected shift', async () => {
    connect()
    mocks.image.mockRejectedValueOnce(new Error('Canvas unavailable'))
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('tab', { name: /第2班/ }))
    await user.click(screen.getByRole('button', { name: copy.v2.export }))
    const dialog = within(await screen.findByRole('dialog', { name: copy.v2.exportTitle }))
    const current = dialog.getByRole('button', { name: copy.domain.result_image.current })
    const all = dialog.getByRole('button', { name: copy.domain.result_image.all })
    await user.click(current)
    expect(await dialog.findByRole('alert')).toHaveTextContent(copy.v2.exportImageCanvasFailed)
    expect(dialog.getByRole('alert')).toHaveTextContent(copy.v2.exportImageHelp)
    expect(mocks.image).toHaveBeenCalledWith(expect.objectContaining({ version: 'v2', planIndex: 1, isRotationMode: false }))
    let finish!: () => void
    mocks.image.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    await user.click(dialog.getByRole('button', { name: copy.v2.exportRetry }))
    expect(current).toBeDisabled()
    expect(all).toBeDisabled()
    expect(dialog.getByText(copy.domain.result_image.busy)).toHaveAttribute('role', 'status')
    await user.click(all)
    expect(mocks.image).toHaveBeenCalledTimes(2)
    await act(async () => { finish() })
    await waitFor(() => expect(all).toBeEnabled())
    expect(dialog.queryByRole('alert')).not.toBeInTheDocument()
    await user.click(all)
    expect(mocks.image).toHaveBeenLastCalledWith(expect.objectContaining({ planIndex: undefined }))
  })

  it('rejects malformed operator fields without replacing the currently displayed data', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: copy.v2.operators }))
    const dialog = await screen.findByRole('dialog')
    const input = within(dialog).getByLabelText(copy.v2.uploadMaa)
    const file = new File([JSON.stringify([{ ...SAMPLE_OPERATORS[0], name: 123 }])], 'operators.json', { type: 'application/json' })
    Object.defineProperty(file, 'text', { value: async () => JSON.stringify([{ ...SAMPLE_OPERATORS[0], name: 123 }]) })
    await user.upload(input, file)
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(copy.v2.uploadFailed)
    expect(within(dialog).getByText(SAMPLE_OPERATORS[0].name)).toBeInTheDocument()
    expect(session.persistWorkspacePatch).not.toHaveBeenCalled()
    expect(mocks.workflow).not.toHaveBeenCalled()
  })

  it('imports valid operator data with additional metadata without running a calculation', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: copy.v2.operators }))
    const dialog = await screen.findByRole('dialog')
    const json = JSON.stringify([{ ...SAMPLE_OPERATORS[0], importedFrom: 'maa' }])
    const file = new File([json], 'operators.json', { type: 'application/json' })
    Object.defineProperty(file, 'text', { value: async () => json })
    await user.upload(within(dialog).getByLabelText(copy.v2.uploadMaa), file)
    expect(await within(dialog).findByRole('status')).toBeInTheDocument()
    expect(within(dialog).getByText(SAMPLE_OPERATORS[0].name)).toBeInTheDocument()
    expect(within(dialog).queryByText(SAMPLE_OPERATORS[1].name)).not.toBeInTheDocument()
    expect(session.persistWorkspacePatch).not.toHaveBeenCalled()
    expect(mocks.workflow).not.toHaveBeenCalled()
    await dismissDrawer(user)
    expect(screen.getByRole('status')).toHaveTextContent(copy.v2.demoConfigChanged)
  })

  it('keeps sample operator data read-only when searching and leaves the result unchanged', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: copy.v2.operators }))
    const dialog = await screen.findByRole('dialog')
    const search = within(dialog).getByRole('textbox', { name: copy.v2.searchOperators })
    await user.type(search, '但书')
    expect(search).toHaveFocus()
    expect(within(dialog).getByText('但书')).toBeInTheDocument()
    expect(within(dialog).queryByText('推进之王')).not.toBeInTheDocument()
    expect(within(dialog).getByText(copy.v2.ownedLabel)).toBeInTheDocument()
    expect(within(dialog).getByText(copy.v2.elite(2))).toBeInTheDocument()
    expect(within(dialog).getByText(copy.v2.operatorLevel())).toBeInTheDocument()
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument()
    await user.tab()
    expect(within(dialog).getByText(copy.domain.building_skills.title).closest('summary')).toHaveFocus()
    await dismissDrawer(user)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: copy.v2.lmd })).getByText('53,595')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /第1班/ })).toBeInTheDocument()
    expect(session.persistWorkspacePatch).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: copy.v2.generateMine }))
    expect(await screen.findByText(copy.v2.generationSignIn)).toBeVisible()
    expect(screen.getByTestId('route-location')).toHaveTextContent('section=generation')
    expect(mocks.workflow).not.toHaveBeenCalled()
  })

  it('opens an existing personal result automatically but submits no new calculation on entry', async () => {
    const workflow = connect()
    mount()
    await waitFor(() => expect(workflow.handleViewHistory).toHaveBeenCalledOnce())
    expect(workflow.handleViewHistory).toHaveBeenCalledWith(summary)
    expect(screen.getByText(copy.v2.ownSource)).toBeInTheDocument()
    expect(workflow.handleGenerate).not.toHaveBeenCalled()
  })

  it('lets a CDK profile generate without displaying or depending on a legacy billing quote', async () => {
    const workflow = connect()
    const user = userEvent.setup()
    workflow.billingQuoteLoading = true
    workflow.billingQuote = { charge: '3', available: '2', tier: null, sufficient: false }
    mount()
    await waitFor(() => expect(workflow.handleViewHistory).toHaveBeenCalledOnce())
    expect(screen.queryByText(/积分/)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: copy.metered.quote.go_to_balance })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: copy.v2.regenerate })).not.toBeDisabled()
    await user.click(screen.getByRole('button', { name: copy.v2.regenerate }))
    await waitFor(() => expect(workflow.handleGenerate).toHaveBeenCalledOnce())
    expect(workflow.refreshBillingQuote).not.toHaveBeenCalled()
  })

  it.each(['metered_personal', 'metered_commercial'] as const)('does not connect the scheduler or list a retired %s profile', async (kind) => {
    const workflow = connect()
    session.activeProfile!.kind = kind
    session.activeProfile!.display_name = 'Retired profile'
    const user = userEvent.setup()
    mount()
    expect(screen.getByText(copy.v2.sampleSource)).toBeInTheDocument()
    expect(mocks.workflow).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Retired profile' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: /Retired profile/ })).not.toBeInTheDocument()
    expect(within(dialog).getByText(copy.v2.noProfiles)).toBeInTheDocument()
    expect(workflow.handleGenerate).not.toHaveBeenCalled()
  })

  it('shows workflow validation errors on the page and inside the configuration drawer', async () => {
    const workflow = connect()
    workflow.configToast = { message: 'Invalid schedule configuration' }
    const user = userEvent.setup()
    mount()
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid schedule configuration')
    await user.click(screen.getByRole('button', { name: copy.v2.facilities }))
    expect(within(await screen.findByRole('dialog')).getByRole('alert')).toHaveTextContent('Invalid schedule configuration')
    expect(workflow.handleGenerate).not.toHaveBeenCalled()
  })

  it('keeps incomplete configuration feedback in the drawer without a validation toast', async () => {
    const workflow = connect()
    workflow.activeConfig = normalizeConfig(SAMPLE_CONFIG)
    workflow.activeConfig.product_requirements.manufacturing_stations['Pure Gold'] += 1
    workflow.configValidation = validateScheduleConfig(workflow.activeConfig)
    if (workflow.configValidation.ok) throw new Error('Expected an incomplete configuration')
    const message = workflow.configValidation.message
    workflow.configToast = { message }
    session.configSyncStatus = 'pending'
    const user = userEvent.setup()
    mount()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: copy.v2.facilities }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(message)).toHaveAttribute('role', 'status')
    expect(within(dialog).getAllByText(message)).toHaveLength(1)
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(dialog).queryByText(copy.v2.saveFailed)).not.toBeInTheDocument()
    expect(within(dialog).queryByText(copy.workspace.config_save_pending)).not.toBeInTheDocument()
  })

  it('retains the save retry action in the configuration drawer after a request failure', async () => {
    connect()
    session.configSyncStatus = 'failed'
    const user = userEvent.setup()
    mount('/v2?panel=config')
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: copy.workspace.config_save_failed_short }))
    expect(session.retryConfigSave).toHaveBeenCalledOnce()
  })

  it('requires layout confirmation before completing configuration', async () => {
    const user = userEvent.setup()
    mount('/v2?panel=config')
    const dialog = within(await screen.findByRole('dialog'))
    await user.click(dialog.getByRole('button', { name: copy.common.components_ConfigEditor_103 }))
    const done = dialog.getByRole('button', { name: copy.v2.done })
    expect(done).toHaveAttribute('aria-disabled', 'true')
    expect(dialog.getByText(copy.common.facilityLayoutRequired)).toBeInTheDocument()
    await user.click(done)
    expect(screen.getByRole('alert')).toHaveTextContent(copy.common.facilityLayoutRequired)
    await user.keyboard('{Escape}')
    expect(done).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('alert')).toHaveTextContent(copy.common.facilityLayoutRequired)
    await user.keyboard('{Escape}')
    await user.click(dialog.getByRole('button', { name: copy.common.facilityLayoutConfirm }))
    expect(done).toHaveAttribute('aria-disabled', 'true')
    await user.click(dialog.getByRole('button', { name: copy.common.facilityLayoutConfirmCollapse }))
    expect(done).toHaveAttribute('aria-disabled', 'false')
    expect(dialog.queryByText(copy.common.facilityLayoutRequired)).not.toBeInTheDocument()
    await user.click(dialog.getByRole('button', { name: copy.common.facilityLayoutEdit }))
    expect(done).toHaveAttribute('aria-disabled', 'true')
    await user.click(dialog.getByRole('tab', { name: copy.v2.configEditor.common }))
    await user.click(dialog.getByRole('button', { name: '243 均衡' }))
    expect(done).toHaveAttribute('aria-disabled', 'false')
    await user.click(done)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('writes the successfully selected profile into the route for refresh restoration', async () => {
    connect()
    const second = { ...session.activeProfile!, id: 'profile-2', display_name: 'Second Doctor' }
    session.cdkProfiles.push(second)
    vi.mocked(session.refreshProfileWorkspace).mockResolvedValue(true)
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: /My Doctor/ }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Second Doctor/ }))
    await waitFor(() => expect(screen.getByTestId('route-location')).toHaveTextContent('profile_id=profile-2'))
    expect(session.flushConfigSave).toHaveBeenCalledOnce()
    expect(session.refreshProfileWorkspace).toHaveBeenCalledWith(second)
    expect(mocks.session).toHaveBeenLastCalledWith('profile-2', true, true)
  })

  it.each(['overview', 'generation'])('cancels the current job from %s through the existing task controller while retaining the result', async (section) => {
    const workflow = connect()
    workflow.loading = true
    workflow.progress = { mode: 'generate', startedAt: Date.now(), jobId: 'running-job', estimatePhase: 'running' }
    const job = { id: 'running-job', canCancel: true, cancellationRequested: false }
    const cancel = vi.fn(async () => undefined)
    mocks.tasks.mockReturnValue({ jobs: [job], cancel, busyJobId: null, error: null, notice: null })
    const user = userEvent.setup()
    const view = mount(`/v2?section=${section}`)
    await act(async () => { await vi.dynamicImportSettled() })
    const progress = within(await screen.findByRole('region', { name: copy.common.components_ScheduleProgress_001 }))
    await user.click(progress.getByRole('button', { name: copy.v2.stopSchedule }))
    expect(cancel).toHaveBeenCalledWith(job)
    mocks.tasks.mockReturnValue({ jobs: [job], cancel, busyJobId: job.id, error: null, notice: null })
    view.rerender(<MemoryRouter initialEntries={[`/v2?section=${section}`]}><V2Page /><RouteLocation /></MemoryRouter>)
    const stopping = screen.getByRole('button', { name: copy.v2.stopping })
    expect(stopping).toBeDisabled()
    expect(stopping).toHaveAttribute('aria-busy', 'true')
    await user.click(stopping)
    expect(cancel).toHaveBeenCalledOnce()
    if (section === 'generation') await user.click(screen.getByRole('button', { name: copy.v2.overview }))
    await waitFor(() => expect(within(screen.getByRole('region', { name: copy.v2.lmd })).getByText('53,595')).toBeInTheDocument())
    expect(workflow.handleGenerate).not.toHaveBeenCalled()
  })

  it('retains the last personal result while generating instead of replacing it with demo data', async () => {
    const workflow = connect()
    workflow.historyItem = { result: { ...SAMPLE_RESULT, daily_production: { trading: { LMD: 12345 } } } }
    const { rerender } = mount()
    await waitFor(() => expect(workflow.handleViewHistory).toHaveBeenCalledOnce())
    expect(within(screen.getByRole('region', { name: copy.v2.lmd })).getByText('12,345')).toBeInTheDocument()
    workflow.historyItem = null as unknown as typeof workflow.historyItem
    workflow.loading = true
    await act(async () => rerender(<MemoryRouter initialEntries={['/v2']}><V2Page /></MemoryRouter>))
    expect(within(screen.getByRole('region', { name: copy.v2.lmd })).getByText('12,345')).toBeInTheDocument()
    expect(screen.queryByText(copy.v2.sampleSource)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: copy.v2.generating })).toBeDisabled()
  })

  it('shows personal ownership, elite stages and levels without allowing manual edits', async () => {
    const workflow = connect()
    workflow.mergedOperators = [
      { ...SAMPLE_OPERATORS[0], own: true, elite: 2, level: 90 },
      { ...SAMPLE_OPERATORS[1], own: false, elite: 0, level: 0 },
    ]
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: copy.v2.operators }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(copy.v2.operatorDescription)).toBeInTheDocument()
    expect(within(dialog).getByText(copy.v2.ownedLabel)).toBeInTheDocument()
    expect(within(dialog).getByText(copy.v2.notOwnedLabel)).toBeInTheDocument()
    expect(within(dialog).getByText(copy.v2.elite(2))).toBeInTheDocument()
    expect(within(dialog).getByText(copy.v2.elite(0))).toBeInTheDocument()
    expect(within(dialog).getByText(copy.v2.operatorLevel(90))).toBeInTheDocument()
    expect(within(dialog).getByText(copy.v2.operatorLevel(0))).toBeInTheDocument()
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument()
    await user.type(within(dialog).getByRole('textbox', { name: copy.v2.searchOperators }), 'danshu')
    expect(within(dialog).getByText('但书')).toBeInTheDocument()
    expect(within(dialog).queryByText('推进之王')).not.toBeInTheDocument()
    expect(session.persistWorkspacePatch).not.toHaveBeenCalled()
    expect(workflow.handleGenerate).not.toHaveBeenCalled()
    await dismissDrawer(user)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('imports personal operators through workspace validation without triggering calculation and clears obsolete elite overrides', async () => {
    const workflow = connect()
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: copy.v2.operators }))
    const dialog = await screen.findByRole('dialog')
    const operators = SAMPLE_OPERATORS.map((operator) => operator.name === '但书' ? { ...operator, elite: 1 } : operator)
    const json = JSON.stringify(operators)
    const file = new File([json], 'operators.json', { type: 'application/json' })
    Object.defineProperty(file, 'text', { value: async () => json })
    await user.upload(within(dialog).getByLabelText(copy.v2.uploadMaa), file)
    expect(await within(dialog).findByRole('status')).toHaveTextContent(copy.v2.importSuccess)
    await waitFor(() => expect(session.persistWorkspacePatch).toHaveBeenCalledWith({
      operators,
      elite_overrides: {},
    }))
    expect(session.flushConfigSave).toHaveBeenCalledOnce()
    expect(vi.mocked(session.flushConfigSave).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(session.persistWorkspacePatch).mock.invocationCallOrder[0])
    expect(workflow.handleGenerate).not.toHaveBeenCalled()
    await dismissDrawer(user)
    expect(screen.getByRole('status')).toHaveTextContent(copy.v2.configChanged)
  })

  it('keeps personal operator data and the result unchanged when import is rejected by risk control', async () => {
    const workflow = connect()
    const user = userEvent.setup()
    vi.mocked(session.persistWorkspacePatch).mockRejectedValueOnce(new Error('干员数据异常，请核对当前游戏账号后重新导入。'))
    mount()
    await user.click(screen.getByRole('button', { name: copy.v2.operators }))
    const dialog = await screen.findByRole('dialog')
    const json = JSON.stringify([{ ...SAMPLE_OPERATORS[0], own: false, elite: 0 }])
    const file = new File([json], 'operators.json', { type: 'application/json' })
    Object.defineProperty(file, 'text', { value: async () => json })
    await user.upload(within(dialog).getByLabelText(copy.v2.uploadMaa), file)
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('干员数据异常，请核对当前游戏账号后重新导入。')
    expect(within(dialog).queryByRole('status')).not.toBeInTheDocument()
    await user.type(within(dialog).getByRole('textbox', { name: copy.v2.searchOperators }), 'danshu')
    expect(within(dialog).getByText(copy.v2.ownedLabel)).toBeInTheDocument()
    expect(within(dialog).getByText(copy.v2.elite(2))).toBeInTheDocument()
    expect(workflow.handleGenerate).not.toHaveBeenCalled()
    await dismissDrawer(user)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: copy.v2.lmd })).getByText('53,595')).toBeInTheDocument()
  })

  it('passes configuration edits through the existing workflow without automatically generating', async () => {
    const workflow = connect()
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: copy.v2.facilities }))
    const dialog = await screen.findByRole('dialog')
    await user.click(await within(dialog).findByRole('button', { name: copy.common.components_ConfigEditor_007 }))
    expect(workflow.updateConfig).toHaveBeenCalledOnce()
    const draft = normalizeConfig(SAMPLE_CONFIG)
    workflow.updateConfig.mock.calls[0][0](draft)
    expect(draft.schedule_mode).toBe('rotation')
    expect(workflow.handleGenerate).not.toHaveBeenCalled()
  })

  it('keeps free preset controls while preventing custom configuration and calculation detail access', async () => {
    const workflow = connect()
    session.activeProfile!.kind = 'free_preview'
    workflow.permission = 'growth'
    workflow.userCanEditConfig = false
    workflow.userCanViewFullData = false
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: copy.v2.facilities }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByRole('button', { name: '243 均衡' })).not.toBeDisabled()
    expect(within(dialog).queryByRole('spinbutton', { name: /贸易站/ })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('switch', { name: /菲亚梅塔/ })).not.toBeInTheDocument()
    await dismissDrawer(user)
    expect(within(screen.getByRole('region', { name: copy.v2.lmd })).getByText('53,595')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: copy.v2.analysisTab }))
    expect(await screen.findByText(copy.v2.previewAnalysis)).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: copy.v2.sanityCalculation })).not.toBeInTheDocument()
  })

  it.each([false, true])('uses effective trial access in the fallback workspace (trial: %s)', async (trial) => {
    connect()
    session.license = null
    session.activeProfile!.kind = 'free_preview'
    session.activeProfile!.permission = 'growth'
    session.activeProfile!.trial = trial ? {
      id: 'trial', starts_at: new Date(Date.now() - 86400000).toISOString(), ends_at: new Date(Date.now() + 30 * 86400000).toISOString(),
      active: true, effective_permission: 'advanced',
    } : null
    const user = userEvent.setup()
    mount()
    await user.click(await screen.findByRole('button', { name: copy.v2.facilities }))
    const dialog = within(await screen.findByRole('dialog'))
    expect(await dialog.findByRole('button', { name: '243 均衡' })).not.toBeDisabled()
    await user.click(dialog.getByRole('tab', { name: copy.v2.configEditor.strategy }))
    if (trial) expect(dialog.getByRole('switch', { name: /^菲亚梅塔$/ })).not.toBeDisabled()
    else expect(dialog.getByRole('switch', { name: /^菲亚梅塔$/ })).toBeDisabled()
    expect(session.setConfigOverride).not.toHaveBeenCalled()
    expect(session.persistWorkspacePatch).not.toHaveBeenCalled()
    await dismissDrawer(user)
    await user.click(screen.getByRole('button', { name: copy.v2.analysisTab }))
    if (trial) expect(screen.getByRole('region', { name: copy.v2.sanityCalculation })).toBeInTheDocument()
    else expect(screen.queryByRole('region', { name: copy.v2.sanityCalculation })).not.toBeInTheDocument()
    expect(mocks.workflow).not.toHaveBeenCalled()
  })

  it('shows orundum and shards in free aggregate output while keeping precise calculations gated', async () => {
    const workflow = connect()
    workflow.userCanViewFullData = false
    workflow.activeConfig = normalizeConfig(CONFIG_PRESETS['243-1'])
    workflow.historyItem = { result: { ...SAMPLE_RESULT, daily_production: {
      manufacturing: { 'Originium Shard': 41.25 }, trading: { Orundum: 103.5 },
    } } }
    const user = userEvent.setup()
    const page = mount()
    expect(screen.getByRole('region', { name: copy.v2.orundum })).toHaveTextContent(`103.5${copy.v2.daily}`)
    expect(screen.getByRole('region', { name: copy.v2.orundum }).querySelector('img')).toHaveAttribute('src', '/assets/products/DIAMOND_SHD.png')
    expect(screen.queryByRole('region', { name: copy.v2.exp })).not.toBeInTheDocument()
    expect(document.querySelectorAll('.v2-metrics section')[3]).toBe(screen.getByRole('region', { name: copy.v2.shortTermPulls }))
    expect(screen.getByRole('region', { name: copy.v2.shortTermPulls })).toHaveTextContent(`5.2${copy.v2.pullsPer30Days}`)
    expect(screen.queryByRole('region', { name: copy.v2.sanity })).not.toBeInTheDocument()
    const panel = within(screen.getByRole('heading', { name: copy.v2.dailyOutput }).closest('section')!)
    expect(panel.getByText('合成玉')).toBeInTheDocument()
    expect(panel.getByText('103.5')).toBeInTheDocument()
    expect(panel.getByText('源石碎片')).toBeInTheDocument()
    workflow.historyItem = { result: { ...SAMPLE_RESULT, daily_production: {
      manufacturing: { 'Originium Shard': 41.25, 'Battle Record': 1 }, trading: { Orundum: 103.5 },
    } } }
    page.rerender(<MemoryRouter initialEntries={['/v2']}><V2Page /><RouteLocation /></MemoryRouter>)
    expect(screen.getByRole('region', { name: copy.v2.exp })).toHaveTextContent(`1,000${copy.v2.expUnit}`)
    expect(screen.queryByRole('region', { name: copy.v2.orundum })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: copy.v2.shortTermPulls })).toHaveTextContent(`5.2${copy.v2.pullsPer30Days}`)
    expect(within(screen.getByRole('heading', { name: copy.v2.dailyOutput }).closest('section')!).getByText('103.5')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: copy.v2.analysisTab }))
    expect(screen.queryByRole('region', { name: copy.v2.sanityCalculation })).not.toBeInTheDocument()
  })
})

function ManualDraftStub({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const [draft, setDraft] = useState('original')
  return <button type="button" onClick={() => { setDraft('edited'); onDirtyChange(true) }}>Edit draft: {draft}</button>
}

describe('V2 feature continuity', () => {
  it('keeps the navigation and main loading animation until inventory data arrives', async () => {
    connect()
    let finishInventory!: (response: Response) => void
    const inventory = new Promise<Response>((resolve) => { finishInventory = resolve })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => String(url) === '/api/user/inventory' ? inventory
      : new Response(JSON.stringify({ tasks: [], notifications: [], unread_count: 0, next_cursor: null }), { status: 200 }))
    const user = userEvent.setup()
    mount()
    const navigation = screen.getByRole('navigation', { name: copy.v2.navigation })
    const topbar = document.querySelector('.v2-topbar')
    const main = screen.getByRole('main')
    await user.click(screen.getByRole('button', { name: copy.inventory.nav }))
    const loading = await screen.findByRole('status', { name: copy.inventory.loading })
    expect(loading).toHaveAttribute('aria-busy', 'true')
    expect(loading.closest('main')).toBe(main)
    expect(screen.getByRole('navigation', { name: copy.v2.navigation })).toBe(navigation)
    expect(document.querySelector('.v2-topbar')).toBe(topbar)
    expect(screen.queryByRole('heading', { name: copy.inventory.title, level: 2 })).not.toBeInTheDocument()

    await act(async () => { finishInventory(new Response(JSON.stringify({ stacks: [], capacities: [], recent_events: [] }), { status: 200 })) })
    expect(await screen.findByRole('heading', { name: copy.inventory.title, level: 2 })).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: copy.inventory.loading })).not.toBeInTheDocument()
  })

  it('retains manual changes across tabs and pages and uses the selected history baseline', async () => {
    const workflow = connect()
    const baseline = normalizeConfig({ ...SAMPLE_CONFIG, desc: 'saved baseline' })
    Object.assign(workflow.historyItem, { id: summary.id, config: baseline })
    mocks.manual.mockImplementation(ManualDraftStub)
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: copy.v2.manualTab }))
    const edit = await screen.findByRole('button', { name: 'Edit draft: original' })
    expect(document.querySelector('.v2-result-view')).not.toBeVisible()
    await user.click(edit)
    expect(mocks.manual.mock.calls[mocks.manual.mock.calls.length - 1]?.[0]).toMatchObject({ profileId: 'profile-1', simulationBaseline: { id: summary.id, config: baseline } })
    await user.click(screen.getByRole('button', { name: copy.v2.tools }))
    expect(await screen.findByRole('link', { name: new RegExp(copy.tools.manualSchedule.title) })).toHaveAttribute('href', '/v2?section=manual-tool&profile_id=profile-1')
    await user.click(screen.getByRole('button', { name: copy.v2.overview }))
    expect(await screen.findByRole('button', { name: 'Edit draft: edited' })).toBe(edit)
    await user.click(screen.getByRole('button', { name: copy.v2.scheduleTab }))
    expect(document.querySelector('.v2-result-view')).toBeVisible()
    await user.click(screen.getByRole('button', { name: copy.v2.manualTab }))
    expect(screen.getByRole('button', { name: 'Edit draft: edited' })).toBe(edit)
    expect(session.persistWorkspacePatch).not.toHaveBeenCalled()
  })

  it('blocks profile switching when configuration cannot be saved', async () => {
    connect()
    const next = { ...session.activeProfile!, id: 'profile-2', display_name: 'Second Doctor' }
    session.cdkProfiles.push(next)
    vi.mocked(session.flushConfigSave).mockResolvedValue(false)
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: /My Doctor/ }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Second Doctor/ }))
    expect(session.refreshProfileWorkspace).not.toHaveBeenCalled()
    expect(screen.getByTestId('route-location')).not.toHaveTextContent('profile_id=profile-2')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('requires confirmation before replacing unsaved manual changes', async () => {
    const workflow = connect()
    mocks.manual.mockImplementation(ManualDraftStub)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: copy.v2.manualTab }))
    await user.click(await screen.findByRole('button', { name: 'Edit draft: original' }))
    await user.click(screen.getByRole('button', { name: copy.v2.regenerate }))
    expect(confirm).toHaveBeenCalledWith(copy.v2.discardManual)
    expect(workflow.handleGenerate).not.toHaveBeenCalled()
    await user.click(screen.getByRole('link', { name: copy.v2.legacyEntry }))
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(session.flushConfigSave).not.toHaveBeenCalled()
    expect(screen.getByTestId('route-location')).toHaveAttribute('data-pathname', '/v2')
    confirm.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: copy.v2.regenerate }))
    expect(workflow.handleGenerate).toHaveBeenCalledOnce()
  })

  it('protects a manual result draft when generation is started from the full generation page', async () => {
    const workflow = connect()
    mocks.manual.mockImplementation(ManualDraftStub)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: copy.v2.manualTab }))
    await user.click(await screen.findByRole('button', { name: 'Edit draft: original' }))
    await user.click(screen.getByRole('button', { name: copy.v2.generation }))
    await user.click(await screen.findByRole('button', { name: copy.optimize.pages_tool_optimize_GenerateControlBar_029 }, { timeout: 3000 }))
    expect(confirm).toHaveBeenCalledWith(copy.v2.discardManual)
    expect(workflow.handleGenerate).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: copy.v2.overview }))
    expect(await screen.findByRole('button', { name: 'Edit draft: edited' })).toBeInTheDocument()
  })

  it('keeps free-preview upload and manual-edit restrictions while allowing the standalone tool', async () => {
    const workflow = connect()
    session.activeProfile = { ...session.activeProfile!, kind: 'free_preview', permission: 'growth' }
    workflow.permission = 'growth'
    workflow.userCanEditConfig = false
    workflow.userCanUseUpgradeFeatures = false
    workflow.activeConfig = normalizeConfig({ ...SAMPLE_CONFIG, schedule_mode: 'maa' })
    mocks.manual.mockClear()
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: copy.v2.manualTab }))
    expect(screen.getByRole('button', { name: copy.v2.manualTab })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(copy.optimize.paid_preview.manual_description)).toBeInTheDocument()
    expect(document.querySelector('[data-locked-capability-preview]')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('link', { name: copy.optimize.pages_tool_optimize_ResultSection_018 })).toHaveAttribute('href', '/v2?section=pricing&profile_id=profile-1')
    expect(screen.getByRole('link', { name: copy.optimize.pages_tool_optimize_ResultSection_019 })).toHaveAttribute('href', '/v2?section=add-account&profile_id=profile-1')
    expect(mocks.manual).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: copy.v2.trainingTab }))
    expect(screen.getByRole('button', { name: copy.v2.trainingTab })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(copy.optimize.pages_tool_optimize_ResultSection_017)).toBeInTheDocument()
    expect(workflow.handleGenerate).not.toHaveBeenCalled()
    expect(workflow.updateConfig).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: copy.v2.operators }))
    const dialog = within(await screen.findByRole('dialog'))
    expect(dialog.getByRole('button', { name: copy.v2.operatorManagement.chooseFile })).toBeDisabled()
    expect(dialog.getByText(copy.v2.operatorManagement.previewImport)).toBeInTheDocument()
    await dismissDrawer(user)
    await user.click(screen.getByRole('button', { name: copy.v2.facilities }))
    const configDialog = within(await screen.findByRole('dialog'))
    expect(configDialog.getByText(/当前为 免费预览 权限/)).toBeInTheDocument()
    expect(configDialog.queryByText(/当前为 练度提升卡 权限/)).not.toBeInTheDocument()
    const fixedHours = configDialog.getByRole('combobox', { name: copy.v2.configShiftFrequency })
    expect(fixedHours).toBeEnabled()
    expect(configDialog.getByRole('option', { name: copy.common.components_ConfigEditor_091 })).toBeDisabled()
    await user.selectOptions(fixedHours, '12x3')
    expect(workflow.updateConfig).toHaveBeenCalledOnce()
    await dismissDrawer(user)
    await user.click(screen.getByRole('button', { name: copy.v2.tools }))
    expect(await screen.findByRole('link', { name: new RegExp(copy.tools.manualSchedule.title) })).toHaveAttribute('href', expect.stringContaining('section=manual-tool'))
  })

  it('returns from pricing to generation while retaining the active profile without submitting a task', async () => {
    const workflow = connect()
    const user = userEvent.setup()
    mount()
    const footer = within(document.querySelector('footer.v2-footer')!)
    await user.click(footer.getByRole('link', { name: copy.v2.comparePlans }))
    expect(await screen.findByRole('heading', { name: cloneDefaultPublicContentSettings().pricing.title, level: 1 })).toBeInTheDocument()
    expect(screen.getByTestId('route-location')).toHaveTextContent('section=pricing&profile_id=profile-1')
    expect(footer.getByRole('link', { name: copy.v2.comparePlans })).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: copy.public.pricing_choice.free_action }))
    expect(await screen.findByRole('heading', { name: copy.v2.generation, level: 1 })).toBeInTheDocument()
    expect(screen.getByTestId('route-location')).toHaveTextContent('section=generation&profile_id=profile-1')
    expect(workflow.handleGenerate).not.toHaveBeenCalled()
  })

  it.each(['free_preview', 'skland', 'schedule_generation'] as const)('disables free start on pricing when %s is closed', async (feature) => {
    mocks.features.mockReturnValue({ status: 'ready', features: { ...DEFAULT_SITE_FEATURES, [feature]: false }, retry: vi.fn() })
    mount('/v2?section=pricing')
    expect(await screen.findByRole('button', { name: copy.public.pricing_choice.free_unavailable })).toBeDisabled()
    expect(screen.queryByRole('link', { name: copy.public.pricing_choice.free_action })).not.toBeInTheDocument()
  })

  it('uses configured purchase links after public content loads in the V2 pricing workspace', async () => {
    const content = cloneDefaultPublicContentSettings()
    content.pricing.plans.single_account_monthly.purchase_url = 'https://example.com/monthly'
    content.pricing.plans.single_account_lifetime.purchase_url = 'https://example.com/lifetime'
    content.pricing.lifetime_upgrade.purchase_url = 'https://example.com/upgrade'
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(content), { headers: { 'Content-Type': 'application/json' } }))
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/v2?section=pricing']}><PublicContentProvider><V2Page /></PublicContentProvider></MemoryRouter>, { wrapper: MotionPreferenceProvider })
    const monthly = await screen.findByRole('link', { name: copy.public.pricing_purchase_labels.single_account_monthly })
    expect(monthly).toHaveAttribute('href', 'https://example.com/monthly')
    expect(monthly).toHaveAttribute('target', '_blank')
    expect(monthly).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByRole('link', { name: copy.public.pricing_upgrade_purchase })).toHaveAttribute('href', 'https://example.com/upgrade')
    await user.click(within(screen.getByRole('group', { name: copy.v2.planChoice })).getByRole('button', { name: /终身/ }))
    expect(screen.getByRole('link', { name: copy.public.pricing_purchase_labels.single_account_lifetime })).toHaveAttribute('href', 'https://example.com/lifetime')
    expect(screen.queryByRole('button', { name: copy.public.pricing_purchase_unavailable })).not.toBeInTheDocument()
  })

  it.each([true, false])('opens CDK redemption from pricing and retains the destination through login: signed in %s', async (signedIn) => {
    const guest = session
    const workflow = connect()
    const authenticated = session
    if (!signedIn) session = guest
    const payload = { user: authenticated.user!, profiles: authenticated.profiles, active_profile: authenticated.activeProfile, workspace: null }
    vi.mocked(session.applyAuthPayload).mockImplementation(() => { session = authenticated })
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => Response.json(
      String(url) === '/api/auth/login' ? payload : { notifications: [], unread_count: 0, next_cursor: null },
    ))
    const user = userEvent.setup()
    const page = mount(signedIn ? '/v2?section=pricing&profile_id=profile-1' : '/v2?section=pricing')
    const redemption = await screen.findByRole('link', { name: copy.public.pricing_redemption.action })
    expect(redemption).toHaveAttribute('href', signedIn ? '/v2?section=add-account&profile_id=profile-1&mode=cdk' : '/v2?section=add-account&mode=cdk')
    await user.click(redemption)
    if (!signedIn) {
      const form = within((await screen.findByText(copy.v2.signInRequired)).parentElement!)
      fireEvent.change(form.getByLabelText(copy.auth.components_AuthForm_011), { target: { value: 'doctor@example.test' } })
      fireEvent.change(form.getByLabelText(copy.auth.components_AuthForm_012), { target: { value: 'password123' } })
      await user.click(form.getAllByRole('button', { name: copy.auth.components_AuthForm_020 }).find((button) => button.getAttribute('type') === 'submit')!)
      await waitFor(() => expect(session.applyAuthPayload).toHaveBeenCalledWith(payload))
      page.rerender(<MemoryRouter><V2Page /><RouteLocation /></MemoryRouter>)
    }
    expect(await screen.findByRole('textbox', { name: 'CDK' })).toBeVisible()
    expect(screen.getByRole('button', { name: copy.dashboard.pages_tool_dashboard_RedeemSection_005 })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('route-location')).toHaveTextContent('mode=cdk')
    expect(fetch.mock.calls.some(([url]) => String(url).includes('/cdk/redeem'))).toBe(false)
    expect(workflow.handleGenerate).not.toHaveBeenCalled()
  })

  it('keeps redemption availability separate from purchase availability', async () => {
    mocks.features.mockReturnValue({ status: 'ready', features: { ...DEFAULT_SITE_FEATURES, cdk_redemption: false }, retry: vi.fn() })
    mount('/v2?section=pricing')
    expect(await screen.findByText(copy.public.pricing_redemption.unavailable)).toBeVisible()
    expect(screen.queryByRole('link', { name: copy.public.pricing_redemption.action })).not.toBeInTheDocument()
  })

  it('opens full account settings inside V2 and shares the existing animation preferences', async () => {
    connect()
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: copy.v2.settings }))
    // Cold imports of the lazy settings page can exceed the default 1s wait in CI.
    expect(await screen.findByLabelText(copy.dashboard.pages_tool_dashboard_SettingsSection_018, {}, { timeout: 5_000 })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: copy.dashboard.settings.preferences }))
    expect(screen.getByRole('switch', { name: copy.dashboard.animation.reduce })).toBeInTheDocument()
    expect(screen.queryByText(copy.dashboard.workspace_entry.settings_title)).not.toBeInTheDocument()
    expect(screen.getByTestId('route-location')).toHaveTextContent('section=settings')
    expect(screen.queryByRole('link', { name: '返回 V1' })).not.toBeInTheDocument()
  }, 10_000)

  it('prefers free account binding while retaining CDK redemption inside V2', async () => {
    connect()
    const user = userEvent.setup()
    mount('/v2?section=add-account')
    const preview = await screen.findByRole('button', { name: copy.dashboard.pages_tool_dashboard_RedeemSection_006 }, { timeout: 3000 })
    expect(preview).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: copy.dashboard.pages_tool_dashboard_RedeemSection_005 }))
    expect(screen.getByRole('textbox', { name: 'CDK' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /邀请有礼/ })).not.toBeInTheDocument()
    expect(session.applyAuthPayload).not.toHaveBeenCalled()
  })

  it.each(['switch', 'keep-draft', 'save-failed'])('uses the resulting account ID and protects the current workspace after adding an account: %s', async (mode) => {
    connect()
    mocks.manual.mockImplementation(ManualDraftStub)
    vi.spyOn(window, 'confirm').mockReturnValue(mode !== 'keep-draft')
    vi.mocked(session.flushConfigSave).mockResolvedValue(mode !== 'save-failed')
    const next = { ...session.activeProfile!, id: 'added-profile', display_name: 'New Doctor' }
    const payload = { user: session.user!, profiles: [...session.profiles, next], active_profile: next, workspace: { ...session.workspace, profile_id: next.id } }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => new Response(JSON.stringify(String(url) === '/api/user/cdk/redeem' ? { redemption_type: 'profile', auth: payload } : { notifications: [], unread_count: 0, next_cursor: null }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: copy.v2.manualTab }))
    await user.click(await screen.findByRole('button', { name: 'Edit draft: original' }))
    await user.click(screen.getByRole('button', { name: copy.v2.account }))
    await user.click(await screen.findByRole('button', { name: copy.v2.addAccount }))
    await user.click(await screen.findByRole('button', { name: copy.dashboard.pages_tool_dashboard_RedeemSection_005 }))
    fireEvent.change(screen.getByRole('textbox', { name: 'CDK' }), { target: { value: 'MAA-NEW-ACCOUNT' } })
    await user.click(screen.getByRole('button', { name: copy.dashboard.pages_tool_dashboard_RedeemSection_015 }))
    await waitFor(() => expect(session.applyAuthPayload).toHaveBeenCalledOnce())
    const expectedProfile = mode === 'switch' ? next : session.activeProfile
    expect(session.applyAuthPayload).toHaveBeenCalledWith(expect.objectContaining({ active_profile: expectedProfile, profiles: payload.profiles }))
    await waitFor(() => expect(screen.getByTestId('route-location')).toHaveTextContent(`profile_id=${expectedProfile!.id}`))
    if (mode !== 'switch') {
      await user.click(screen.getByRole('button', { name: copy.v2.overview }))
      expect(await screen.findByRole('button', { name: 'Edit draft: edited' })).toBeInTheDocument()
    }
  })

  it('redeems an existing CDK for the current free profile through the original upgrade workflow', async () => {
    const workflow = connect()
    session.activeProfile = { ...session.activeProfile!, kind: 'free_preview' }
    const upgrade = vi.fn((event: { preventDefault: () => void }) => event.preventDefault())
    const changeCdk = vi.fn()
    Object.assign(workflow, { upgradeCdk: 'MAA-EXISTING', upgradeLoading: false, upgradeError: null, setUpgradeCdk: changeCdk, handleUpgradePreviewProfile: upgrade })
    const user = userEvent.setup()
    mount('/v2?section=add-account&profile_id=profile-1')
    await user.click(await screen.findByText(copy.workspace.pages_tool_WorkspaceSetupPage_052))
    await user.click(await screen.findByRole('button', { name: copy.optimize.pages_tool_optimize_ResultSection_007 }))
    expect(upgrade).toHaveBeenCalledOnce()
    expect(screen.getByTestId('route-location')).toHaveTextContent('profile_id=profile-1')
    expect(session.applyAuthPayload).not.toHaveBeenCalled()
  })

  it('uses the current session in the manual tool and routes operator editing back into V2', async () => {
    connect()
    session.workspace = { operators: SAMPLE_OPERATORS, config: SAMPLE_CONFIG } as V2Session['workspace']
    const user = userEvent.setup()
    mount('/v2?section=manual-tool&profile_id=profile-1')
    const edit = await screen.findByRole('link', { name: copy.tools.manualSchedule.editOperators })
    expect(edit).toHaveAttribute('href', '/v2?profile_id=profile-1&panel=operators')
    expect(mocks.session.mock.calls.every((args) => args[0] === 'profile-1')).toBe(true)
    await user.click(edit)
    expect(await screen.findByRole('dialog', { name: copy.v2.operators })).toBeInTheDocument()
    expect(screen.getByTestId('route-location')).toHaveTextContent('panel=operators')
  })

  it('keeps the manual tool draft while navigation or a failed profile save leaves the current account in place', async () => {
    connect()
    session.workspace = { operators: SAMPLE_OPERATORS, config: SAMPLE_CONFIG } as V2Session['workspace']
    const next = { ...session.activeProfile!, id: 'profile-2', display_name: 'Second Doctor' }
    session.profiles.push(next)
    session.cdkProfiles.push(next)
    mocks.manual.mockImplementation(ManualDraftStub)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = userEvent.setup()
    mount('/v2?section=manual-tool&profile_id=profile-1')
    await user.click(await screen.findByRole('button', { name: copy.tools.manualSchedule.start }))
    await user.click(await screen.findByRole('button', { name: 'Edit draft: original' }))
    await user.selectOptions(screen.getByRole('combobox', { name: copy.tools.manualSchedule.profile }), next.id)
    expect(session.refreshProfileWorkspace).not.toHaveBeenCalled()
    expect(confirm).toHaveBeenCalledWith(copy.v2.discardManual)
    confirm.mockReturnValue(true)
    vi.mocked(session.flushConfigSave).mockResolvedValue(false)
    await user.selectOptions(screen.getByRole('combobox', { name: copy.tools.manualSchedule.profile }), next.id)
    await waitFor(() => expect(session.flushConfigSave).toHaveBeenCalledOnce())
    expect(session.refreshProfileWorkspace).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Edit draft: edited' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: copy.v2.tools }))
    await user.click(await screen.findByRole('link', { name: new RegExp(copy.tools.manualSchedule.title) }))
    expect(await screen.findByRole('button', { name: 'Edit draft: edited' })).toBeInTheDocument()
    expect(screen.getByTestId('route-location')).toHaveTextContent('profile_id=profile-1')
  })

  it('honors service switches even when a disabled tool is opened directly', async () => {
    mocks.features.mockReturnValue({ status: 'ready', features: { ...DEFAULT_SITE_FEATURES, manual_schedule: false }, retry: vi.fn() })
    mount('/v2?section=manual-tool')
    expect(await screen.findByText(copy.v2.featureUnavailable)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: copy.tools.manualSchedule.start })).not.toBeInTheDocument()
    expect(mocks.manual).not.toHaveBeenCalled()
  })
})
