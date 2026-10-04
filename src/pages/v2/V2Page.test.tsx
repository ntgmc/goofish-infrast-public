// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copy } from '../../copy'
import { MotionPreferenceProvider } from '../../lib/motion-preference'
import { normalizeConfig } from '../../lib/config'
import { DEFAULT_SITE_FEATURES } from '../../lib/site-features'
import type { OptimizeResult, UserGameAccount, WorkspaceResultHistorySummary } from '../../lib/types'
import type { V2Session } from './OptionsDrawer'
import { SAMPLE_CONFIG, SAMPLE_OPERATORS, SAMPLE_RESULT } from './sample-result'
import { SANITY_PER_LMD, SANITY_PER_PURE_GOLD } from '../../lib/orundum-economy'

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  workflow: vi.fn(),
  features: vi.fn(),
  tasks: vi.fn(),
}))
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
  operator_count: 42, source: 'generated', archived: false, schedule_mode: 'maa', maa_exportable: true, has_config: true,
}

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  mocks.features.mockReturnValue({ status: 'ready', features: DEFAULT_SITE_FEATURES, retry: vi.fn() })
  mocks.tasks.mockReturnValue({ jobs: [], cancel: vi.fn(), busyJobId: null, error: null, notice: null })
  session = {
    user: null, activeProfile: null, license: null, workspace: null, configOverride: null,
    authStatus: 'anonymous', cdkProfiles: [], openingProfileId: null, workspaceLoadError: null,
    configSyncStatus: 'idle', eliteOverrides: {}, banner: null,
    retryAuth: vi.fn(), setLicense: vi.fn(), applyAuthPayload: vi.fn(),
    setConfigOverride: vi.fn(), flushConfigSave: vi.fn(async () => true), retryConfigSave: vi.fn(),
    persistWorkspacePatch: vi.fn(async () => undefined), applyWorkspaceSnapshot: vi.fn(),
    handleLogout: vi.fn(), refreshProfileWorkspace: vi.fn(),
  } as unknown as V2Session
  mocks.session.mockImplementation(() => session)
})

afterEach(() => {
  cleanup()
  window.localStorage.removeItem('maatool-reduce-motion')
  vi.restoreAllMocks()
})

function RouteLocation() {
  return <span data-testid="route-location">{useLocation().search}</span>
}

function mount() {
  return render(<MemoryRouter initialEntries={['/v2']}><V2Page /><RouteLocation /></MemoryRouter>)
}

async function dismissDrawer(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard('{Escape}')
  await waitFor(() => expect(document.querySelector('[data-slot="dialog-content"]')).not.toBeInTheDocument())
}

function connect() {
  const profile = {
    id: 'profile-1', kind: 'cdk', permission: 'ultimate', display_name: 'My Doctor',
    status: 'active', cdk_order_hash: 'profile-order',
  } as UserGameAccount
  session = {
    ...session,
    user: { id: 'user-1', email: 'doctor@example.test' } as V2Session['user'],
    activeProfile: profile, cdkProfiles: [profile],
    license: { version: 2, order_hash: 'order', operators: SAMPLE_OPERATORS, config: SAMPLE_CONFIG, issued_at: '', sig: '' },
  }
  const workflow = {
    latestWorkspaceResult: summary, handleViewHistory: vi.fn(async () => undefined),
    currentResult: null as OptimizeResult | null, finalResult: null, historyItem: { result: SAMPLE_RESULT },
    activeConfig: SAMPLE_CONFIG, mergedOperators: SAMPLE_OPERATORS, configDiffRows: [],
    updateConfig: vi.fn(), handleGenerate: vi.fn(async () => undefined), handleDownloadMAA: vi.fn(),
    permission: 'ultimate', userCanEditConfig: true, userCanUseIntermediateAutoConfig: true,
    userCanViewFullData: true,
    resultHistory: [summary], loading: false, workspaceError: null, inlineError: null,
    workspaceNotice: null, declarationDialog: null, configToast: null as { message: string } | null,
    billingQuote: null as { charge: string; available: string; tier: number | null; sufficient: boolean } | null,
    billingQuoteLoading: false, billingQuoteError: null as string | null, refreshBillingQuote: vi.fn(async () => undefined),
    progress: null as import('../../components/ScheduleProgress').ScheduleProgressState | null,
  }
  mocks.workflow.mockImplementation(() => workflow)
  return workflow
}

describe('V2 results-first workspace', () => {
  it('uses normalized backend station output and drone consumption without rescaling or averaging', async () => {
    const workflow = connect()
    workflow.historyItem = { result: { ...SAMPLE_RESULT, daily_production: {
      hours: 24, source_hours: 16, normalization_factor: 1.5,
      manufacturing: { 'Pure Gold': 20 }, trading: { LMD: 3000 }, consumption: { 'Pure Gold': 6 },
      details: [
        { shift: '早班', room_type: 'manufacture', room_index: 1, product: 'Pure Gold', amount: 20 },
        { shift: '早班', room_type: 'trading', room_index: 2, product: 'LMD', amount: 2500, consume: { 'Pure Gold': 5 } },
        { shift: '早班', room_type: 'trading', room_index: 2, product: 'LMD', source: 'drones', amount: 500, consume: { 'Pure Gold': 1 } },
      ],
    } } }
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: copy.v2.analysisTab }))
    const station = within(await screen.findByRole('region', { name: copy.v2.stationOutput }))
    const rows = station.getAllByRole('row').slice(1)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('赤金 20')
    expect(rows[1]).toHaveTextContent('贸易站 2早班龙门币 2,500赤金 5')
    expect(rows[2]).toHaveTextContent(`贸易站 2早班${copy.v2.drones}龙门币 500赤金 1`)
    const sanity = 3000 * SANITY_PER_LMD + 14 * SANITY_PER_PURE_GOLD
    expect(screen.getByRole('region', { name: copy.v2.sanityCalculation })).toHaveTextContent(sanity.toFixed(2))
    expect(workflow.handleGenerate).not.toHaveBeenCalled()
  })

  it('reads facility levels and operator moods from the chosen result and resolves skills using saved training', async () => {
    const workflow = connect()
    const result = structuredClone(SAMPLE_RESULT)
    result.buildingType = 252
    const room = result.plans[0].rooms.trading[0]
    delete room.level
    room.facility_level = 2
    room.mood = { 银灰: { start: 21.5, end: 7.2 } }
    room.overflow = { time: '7h', equivalent: { equivalent_efficiency: 304.2 } }
    workflow.historyItem = { result }
    const user = userEvent.setup()
    mount()
    const card = screen.getByRole('button', { name: /贸易站.*银灰/ })
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

  it('shows an explicitly marked result immediately without requiring login or a CDK', () => {
    mount()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(copy.v2.title)
    expect(screen.getByText(copy.v2.sampleSource)).toBeInTheDocument()
    expect(screen.getByText(copy.v2.brandDescription)).toBeInTheDocument()
    expect(screen.queryByText('可露希尔基建终端')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: copy.v2.backToV1 })).toHaveAttribute('href', '/')
    expect(screen.getByRole('tab', { name: /第 1 班/ })).toHaveAttribute('aria-selected', 'true')
    expect(mocks.workflow).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('refreshes cached teams and expanded skills when saved training and the result change', async () => {
    const workflow = connect()
    const user = userEvent.setup()
    const page = mount()
    await user.click(screen.getByRole('button', { name: copy.v2.operators }))
    const dialog = within(await screen.findByRole('dialog'))
    await user.type(dialog.getByRole('textbox', { name: copy.v2.searchOperators }), '银灰')
    expect(dialog.queryByText('喀兰之主')).not.toBeInTheDocument()
    await user.click(dialog.getByText(copy.domain.building_skills.title))
    expect((await dialog.findByText('喀兰之主')).closest('.v2-skill')).toHaveClass('v2-skill-active')

    workflow.mergedOperators = SAMPLE_OPERATORS.map((operator) => operator.name === '银灰' ? { ...operator, elite: 0, level: 1 } : operator)
    const nextResult = structuredClone(SAMPLE_RESULT)
    nextResult.plans[0].rooms.trading[0].level = 2
    workflow.historyItem = { result: nextResult }
    page.rerender(<MemoryRouter initialEntries={['/v2']}><V2Page /><RouteLocation /></MemoryRouter>)
    expect(dialog.getByText('喀兰之主').closest('.v2-skill')).toHaveClass('v2-skill-locked')
    expect(dialog.getByText('喀兰贸易·α').closest('.v2-skill')).toHaveClass('v2-skill-active')
    await user.click(dialog.getByText(copy.domain.building_skills.title))
    await waitFor(() => expect(dialog.queryByText('喀兰之主')).not.toBeInTheDocument())
    await dismissDrawer(user)
    const card = screen.getByRole('button', { name: /贸易站.*银灰/ })
    expect(card).toHaveTextContent('Lv.2')
    expect(card.querySelector('[data-operator-name="银灰"]')).toHaveAttribute('data-operator-elite', '0')
    expect(workflow.handleGenerate).not.toHaveBeenCalled()
    expect(session.persistWorkspacePatch).not.toHaveBeenCalled()
  })

  it('switches teams by mouse and keyboard and exposes room details on demand', async () => {
    const user = userEvent.setup()
    mount()
    const second = screen.getByRole('tab', { name: /第 2 班/ })
    await user.click(second)
    expect(second).toHaveAttribute('aria-selected', 'true')
    expect(within(screen.getByRole('tabpanel')).getByText('能天使')).toBeInTheDocument()
    await user.keyboard('{ArrowRight}')
    const third = screen.getByRole('tab', { name: /第 3 班/ })
    expect(third).toHaveFocus()
    expect(third).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('button', { name: /贸易站.*银灰/ }))
    expect(await screen.findByRole('dialog')).toHaveTextContent(copy.v2.roomDetails)
    await dismissDrawer(user)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('preserves the selected shift and display mode across result views without generating', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('tab', { name: /第 2 班/ }))
    const room = within(screen.getByRole('tabpanel')).getByRole('button', { name: /贸易站.*能天使/ })
    await user.click(screen.getByRole('button', { name: copy.v2.list }))
    expect(within(screen.getByRole('tabpanel')).getByRole('button', { name: /贸易站.*能天使/ })).toBe(room)
    await user.click(screen.getByRole('button', { name: copy.v2.detailsTab }))
    expect(screen.getByRole('tab', { name: /第 2 班/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: copy.v2.list })).toHaveAttribute('aria-pressed', 'true')
    expect(within(screen.getByRole('tabpanel')).getByText('能天使')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: copy.v2.analysisTab }))
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: copy.v2.summaryTab }))
    expect(screen.getByRole('tab', { name: /第 2 班/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: copy.v2.list })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(screen.getByRole('tabpanel')).toBeVisible())
    expect(mocks.workflow).not.toHaveBeenCalled()
  })

  it('exposes only the current team during rapid shift changes and keeps keyboard focus on the selected tab', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('tab', { name: /第 2 班/ }))
    await user.keyboard('{ArrowRight}{Home}{End}')
    const third = screen.getByRole('tab', { name: /第 3 班/ })
    expect(third).toHaveFocus()
    expect(third).toHaveAttribute('aria-selected', 'true')
    const board = within(screen.getByRole('tabpanel'))
    expect(board.getByRole('button', { name: /贸易站.*银灰/ })).toBeInTheDocument()
    expect(board.queryByRole('button', { name: /贸易站.*能天使/ })).not.toBeInTheDocument()
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
  })

  it('applies the shared reduced-animation setting from V2 without generating or losing the selected team', async () => {
    const user = userEvent.setup()
    render(<MotionPreferenceProvider><MemoryRouter initialEntries={['/v2']}><V2Page /></MemoryRouter></MotionPreferenceProvider>)
    await user.click(screen.getByRole('tab', { name: /第 2 班/ }))
    await user.click(screen.getByRole('button', { name: copy.dashboard.animation.settings }))
    const dialog = within(await screen.findByRole('dialog', { name: copy.dashboard.animation.settings }))
    await user.click(dialog.getByRole('switch', { name: copy.dashboard.animation.reduce }))
    expect(document.documentElement).toHaveAttribute('data-reduced-motion')
    expect(window.localStorage.getItem('maatool-reduce-motion')).toBe('true')
    await dismissDrawer(user)
    expect(screen.getByRole('tab', { name: /第 2 班/ })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('button', { name: copy.v2.list }))
    expect(screen.getByRole('button', { name: copy.v2.list })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('tab', { name: /第 2 班/ })).toHaveAttribute('aria-selected', 'true')
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
    expect(within(screen.getByRole('button', { name: /贸易站.*巫恋/ })).getByTitle(copy.v2.drones)).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: /贸易站.*银灰/ })).queryByTitle(copy.v2.drones)).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: /第 2 班/ }))
    expect(within(screen.getByRole('button', { name: /贸易站.*能天使/ })).getByTitle(copy.v2.drones)).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: /贸易站.*芳汀/ })).queryByTitle(copy.v2.drones)).not.toBeInTheDocument()
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
    expect(within(dialog).getByText(copy.v2.sampleOperators.silverash)).toBeInTheDocument()
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
    expect(within(dialog).getByText(copy.v2.sampleOperators.silverash)).toBeInTheDocument()
    expect(within(dialog).queryByText(copy.v2.sampleOperators.degenbrecher)).not.toBeInTheDocument()
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
    await user.type(search, '银灰')
    expect(search).toHaveFocus()
    expect(within(dialog).getByText('银灰')).toBeInTheDocument()
    expect(within(dialog).queryByText('锏')).not.toBeInTheDocument()
    expect(within(dialog).getByText(copy.v2.ownedLabel)).toBeInTheDocument()
    expect(within(dialog).getByText(copy.v2.elite(2))).toBeInTheDocument()
    expect(within(dialog).getByText(copy.v2.operatorLevel())).toBeInTheDocument()
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument()
    await user.tab()
    expect(within(dialog).getByRole('button', { name: copy.v2.uploadMaa })).toHaveFocus()
    await dismissDrawer(user)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: copy.v2.lmd })).getByText('54,720')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /第 1 班/ })).toBeInTheDocument()
    expect(session.persistWorkspacePatch).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: copy.v2.regenerate }))
    expect(await screen.findByRole('dialog')).toHaveTextContent(copy.v2.account)
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

  it('flushes saved configuration before generating and blocks generation on a save failure', async () => {
    const workflow = connect()
    const user = userEvent.setup()
    mount()
    await waitFor(() => expect(screen.getByRole('button', { name: copy.v2.regenerate })).not.toBeDisabled())
    vi.mocked(session.flushConfigSave).mockResolvedValueOnce(false)
    await user.click(screen.getByRole('button', { name: copy.v2.regenerate }))
    expect(await screen.findByRole('alert')).toHaveTextContent(copy.v2.saveFailed)
    expect(workflow.handleGenerate).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: copy.v2.regenerate }))
    await waitFor(() => expect(workflow.handleGenerate).toHaveBeenCalledOnce())
    expect(vi.mocked(session.flushConfigSave).mock.invocationCallOrder[1]).toBeLessThan(workflow.handleGenerate.mock.invocationCallOrder[0])
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
    await user.click(screen.getByRole('button', { name: copy.v2.regenerate }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: /Retired profile/ })).not.toBeInTheDocument()
    expect(within(dialog).getByText(copy.v2.noProfiles)).toBeInTheDocument()
    expect(workflow.handleGenerate).not.toHaveBeenCalled()
  })

  it('exposes configuration validation failures from the existing workflow', async () => {
    const workflow = connect()
    workflow.configToast = { message: 'Invalid schedule configuration' }
    mount()
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid schedule configuration'))
    expect(workflow.handleGenerate).not.toHaveBeenCalled()
  })

  it('shows validation errors inside the configuration drawer', async () => {
    const workflow = connect()
    workflow.configToast = { message: 'Invalid schedule configuration' }
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: copy.v2.facilities }))
    expect(within(await screen.findByRole('dialog')).getByRole('alert')).toHaveTextContent('Invalid schedule configuration')
  })

  it('writes the successfully selected profile into the route for refresh restoration', async () => {
    connect()
    const second = { ...session.activeProfile!, id: 'profile-2', display_name: 'Second Doctor' }
    session.cdkProfiles.push(second)
    vi.mocked(session.refreshProfileWorkspace).mockResolvedValue(undefined)
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: copy.v2.account }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Second Doctor/ }))
    await waitFor(() => expect(screen.getByTestId('route-location')).toHaveTextContent('profile_id=profile-2'))
    expect(session.flushConfigSave).toHaveBeenCalledOnce()
    expect(session.refreshProfileWorkspace).toHaveBeenCalledWith(second)
    expect(mocks.session).toHaveBeenLastCalledWith('profile-2')
  })

  it('cancels the current job through the existing task controller while retaining the result', async () => {
    const workflow = connect()
    workflow.loading = true
    workflow.progress = { mode: 'generate', startedAt: Date.now(), jobId: 'running-job', estimatePhase: 'running' }
    const job = { id: 'running-job', canCancel: true, cancellationRequested: false }
    const cancel = vi.fn(async () => undefined)
    mocks.tasks.mockReturnValue({ jobs: [job], cancel, busyJobId: null, error: null, notice: null })
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: copy.v2.stopSchedule }))
    expect(cancel).toHaveBeenCalledWith(job)
    expect(within(screen.getByRole('region', { name: copy.v2.lmd })).getByText('54,720')).toBeInTheDocument()
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
    await user.type(within(dialog).getByRole('textbox', { name: copy.v2.searchOperators }), '银灰')
    expect(within(dialog).getByText('银灰')).toBeInTheDocument()
    expect(within(dialog).queryByText('锏')).not.toBeInTheDocument()
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
    const operators = SAMPLE_OPERATORS.map((operator) => operator.name === '银灰' ? { ...operator, elite: 1 } : operator)
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
    await user.type(within(dialog).getByRole('textbox', { name: copy.v2.searchOperators }), '银灰')
    expect(within(dialog).getByText(copy.v2.ownedLabel)).toBeInTheDocument()
    expect(within(dialog).getByText(copy.v2.elite(2))).toBeInTheDocument()
    expect(workflow.handleGenerate).not.toHaveBeenCalled()
    await dismissDrawer(user)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: copy.v2.lmd })).getByText('54,720')).toBeInTheDocument()
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
    expect(within(screen.getByRole('region', { name: copy.v2.lmd })).getByText('54,720')).toBeInTheDocument()
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
      id: 'trial', starts_at: '2026-10-01T00:00:00Z', ends_at: '2026-10-10T00:00:00Z',
      active: true, effective_permission: 'advanced',
    } : null
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole('button', { name: copy.v2.facilities }))
    const dialog = within(await screen.findByRole('dialog'))
    expect(await dialog.findByRole('button', { name: '243 均衡' })).not.toBeDisabled()
    if (trial) expect(dialog.getByRole('switch', { name: /^菲亚梅塔$/ })).not.toBeDisabled()
    else expect(dialog.queryByRole('switch', { name: /^菲亚梅塔$/ })).not.toBeInTheDocument()
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
    workflow.historyItem = { result: { ...SAMPLE_RESULT, daily_production: {
      manufacturing: { 'Originium Shard': 41.25 }, trading: { Orundum: 103.5 },
    } } }
    const user = userEvent.setup()
    mount()
    const panel = within(screen.getByRole('heading', { name: copy.v2.dailyOutput }).closest('section')!)
    expect(panel.getByText('合成玉')).toBeInTheDocument()
    expect(panel.getByText('103.5')).toBeInTheDocument()
    expect(panel.getByText('源石碎片')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: copy.v2.analysisTab }))
    expect(screen.queryByRole('region', { name: copy.v2.sanityCalculation })).not.toBeInTheDocument()
  })
})
