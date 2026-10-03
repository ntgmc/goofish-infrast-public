import { useState, type ReactNode } from 'react'
import { Activity, ArrowRight, ArrowUpRight, Bell, BookOpen, Building2, CalendarClock, Check, ChevronDown, ChevronRight, Clock3, Download, Factory, FileClock, Gem, LayoutDashboard, Menu, RefreshCw, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Users, WalletCards, X, Zap } from 'lucide-react'
import { Link } from 'react-router'
import { copy } from '../../copy'
import ProductIcon from '../../components/ProductIcon'
import { formatAmount, prepareResult } from '../../components/result-panel/formatters'
import type { BoardRoom } from '../../components/result-panel/ResultBoardV2'
import { normalizeScheduleMode, parseShiftHours, SCHEDULE_MODE_LABELS } from '../../lib/config'
import type { LicenseConfig, LicenseOperator, OptimizeResult, PermissionMode, WorkspaceResultHistorySummary } from '../../lib/types'
import ScheduleBoard, { Avatar, OutputChart } from './ScheduleBoard'
import OptionsDrawer, { type OptionPanel, type V2Session } from './OptionsDrawer'

const text = copy.v2
type View = 'summary' | 'details' | 'analysis'

export default function V2Dashboard({ session, result, operators, config, sample, configChanged, onUpdateConfig,
  onOperatorsChange, onImportOperators, onGenerate, onExport, busy = false, loadingResult = false, generationDisabledReason, onRetryResult, error, notice,
  permission, canEditConfig = true, canUseIntermediateConfig = true, history = [], onHistory, children }: {
  session: V2Session
  result: OptimizeResult
  operators: LicenseOperator[]
  config: LicenseConfig
  sample: boolean
  configChanged: boolean
  onUpdateConfig: (mutate: (config: LicenseConfig) => void) => void
  onOperatorsChange: (operators: LicenseOperator[]) => void
  onImportOperators?: (operators: LicenseOperator[]) => Promise<void>
  onGenerate?: () => void
  onExport?: () => void
  busy?: boolean
  loadingResult?: boolean
  generationDisabledReason?: string | null
  onRetryResult?: () => void
  error?: string | null
  notice?: string | null
  permission?: PermissionMode
  canEditConfig?: boolean
  canUseIntermediateConfig?: boolean
  history?: WorkspaceResultHistorySummary[]
  onHistory?: (summary: WorkspaceResultHistorySummary) => Promise<void>
  children?: ReactNode
}) {
  const [panel, setPanel] = useState<OptionPanel | null>(null)
  const [room, setRoom] = useState<BoardRoom | null>(null)
  const [view, setView] = useState<View>('summary')
  const [mobileNavigation, setMobileNavigation] = useState(false)
  const [downloadNotice, setDownloadNotice] = useState(false)
  const prepared = prepareResult(result, result.schedule_mode === 'rotation', result.dormitory_rule === 'maa_pure_autofill', operators)
  const owned = operators.filter((operator) => operator.own)
  const resultMode = normalizeScheduleMode(result.schedule_mode)
  const configMode = normalizeScheduleMode(config.schedule_mode)
  const hours = parseShiftHours(config.shift_hours) ?? [8, 8, 8]
  const name = session.activeProfile?.display_name ?? text.guest
  const openPanel = (next: OptionPanel) => { setPanel(next); setMobileNavigation(false) }

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
    <div className="v2-app">
      {mobileNavigation && <button className="v2-nav-scrim" type="button" onClick={() => setMobileNavigation(false)} aria-label={text.close} />}
      <aside className={`v2-sidebar ${mobileNavigation ? 'v2-sidebar-open' : ''}`}>
        <Link to="/v2" className="v2-brand"><span className="v2-brand-mark"><Building2 size={24} strokeWidth={1.8} /></span>
          <span><strong>{text.brand}<sup>V2</sup></strong><small>{text.brandDescription}</small></span></Link>
        <button className="v2-mobile-close v2-icon-button" type="button" onClick={() => setMobileNavigation(false)} aria-label={text.close}><X size={20} /></button>
        <nav aria-label={text.navigation}>
          <p className="v2-nav-label">{text.workspace}</p>
          <button type="button" className="v2-nav-item v2-nav-active" aria-current="page" onClick={() => { setView('summary'); setMobileNavigation(false) }}><LayoutDashboard size={19} /><span>{text.overview}</span><span className="v2-nav-dot" /></button>
          <button type="button" className="v2-nav-item" onClick={() => openPanel('history')}><FileClock size={19} /><span>{text.history}</span></button>
          <p className="v2-nav-label">{text.configuration}</p>
          <button type="button" className="v2-nav-item" aria-label={text.operators} onClick={() => openPanel('operators')}><Users size={19} /><span>{text.operators}</span><small>{owned.length}</small></button>
          <button type="button" className="v2-nav-item" onClick={() => openPanel('config')}><Building2 size={19} /><span>{text.facilities}</span></button>
          <button type="button" className="v2-nav-item" onClick={() => openPanel('preferences')}><SlidersHorizontal size={19} /><span>{text.preferences}</span></button>
          <p className="v2-nav-label">{text.personal}</p>
          <button type="button" className="v2-nav-item" onClick={() => openPanel('account')}><UserIcon /><span>{text.account}</span></button>
          <button type="button" className="v2-nav-item" onClick={() => openPanel('cdk')}><WalletCards size={19} /><span>{text.cdk}</span></button>
        </nav>
        <div className="v2-sidebar-bottom">
          <div className="v2-help-card"><span className="v2-help-icon"><BookOpen size={19} /></span><h3>{text.help}</h3><p>{text.helpDescription}</p><Link to="/faq">{text.helpAction}<ArrowUpRight size={14} /></Link></div>
          <div className="v2-sidebar-version"><span className="v2-green-dot" />{text.version}</div>
        </div>
      </aside>
      <div className="v2-workspace">
        <header className="v2-topbar">
          <div className="v2-breadcrumb"><button className="v2-menu-button v2-icon-button" type="button" onClick={() => setMobileNavigation(true)} aria-label={text.menu}><Menu size={21} /></button>
            <span>{text.workspace}</span><ChevronRight size={14} /><strong>{text.infrastructure}</strong></div>
          <div className="v2-topbar-actions"><Link className="v2-back-link" to="/">{text.backToV1}</Link><span className="v2-sample-pill"><span />{text.testVersion}</span>
            <Link to="/changelog" className="v2-icon-button v2-notification" aria-label={text.updates}><Bell size={19} /><span /></Link>
            <span className="v2-topbar-divider" />
            <button className="v2-profile-button" type="button" onClick={() => openPanel('account')}><span className="v2-profile-avatar">D</span><span>{name}</span><ChevronDown size={14} /></button>
          </div>
        </header>
        <main className="v2-main" tabIndex={-1} data-route-focus>
          <div className="v2-page-title"><div><p className="v2-eyebrow">{text.eyebrow}</p><h1>{text.title}</h1><p>{text.subtitle}</p></div>
            <button className="v2-button v2-button-secondary v2-export-button" type="button" disabled={busy || (!sample && resultMode === 'rotation')} title={resultMode === 'rotation' ? text.exportUnavailable : undefined}
              onClick={sample ? downloadSample : onExport}><Download size={16} />{sample ? text.sampleExport : text.export}</button></div>
          <div className="v2-ready-banner">
            <span className="v2-ready-icon"><Check size={25} strokeWidth={2} /></span>
            <div><h2>{text.resultReady}<span className="v2-ready-tag">{sample ? text.sample : SCHEDULE_MODE_LABELS[resultMode]}</span></h2><p>{text.resultDescription}</p></div>
            <div className="v2-banner-actions"><button type="button" className="v2-button v2-button-white" onClick={() => openPanel('config')}><Settings2 size={16} />{text.configure}</button>
              <button type="button" className="v2-button v2-button-primary" disabled={busy || loadingResult || Boolean(generationDisabledReason)} title={generationDisabledReason ?? undefined}
                onClick={() => onGenerate ? onGenerate() : openPanel('account')}><RefreshCw size={16} className={busy ? 'v2-spin' : ''} />{busy ? text.generating : text.regenerate}</button></div>
          </div>
          <div className="v2-result-context"><span><span className="v2-green-dot" />{sample ? text.sampleProfile : name}</span>
            <span><Building2 size={13} />{config.layout}</span><span><Users size={13} />{text.owned(owned.length)}</span><span><Clock3 size={13} />{text.shiftHours(hours.join(' / '))}</span>
            <button type="button" onClick={() => openPanel('config')}>{text.configure}<ChevronRight size={12} /></button></div>
          {(loadingResult || error || notice || downloadNotice || configChanged) && <div className={`v2-feedback ${error ? 'v2-feedback-error' : ''}`} role={error ? 'alert' : 'status'} aria-live="polite">
            {loadingResult ? text.loadingResult : error ?? notice ?? (downloadNotice ? text.exported : sample ? text.demoConfigChanged : text.configChanged)}
            {error && onRetryResult && <button type="button" onClick={onRetryResult}>{text.retry}</button>}
          </div>}
          {children}
          <div className="v2-metrics">
            <Metric label={text.lmd} value={formatAmount(prepared.productionStats.lmd)} unit={text.daily} hint={text.outputSubtitle} product="LMD" tone="mint" />
            <Metric label={text.exp} value={formatAmount((prepared.productionStats.manufacturing['Battle Record'] ?? 0) * 1000)} unit={text.expUnit} hint={text.outputSubtitle} product="Battle Record" tone="blue" />
            <Metric label={text.totalEfficiency} value={formatAmount(prepared.totalEff)} unit="%" hint={text.efficiencyHint} icon={<Activity size={20} />} tone="amber" />
            <Metric label={text.sanity} value={prepared.productionSanity.value.toFixed(1)} unit={text.daily} hint={text.sanityHint} icon={<Gem size={20} />} tone="purple" />
          </div>
          <div className="v2-content-tabs" role="group" aria-label={text.resultTabs}>
            {([['summary', text.summaryTab], ['details', text.detailsTab], ['analysis', text.analysisTab]] as const).map(([id, label]) => <button type="button" key={id} aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>)}
            <span><ShieldCheck size={14} />{sample ? text.sampleSource : text.ownSource}</span>
          </div>
          <div className={`v2-results-grid ${view === 'details' ? 'v2-results-expanded' : ''}`}>
            {view === 'analysis' ? (
              <section className="v2-panel v2-analysis"><div className="v2-panel-heading"><h2>{text.analysisTab}</h2><span className="v2-neutral-tag">24h</span></div><OutputChart result={result} large />
                <div className="v2-analysis-note"><Gem size={21} /><div><h3>{text.sanity}: {prepared.productionSanity.value.toFixed(1)} {text.daily}</h3><p>{prepared.productionSanity.note}</p></div></div><p className="v2-muted">{text.estimateNotice}</p></section>
            ) : (
              <ScheduleBoard result={result} operators={operators} expanded={view === 'details'} onRoom={(nextRoom) => { setRoom(nextRoom); openPanel('room') }} />
            )}
            {view !== 'details' && <aside className="v2-result-aside">
              <section className="v2-panel v2-production-panel">
                <div className="v2-panel-heading"><h2>{text.dailyOutput}</h2><span className="v2-output-clock"><CalendarClock size={16} /></span></div>
                <p className="v2-panel-subtitle">{text.outputSubtitle}</p>
                <OutputRow product="LMD" value={prepared.productionStats.lmd} />
                <OutputRow product="Battle Record" value={prepared.productionStats.manufacturing['Battle Record'] ?? 0} />
                <OutputRow product="Pure Gold" value={prepared.productionStats.manufacturing['Pure Gold'] ?? 0} />
                <OutputChart result={result} />
              </section>
              <section className="v2-panel v2-config-panel">
                <div className="v2-panel-heading"><h2>{text.currentConfig}</h2><button className="v2-text-button" type="button" onClick={() => openPanel('config')}>{text.edit}<ArrowUpRight size={13} /></button></div>
                <div className="v2-layout-preview">
                  {Array.from({ length: config.trading_stations_count }, (_, index) => <span className="v2-layout-trading" key={`t${index}`}><Building2 size={14} /></span>)}
                  {Array.from({ length: config.manufacturing_stations_count }, (_, index) => <span className="v2-layout-manufacture" key={`m${index}`}><Factory size={14} /></span>)}
                  {Array.from({ length: Math.max(0, 9 - config.trading_stations_count - config.manufacturing_stations_count) }, (_, index) => <span className="v2-layout-power" key={`p${index}`}><Zap size={14} /></span>)}
                </div>
                <dl className="v2-config-summary"><div><dt>{text.layout}</dt><dd>{config.layout}</dd></div><div><dt>{text.mode}</dt><dd>{SCHEDULE_MODE_LABELS[configMode]}</dd></div>
                  <div><dt>{text.duration}</dt><dd>{hours.join(' / ')}h</dd></div><div><dt>{text.drones}</dt><dd>{config.drones?.enable ? config.drones.auto ? text.automatic : text.manual : text.disabled}</dd></div></dl>
                <button className="v2-operator-summary" type="button" onClick={() => openPanel('operators')}><div className="v2-avatar-stack">{owned.slice(0, 4).map((operator) => <Avatar key={operator.id} operator={operator} small />)}</div><span><strong>{text.operatorData}</strong><small>{text.owned(owned.length)}</small></span><ChevronRight size={15} /></button>
              </section>
            </aside>}
          </div>
          <div className="v2-sample-notice"><span className="v2-notice-icon"><Sparkles size={16} /></span><p>{sample ? text.sampleHint : text.estimateNotice}</p>{sample && <button type="button" onClick={() => openPanel('account')}>{session.user ? text.account : text.login}<ArrowRight size={14} /></button>}</div>
          <footer className="v2-footer"><span>{text.footer}</span><nav><Link to="/faq">{text.helpAction}</Link><Link to="/terms">{text.terms}</Link><Link to="/privacy">{text.privacy}</Link></nav></footer>
        </main>
      </div>
      <OptionsDrawer panel={panel} onClose={() => setPanel(null)} session={session} config={config} operators={operators}
        onUpdateConfig={onUpdateConfig} permission={permission} canEditConfig={canEditConfig} canUseIntermediateConfig={canUseIntermediateConfig}
        sample={sample} busy={busy} onOperatorsChange={onOperatorsChange} onImportOperators={onImportOperators}
        onAccount={() => openPanel('account')} history={history} onHistory={onHistory} room={room} />
    </div>
  )
}

function UserIcon() {
  return <span className="v2-user-nav-icon"><Users size={18} /></span>
}

function Metric({ label, value, unit, hint, product, icon, tone }: { label: string; value: string; unit: string; hint: string; product?: string; icon?: ReactNode; tone: string }) {
  return <section className={`v2-metric v2-metric-${tone}`} aria-label={label}><div className="v2-metric-top"><span>{label}</span><span className="v2-metric-icon">{product ? <ProductIcon product={product} size={24} /> : icon}</span></div>
    <p className="v2-metric-value">{value}<small>{unit}</small></p><p className="v2-metric-hint">{hint}</p></section>
}

function OutputRow({ product, value }: { product: string; value: number }) {
  const labels: Record<string, string> = { LMD: copy.common.components_ConfigEditor_001, 'Battle Record': copy.common.components_ConfigEditor_004, 'Pure Gold': copy.common.components_ConfigEditor_003 }
  return <div className="v2-output-row"><span><ProductIcon product={product} size={29} /><span>{labels[product]}</span></span><strong>{formatAmount(value)}<small>{text.daily}</small></strong></div>
}
