import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { copy } from '../copy'
import { QUEUE_CONGESTION_THRESHOLD, QUEUE_OVERLOAD_THRESHOLD, SERVICE_STATUS_LEVELS,
  type PublicStatusIncident, type ServiceStatusHistoryBucket, type ServiceStatusHistoryLevel,
  type ServiceStatusLevel, type ServiceStatusResponse } from '../lib/service-status'

const POLL_INTERVAL_MS = 30_000
const PUBLIC_STATUS_HISTORY_DAYS = 7
const PUBLIC_STATUS_HISTORY_HOURS = PUBLIC_STATUS_HISTORY_DAYS * 24

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

export function useServiceStatus() {
  const query = useQuery({ queryKey: ['public', 'service-status'], staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: 'always', refetchInterval: POLL_INTERVAL_MS,
    queryFn: async ({ signal }) => {
      const response = await fetch('/api/status', { method: 'GET', cache: 'no-store', signal, headers: { Accept: 'application/json' } })
      const payload: unknown = await response.json()
      if (!isServiceStatusResponse(payload)) throw new Error('invalid_status_response')
      return normalizeStatusResponse(payload)
    },
  })
  const status = query.data ?? null
  const error = Boolean(query.error)
  const refreshing = query.isFetching
  const loadStatus = useCallback(async () => { await query.refetch({ cancelRefetch: false }) }, [query.refetch])

  const currentStatus = status ?? UNAVAILABLE_STATUS
  const optimizationStatus = status?.components.find((component) => component.id === 'optimization')?.status ?? status?.status
  const sklandStatus = status?.components.find((component) => component.id === 'skland_import')?.status
  const statusMessage = status ? statusMessageFor(status.status) : error ? copy.status.pages_StatusPage_021 : copy.status.pages_StatusPage_024
  const updatedAt = status ? formatUpdatedAt(status.generated_at) : error ? copy.status.pages_StatusPage_072 : copy.status.pages_StatusPage_024

  return { status, error, refreshing, loadStatus, currentStatus, optimizationStatus, sklandStatus, statusMessage, updatedAt }
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

export function createHistoryCells(history: ServiceStatusResponse['history']): ServiceStatusHistoryBucket[] {
  const end = Date.parse(history.to); const start = Date.parse(history.from)
  const lookup = new Map(history.buckets.map((bucket) => [bucket.bucket_start, bucket]))
  const cells: ServiceStatusHistoryBucket[] = []
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return Array.from({ length: PUBLIC_STATUS_HISTORY_HOURS }, (_, index) => ({ component_id: 'optimization', bucket_start: new Date(index * 3600000).toISOString(), status: 'unknown', sample_count: 0, availability_percent: null }))
  for (let timestamp = start; timestamp < end; timestamp += 3600000) {
    const bucketStart = new Date(timestamp).toISOString()
    cells.push(lookup.get(bucketStart) ?? { component_id: 'optimization', bucket_start: bucketStart, status: 'unknown', sample_count: 0, availability_percent: null })
  }
  while (cells.length < PUBLIC_STATUS_HISTORY_HOURS) {
    const first = Date.parse(cells[0]?.bucket_start ?? new Date(end).toISOString()) - 3600000
    cells.unshift({ component_id: 'optimization', bucket_start: new Date(first).toISOString(), status: 'unknown', sample_count: 0, availability_percent: null })
  }
  return cells.slice(-PUBLIC_STATUS_HISTORY_HOURS)
}

export function historyCellLabel(cell: ServiceStatusHistoryBucket): string {
  const start = Date.parse(cell.bucket_start); const end = new Date(start + 3600000)
  const range = `${new Date(start).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}–${end.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}`
  return `${range}，${statusLabel(cell.status)}，${copy.status.pages_StatusPage_048} ${cell.sample_count}，${copy.status.pages_StatusPage_049} ${cell.availability_percent === null ? copy.status.pages_StatusPage_050 : `${cell.availability_percent}%`}`
}

export function statusLabel(level: ServiceStatusHistoryLevel): string { return ({ available: copy.status.pages_StatusPage_052, scaling: copy.status.pages_StatusPage_066, busy: copy.status.pages_StatusPage_053, congested: copy.status.pages_StatusPage_054, overloaded: copy.status.pages_StatusPage_065, unavailable: copy.status.pages_StatusPage_055, unknown: copy.status.pages_StatusPage_050 } as const)[level] }
export function incidentStatusLabel(status: PublicStatusIncident['status']): string { return ({ investigating: copy.status.pages_StatusPage_056, identified: copy.status.pages_StatusPage_057, monitoring: copy.status.pages_StatusPage_058, resolved: copy.status.pages_StatusPage_059 } as const)[status] }
export function incidentImpactLabel(impact: PublicStatusIncident['impact']): string { return ({ minor: copy.status.pages_StatusPage_060, major: copy.status.pages_StatusPage_061, critical: copy.status.pages_StatusPage_062 } as const)[impact] }

export function formatUpdatedAt(value: string): string {
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
