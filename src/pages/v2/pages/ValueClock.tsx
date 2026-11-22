import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { copy } from '../../../copy'
import { useAppReducedMotion } from '../../../lib/motion-preference'
import { projectValueClock, type ValueClockSnapshot } from '../../../lib/value-clock'
import { useValueClockQuery } from '../../../lib/value-clock-query'
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
    <ClockReadings fullscreen={<button ref={fullscreenButton} type="button" className="value-clock-action" onClick={() => void toggleFullscreen()}>{display ? text.exitFullscreen : text.fullscreen}</button>} />
    </div>
  </main>
}

function ClockReadings({ fullscreen }: { fullscreen: ReactNode }) {
  const query = useValueClockQuery()
  const reduced = useAppReducedMotion()
  const [paused, setPaused] = useState(false)
  const [calibrated, setCalibrated] = useState(false)
  const previous = useRef<{ snapshot: ValueClockSnapshot; receivedAt: number } | null>(null)
  const [reading, setReading] = useState({ sanity: '—', sanityFull: '—', today: '—', todayFull: '—', lmd: '—', experience: '—', orundum: '—', progress: 0, stale: false })
  const data = query.data
  useEffect(() => {
    if (!data) return
    const old = previous.current
    if (old && (old.snapshot.series_id !== data.snapshot.series_id || data.snapshot.revision !== old.snapshot.revision && (data.snapshot.totals?.sanity ?? 0) < (projectValueClock(old.snapshot, performance.now() - old.receivedAt).totals?.sanity ?? 0) - 0.005)) setCalibrated(true)
    previous.current = data
    const tick = () => {
      if (document.hidden) return
      const snapshot = data.snapshot
      const elapsed = performance.now() - data.receivedAt + Math.max(0, Date.parse(snapshot.server_now) - Date.parse(snapshot.as_of))
      const values = projectValueClock(snapshot, elapsed)
      const stale = Boolean(snapshot.valid_until && elapsed >= Date.parse(snapshot.valid_until) - Date.parse(snapshot.as_of))
      const sanity = values.totals?.sanity ?? 0
      const step = Math.abs(sanity) >= 1e8 ? 1e6 : Math.abs(sanity) >= 1e4 ? 100 : .01
      const progress = Math.round(((sanity % step + step) % step) / step * 1000)
      setReading((current) => {
        const next = paused ? { ...current, stale } : {
          sanity: compact(values.totals?.sanity), sanityFull: full(values.totals?.sanity), today: compact(values.today?.sanity), todayFull: full(values.today?.sanity),
          lmd: full(values.totals?.lmd_net, 0), experience: full(values.totals?.experience_points, 0), orundum: full(values.totals?.orundum, 0), progress, stale,
        }
        return Object.keys(next).every((key) => next[key as keyof typeof next] === current[key as keyof typeof current]) ? current : next
      })
    }
    tick()
    const timer = window.setInterval(tick, reduced ? 1000 : 250)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick) }
  }, [data, reduced, paused])
  const snapshot = data?.snapshot
  const status = !snapshot ? query.error ? text.paused : text.loading
    : reading.stale || snapshot.status === 'paused' ? text.paused
      : snapshot.status === 'not_started' ? text.notStarted : snapshot.status === 'rebuilding' ? text.rebuilding : snapshot.status === 'empty' ? text.empty : text.ready
  return <>
    <div className="value-clock-toolbar"><p className="value-clock-status" role="status"><span className="value-clock-status-mark" data-live={status === text.ready || undefined} /><span className="value-clock-status-text" data-live={status === text.ready || undefined}>{status}</span></p><div className="value-clock-actions"><button type="button" className="value-clock-action" onClick={() => setPaused((value) => !value)}>{paused ? text.resume : text.pause}</button>{fullscreen}</div></div>
    <div className="value-clock-hero" aria-busy={query.isPending}>
      <h2 className="value-clock-eyebrow"><span>{text.headlineLead}</span><span>{text.headlineEnd}</span></h2>
      <p className="value-clock-total-label">{text.total}</p>
      <div className="value-clock-total" aria-label={`${text.total} ${reading.sanityFull} ${text.unit}`}><span className="value-clock-total-full" aria-hidden="true">{reading.sanityFull}</span><span className="value-clock-total-compact" aria-hidden="true">{reading.sanity}</span></div>
      <p className="value-clock-unit">{text.unit}</p>
      <progress className="value-clock-progress" aria-label={text.progress} value={reading.progress} max={1000} hidden={!snapshot?.totals || Math.abs(snapshot.totals.sanity) < 1e4 || !snapshot.rates_per_second || snapshot.rates_per_second.sanity <= 0} />
      <p className="value-clock-rate">{text.rate}<strong>{full(snapshot?.rates_per_second ? snapshot.rates_per_second.sanity * 60 : undefined)}</strong><span>{text.unit}</span></p>
    </div>
    <dl className="value-clock-resources" aria-label={text.resources}>
      <div><dt>{text.lmd}</dt><dd>{reading.lmd}</dd></div><div><dt>{text.experience}</dt><dd>{reading.experience}</dd></div><div><dt>{text.orundum}</dt><dd>{reading.orundum}</dd></div>
    </dl>
    <dl className="value-clock-secondary"><div><dt>{text.today}</dt><dd aria-label={`${reading.todayFull} ${text.unit}`}><span aria-hidden="true">{reading.today}</span><small aria-hidden="true">{text.unit}</small></dd></div><div><dt>{text.accounts}</dt><dd><span>{snapshot ? full(snapshot.active_accounts, 0) : '—'}</span><small>{text.accountUnit}</small></dd></div></dl>
    <div className="value-clock-data-note">
      {(query.error || reading.stale) && <p role="status">{query.error && text.refreshFailed} <button type="button" className="value-clock-action" disabled={query.isFetching} onClick={() => void query.refetch()}>{text.retry}</button></p>}
      {paused && <p role="status">{text.displayPaused}</p>}{calibrated && <p role="status">{text.calibrated}</p>}
      <details className="value-clock-disclosure"><summary>{text.methodology}</summary><div className="value-clock-methodology"><p>{text.methodologyIntro}</p><p>{text.methodologyResources}</p><p>{text.methodologyTime}</p><p>{text.completeValue}：{reading.sanityFull} {text.unit}</p>{snapshot?.tracking_started_at && <p>{text.trackingSince}：{new Date(snapshot.tracking_started_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</p>}{snapshot && <p>{text.updated}：<time dateTime={snapshot.as_of}>{new Date(snapshot.as_of).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</time></p>}</div></details>
    </div>
  </>
}
