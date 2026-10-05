import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence, LayoutGroup, motion, useIsPresent } from 'motion/react'
import { useAppReducedMotion } from '../../lib/motion-preference'
import { Activity, ArrowRight, ArrowUpRight, Bell, BookOpen, Building2, CalendarClock, Check, ChevronDown, ChevronRight, Download, Factory, FileClock, Gem, LayoutDashboard, Menu, RefreshCw, ScrollText, Settings2, ShieldCheck, Sparkles, Users, WalletCards, X, Zap } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router'
import Link from '../../components/InternalLink'
import { copy } from '../../copy'
import ProductIcon from '../../components/ProductIcon'
import { AnimatedValue, MotionNavIndicator, RevealItem, StaggeredReveal, motionTokens } from '../../components/MotionPrimitives'
import { formatAmount, prepareResult } from '../../components/result-panel/formatters'
import { PRODUCT_LABELS } from '../../components/result-panel/labels'
import InventoryDepletionWarning from '../../components/result-panel/InventoryDepletionWarning'
import type { BoardRoom } from '../../components/result-panel/ResultBoardV2'
import { manualSourceKey } from '../../lib/manual-schedule'
import { hasCapability } from '../../lib/product-catalog'
import { NotificationBell } from '../../components/NotificationCenter'
import AnnouncementBanner from '../../components/AnnouncementBanner'
import AnnouncementPopup from '../../components/AnnouncementPopup'
import { UpgradeSuggestionStatusNotice } from '../tool/optimize/ResultSection'
import WorkspaceSections, { sectionLabels, type V2Workflow } from './WorkspaceSections'
import { v2Path, v2Section, v2SectionAvailable, type V2Section } from './navigation'
import { normalizeScheduleMode, parseShiftHours, SCHEDULE_MODE_LABELS } from '../../lib/config'
import type { AuthSuccessResponse, LicenseConfig, LicenseOperator, OptimizeResult, PermissionMode } from '../../lib/types'
import ScheduleBoard, { Avatar } from './ScheduleBoard'
import IncomeAnalysis from './IncomeAnalysis'
import ResultExportDrawer from './ResultExportDrawer'
import OptionsDrawer, { type OptionPanel, type V2Session } from './OptionsDrawer'
import { sortOperatorsForPreview } from '../tool/tool-utils'
import V2Transition, { V2PageTransition } from './V2Transition'
import TradingIcon from './TradingIcon'
import { useSiteFeatures } from '../../lib/site-feature-context'
import ThemeSwitcher from '../../components/ThemeSwitcher'
import ProfileExpiryPrompt from '../tool/ProfileExpiryPrompt'

const text = copy.v2
type View = 'schedule' | 'analysis' | 'manual' | 'training'
const ManualScheduleEditor = lazy(() => import('../../components/result-panel/ManualScheduleEditor'))
const UpgradeSuggestions = lazy(() => import('../../components/UpgradeSuggestions'))

export default function V2Dashboard({ session, workflow, taskCenterAction, result, operators, config, sample, configChanged, onUpdateConfig,
  onImportOperators, onGenerate, onExport, busy = false, loadingResult = false, generationDisabledReason, onRetryResult, error, notice,
  permission, onManualDirtyChange, canEditConfig = true, canViewAnalysis = true, canUseIntermediateConfig = true, children }: {
  session: V2Session
  workflow?: V2Workflow
  taskCenterAction?: ReactNode
  result: OptimizeResult
  operators: LicenseOperator[]
  config: LicenseConfig
  sample: boolean
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
  const navigate = useNavigate()
  const section = v2Section(params)
  const [navigationError, setNavigationError] = useState<string | null>(null)
  const [manualOpened, setManualOpened] = useState(false)
  const [manualDirty, setManualDirty] = useState(false)
  const [toolDirty, setToolDirty] = useState(false)
  useEffect(() => { onManualDirtyChange?.(manualDirty) }, [manualDirty, onManualDirtyChange])
  const [panel, setPanel] = useState<OptionPanel | null>(null)
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
  const configMode = normalizeScheduleMode(config.schedule_mode)
  const battleRecords = prepared.productionStats.manufacturing['Battle Record'] ?? 0
  const orundumEconomy = prepared.orundumEconomy
  const isOrundum = Boolean(orundumEconomy) || prepared.productionStats.orundum > 0
  const showOrundum = isOrundum && battleRecords === 0
  const shortTermOrundum = orundumEconomy?.short_term_orundum ?? prepared.productionStats.orundum
  const sustainablePulls = orundumEconomy ? (orundumEconomy.sustainable_orundum * 30 / 600).toFixed(1) : '—'
  const sustainablePullsNote = orundumEconomy
    ? text.sustainablePullsHint(formatAmount(orundumEconomy.sustainable_orundum))
    : text.sustainableOrundumUnavailable
  const inventoryBurstNote = orundumEconomy?.case === 'inventory_burst' && orundumEconomy.inventory_depletion_days !== null
    ? text.inventoryBurstHint(formatAmount(orundumEconomy.inventory_depletion_days))
    : ''
  const hours = parseShiftHours(config.shift_hours) ?? [8, 8, 8]
  const name = session.activeProfile?.display_name ?? text.guest
  const openPanel = useCallback((next: OptionPanel) => { setPanel(next); setMobileNavigation(false) }, [])
  const openRoom = useCallback((next: BoardRoom) => { setRoom(next); openPanel('room') }, [openPanel])
  const canManual = Boolean(features.manual_schedule && !sample && session.activeProfile && session.activeProfile.kind !== 'free_preview' && !result.preview_limit
    && hasCapability({ kind: session.activeProfile.kind, permission }, 'edit_full_config') && result.plans.length)
  const manualKey = useMemo(() => manualSourceKey(result), [result])
  const simulationBaseline = workflow?.historyItem?.config ? { id: workflow.historyItem.id, config: workflow.historyItem.config }
    : workflow?.progress?.historyResultId || workflow?.progress?.jobId || workflow?.latestWorkspaceResult?.id
      ? { id: workflow.progress?.historyResultId ?? workflow.progress?.jobId ?? workflow.latestWorkspaceResult!.id, config } : undefined
  useEffect(() => { setShift(0); setManualOpened(false); setManualDirty(false) }, [manualKey])
  useEffect(() => { if (!canManual && view === 'manual') setView('schedule') }, [canManual, view])
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
      await session.refreshProfileWorkspace(profile)
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
    void navigate(v2Path('profiles', next.active_profile?.id))
  }
  async function logout() {
    if ((manualDirty || toolDirty) && !window.confirm(text.discardManual)) return
    if (!await session.flushConfigSave()) { setNavigationError(text.saveFailed); return }
    await session.handleLogout()
  }
  const guardedSession = { ...session, handleLogout: logout }
  function closePanel() {
    setPanel(null)
    if (params.has('panel')) setParams((current) => { const next = new URLSearchParams(current); next.delete('panel'); return next }, { replace: true })
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
      <aside className={`v2-sidebar ${mobileNavigation ? 'v2-sidebar-open' : ''}`}>
        <Link to={v2Path('overview', session.activeProfile?.id)} className="v2-brand"><span className="v2-brand-mark"><Building2 size={24} strokeWidth={1.8} /></span>
          <span><strong>{text.brand}<sup>V2</sup></strong><small>{text.brandDescription}</small></span></Link>
        <button className="v2-mobile-close v2-icon-button" type="button" onClick={() => setMobileNavigation(false)} aria-label={text.close}><X size={20} /></button>
        <nav aria-label={text.navigation}>
          <p className="v2-nav-label">{text.workspace}</p>
          {(['overview', 'generation', 'plans', 'lab', 'tools'] as const).filter((entry) => v2SectionAvailable(entry, features)).map((entry) => <button type="button" key={entry} className={`v2-nav-item ${section === entry ? 'v2-nav-active' : ''}`} aria-current={section === entry ? 'page' : undefined} onClick={() => navigateSection(entry)}>
            {entry === 'overview' ? <LayoutDashboard size={19} /> : entry === 'plans' ? <FileClock size={19} /> : entry === 'generation' ? <RefreshCw size={19} /> : entry === 'lab' ? <Activity size={19} /> : <CalendarClock size={19} />}<span>{sectionLabels[entry]}</span>{section === entry && <span className="v2-nav-dot" />}</button>)}
          <p className="v2-nav-label">{text.configuration}</p>
          <button type="button" className="v2-nav-item" aria-label={text.operators} onClick={() => openPanel('operators')}><Users size={19} /><span>{text.operators}</span><small>{owned.length}</small></button>
          <button type="button" className="v2-nav-item" onClick={() => openPanel('config')}><Building2 size={19} /><span>{text.facilities}</span></button>
          <p className="v2-nav-label">{text.personal}</p>
          <button type="button" className="v2-nav-item" onClick={() => openPanel('settings')}><Settings2 size={19} /><span>{copy.dashboard.animation.settings}</span></button>
          {(['profiles', 'inventory', 'commercial', 'balance', 'announcements', 'settings'] as const).filter((entry) => v2SectionAvailable(entry, features)).map((entry) => <button type="button" key={entry} className={`v2-nav-item ${section === entry ? 'v2-nav-active' : ''}`} aria-current={section === entry ? 'page' : undefined} onClick={() => navigateSection(entry)}>
            {entry === 'profiles' ? <UserIcon /> : entry === 'announcements' ? <Bell size={19} /> : entry === 'settings' ? <Settings2 size={19} /> : <WalletCards size={19} />}<span>{sectionLabels[entry]}</span>{entry === 'announcements' && session.announcementUnreadCount > 0 && <small>{session.announcementUnreadCount}</small>}</button>)}
        </nav>
        <div className="v2-sidebar-bottom">
          {features.faq && <Link className="v2-help-link" to={v2Path('help', session.activeProfile?.id)}><BookOpen size={19} /><span>{text.helpAction}</span><ArrowUpRight size={14} /></Link>}
        </div>
      </aside>
      <div className="v2-workspace">
        <header className="v2-topbar">
          <div className="v2-breadcrumb"><button className="v2-menu-button v2-icon-button" type="button" onClick={() => setMobileNavigation(true)} aria-label={text.menu}><Menu size={21} /></button>
            <span>{text.workspace}</span><ChevronRight size={14} /><strong>{sectionLabels[section]}</strong></div>
          <div className="v2-topbar-actions"><span className="v2-sample-pill"><span />{text.testVersion}</span>
            {features.changelog && <Link to={v2Path('updates', session.activeProfile?.id)} className="v2-icon-button" aria-label={text.updates}><ScrollText size={19} /></Link>}
            <div className="v2-feature-content">{taskCenterAction}</div>
            <div className="v2-feature-content"><ThemeSwitcher iconOnly /></div>
            <NotificationBell iconOnly onInventory={() => navigateSection('inventory')} />
            <span className="v2-topbar-divider" />
            <button className="v2-profile-button" type="button" onClick={() => openPanel('account')}><span className="v2-profile-avatar">{name.slice(0, 1)}</span><span>{name}</span><ChevronDown size={14} /></button>
          </div>
        </header>
        <main className="v2-main motion-region-enter" tabIndex={-1} data-route-focus>
          {navigationError && <p className="v2-feedback v2-feedback-error" role="alert">{navigationError}<button type="button" onClick={() => { session.retryConfigSave(); setNavigationError(null) }}>{text.loginRetry}</button></p>}
          <AnnouncementBanner announcement={session.banner} />
          <V2PageTransition motionKey={section} className="v2-page-transition">{(displayedSection) => <>
          <WorkspaceSections section={displayedSection} session={guardedSession} workflow={workflow} onAccountAdded={accountAdded} onToolDirtyChange={setToolDirty} onOpenProfile={(profile) => openProfile(profile, section === 'manual-tool' ? 'manual-tool' : 'overview')} onNavigate={navigateSection} onConfig={() => openPanel('config')} generationDisabledReason={generationDisabledReason} />
          <div hidden={displayedSection !== 'overview'}>
          <div className="v2-page-title"><h1>{text.title}</h1></div>
          <div className="v2-ready-banner">
            <span className="v2-ready-icon"><Check size={25} strokeWidth={2} /></span>
            <div><h2>{text.resultReady}<span className="v2-ready-tag">{sample ? text.sample : SCHEDULE_MODE_LABELS[resultMode]}</span></h2></div>
            <div className="v2-banner-actions"><button type="button" className="v2-button v2-button-white" onClick={() => openPanel('config')}><Settings2 size={16} />{text.configure}</button>
              <button type="button" className="v2-button v2-button-primary" disabled={busy || loadingResult || Boolean(generationDisabledReason)} title={generationDisabledReason ?? undefined}
                onClick={() => { if (onGenerate) onGenerate(); else openPanel('account') }}><RefreshCw size={16} className={busy ? 'v2-spin' : ''} />{busy ? text.generating : text.regenerate}</button>
              <button className="v2-button v2-button-secondary v2-export-button" type="button" disabled={busy || loadingResult}
                onClick={() => setExportOpen(true)}><Download size={16} />{text.export}</button></div>
          </div>
          <AnimatePresence initial={false}>
          {(loadingResult || error || notice || downloadNotice || configChanged) && <FeedbackRegion key="feedback">
          <div className={`v2-feedback ${error ? 'v2-feedback-error' : ''}`} role={error ? 'alert' : 'status'} aria-live="polite">
            {loadingResult ? text.loadingResult : error ?? notice ?? (downloadNotice ? text.exported : sample ? text.demoConfigChanged : text.configChanged)}
            {error && onRetryResult && <button type="button" onClick={onRetryResult}>{text.retry}</button>}
          </div></FeedbackRegion>}
          </AnimatePresence>
          {children}
          <InventoryDepletionWarning result={result} />
          <StaggeredReveal className="v2-metrics">
            <Metric label={text.lmd} value={formatAmount(prepared.productionStats.lmd)} unit={text.daily} product="LMD" />
            <Metric label={showOrundum ? text.orundum : text.exp} value={formatAmount(showOrundum ? shortTermOrundum : battleRecords * 1000)}
              unit={showOrundum ? text.daily : text.expUnit} product={showOrundum ? 'Orundum' : 'Battle Record'}
              hint={showOrundum && orundumEconomy ? [text.shortTermOrundumHint, inventoryBurstNote].filter(Boolean).join(' · ') : undefined} />
            <Metric label={text.totalEfficiency} value={formatAmount(prepared.totalEff)} unit="%" hint={text.efficiencyHint} icon={<Activity size={20} />} />
            <Metric
              label={isOrundum ? text.sustainablePulls : text.sanity}
              value={isOrundum ? sustainablePulls : prepared.productionSanity.value.toFixed(1)}
              unit={isOrundum ? text.pullsPer30Days : text.daily}
              hint={isOrundum ? sustainablePullsNote : text.sanityHint}
              icon={<Gem size={20} />}
            />
          </StaggeredReveal>
          <p className="v2-metrics-note">{text.outputSubtitle}</p>
          <div className="v2-content-tabs" role="group" aria-label={text.resultTabs}>
            {([['schedule', text.scheduleTab], ['analysis', text.analysisTab], ...(canManual ? [['manual', text.manualTab] as const] : []), ...(!sample && (workflow?.suggestions?.length || result.upgrade_suggestions_status) ? [['training', text.trainingTab] as const] : [])] as const).map(([id, label]) => <button type="button" key={id} aria-pressed={view === id} onClick={() => { setView(id); if (id === 'manual') setManualOpened(true) }}>
              {label}{view === id && <MotionNavIndicator layoutId="result-tab" variant="underline" />}
            </button>)}
            <span><ShieldCheck size={14} />{sample ? text.sampleSource : text.ownSource}</span>
          </div>
          <div className="v2-feature-content" hidden={view !== 'manual'}>
            {canManual && manualOpened && session.activeProfile && <Suspense fallback={<p role="status">{text.loading}</p>}><ManualScheduleEditor key={manualKey} source={result} profileId={session.activeProfile.id} operators={operators} simulationBaseline={simulationBaseline} onDirtyChange={setManualDirty} /></Suspense>}
          </div>
          <V2Transition motionKey={view}>
          <div hidden={view === 'manual'} className={`v2-results-grid ${view !== 'schedule' || expanded ? 'v2-results-expanded' : ''}`}>
            {view === 'training' ? <section className="v2-panel v2-feature-content v2-training-workspace v2-section-loading"><Suspense fallback={<p role="status">{text.loading}</p>}><UpgradeSuggestionStatusNotice result={result} /><UpgradeSuggestions suggestions={workflow?.suggestions ?? []} embedded /></Suspense></section> : view === 'analysis' ? (
              <section className="v2-panel v2-analysis"><div className="v2-panel-heading"><h2>{text.analysisTab}</h2><span className="v2-neutral-tag">24h</span></div>{canViewAnalysis
                ? <IncomeAnalysis result={result} prepared={prepared} />
                : <div className="v2-analysis-note"><ShieldCheck size={21} /><div><p>{text.previewAnalysis}</p>{features.pricing && <Link className="v2-text-button" to="/pricing">{text.comparePlans}<ArrowRight size={14} /></Link>}</div></div>}</section>
            ) : (
              <ScheduleBoard result={result} prepared={prepared} expanded={expanded} onExpandedChange={setExpanded} shift={shift} onShiftChange={setShift}
                view={boardView} onViewChange={setBoardView} onRoom={openRoom} />
            )}
            {view === 'schedule' && !expanded && <aside className="v2-result-aside">
              <section className="v2-panel v2-production-panel">
                <div className="v2-panel-heading"><h2>{text.dailyOutput}</h2><span className="v2-output-clock"><CalendarClock size={16} /></span></div>
                <OutputRow product="LMD" value={prepared.productionStats.lmd} />
                <OutputRow product="Battle Record" value={prepared.productionStats.manufacturing['Battle Record'] ?? 0} />
                <OutputRow product="Pure Gold" value={prepared.productionStats.manufacturing['Pure Gold'] ?? 0} />
                {Object.keys(PRODUCT_LABELS).filter((product) => !['LMD', 'Battle Record', 'Pure Gold'].includes(product)).map((product) => {
                  const value = (prepared.productionStats.manufacturing[product] ?? 0) + (product === 'Orundum' ? shortTermOrundum : result.daily_production?.trading?.[product] ?? 0)
                  return value !== 0 ? <OutputRow key={product} product={product} value={value} /> : null
                })}
              </section>
              <section className="v2-panel v2-config-panel">
                <div className="v2-panel-heading"><h2>{text.currentConfig}</h2><button className="v2-text-button" type="button" onClick={() => openPanel('config')}>{text.edit}<ArrowUpRight size={13} /></button></div>
                <div className="v2-layout-preview">
                  {Array.from({ length: config.trading_stations_count }, (_, index) => <span className="v2-layout-trading" key={`t${index}`}><TradingIcon size={14} /></span>)}
                  {Array.from({ length: config.manufacturing_stations_count }, (_, index) => <span className="v2-layout-manufacture" key={`m${index}`}><Factory size={14} /></span>)}
                  {Array.from({ length: Math.max(0, 9 - config.trading_stations_count - config.manufacturing_stations_count) }, (_, index) => <span className="v2-layout-power" key={`p${index}`}><Zap size={14} /></span>)}
                </div>
                <dl className="v2-config-summary"><div><dt>{text.layout}</dt><dd>{config.layout}</dd></div><div><dt>{text.mode}</dt><dd>{SCHEDULE_MODE_LABELS[configMode]}</dd></div>
                  <div><dt>{text.duration}</dt><dd>{hours.join(' / ')}h</dd></div><div><dt>{text.drones}</dt><dd>{config.drones?.enable ? config.drones.auto ? text.automatic : text.manual : text.disabled}</dd></div></dl>
                <button className="v2-operator-summary" type="button" onClick={() => openPanel('operators')}><div className="v2-avatar-stack">{owned.slice(0, 4).map((operator) => <Avatar key={operator.id} operator={operator} small />)}</div><span><strong>{text.operatorData}</strong><small>{text.owned(owned.length)}</small></span><ChevronRight size={15} /></button>
              </section>
            </aside>}
          </div>
          </V2Transition>
          <div className="v2-sample-notice"><span className="v2-notice-icon"><Sparkles size={16} /></span><p>{sample && <>{text.sampleHint} </>}{text.estimateNotice}</p>{sample && <button type="button" onClick={() => openPanel('account')}>{session.user ? text.account : text.login}<ArrowRight size={14} /></button>}</div>
          </div>
          </>}</V2PageTransition>
          <footer className="v2-footer"><span>{text.brand}</span><nav>{(['status', 'support', 'terms', 'privacy', 'disclaimer'] as const).filter((entry) => v2SectionAvailable(entry, features)).map((entry) => <Link key={entry} to={v2Path(entry, session.activeProfile?.id)}>{sectionLabels[entry]}</Link>)}</nav></footer>
        </main>
      </div>
      <ResultExportDrawer key={`${session.activeProfile?.id ?? 'sample'}:${manualKey}`} open={exportOpen} onOpenChange={setExportOpen} result={result} prepared={prepared} shift={shift} busy={busy}
        onDownloadMaa={!sample && features.maa_export ? onExport : undefined} onDownloadSample={sample ? downloadSample : undefined}
        onDownloadFullResult={!sample && canViewAnalysis && !result.preview_limit && features.full_result_export && workflow?.userCanDownloadFullResult ? workflow.handleDownloadFullResult : undefined} />
      <OptionsDrawer panel={panel} onClose={closePanel} onOpenProfile={openProfile} onNavigate={navigateSection} session={guardedSession} config={config} operators={sortedOperators}
        onUpdateConfig={onUpdateConfig} permission={permission} canEditConfig={canEditConfig} canUseIntermediateConfig={canUseIntermediateConfig}
        sample={sample} busy={busy} configReadOnly={workflow?.loading} onImportOperators={onImportOperators} configDiffRows={workflow?.configDiffRows} hasPreviousResult={Boolean(workflow?.latestWorkspaceResult)}
        onAccount={() => openPanel('account')} room={room} error={error} />
      {session.user && features.profiles && <ProfileExpiryPrompt userId={session.user.id} profiles={session.cdkProfiles} onOpenExport={(profile) => { void (async () => {
        if ((manualDirty || toolDirty) && !window.confirm(text.discardManual)) return
        if (!await session.flushConfigSave()) { setNavigationError(text.saveFailed); return }
        if (profile.id !== session.activeProfile?.id) { try { await session.refreshProfileWorkspace(profile) } catch { return } }
        void navigate(v2Path('plans', profile.id))
      })() }} />}
      {features.announcements && <AnnouncementPopup announcements={session.popups ?? []} userId={session.user?.id} onUnreadCountChange={session.setAnnouncementUnreadCount} announcementsPath={v2Path('announcements', session.activeProfile?.id)} />}
    </div>
    </LayoutGroup>
  )
}

function UserIcon() {
  return <span className="v2-user-nav-icon"><Users size={18} /></span>
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

function Metric({ label, value, unit, hint, product, icon }: { label: string; value: string; unit: string; hint?: string; product?: string; icon?: ReactNode }) {
  return <RevealItem className="v2-metric"><section aria-label={label}><div className="v2-metric-top"><span>{label}</span><span className="v2-metric-icon">{product ? <ProductIcon product={product} size={24} /> : icon}</span></div>
    <p className="v2-metric-value"><AnimatedValue value={value} /><small>{unit}</small></p>{hint && <p className="v2-metric-hint">{hint}</p>}</section></RevealItem>
}

function OutputRow({ product, value }: { product: string; value: number }) {
  return <div className="v2-output-row"><span><ProductIcon product={product} size={29} /><span>{PRODUCT_LABELS[product] ?? product}</span></span><strong><AnimatedValue value={formatAmount(value)} /><small>{text.daily}</small></strong></div>
}
