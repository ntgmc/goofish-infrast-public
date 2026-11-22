import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link, useSearchParams } from 'react-router'
import { copy } from '../../../copy'
import { useGainClockQuery } from '../../../lib/value-clock-query'
import { useValueClockReadings } from '../../../lib/use-value-clock-readings'
import ValueClockNumber from '../ValueClockNumber'
import '../value-clock.css'
import './optimization-gain-clock.css'

const Personal = lazy(() => import('./OptimizationGainPersonal'))
const text = copy.optimizationGainClock
const shared = copy.valueClock
const format = (value: number | undefined, signed = false, decimals = 2) => value === undefined ? '—' : value.toLocaleString('zh-CN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, signDisplay: signed ? 'exceptZero' : 'auto' })

export default function OptimizationGainClock() {
  const root = useRef<HTMLElement>(null), fullscreenButton = useRef<HTMLButtonElement>(null)
  const [display, setDisplay] = useState(false)
  const [params, setParams] = useSearchParams()
  const local = import.meta.env.DEV && import.meta.env.MODE !== 'test'
  const preview = local && params.get('clock_data') !== 'live'
  useEffect(() => {
    const exit = () => { if (display && !document.fullscreenElement) { setDisplay(false); fullscreenButton.current?.focus() } }
    const handleEscape = (event: KeyboardEvent) => { if (display && event.key === 'Escape' && !event.defaultPrevented && !document.fullscreenElement) exit() }
    document.addEventListener('fullscreenchange', exit)
    document.addEventListener('keydown', handleEscape)
    return () => { document.removeEventListener('fullscreenchange', exit); document.removeEventListener('keydown', handleEscape) }
  }, [display])
  async function fullscreen() {
    if (display) {
      if (document.fullscreenElement) await document.exitFullscreen()
      setDisplay(false); fullscreenButton.current?.focus()
    } else {
      setDisplay(true)
      try { await root.current?.requestFullscreen?.() } catch { root.current?.scrollIntoView({ block: 'start' }) }
    }
  }
  return <main ref={root} className={`value-clock optimization-gain-clock${display ? ' value-clock-display' : ''}`} aria-labelledby="gain-clock-title" data-route-focus tabIndex={-1}>
    <div className="value-clock-shell">
      <header className="value-clock-masthead"><Link to="/v2" aria-label={shared.home}>MaaTool</Link><h1 id="gain-clock-title">{text.title}</h1></header>
      {local && <aside className="value-clock-preview"><span>{preview ? text.localPreview : shared.localLive}</span><button type="button" className="value-clock-action" onClick={() => setParams((current) => { const next = new URLSearchParams(current); if (preview) next.set('clock_data', 'live'); else next.delete('clock_data'); return next }, { replace: true })}>{preview ? shared.liveData : text.previewData}</button></aside>}
      <GainReadings key={preview ? 'preview' : 'live'} preview={preview} fullscreen={<button ref={fullscreenButton} type="button" className="value-clock-action" onClick={() => void fullscreen()}>{display ? shared.exitFullscreen : shared.fullscreen}</button>} />
      <div className="gain-personal-entry"><button type="button" className="value-clock-action" aria-expanded={params.get('personal') === '1'} onClick={() => setParams((current) => { const next = new URLSearchParams(current); if (next.get('personal') === '1') next.delete('personal'); else next.set('personal', '1'); return next }, { replace: true })}>{params.get('personal') === '1' ? text.closePersonal : text.setBaseline}</button></div>
      {params.get('personal') === '1' && <Suspense fallback={<p className="gain-personal-loading" role="status">{text.loading}</p>}><Personal /></Suspense>}
    </div>
  </main>
}

function GainReadings({ fullscreen, preview }: { fullscreen: React.ReactNode; preview: boolean }) {
  const query = useGainClockQuery(preview)
  const [paused, setPaused] = useState(false)
  const { reading, calibrated, reduced } = useValueClockReadings(query.data, paused)
  const snapshot = query.data?.snapshot
  const value = reading.details?.totals?.sanity
  const today = reading.details?.today?.sanity
  const comparison = snapshot?.comparison
  const daily = snapshot?.rates_per_second?.sanity === undefined ? undefined : snapshot.rates_per_second.sanity * 86_400
  const direction = value === undefined ? 'unknown' : value < 0 ? 'negative' : value > 0 ? 'positive' : 'equal'
  const status = !snapshot ? query.error ? shared.paused : shared.loading
    : reading.stale || snapshot.status === 'paused' ? shared.paused : snapshot.status === 'rebuilding' ? shared.rebuilding
      : !comparison?.has_recorded_comparison ? text.unknown : !comparison.active_comparable_accounts ? text.noActive : text.ready
  const maximum = Math.max(comparison?.current_daily_sanity ?? 0, comparison?.baseline_daily_sanity ?? 0)
  const bar = comparison && comparison.active_comparable_accounts > 0 && comparison.current_daily_sanity >= 0 && comparison.baseline_daily_sanity >= 0 && maximum > 0
  return <>
    <div className="value-clock-toolbar"><p className="value-clock-status" role="status"><span className="value-clock-status-mark" data-live={status === text.ready || undefined} /><span className="value-clock-status-text" data-live={status === text.ready || undefined}>{status}</span></p><div className="value-clock-actions"><button type="button" className="value-clock-action" aria-pressed={paused} onClick={() => setPaused((value) => !value)}>{paused ? shared.resume : shared.pause}</button>{fullscreen}</div></div>
    <div className="value-clock-hero" aria-busy={query.isPending} data-direction={direction}>
      <h2 className="value-clock-eyebrow">{text.headline}</h2>
      <p className="value-clock-total-label">{text.total}</p>
      <div className="value-clock-total" style={{ '--value-clock-characters': format(value, true).length } as CSSProperties} role="img" aria-label={`${text.total} ${format(value, true)} ${shared.unit}`}><span aria-hidden="true"><ValueClockNumber value={value} signed animated={!reduced && !paused && !reading.stale && (value ?? 0) > 0} /></span></div>
      <p className="value-clock-unit">{shared.unit}</p>
      <p className="gain-direction">{text[direction]}</p>
    </div>
    <dl className="gain-metrics"><div><dt>{daily === undefined || daily === 0 ? text.daily : daily < 0 ? text.dailyNegative : text.dailyPositive}</dt><dd data-negative={daily !== undefined && daily < 0 || undefined}>{format(daily, true)}<small>{shared.unit}</small></dd></div><div><dt>{text.today}</dt><dd data-negative={today !== undefined && today < 0 || undefined}>{format(today, true)}<small>{shared.unit}</small></dd></div></dl>
    <div className="gain-comparison">
      <p className="gain-comparison-heading">{text.comparison}{comparison && comparison.active_comparable_accounts > 0 && comparison.gain_ratio !== null && <span>{text.ratio} <strong>{format(comparison.gain_ratio * 100, true)}%</strong></span>}</p>
      <dl className="gain-comparison-values">{([['current_daily_sanity', text.current], ['baseline_daily_sanity', text.baseline]] as const).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{format(comparison && comparison.active_comparable_accounts > 0 ? comparison[key] : undefined)}<small>{text.perDay}</small></dd>{bar && <div className="gain-comparison-track" aria-hidden="true"><span style={{ width: `${comparison[key] / maximum * 100}%` }} /></div>}</div>)}</dl>
    </div>
    <p className="gain-coverage"><span>{text.coverage} <strong>{format(comparison?.active_comparable_accounts, false, 0)}</strong></span><span aria-hidden="true">/</span><span>{text.productionAccounts} <strong>{format(comparison?.active_production_accounts, false, 0)}</strong></span></p>
    <div className="value-clock-data-note">
      {(query.error || reading.stale) && <p role="status">{query.error && shared.refreshFailed} <button type="button" className="value-clock-action" disabled={query.isFetching} onClick={() => void query.refetch()}>{shared.retry}</button></p>}
      {paused && <p role="status">{shared.displayPaused}</p>}{calibrated && <p role="status">{shared.calibrated}</p>}
      <p>{text.note}</p>
      <details className="value-clock-disclosure"><summary>{text.methodology}</summary><div className="value-clock-methodology"><p>{text.methodologyComparison}</p><p>{text.methodologyTime}</p><p>{text.methodologyResources}</p><p>{shared.completeValue}：{format(value, true)} {shared.unit}</p>{snapshot?.tracking_started_at && <p>{shared.trackingSince}：{new Date(snapshot.tracking_started_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</p>}{snapshot && <p>{shared.updated}：<time dateTime={snapshot.as_of}>{new Date(snapshot.as_of).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</time></p>}</div></details>
    </div>
  </>
}
