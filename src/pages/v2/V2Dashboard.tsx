import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { AnimatePresence, LayoutGroup, motion, useIsPresent } from 'motion/react'
import { useAppReducedMotion } from '../../lib/motion-preference'
import { NextIcon as ArrowRight, SuccessIcon as Check, ExpandIcon as ChevronDown, BreadcrumbIcon, ExportIcon as Download, LoginIcon as LogIn, MenuIcon as Menu, GenerateIcon, LoadingIcon, ConfigIcon as Settings2, DataSourceIcon as ShieldCheck, InfoIcon as Sparkles, CloseIcon as X, PreviewIcon, SampleIcon } from '../../components/icons'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import Link from '../../components/InternalLink'
import { copy } from '../../copy'
import { MotionNavIndicator, motionTokens } from '../../components/MotionPrimitives'
import { prepareResult } from '../../components/result-panel/formatters'
import InventoryDepletionWarning from '../../components/result-panel/InventoryDepletionWarning'
import type { BoardRoom } from '../../components/result-panel/ResultBoardV2'
import { getMaaExportNotice } from '../tool/optimize/maa-export-notice'
import { manualSourceKey } from '../../lib/manual-schedule'
import { hasCapability } from '../../lib/product-catalog'
import { FIRST_SCHEDULE_INTENT_KEY } from '../../lib/first-schedule'
import { canonicalJson } from '../../lib/crypto'
import { NotificationBell } from '../../components/NotificationCenter'
import AnnouncementBanner from '../../components/AnnouncementBanner'
import AnnouncementPopup from '../../components/AnnouncementPopup'
import { LockedCapabilityPreview, UpgradeSuggestionStatusNotice } from '../tool/optimize/ResultSection'
import WorkspaceSections, { type V2Workflow } from './WorkspaceSections'
import { sectionLabels, v2Path, v2Section, v2SectionAvailable, type V2Section } from './navigation'
import V2Navigation from './V2Navigation'
import { normalizeScheduleMode, SCHEDULE_MODE_LABELS, validateScheduleConfig } from '../../lib/config'
import type { AuthSuccessResponse, LicenseConfig, LicenseOperator, OptimizeResult, PermissionMode } from '../../lib/types'
import ScheduleBoard from './ScheduleBoard'
import ScheduleContext from './ScheduleContext'
import IncomeAnalysis from './IncomeAnalysis'
import ProductionSummary from './ProductionSummary'
import ResultExportDrawer from './ResultExportDrawer'
import ManualResultExport from './ManualResultExport'
import OptionsDrawer, { type OptionPanel, type V2Session } from './OptionsDrawer'
import { isFreePreviewProfile, isFreePreviewTrialActive, sortOperatorsForPreview } from '../tool/tool-utils'
import V2Transition, { V2PageTransition } from './V2Transition'
import { useSiteFeatures } from '../../lib/site-feature-context'
import ThemeSwitcher from '../../components/ThemeSwitcher'
import ProfileExpiryPrompt from '../tool/ProfileExpiryPrompt'

const text = copy.v2
type View = 'schedule' | 'analysis' | 'manual' | 'training'
const ManualScheduleEditor = lazy(() => import('../../components/result-panel/ManualScheduleEditor'))
const UpgradeSuggestions = lazy(() => import('../../components/UpgradeSuggestions'))

export default function V2Dashboard({ session, workflow, taskCenterAction, generationProgress, result, operators, config, sample, configChanged, onUpdateConfig,
  onImportOperators, onGenerate, onExport, sampleOperators = false, busy = false, loadingResult = false, generationDisabledReason, onRetryResult, error, notice,
  permission, onManualDirtyChange, canEditConfig = true, canViewAnalysis = true, canUseIntermediateConfig = true, children }: {
  session: V2Session
  workflow?: V2Workflow
  taskCenterAction?: ReactNode
  generationProgress?: ReactNode
  result: OptimizeResult
  operators: LicenseOperator[]
  config: LicenseConfig
  sample: boolean
  sampleOperators?: boolean
  configChanged: boolean
  onUpdateConfig: (mutate: (config: LicenseConfig) => void) => void
  onImportOperators: (operators: LicenseOperator[]) => Promise<void>
  onGenerate?: () => void
  onManualDirtyChange?: (dirty: boolean) => void
  onExport?: () => void
  busy?: boolean
  loadingResult?: boolean
  generationDisabledReason?: string | null
  onRetryResult?: () => void
  error?: string | null
  notice?: string | null
  permission?: PermissionMode
  canEditConfig?: boolean
  canViewAnalysis?: boolean
  canUseIntermediateConfig?: boolean
  children?: ReactNode
}) {
  const { features } = useSiteFeatures()
  const [params, setParams] = useSearchParams()
  const { hash, pathname } = useLocation()
  const navigate = useNavigate()
  const section = v2Section(params, hash, pathname)
  const startDisabledReason = generationDisabledReason ?? (!features.profiles || !features.schedule_generation ? copy.features.schedule_read_only : null)
  const [navigationError, setNavigationError] = useState<string | null>(null)
  const [manualOpened, setManualOpened] = useState(false)
  const [manualDirty, setManualDirty] = useState(false)
  const [toolDirty, setToolDirty] = useState(false)
  useEffect(() => { onManualDirtyChange?.(manualDirty) }, [manualDirty, onManualDirtyChange])
  const firstSchedule = sample && !workflow?.hasResult && !workflow?.latestWorkspaceResult && !session.workspace?.latest_result
    && !workflow?.archivedResults?.length && !session.workspace?.archived_results?.length && !session.workspace?.free_schedule_entitlement?.first_generated_at
  const confirmationKey = `maatool:first-schedule:config:${session.user?.id}:${session.activeProfile?.id}`
  const [confirmedConfig, setConfirmedConfig] = useState(() => {
    try { return window.sessionStorage.getItem(confirmationKey) } catch { return null }
  })
  const [confirmingConfig, setConfirmingConfig] = useState(false)
  const configConfirmed = confirmedConfig === canonicalJson(config)
  useEffect(() => {
    try {
      if (firstSchedule && section === 'generation' && !session.user) window.localStorage.setItem(FIRST_SCHEDULE_INTENT_KEY, 'true')
      if (!sample) window.localStorage.removeItem(FIRST_SCHEDULE_INTENT_KEY)
    } catch { /* Storage may be disabled. */ }
  }, [firstSchedule, section, session.user, sample])
  const [panel, setPanel] = useState<OptionPanel | null>(() => params.get('feedback') === 'new' && !session.user ? 'account' : null)
  const [room, setRoom] = useState<BoardRoom | null>(null)
  const [view, setView] = useState<View>('schedule')
  const [expanded, setExpanded] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [shift, setShift] = useState(0)
  const [boardView, setBoardView] = useState<'grid' | 'list'>('grid')
  const [mobileNavigation, setMobileNavigation] = useState(false)
  const [downloadNotice, setDownloadNotice] = useState(false)
  const reduceMotion = useAppReducedMotion()
  const motionId = useId()
  const prepared = useMemo(() => prepareResult(result, result.schedule_mode === 'rotation', result.dormitory_rule === 'maa_pure_autofill', operators), [result, operators])
  const sortedOperators = useMemo(() => sortOperatorsForPreview(operators), [operators])
  const owned = useMemo(() => sortedOperators.filter((operator) => operator.own), [sortedOperators])
  const resultMode = normalizeScheduleMode(result.schedule_mode)
  const profileName = session.activeProfile?.display_name
  const signedIn = Boolean(session.user)
  const profileLabel = profileName ?? (signedIn ? text.account : text.login)
  const openPanel = useCallback((next: OptionPanel) => { setPanel(next); setMobileNavigation(false) }, [])
  const openRoom = useCallback((next: BoardRoom) => { setRoom(next); openPanel('room') }, [openPanel])
  const restrictedPreview = Boolean(session.activeProfile && isFreePreviewProfile(session.activeProfile) && !isFreePreviewTrialActive(session.activeProfile))
  const canManual = Boolean(features.manual_schedule && !sample && session.activeProfile && session.activeProfile.kind !== 'free_preview' && !result.preview_limit
    && hasCapability({ kind: session.activeProfile.kind, permission }, 'edit_full_config') && result.plans.length)
  const showManual = canManual || (features.manual_schedule && restrictedPreview)
  const canViewTraining = Boolean(workflow?.userCanUseUpgradeFeatures || workflow?.suggestions?.length)
  const manualKey = useMemo(() => manualSourceKey(result), [result])
  const exportResultId = workflow?.currentResult || workflow?.finalResult ? workflow.progress?.historyResultId ?? workflow.progress?.jobId : workflow?.historyItem?.id ?? workflow?.latestWorkspaceResult?.id
  const exportFailure = !sample && workflow?.exportFailure?.resultId === exportResultId ? workflow?.exportFailure : null
  const exportNotice = getMaaExportNotice(sample ? config.schedule_mode : result.schedule_mode, features.maa_export, workflow)
  const simulationBaseline = workflow?.historyItem?.config ? { id: workflow.historyItem.id, config: workflow.historyItem.config }
    : workflow?.progress?.historyResultId || workflow?.progress?.jobId || workflow?.latestWorkspaceResult?.id
      ? { id: workflow.progress?.historyResultId ?? workflow.progress?.jobId ?? workflow.latestWorkspaceResult!.id, config } : undefined
  useEffect(() => { setShift(0); setManualOpened(false); setManualDirty(false) }, [manualKey])
  useEffect(() => { if (!showManual && view === 'manual') setView('schedule') }, [showManual, view])
  useEffect(() => {
    const requested = params.get('panel')
    if (requested === 'operators' || requested === 'config') setPanel(requested)
  }, [params])

  function navigateSection(next: V2Section) {
    setMobileNavigation(false)
    setPanel(null)
    void navigate(v2Path(next, session.activeProfile?.id))
  }
  async function openProfile(profile: V2Session['profiles'][number], next: V2Section = 'overview') {
    if (busy || session.openingProfileId || ((manualDirty || toolDirty) && !window.confirm(text.discardManual))) return
    if (!await session.flushConfigSave()) { setNavigationError(text.saveFailed); return }
    try {
      if (!await session.refreshProfileWorkspace(profile)) return
      setManualDirty(false)
      setToolDirty(false)
      setPanel(null)
      void navigate(v2Path(next, profile.id))
    } catch (caught) { setNavigationError(caught instanceof Error ? caught.message : text.resultLoadFailed) }
  }
  async function accountAdded(payload: AuthSuccessResponse) {
    let keepCurrent = false
    if (session.activeProfile && payload.active_profile?.id !== session.activeProfile.id) {
      keepCurrent = (manualDirty || toolDirty) && !window.confirm(text.discardManual)
      if (!keepCurrent && !await session.flushConfigSave()) { keepCurrent = true; setNavigationError(text.saveFailed) }
    }
    const next = keepCurrent ? { ...payload, active_profile: session.activeProfile, workspace: session.workspace } : payload
    session.applyAuthPayload(next)
    setPanel(null)
    void navigate(v2Path(section === 'generation' ? 'generation' : 'profiles', next.active_profile?.id))
  }
  async function logout() {
    if ((manualDirty || toolDirty) && !window.confirm(text.discardManual)) return
    if (!await session.flushConfigSave()) { setNavigationError(text.saveFailed); return }
    await session.handleLogout()
  }
  async function openLegacy(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    setMobileNavigation(false)
    if ((manualDirty || toolDirty) && !window.confirm(text.discardManual)) return
    if (!await session.flushConfigSave()) { setNavigationError(text.saveFailed); return }
    void navigate('/v1')
  }
  const guardedSession = { ...session, handleLogout: logout }
  function closePanel() {
    setPanel(null)
    if (params.has('panel')) setParams((current) => { const next = new URLSearchParams(current); next.delete('panel'); return next }, { replace: true })
  }
  async function confirmConfig() {
    if (confirmingConfig) return false
    setConfirmingConfig(true)
    try {
      const validation = validateScheduleConfig(config)
      if (!validation.ok) { setNavigationError(validation.message); return false }
      if (!await session.flushConfigSave()) { setNavigationError(text.firstSchedule.configFailed); return false }
      const confirmed = canonicalJson(config)
      setConfirmedConfig(confirmed)
      try { window.sessionStorage.setItem(confirmationKey, confirmed) } catch { /* Storage may be disabled. */ }
      setNavigationError(null)
      return true
    } catch (caught) {
      setNavigationError(caught instanceof Error ? caught.message : text.firstSchedule.configFailed)
      return false
    } finally { setConfirmingConfig(false) }
  }
  function downloadSample() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'maatool-example-schedule.json'
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
    setDownloadNotice(true)
  }

  return (
    <LayoutGroup id={motionId}>
    <div className="v2-app">
      <AnimatePresence>
        {mobileNavigation && <motion.button key="navigation-scrim" className="v2-nav-scrim" type="button" onClick={() => setMobileNavigation(false)} aria-label={text.close}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduceMotion ? 0 : motionTokens.duration.exit }} />}
      </AnimatePresence>
      <aside id="v2-navigation" className={`v2-sidebar ${mobileNavigation ? 'v2-sidebar-open' : ''}`}>
        <Link to={v2Path('overview', session.activeProfile?.id)} className="v2-brand"><img className="v2-brand-mark" src="/assets/maatool-v2-icon.svg" width="44" height="44" alt="" />
          <span><strong>{text.brand}</strong><small>{text.brandDescription}</small></span></Link>
        <button className="v2-mobile-close v2-icon-button" type="button" onClick={() => setMobileNavigation(false)} aria-label={text.close}><X size={20} /></button>
        <V2Navigation section={section} session={session} operatorCount={owned.length} sampleOperators={sampleOperators}
          onNavigate={navigateSection} onPanel={openPanel} onClose={() => setMobileNavigation(false)} onLegacy={openLegacy} />
      </aside>
      <div className="v2-workspace">
        <header className="v2-topbar">
          <div className="v2-breadcrumb"><button className="v2-menu-button v2-icon-button" type="button" onClick={() => setMobileNavigation(true)} aria-label={text.menu} aria-expanded={mobileNavigation} aria-controls="v2-navigation"><Menu size={21} /></button>
            <span>{text.workspace}</span><BreadcrumbIcon size={14} aria-hidden="true" /><strong>{sectionLabels[section]}</strong></div>
          <div className="v2-topbar-actions"><div className="v2-feature-content">{taskCenterAction}</div>
            <div className="v2-feature-content"><ThemeSwitcher iconOnly /></div>
            <NotificationBell iconOnly onInventory={() => navigateSection('inventory')} />
            <span className="v2-topbar-divider" />
            <button className={`v2-profile-button ${profileName ? '' : 'v2-profile-button-text'}`} type="button" aria-label={profileLabel} title={profileLabel} onClick={() => openPanel('account')}>
              {profileName ? <><span className="v2-profile-avatar" aria-hidden="true">{profileName.slice(0, 1)}</span><span>{profileLabel}</span><ChevronDown size={14} aria-hidden="true" /></> : <><LogIn size={17} aria-hidden="true" /><span>{profileLabel}</span></>}
            </button>
          </div>
        </header>
        <main className="v2-main motion-region-enter" tabIndex={-1} data-route-focus>
          {session.authStatus === 'error' && <p className="v2-feedback v2-feedback-error" role="alert">{text.loginServiceUnavailable}<button type="button" onClick={session.retryAuth}>{copy.common.pages_ToolPage_005}</button></p>}
          {navigationError && <p className="v2-feedback v2-feedback-error" role="alert">{navigationError}<button type="button" onClick={() => { session.retryConfigSave(); setNavigationError(null) }}>{text.loginRetry}</button></p>}
          <AnnouncementBanner announcement={session.banner} />
          <V2PageTransition motionKey={section} className="v2-page-transition">{(displayedSection) => <>
          <WorkspaceSections section={displayedSection} session={guardedSession} workflow={workflow} generationProgress={generationProgress} onAccountAdded={accountAdded} onToolDirtyChange={setToolDirty} onOpenProfile={(profile) => openProfile(profile, section === 'skland' ? 'skland' : section === 'manual-tool' ? 'manual-tool' : 'overview')} onNavigate={navigateSection} onConfig={() => openPanel('config')} onOperators={() => openPanel('operators')} generationDisabledReason={generationDisabledReason}
            firstSchedule={firstSchedule} configConfirmed={configConfirmed} />
          <div hidden={displayedSection !== 'overview'}>
          {sample ? <div className="v2-page-title v2-start-schedule">
            <div><h1>{text.startTitle}</h1><p>{text.startDescription}</p></div>
            <button type="button" className="v2-button v2-button-primary" disabled={busy || loadingResult || Boolean(startDisabledReason)} aria-describedby={startDisabledReason ? 'v2-start-unavailable' : undefined} onClick={() => navigateSection('generation')}><GenerateIcon size={18} aria-hidden="true" />{text.generateMine}</button>
            {startDisabledReason && <p id="v2-start-unavailable" role="status">{startDisabledReason}</p>}
          </div> : <div className="v2-page-title"><h1>{text.title}</h1></div>}
          <InventoryDepletionWarning result={result} className="v2-inventory-warning" action={<button type="button" className="v2-button v2-button-secondary" onClick={() => openPanel('config')}><Settings2 size={16} aria-hidden="true" />{text.configure}</button>} />
          <div className={`v2-ready-banner${sample ? ' v2-example-banner' : ''}`}>
            <div className="v2-ready-status"><span className="v2-ready-icon"><Check size={22} strokeWidth={2} aria-hidden="true" /></span>
              <h2>{sample ? text.exampleSchedule : text.resultReady}<span className="v2-ready-tag">{sample ? text.sample : SCHEDULE_MODE_LABELS[resultMode]}</span></h2></div>
            <div className="v2-banner-actions"><button type="button" className="v2-button v2-button-white v2-config-button" aria-label={text.configure} title={text.configure} onClick={() => openPanel('config')}><Settings2 size={16} aria-hidden="true" /><span>{text.configure}</span></button>
              {!sample && <button type="button" className="v2-button v2-button-primary" disabled={busy || loadingResult || Boolean(generationDisabledReason)} title={generationDisabledReason ?? undefined}
                onClick={() => onGenerate?.()}>{busy ? <LoadingIcon size={16} className="v2-spin" aria-hidden="true" /> : <GenerateIcon size={16} aria-hidden="true" />}{busy ? text.generating : text.regenerate}</button>}
            </div>
          </div>
          <AnimatePresence initial={false}>
          {(loadingResult || error || notice || downloadNotice || configChanged) && <FeedbackRegion key="feedback">
          <div className={`v2-feedback ${error ? 'v2-feedback-error' : ''}`} role={error ? 'alert' : 'status'} aria-live="polite">
            {loadingResult ? text.loadingResult : error ?? notice ?? (downloadNotice ? text.exported : sample ? text.demoConfigChanged : text.configChanged)}
            {error && (workflow?.inlineError?.retry === 'save'
              ? <button type="button" disabled={busy || session.configSyncStatus === 'pending' || session.configSyncStatus === 'saving'} onClick={session.retryConfigSave}>{session.configSyncStatus === 'pending' || session.configSyncStatus === 'saving' ? copy.optimize.generation.saving : copy.optimize.generation.retry_save}</button>
              : onRetryResult && <button type="button" onClick={onRetryResult}>{text.retry}</button>)}
          </div></FeedbackRegion>}
          </AnimatePresence>
          {generationProgress}
          {children}
          <div className={`v2-results-grid ${view !== 'schedule' ? 'v2-results-wide' : ''}`}>
          <div className="v2-overview-metrics"><ProductionSummary result={result} prepared={prepared} sample={sample} userId={session.user?.id} profileId={session.activeProfile?.id} resultId={exportResultId}
            resultConfig={workflow?.historyItem?.result === result ? workflow.historyItem.config : undefined}
            history={[...(workflow?.resultHistory ?? []), ...(workflow?.archivedResults ?? [])]} newResult={Boolean(workflow?.currentResult || workflow?.finalResult)} onConfigure={() => openPanel('config')} /></div>
          {view === 'schedule' && <ScheduleContext result={result} prepared={prepared} config={config} operators={owned} sampleOperators={sampleOperators}
            onConfigure={() => openPanel('config')} onOperators={() => openPanel('operators')} />}
          <div className="v2-content-tabs" role="group" aria-label={text.resultTabs}>
            {([['schedule', text.scheduleTab], ['analysis', text.analysisTab], ...(showManual ? [['manual', text.manualTab] as const] : []), ...(restrictedPreview || !sample && (workflow?.suggestions?.length || result.upgrade_suggestions_status) ? [['training', text.trainingTab] as const] : [])] as const).map(([id, label]) => <button type="button" key={id} aria-pressed={view === id} onClick={() => { setView(id); if (id === 'manual') setManualOpened(true) }}>
              {label}{view === id && <MotionNavIndicator layoutId="result-tab" variant="underline" />}
            </button>)}
          </div>
          {view !== 'manual' && <ResultActions plans={result.plans} shift={shift} showShift={view === 'schedule'} onShiftChange={setShift} onExport={() => setExportOpen(true)} sample={sample} busy={busy} loadingResult={loadingResult} />}
          <div className="v2-feature-content v2-manual-workspace" hidden={view !== 'manual'}>
            {canManual && manualOpened && session.activeProfile && <Suspense fallback={<p role="status">{text.loading}</p>}><ManualScheduleEditor key={manualKey} source={result} profileId={session.activeProfile.id} operators={operators} simulationBaseline={simulationBaseline} onDirtyChange={setManualDirty} renderExport={(props) => workflow && <ManualResultExport key={props.resultId} {...props} workflow={workflow}
              onRecover={(action) => { navigateSection(action === 'login' ? 'generation' : action); if (action === 'login') session.retryAuth() }} />} /></Suspense>}
            {!canManual && restrictedPreview && view === 'manual' && <LockedCapabilityPreview title={copy.optimize.paid_preview.manual_title} description={copy.optimize.paid_preview.manual_description} />}
          </div>
          <div className="v2-result-view" hidden={view === 'manual'}>
          <V2Transition motionKey={view}>
            {view === 'training' ? <section className="v2-panel v2-feature-content v2-training-workspace v2-section-loading">{canViewTraining
              ? <Suspense fallback={<p role="status">{text.loading}</p>}><UpgradeSuggestionStatusNotice result={result} /><UpgradeSuggestions suggestions={workflow?.suggestions ?? []} embedded projectScope={session.user && session.activeProfile ? { userId: session.user.id, profileId: session.activeProfile.id } : undefined} /></Suspense>
              : <LockedCapabilityPreview title={copy.optimize.pages_tool_optimize_ResultSection_016} description={copy.optimize.pages_tool_optimize_ResultSection_017} />}</section> : view === 'analysis' ? (
              <section className="v2-panel v2-analysis"><div className="v2-panel-heading"><h2>{text.analysisTab}</h2><span className="v2-neutral-tag">24h</span></div>{canViewAnalysis
                ? <IncomeAnalysis result={result} prepared={prepared} />
                : <div className="v2-analysis-note"><PreviewIcon size={21} aria-hidden="true" /><div><p>{text.previewAnalysis}</p>{features.pricing && <Link className="v2-text-button" to="/pricing">{text.comparePlans}<ArrowRight size={14} /></Link>}</div></div>}</section>
            ) : (
              <ScheduleBoard result={result} prepared={prepared} expanded={expanded} onExpandedChange={setExpanded} shift={shift} onShiftChange={setShift}
                view={boardView} onViewChange={setBoardView} onRoom={openRoom} />
            )}
          </V2Transition>
          </div>
          </div>
          <div className="v2-sample-notice"><span className="v2-notice-icon"><Sparkles size={16} /></span><p>{sample && <>{text.sampleHint} </>}{text.estimateNotice}</p>{sample && <button type="button" onClick={() => openPanel('account')}>{session.user ? text.account : text.login}<ArrowRight size={14} /></button>}</div>
          </div>
          </>}</V2PageTransition>
          <footer className="v2-footer"><span>{text.brand}</span><nav>{(['pricing', 'status', 'support', 'terms', 'privacy', 'disclaimer'] as const).filter((entry) => v2SectionAvailable(entry, features)).map((entry) => <Link key={entry} to={v2Path(entry, session.activeProfile?.id)}>{sectionLabels[entry]}</Link>)}</nav></footer>
        </main>
      </div>
      <ResultExportDrawer key={`${session.activeProfile?.id ?? 'sample'}:${exportResultId ?? manualKey}`} open={exportOpen} onOpenChange={setExportOpen} result={result} prepared={prepared} shift={shift} busy={busy} failure={exportFailure} exportNotice={exportNotice}
        onRecover={(action) => { setExportOpen(false); navigateSection(action === 'login' ? 'generation' : action); if (action === 'login') session.retryAuth() }}
        onDownloadMaa={!sample && features.maa_export ? onExport : undefined} onDownloadSample={sample ? downloadSample : undefined}
        onDownloadFullResult={!sample && canViewAnalysis && !result.preview_limit && features.full_result_export && workflow?.userCanDownloadFullResult ? workflow.handleDownloadFullResult : undefined} />
      <OptionsDrawer panel={panel} onClose={closePanel} onOpenProfile={openProfile} onNavigate={navigateSection} session={guardedSession} config={config} operators={sortedOperators}
        onUpdateConfig={onUpdateConfig} permission={permission} canEditConfig={canEditConfig} canUseIntermediateConfig={canUseIntermediateConfig}
        sample={sample} busy={busy} configReadOnly={workflow?.loading} onImportOperators={onImportOperators} configDiffRows={workflow?.configDiffRows} hasPreviousResult={Boolean(workflow?.latestWorkspaceResult)}
        onAccount={() => openPanel('account')} room={room} error={navigationError ?? error}
        dailyProduction={!sample && canViewAnalysis && !result.preview_limit ? result.daily_production : undefined}
        shiftName={result.plans[Math.min(shift, Math.max(result.plans.length - 1, 0))]?.name}
        onConfirmConfig={firstSchedule && section === 'generation' && session.license ? confirmConfig : undefined} confirmingConfig={confirmingConfig} />
      {session.user && features.profiles && <ProfileExpiryPrompt userId={session.user.id} profiles={session.cdkProfiles} onOpenExport={(profile) => { void (async () => {
        if ((manualDirty || toolDirty) && !window.confirm(text.discardManual)) return
        if (!await session.flushConfigSave()) { setNavigationError(text.saveFailed); return }
        if (profile.id !== session.activeProfile?.id) { try { if (!await session.refreshProfileWorkspace(profile)) return } catch { return } }
        void navigate(v2Path('plans', profile.id))
      })() }} />}
      {features.announcements && section !== 'announcements' && <AnnouncementPopup announcements={session.popups ?? []} userId={session.user?.id} onUnreadCountChange={session.setAnnouncementUnreadCount} announcementsPath={v2Path('announcements', session.activeProfile?.id)} />}
    </div>
    </LayoutGroup>
  )
}

function FeedbackRegion({ children }: { children: ReactNode }) {
  const reduceMotion = useAppReducedMotion()
  const isPresent = useIsPresent()
  return (
    <motion.div className="v2-feedback-region" aria-hidden={isPresent ? undefined : true} inert={isPresent ? undefined : true}
      initial={{ opacity: 0, height: reduceMotion ? 'auto' : 0 }} animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: reduceMotion ? 'auto' : 0 }}
      transition={{ duration: reduceMotion ? 0 : motionTokens.duration.enter, ease: motionTokens.ease.enter }}>
      {children}
    </motion.div>
  )
}

function ResultActions({ plans, shift, showShift, onShiftChange, onExport, sample, busy, loadingResult }: {
  plans: OptimizeResult['plans']
  shift: number
  showShift: boolean
  onShiftChange: (shift: number) => void
  onExport: () => void
  sample: boolean
  busy: boolean
  loadingResult: boolean
}) {
  const selected = Math.min(shift, Math.max(plans.length - 1, 0))
  return (
    <div className="v2-result-actions" role="group" aria-label={text.result}>
      {showShift && <label className="v2-current-shift">
        <span>{text.currentShift}</span>
        <select aria-label={text.shiftTabs} value={selected} onChange={(event) => onShiftChange(Number(event.currentTarget.value))}>
          {plans.map((plan, index) => <option key={index} value={index}>{plan.name || text.shift(index + 1)}</option>)}
        </select>
      </label>}
      <span className="v2-result-source" title={sample ? text.sampleSource : text.ownSource}>{sample ? <SampleIcon size={14} aria-hidden="true" /> : <ShieldCheck size={14} aria-hidden="true" />}<span className="max-sm:sr-only">{sample ? text.sampleSource : text.ownSource}</span></span>
      <button className="v2-button v2-button-secondary" type="button" disabled={busy || loadingResult} onClick={onExport}><Download size={16} />{text.export}</button>
    </div>
  )
}
