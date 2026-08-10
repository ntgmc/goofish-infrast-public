import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import BrandLogo from '../components/BrandLogo'
import PublicFooter from '../components/PublicFooter'
import ServiceStatusBadge from '../components/ServiceStatusBadge'
import ThemeSwitcher from '../components/ThemeSwitcher'
import { copy } from '../copy/index'
import {
  QUEUE_CONGESTION_THRESHOLD,
  QUEUE_OVERLOAD_THRESHOLD,
  SERVICE_STATUS_HISTORY_HOURS,
  SERVICE_STATUS_LEVELS,
  type PublicStatusIncident,
  type ServiceStatusHistoryBucket,
  type ServiceStatusHistoryLevel,
  type ServiceStatusLevel,
  type ServiceStatusResponse,
} from '../lib/service-status'

const POLL_INTERVAL_MS = 30_000

const UNAVAILABLE_STATUS: ServiceStatusResponse = {
  generated_at: new Date(0).toISOString(),
  status: 'unavailable',
  queue: null,
  components: [{ id: 'optimization', status: 'unavailable' }],
  thresholds: { queue_congested_at: QUEUE_CONGESTION_THRESHOLD, queue_overloaded_at: QUEUE_OVERLOAD_THRESHOLD },
  history: {
    from: new Date(0).toISOString(),
    to: new Date(0).toISOString(),
    interval: 'hour',
    complete: false,
    buckets: [],
  },
  incidents: [],
}

export default function StatusPage() {
  const [status, setStatus] = useState<ServiceStatusResponse | null>(null)
  const [error, setError] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const requestRef = useRef<AbortController | null>(null)

  const loadStatus = useCallback(async () => {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setRefreshing(true)
    try {
      const response = await fetch('/api/status', {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      })
      const payload = await response.json() as unknown
      if (controller.signal.aborted) return
      if (!isServiceStatusResponse(payload)) throw new Error('invalid_status_response')
      setStatus(normalizeStatusResponse(payload))
      setError(!response.ok)
    } catch {
      if (controller.signal.aborted) return
      setStatus({ ...UNAVAILABLE_STATUS, generated_at: new Date().toISOString() })
      setError(true)
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null
        setRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    void loadStatus()
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadStatus()
    }, POLL_INTERVAL_MS)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void loadStatus()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      requestRef.current?.abort()
    }
  }, [loadStatus])

  const currentStatus = status ?? UNAVAILABLE_STATUS
  const optimizationStatus = currentStatus.components[0]?.status ?? currentStatus.status
  const statusMessage = status ? statusMessageFor(status.status) : copy.status.pages_StatusPage_024

  return (
    <main className="tool-page" tabIndex={-1} data-route-focus>
      <div className="public-shell">
        <header className="public-nav">
          <Link to="/" className="flex min-w-0 flex-1 items-center gap-2 text-left sm:gap-3">
            <BrandLogo size="sm" className="sm:h-10 sm:w-10 sm:rounded-lg sm:p-1" />
            <span className="truncate text-sm font-semibold text-ink-primary">{copy.status.pages_StatusPage_001}</span>
          </Link>
          <nav className="flex shrink-0 items-center gap-2 sm:gap-3" aria-label={copy.status.pages_StatusPage_002}>
            <div className="sm:hidden"><ThemeSwitcher iconOnly /></div>
            <div className="hidden sm:block"><ThemeSwitcher /></div>
            <Link to="/tool/profiles" className="tool-primary-action">{copy.status.pages_StatusPage_005}</Link>
          </nav>
        </header>

        <div className="mx-auto max-w-4xl py-12 sm:py-16 lg:py-20">
          <header className="status-reading-measure">
            <p className="public-kicker">{copy.status.pages_StatusPage_002}</p>
            <h1 className="display-title mt-3 text-4xl leading-tight text-ink-primary sm:text-5xl">{copy.status.pages_StatusPage_002}</h1>
            <p className="mt-5 max-w-2xl text-base leading-8 text-ink-secondary">{copy.status.pages_StatusPage_003}</p>
          </header>

          <section className="tool-panel mt-10 p-5 sm:p-7" aria-labelledby="status-overall-title" aria-live="polite">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="public-kicker">{copy.status.pages_StatusPage_006}</p>
                <h2 id="status-overall-title" className="mt-2 text-2xl font-semibold text-ink-primary sm:text-3xl">{statusMessage}</h2>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-ink-secondary">
                  {formatUpdatedAt(currentStatus.generated_at)} · {copy.status.pages_StatusPage_007}
                </p>
              </div>
              {status ? <ServiceStatusBadge level={currentStatus.status} /> : <span className="tool-status">{copy.status.pages_StatusPage_024}</span>}
            </div>
            {error && (
              <div className="tool-alert tool-alert--error mt-5" role="alert">
                <p className="font-medium">{copy.status.pages_StatusPage_021}</p>
                <p className="mt-1 text-sm">{copy.status.pages_StatusPage_022}</p>
                <button type="button" className="tool-secondary-action mt-4 gap-2" onClick={() => void loadStatus()} disabled={refreshing}>
                  <RefreshCw aria-hidden="true" className={`size-4 ${refreshing ? 'animate-spin motion-reduce:animate-none' : ''}`} />
                  {copy.status.pages_StatusPage_023}
                </button>
              </div>
            )}
          </section>

          <section className="mt-12 status-reading-measure" aria-labelledby="status-components-title">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="public-kicker">{copy.status.pages_StatusPage_008}</p>
                <h2 id="status-components-title" className="mt-2 text-2xl font-semibold text-ink-primary">{copy.status.pages_StatusPage_009}</h2>
              </div>
              <span className="text-sm text-ink-muted">{formatUpdatedAt(currentStatus.generated_at)}</span>
            </div>
            <article className="mt-5 border-y border-surface-3 py-5" aria-labelledby="optimization-component-title">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h3 id="optimization-component-title" className="text-lg font-semibold text-ink-primary">{copy.status.pages_StatusPage_009}</h3>
                  <p className="mt-2 max-w-2xl text-sm leading-7 text-ink-secondary">{copy.status.pages_StatusPage_010}</p>
                </div>
                <ServiceStatusBadge level={optimizationStatus} compact />
              </div>
            </article>
          </section>

          <StatusHistorySection history={currentStatus.history} />
          <StatusIncidentSection incidents={currentStatus.incidents} />

          <section className="mt-12 status-reading-measure" aria-labelledby="status-rules-title">
            <h2 id="status-rules-title" className="text-2xl font-semibold text-ink-primary">{copy.status.pages_StatusPage_015}</h2>
            <div className="mt-5 divide-y divide-surface-3 border-y border-surface-3">
              <StatusRule level="available" label={copy.status.pages_StatusPage_025} description={copy.status.pages_StatusPage_016} />
              <StatusRule level="scaling" label={copy.status.pages_StatusPage_066} description={copy.status.pages_StatusPage_068} />
              <StatusRule level="busy" label={copy.status.pages_StatusPage_026} description={copy.status.pages_StatusPage_017} />
              <StatusRule level="congested" label={copy.status.pages_StatusPage_027} description={copy.status.pages_StatusPage_018} />
              <StatusRule level="overloaded" label={copy.status.pages_StatusPage_063} description={copy.status.pages_StatusPage_064} />
              <StatusRule level="unavailable" label={copy.status.pages_StatusPage_028} description={copy.status.pages_StatusPage_019} />
            </div>
            <p className="mt-5 text-sm leading-7 text-ink-muted">{copy.status.pages_StatusPage_031}</p>
          </section>
        </div>
      </div>
      <PublicFooter variant="tool" />
    </main>
  )
}

function StatusRule({ level, label, description }: { level: ServiceStatusLevel; label: string; description: string }) {
  return (
    <div className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:gap-6">
      <div className="w-32 shrink-0"><ServiceStatusBadge level={level} compact /></div>
      <p className="text-sm leading-7 text-ink-secondary">{label} · {description}</p>
    </div>
  )
}

function isServiceStatusResponse(value: unknown): value is ServiceStatusResponse {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ServiceStatusResponse>
  return typeof candidate.generated_at === 'string'
    && typeof candidate.status === 'string'
    && SERVICE_STATUS_LEVELS.includes(candidate.status as ServiceStatusLevel)
    && Array.isArray(candidate.components)
}

function normalizeStatusResponse(value: ServiceStatusResponse): ServiceStatusResponse {
  return {
    ...value,
    thresholds: {
      queue_congested_at: value.thresholds?.queue_congested_at ?? QUEUE_CONGESTION_THRESHOLD,
      queue_overloaded_at: value.thresholds?.queue_overloaded_at ?? QUEUE_OVERLOAD_THRESHOLD,
    },
    history: value.history ?? { from: new Date(0).toISOString(), to: new Date(0).toISOString(), interval: 'hour', complete: false, buckets: [] },
    incidents: Array.isArray(value.incidents) ? value.incidents : [],
  }
}

function StatusHistorySection({ history }: { history: ServiceStatusResponse['history'] }) {
  const cells = createHistoryCells(history)
  const rows = Array.from({ length: 30 }, (_, index) => cells.slice(index * 24, (index + 1) * 24))
  const sampled = history.buckets.reduce((sum, bucket) => sum + bucket.sample_count, 0)
  return (
    <section className="mt-12 status-reading-measure" aria-labelledby="status-history-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="public-kicker">{copy.status.pages_StatusPage_036}</p><h2 id="status-history-title" className="mt-2 text-2xl font-semibold text-ink-primary">{copy.status.pages_StatusPage_037}</h2></div>
        <span className="text-sm text-ink-muted">{formatHistoryRange(history.from, history.to)}</span>
      </div>
      <div className="tool-panel mt-5 overflow-hidden p-4 sm:p-5">
        <p className="text-sm leading-7 text-ink-secondary">{copy.status.pages_StatusPage_038}{history.complete ? `${copy.status.pages_StatusPage_039} ${sampled} ${copy.status.pages_StatusPage_040}` : copy.status.pages_StatusPage_041}</p>
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-ink-muted" aria-label={copy.status.pages_StatusPage_042}>
          {(['available', 'scaling', 'busy', 'congested', 'overloaded', 'unavailable', 'unknown'] as const).map((level) => <span key={level} className="inline-flex items-center gap-1.5"><span className={`service-status-history-swatch service-status-history-cell--${level}`} aria-hidden="true" />{statusLabel(level)}</span>)}
        </div>
        <div className="service-status-history-scroll mt-5" tabIndex={0} aria-label={copy.status.pages_StatusPage_043}>
          <div className="service-status-history-grid" role="grid" aria-rowcount={rows.length}>
            {rows.map((row, rowIndex) => <div className="service-status-history-row" role="row" key={rowIndex}>
              <span className="service-status-history-day" aria-hidden="true">{formatDay(row[0]?.bucket_start)}</span>
              {row.map((cell) => <span key={cell.bucket_start} role="gridcell" tabIndex={0} title={historyCellLabel(cell)} aria-label={historyCellLabel(cell)} className={`service-status-history-cell service-status-history-cell--${cell.status}`} />)}
            </div>)}
          </div>
        </div>
      </div>
    </section>
  )
}

function StatusIncidentSection({ incidents }: { incidents: PublicStatusIncident[] }) {
  const active = incidents.filter((incident) => incident.status !== 'resolved')
  const resolved = incidents.filter((incident) => incident.status === 'resolved')
  return (
    <section className="mt-12 status-reading-measure" aria-labelledby="status-incidents-title">
      <p className="public-kicker">{copy.status.pages_StatusPage_044}</p><h2 id="status-incidents-title" className="mt-2 text-2xl font-semibold text-ink-primary">{copy.status.pages_StatusPage_045}</h2>
      {incidents.length === 0 ? <p className="mt-5 text-sm leading-7 text-ink-muted">{copy.status.pages_StatusPage_046}</p> : <div className="mt-5 space-y-4">{[...active, ...resolved].map((incident) => <IncidentCard incident={incident} key={incident.id} />)}</div>}
    </section>
  )
}

function IncidentCard({ incident }: { incident: PublicStatusIncident }) {
  return (
    <article className={`tool-panel border-l-4 p-5 ${incident.status === 'resolved' ? 'border-l-success' : incident.impact === 'critical' ? 'border-l-error' : incident.impact === 'major' ? 'border-l-warning' : 'border-l-brand-500'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-base font-semibold text-ink-primary">{incident.title}</h3><p className="mt-1 text-xs text-ink-muted">{incidentImpactLabel(incident.impact)} · {copy.status.pages_StatusPage_047} {formatUpdatedAt(incident.started_at)}</p></div><span className="tool-status">{incidentStatusLabel(incident.status)}</span></div>
      <ol className="mt-4 space-y-3 border-l border-surface-3 pl-4">{incident.updates.map((update) => <li key={update.id} className="relative text-sm leading-6 text-ink-secondary"><span className="absolute -left-[1.35rem] top-2 h-2 w-2 rounded-full bg-brand-500" aria-hidden="true" /><p>{update.body}</p><time className="text-xs text-ink-muted" dateTime={update.created_at}>{incidentStatusLabel(update.status)} · {formatUpdatedAt(update.created_at)}</time></li>)}</ol>
    </article>
  )
}

function createHistoryCells(history: ServiceStatusResponse['history']): ServiceStatusHistoryBucket[] {
  const end = Date.parse(history.to); const start = Date.parse(history.from)
  const lookup = new Map(history.buckets.map((bucket) => [bucket.bucket_start, bucket]))
  const cells: ServiceStatusHistoryBucket[] = []
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return Array.from({ length: SERVICE_STATUS_HISTORY_HOURS }, (_, index) => ({ component_id: 'optimization', bucket_start: new Date(index * 3600000).toISOString(), status: 'unknown', sample_count: 0, availability_percent: null }))
  for (let timestamp = start; timestamp < end; timestamp += 3600000) {
    const bucketStart = new Date(timestamp).toISOString()
    cells.push(lookup.get(bucketStart) ?? { component_id: 'optimization', bucket_start: bucketStart, status: 'unknown', sample_count: 0, availability_percent: null })
  }
  while (cells.length < SERVICE_STATUS_HISTORY_HOURS) {
    const first = Date.parse(cells[0]?.bucket_start ?? new Date(end).toISOString()) - 3600000
    cells.unshift({ component_id: 'optimization', bucket_start: new Date(first).toISOString(), status: 'unknown', sample_count: 0, availability_percent: null })
  }
  return cells.slice(-SERVICE_STATUS_HISTORY_HOURS)
}

function historyCellLabel(cell: ServiceStatusHistoryBucket): string {
  const start = Date.parse(cell.bucket_start); const end = new Date(start + 3600000)
  const range = `${new Date(start).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}–${end.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}`
  return `${range}，${statusLabel(cell.status)}，${copy.status.pages_StatusPage_048} ${cell.sample_count}，${copy.status.pages_StatusPage_049} ${cell.availability_percent === null ? copy.status.pages_StatusPage_050 : `${cell.availability_percent}%`}`
}

function formatHistoryRange(from: string, to: string): string { return `${formatDateInProjectTimezone(from)} – ${formatDateInProjectTimezone(to)}` }
function formatDateInProjectTimezone(value: string): string { const timestamp = Date.parse(value); return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }) : copy.status.pages_StatusPage_051 }
function formatDay(value: string | undefined): string { if (!value) return ''; const timestamp = Date.parse(value); return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric' }) : '' }
function statusLabel(level: ServiceStatusHistoryLevel): string { return ({ available: copy.status.pages_StatusPage_052, scaling: copy.status.pages_StatusPage_066, busy: copy.status.pages_StatusPage_053, congested: copy.status.pages_StatusPage_054, overloaded: copy.status.pages_StatusPage_065, unavailable: copy.status.pages_StatusPage_055, unknown: copy.status.pages_StatusPage_050 } as const)[level] }
function incidentStatusLabel(status: PublicStatusIncident['status']): string { return ({ investigating: copy.status.pages_StatusPage_056, identified: copy.status.pages_StatusPage_057, monitoring: copy.status.pages_StatusPage_058, resolved: copy.status.pages_StatusPage_059 } as const)[status] }
function incidentImpactLabel(impact: PublicStatusIncident['impact']): string { return ({ minor: copy.status.pages_StatusPage_060, major: copy.status.pages_StatusPage_061, critical: copy.status.pages_StatusPage_062 } as const)[impact] }

function formatUpdatedAt(value: string): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || timestamp === 0) return copy.status.pages_StatusPage_024
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })
}

function statusMessageFor(level: ServiceStatusLevel): string {
  return level === 'available'
    ? copy.status.pages_StatusPage_032
    : level === 'scaling'
      ? copy.status.pages_StatusPage_067
      : level === 'busy'
        ? copy.status.pages_StatusPage_033
        : level === 'congested'
          ? copy.status.pages_StatusPage_034
          : level === 'overloaded'
            ? copy.status.pages_StatusPage_064
            : copy.status.pages_StatusPage_035
}
