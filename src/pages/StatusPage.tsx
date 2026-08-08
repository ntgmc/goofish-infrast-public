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
  SERVICE_STATUS_LEVELS,
  type ServiceStatusLevel,
  type ServiceStatusResponse,
} from '../lib/service-status'

const POLL_INTERVAL_MS = 30_000

const UNAVAILABLE_STATUS: ServiceStatusResponse = {
  generated_at: new Date(0).toISOString(),
  status: 'unavailable',
  queue: null,
  components: [{ id: 'optimization', status: 'unavailable' }],
  thresholds: { queue_congested_at: QUEUE_CONGESTION_THRESHOLD },
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
      setStatus(payload)
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
  const queue = currentStatus.queue
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
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <StatusMetric label={copy.status.pages_StatusPage_011} value={queue?.queued} suffix={copy.status.pages_StatusPage_029} />
                <StatusMetric label={copy.status.pages_StatusPage_012} value={queue?.running} suffix={copy.status.pages_StatusPage_029} />
                <StatusMetric label={copy.status.pages_StatusPage_013} value={queue?.worker_concurrency} suffix={copy.status.pages_StatusPage_030} />
              </div>
            </article>
          </section>

          <section className="mt-12 status-reading-measure" aria-labelledby="status-rules-title">
            <h2 id="status-rules-title" className="text-2xl font-semibold text-ink-primary">{copy.status.pages_StatusPage_015}</h2>
            <div className="mt-5 divide-y divide-surface-3 border-y border-surface-3">
              <StatusRule level="available" label={copy.status.pages_StatusPage_025} description={copy.status.pages_StatusPage_016} />
              <StatusRule level="busy" label={copy.status.pages_StatusPage_026} description={copy.status.pages_StatusPage_017} />
              <StatusRule level="congested" label={copy.status.pages_StatusPage_027} description={copy.status.pages_StatusPage_018} />
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

function StatusMetric({ label, value, suffix }: { label: string; value: number | undefined; suffix: string }) {
  return (
    <div className="tool-inset px-4 py-4">
      <p className="text-xs font-semibold tracking-wide text-ink-muted">{label}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums text-ink-primary">{value ?? '—'}</p>
      <p className="mt-1 text-xs text-ink-muted">{value === undefined ? '' : suffix}</p>
    </div>
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

function formatUpdatedAt(value: string): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || timestamp === 0) return copy.status.pages_StatusPage_024
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
}

function statusMessageFor(level: ServiceStatusLevel): string {
  return level === 'available'
    ? copy.status.pages_StatusPage_032
    : level === 'busy'
      ? copy.status.pages_StatusPage_033
      : level === 'congested'
        ? copy.status.pages_StatusPage_034
        : copy.status.pages_StatusPage_035
}
