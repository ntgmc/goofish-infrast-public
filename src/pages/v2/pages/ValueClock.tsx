import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { copy } from '../../../copy'
import { useAppReducedMotion } from '../../../lib/motion-preference'
import { projectValueClock, type ValueClockSnapshot } from '../../../lib/value-clock'
import { useValueClockQuery } from '../../../lib/value-clock-query'
import ValueClockNumber from '../ValueClockNumber'
import '../value-clock.css'

const text = copy.valueClock
const full = (value: number | undefined, decimals = 2) => value === undefined ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: decimals, minimumFractionDigits: decimals })
const compact = (value: number | undefined) => {
  if (value === undefined) return '—'
  const magnitude = Math.abs(value)
  return magnitude >= 1e8 ? `${full(value / 1e8)} ${text.hundredMillion}` : magnitude >= 1e4 ? `${full(value / 1e4)} ${text.tenThousand}` : full(value)
}

export default function ValueClock() {
  const root = useRef<HTMLDivElement>(null), fullscreenButton = useRef<HTMLButtonElement>(null)
  const [display, setDisplay] = useState(false)
  const [params, setParams] = useSearchParams()
  const local = import.meta.env.DEV && import.meta.env.MODE !== 'test'
  const preview = local && params.get('clock_data') !== 'live'
  useEffect(() => {
    const exit = () => { if (display && !document.fullscreenElement) { setDisplay(false); fullscreenButton.current?.focus() } }
    const handleEscape = (event: KeyboardEvent) => { if (display && event.key === 'Escape' && !event.defaultPrevented && !document.fullscreenElement) { setDisplay(false); fullscreenButton.current?.focus() } }
    document.addEventListener('fullscreenchange', exit)
    document.addEventListener('keydown', handleEscape)
    return () => { document.removeEventListener('fullscreenchange', exit); document.removeEventListener('keydown', handleEscape) }
  }, [display])
  const toggleFullscreen = async () => {
    if (display) {
      if (document.fullscreenElement) await document.exitFullscreen()
      setDisplay(false); fullscreenButton.current?.focus()
    } else {
      setDisplay(true)
      try { await root.current?.requestFullscreen?.() } catch { root.current?.scrollIntoView({ block: 'start' }) }
    }
  }
  return <main ref={root} className={`value-clock${display ? ' value-clock-display' : ''}`} aria-labelledby="value-clock-title" data-route-focus tabIndex={-1}>
    <div className="value-clock-shell">
    <header className="value-clock-masthead"><Link to="/v2" aria-label={text.home}>MaaTool</Link><h1 id="value-clock-title">{text.title}</h1></header>
    {local && <aside className="value-clock-preview"><span>{preview ? text.localPreview : text.localLive}</span><button type="button" className="value-clock-action" onClick={() => setParams((current) => { const next = new URLSearchParams(current); if (preview) next.set('clock_data', 'live'); else next.delete('clock_data'); return next }, { replace: true })}>{preview ? text.liveData : text.previewData}</button></aside>}
    <ClockReadings key={preview ? 'preview' : 'live'} preview={preview} fullscreen={<button ref={fullscreenButton} type="button" className="value-clock-action" onClick={() => void toggleFullscreen()}>{display ? text.exitFullscreen : text.fullscreen}</button>} />
    </div>
  </main>
}

function ClockReadings({ fullscreen, preview }: { fullscreen: ReactNode; preview: boolean }) {
  const query = useValueClockQuery(preview)
  const reduced = useAppReducedMotion()
  const [paused, setPaused] = useState(false)
  const [calibrated, setCalibrated] = useState(false)
  const previous = useRef<{ snapshot: ValueClockSnapshot; receivedAt: number } | null>(null)
  const [reading, setReading] = useState<ReturnType<typeof projectValueClock> & { details: ReturnType<typeof projectValueClock> | null; stale: boolean }>({ totals: null, today: null, details: null, stale: false })
  const data = query.data
  useEffect(() => {
    if (!data) return
    const old = previous.current
    if (old && (old.snapshot.series_id !== data.snapshot.series_id || data.snapshot.revision !== old.snapshot.revision && (data.snapshot.totals?.sanity ?? 0) < (projectValueClock(old.snapshot, performance.now() - old.receivedAt).totals?.sanity ?? 0) - 0.005)) setCalibrated(true)
    previous.current = data
    const snapshot = data.snapshot
    const moving = snapshot.status === 'ready' && Object.values(snapshot.rates_per_second ?? {}).some((rate) => rate !== 0)
    let timer = 0, detailsAt = -Infinity
    const tick = () => {
      if (document.hidden) return
      const now = performance.now()
      const elapsed = now - data.receivedAt + Math.max(0, Date.parse(snapshot.server_now) - Date.parse(snapshot.as_of))
      const values = projectValueClock(snapshot, elapsed)
      const remaining = snapshot.valid_until ? Date.parse(snapshot.valid_until) - Date.parse(snapshot.as_of) - elapsed : null
      const stale = remaining !== null && remaining <= 0
      const refreshDetails = now - detailsAt >= 1000 || stale
      if (refreshDetails) detailsAt = now
      setReading((current) => paused ? current.stale === stale ? current : { ...current, stale }
        : { ...values, details: refreshDetails ? values : current.details, stale })
      if (remaining !== null && !stale) timer = window.setTimeout(tick, moving && !paused ? Math.min(reduced ? 1000 : 250, remaining) : remaining)
    }
    const stop = () => { clearTimeout(timer) }
    const visibility = () => { stop(); tick() }
    tick()
    document.addEventListener('visibilitychange', visibility)
    return () => { stop(); document.removeEventListener('visibilitychange', visibility) }
  }, [data, reduced, paused])
  const snapshot = data?.snapshot
  const sanity = reading.totals?.sanity
  const displaySanity = reading.details?.totals?.sanity ?? sanity
  const sanityFull = full(sanity)
  const displaySanityFull = full(displaySanity)
  const status = !snapshot ? query.error ? text.paused : text.loading
    : reading.stale || snapshot.status === 'paused' ? text.paused
      : snapshot.status === 'not_started' ? text.notStarted : snapshot.status === 'rebuilding' ? text.rebuilding : snapshot.status === 'empty' ? text.empty : text.ready
  return <>
    <div className="value-clock-toolbar"><p className="value-clock-status" role="status"><span className="value-clock-status-mark" data-live={status === text.ready || undefined} /><span className="value-clock-status-text" data-live={status === text.ready || undefined}>{status}</span></p><div className="value-clock-actions"><button type="button" className="value-clock-action" onClick={() => setPaused((value) => !value)}>{paused ? text.resume : text.pause}</button>{fullscreen}</div></div>
    <div className="value-clock-hero" aria-busy={query.isPending}>
      <h2 className="value-clock-eyebrow"><span>{text.headlineLead}</span><span>{text.headlineEnd}</span></h2>
      <p className="value-clock-total-label">{text.total}</p>
      <div className="value-clock-total" style={{ '--value-clock-characters': displaySanityFull.length } as CSSProperties} aria-label={`${text.total} ${displaySanityFull} ${text.unit}`}><span aria-hidden="true"><ValueClockNumber value={displaySanity} animated={!reduced && !paused && !reading.stale} /></span></div>
      <p className="value-clock-unit">{text.unit}</p>
      <p className="value-clock-rate">{text.rate}<strong>{full(snapshot?.rates_per_second ? snapshot.rates_per_second.sanity * 60 : undefined)}</strong><span>{text.unit}</span></p>
    </div>
    <dl className="value-clock-resources" aria-label={text.resources}>
      <div><dt>{text.lmd}</dt><dd style={{ '--value-clock-characters': full(reading.details?.totals?.lmd_net, 0).length } as CSSProperties}>{full(reading.details?.totals?.lmd_net, 0)}</dd></div><div><dt>{text.experience}</dt><dd style={{ '--value-clock-characters': full(reading.details?.totals?.experience_points, 0).length } as CSSProperties}>{full(reading.details?.totals?.experience_points, 0)}</dd></div><div><dt>{text.orundum}</dt><dd style={{ '--value-clock-characters': full(reading.details?.totals?.orundum, 0).length } as CSSProperties}>{full(reading.details?.totals?.orundum, 0)}</dd></div>
    </dl>
    <dl className="value-clock-secondary"><div><dt>{text.today}</dt><dd aria-label={`${full(reading.details?.today?.sanity)} ${text.unit}`}><span aria-hidden="true">{compact(reading.details?.today?.sanity)}</span><small aria-hidden="true">{text.unit}</small></dd></div><div><dt>{text.accounts}</dt><dd><span>{snapshot ? full(snapshot.active_accounts, 0) : '—'}</span><small>{text.accountUnit}</small></dd></div></dl>
    <div className="value-clock-data-note">
      {(query.error || reading.stale) && <p role="status">{query.error && text.refreshFailed} <button type="button" className="value-clock-action" disabled={query.isFetching} onClick={() => void query.refetch()}>{text.retry}</button></p>}
      {paused && <p role="status">{text.displayPaused}</p>}{calibrated && <p role="status">{text.calibrated}</p>}
      <details className="value-clock-disclosure"><summary>{text.methodology}</summary><div className="value-clock-methodology"><p>{text.methodologyIntro}</p><p>{text.methodologyResources}</p><p>{text.methodologyTime}</p><p>{text.completeValue}：{sanityFull} {text.unit}</p>{snapshot?.tracking_started_at && <p>{text.trackingSince}：{new Date(snapshot.tracking_started_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</p>}{snapshot && <p>{text.updated}：<time dateTime={snapshot.as_of}>{new Date(snapshot.as_of).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</time></p>}</div></details>
    </div>
  </>
}
