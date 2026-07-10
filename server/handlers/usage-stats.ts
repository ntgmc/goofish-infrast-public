import { randomUUID } from 'node:crypto'
import { authenticateAdminRequest } from './admin-auth'
import { jsonResponse } from './license-utils'
import {
  createPostgresUsageEventStore,
  type UsageEventName,
  type UsageEventRecord,
  type UsageEventStatus,
  type UsageEventStore,
} from '../storage/usage-store'

const EVENT_PREFIX = 'events/'
const VALID_VISITOR_ID = /^[A-Za-z0-9_-]{8,128}$/
const VALID_RANGE_VALUES = new Set(['7d', '14d', '30d'])
const MAX_CUSTOM_RANGE_DAYS = 90

type UsageEventInput = string | null | Partial<Pick<
  UsageEventRecord,
  | 'visitor_id'
  | 'status'
  | 'duration_ms'
  | 'reason_code'
  | 'permission'
  | 'profile_id'
  | 'cdk_status'
  | 'source'
  | 'schedule_mode'
  | 'fiammetta_enabled'
  | 'estimate_bucket'
  | 'announcement_id'
  | 'announcement_kind'
>>

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return jsonResponse(null, 204)
  }

  const url = new URL(req.url)
  const isAdminRoute = url.searchParams.get('admin') === '1' || url.pathname.includes('/api/admin/usage-stats')

  try {
    if (req.method === 'POST' && !isAdminRoute) {
      return handlePublicPost(req)
    }
    if (req.method === 'GET' && isAdminRoute) {
      return handleAdminGet(req)
    }
    return jsonResponse({ error: 'Method not allowed' }, 405)
  } catch (error) {
    console.error('usage stats error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return jsonResponse({ error: message }, 500)
  }
}

export async function recordUsageEvent(event: UsageEventName, input: UsageEventInput = null): Promise<void> {
  const createdAt = new Date().toISOString()
  const date = createdAt.slice(0, 10)
  const id = randomUUID()
  const key = `${EVENT_PREFIX}${date}/${createdAt.replace(/[:.]/g, '-')}-${id}.json`
  const options = normalizeUsageEventInput(input)
  const record: UsageEventRecord = {
    id,
    event,
    visitor_id: options.visitor_id,
    created_at: createdAt,
    date,
    ...(options.status && { status: options.status }),
    ...(options.duration_ms !== undefined && { duration_ms: options.duration_ms }),
    ...(options.reason_code && { reason_code: options.reason_code }),
    ...(options.permission && { permission: options.permission }),
    ...(options.profile_id && { profile_id: options.profile_id }),
    ...(options.cdk_status && { cdk_status: options.cdk_status }),
    ...(options.source && { source: options.source }),
    ...(options.schedule_mode && { schedule_mode: options.schedule_mode }),
    ...(typeof options.fiammetta_enabled === 'boolean' && { fiammetta_enabled: options.fiammetta_enabled }),
    ...(options.estimate_bucket && { estimate_bucket: options.estimate_bucket }),
    ...(options.announcement_id && { announcement_id: options.announcement_id }),
    ...(options.announcement_kind && { announcement_kind: options.announcement_kind }),
  }
  const store = await getUsageEventStore()
  await store.set(key, record)
}

async function handlePublicPost(req: Request): Promise<Response> {
  const body = await req.json() as {
    event?: unknown;
    visitor_id?: unknown;
    announcement_id?: unknown;
    announcement_kind?: unknown;
    source?: unknown;
  }
  if (body.event === 'announcement_impression' || body.event === 'announcement_read') {
    const announcementId = normalizeNullableString(body.announcement_id, 120)
    if (!announcementId) {
      return jsonResponse({ error: 'Invalid announcement id.' }, 400)
    }
    await recordUsageEvent(body.event, {
      status: 'success',
      reason_code: 'ok',
      announcement_id: announcementId,
      ...(normalizeAnnouncementKind(body.announcement_kind) && { announcement_kind: normalizeAnnouncementKind(body.announcement_kind) as string }),
      source: normalizePublicAnnouncementSource(body.source),
    })
    return jsonResponse({ ok: true })
  }
  if (body.event !== 'tool_visit') {
    return jsonResponse({ error: 'Unsupported usage event.' }, 400)
  }
  if (typeof body.visitor_id !== 'string' || !VALID_VISITOR_ID.test(body.visitor_id)) {
    return jsonResponse({ error: 'Invalid visitor id.' }, 400)
  }

  await recordUsageEvent('tool_visit', { visitor_id: body.visitor_id, status: 'success' })
  return jsonResponse({ ok: true })
}

async function handleAdminGet(req: Request): Promise<Response> {
  const authentication = await authenticateAdminRequest(req)
  if (!authentication.ok) return authentication.response

  const store = await getUsageEventStore()
  const dateRange = parseDateRange(new URL(req.url))
  if (!dateRange.ok) {
    return jsonResponse({ error: dateRange.message }, 400)
  }

  const stats = await store.getStats(dateRange.dates)
  const format = new URL(req.url).searchParams.get('format')
  if (format === 'csv') {
    return csvResponse(toUsageStatsCsv(stats), `admin-ops-report-${stats.range.from}_${stats.range.to}.csv`)
  }
  return jsonResponse(stats)
}

function parseDateRange(url: URL): { ok: true; dates: string[] } | { ok: false; message: string } {
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  if (from || to) {
    if (!from || !to || !isValidDateString(from) || !isValidDateString(to)) {
      return { ok: false, message: 'Invalid date range.' }
    }
    const dates = getDatesBetween(from, to)
    if (dates.length === 0 || dates.length > MAX_CUSTOM_RANGE_DAYS) {
      return { ok: false, message: `Date range must include 1-${MAX_CUSTOM_RANGE_DAYS} days.` }
    }
    return { ok: true, dates }
  }

  const range = url.searchParams.get('range') ?? '7d'
  if (!VALID_RANGE_VALUES.has(range)) {
    return { ok: false, message: 'Unsupported range. Use 7d, 14d, or 30d.' }
  }
  return { ok: true, dates: getLastDates(Number.parseInt(range, 10)) }
}

function getLastDates(dayCount: number): string[] {
  const dates: string[] = []
  const now = new Date()
  for (let offset = dayCount - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset))
    dates.push(date.toISOString().slice(0, 10))
  }
  return dates
}

function getDatesBetween(from: string, to: string): string[] {
  const start = Date.parse(`${from}T00:00:00.000Z`)
  const end = Date.parse(`${to}T00:00:00.000Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return []
  const dates: string[] = []
  for (let time = start; time <= end; time += 24 * 60 * 60 * 1000) {
    dates.push(new Date(time).toISOString().slice(0, 10))
  }
  return dates
}

function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
}

function normalizeUsageEventInput(input: UsageEventInput): Required<Pick<UsageEventRecord, 'visitor_id'>> & Partial<UsageEventRecord> {
  if (typeof input === 'string' || input === null) {
    return { visitor_id: input }
  }
  const status = input.status === 'success' || input.status === 'failure' ? input.status : undefined
  return {
    visitor_id: normalizeNullableString(input.visitor_id, 128),
    ...(status && { status: status as UsageEventStatus }),
    ...(typeof input.duration_ms === 'number' && Number.isFinite(input.duration_ms)
      ? { duration_ms: Math.max(0, Math.round(input.duration_ms)) }
      : {}),
    ...(input.reason_code && { reason_code: input.reason_code }),
    ...(normalizeNullableString(input.permission, 40) && { permission: normalizeNullableString(input.permission, 40) as string }),
    ...(normalizeNullableString(input.profile_id, 80) && { profile_id: normalizeNullableString(input.profile_id, 80) as string }),
    ...(normalizeNullableString(input.cdk_status, 40) && { cdk_status: normalizeNullableString(input.cdk_status, 40) as string }),
    ...(normalizeNullableString(input.source, 80) && { source: normalizeNullableString(input.source, 80) as string }),
    ...(normalizeNullableString(input.schedule_mode, 40) && { schedule_mode: normalizeNullableString(input.schedule_mode, 40) as string }),
    ...(typeof input.fiammetta_enabled === 'boolean' && { fiammetta_enabled: input.fiammetta_enabled }),
    ...(normalizeNullableString(input.estimate_bucket, 40) && { estimate_bucket: normalizeNullableString(input.estimate_bucket, 40) as string }),
    ...(normalizeNullableString(input.announcement_id, 120) && { announcement_id: normalizeNullableString(input.announcement_id, 120) as string }),
    ...(normalizeAnnouncementKind(input.announcement_kind) && { announcement_kind: normalizeAnnouncementKind(input.announcement_kind) as string }),
  }
}

function normalizeAnnouncementKind(value: unknown): 'banner' | 'popup' | null {
  return value === 'banner' || value === 'popup' ? value : null
}

function normalizePublicAnnouncementSource(value: unknown): string {
  return value === 'popup_local' || value === 'public_page' ? value : 'public_report'
}

function normalizeNullableString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized) return null
  return normalized.slice(0, maxLength)
}

function csvResponse(csv: string, filename: string): Response {
  return new Response(`\uFEFF${csv}`, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}

function toUsageStatsCsv(stats: Awaited<ReturnType<UsageEventStore['getStats']>>): string {
  const rows: string[][] = [
    ['section', 'key', 'label', 'date', 'value', 'extra'],
    ['range', 'from', 'From', '', stats.range.from, ''],
    ['range', 'to', 'To', '', stats.range.to, ''],
    ['range', 'days', 'Days', '', String(stats.range.days), ''],
  ]

  for (const [key, value] of Object.entries(stats.totals)) {
    rows.push(['totals', key, key, '', String(value), ''])
  }
  for (const day of stats.days) {
    for (const [key, value] of Object.entries(day)) {
      if (key === 'date') continue
      rows.push(['days', key, key, day.date, String(value), ''])
    }
  }
  for (const item of stats.funnel) {
    rows.push(['funnel', item.key, item.label, '', String(item.count), `conversion=${item.conversion_rate};dropoff=${item.dropoff}`])
  }
  for (const item of stats.failure_reasons) {
    rows.push(['failure_reasons', item.reason_code, item.reason_code, item.last_seen_at ?? '', String(item.count), `percentage=${item.percentage}`])
  }
  const latency = stats.latency.schedule_generate
  for (const [key, value] of Object.entries({
    average_ms: latency.average_ms,
    p50_ms: latency.p50_ms,
    p95_ms: latency.p95_ms,
    max_ms: latency.max_ms,
    sample_count: latency.sample_count,
  })) {
    rows.push(['latency', key, key, '', String(value), ''])
  }
  for (const day of latency.days) {
    rows.push(['latency_days', 'schedule_generate', 'Generate schedule', day.date, String(day.average_ms), `p95=${day.p95_ms};samples=${day.sample_count}`])
  }
  for (const [key, value] of Object.entries({
    attempts: stats.skland.attempts,
    success: stats.skland.success,
    failed: stats.skland.failed,
    success_rate: stats.skland.success_rate,
    credential_invalid: stats.skland.credential_invalid,
    refresh_forbidden: stats.skland.refresh_forbidden,
    not_bound: stats.skland.not_bound,
    request_failed: stats.skland.request_failed,
  })) {
    rows.push(['skland', key, key, '', String(value), ''])
  }
  for (const [key, value] of Object.entries(stats.announcement)) {
    rows.push(['announcement', key, key, '', String(value), ''])
  }
  for (const item of stats.cdk_distribution) {
    rows.push(['cdk_distribution', item.permission, item.permission, '', String(item.total), `success=${item.success};failure=${item.failure}`])
  }

  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
}

function csvCell(value: string): string {
  if (!/[",\r\n]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

async function getUsageEventStore(): Promise<UsageEventStore> {
  const testingStore = getTestingUsageEventStore()
  if (testingStore) return testingStore
  return createPostgresUsageEventStore()
}

export async function listUsageEvents(prefix = EVENT_PREFIX): Promise<UsageEventRecord[]> {
  const store = await getUsageEventStore()
  return store.list(prefix)
}

export async function countSuccessfulUsageEventsForProfileInRange(
  event: UsageEventName,
  profileId: string,
  startAt: string,
  endAt: string,
): Promise<number> {
  const store = await getUsageEventStore()
  if (store.countSuccessfulByProfileInRange) {
    return store.countSuccessfulByProfileInRange(event, profileId, startAt, endAt)
  }
  const events = await store.list(EVENT_PREFIX)
  return events.filter((record) => (
    record.event === event &&
    record.profile_id === profileId &&
    record.status !== 'failure' &&
    record.created_at >= startAt &&
    record.created_at < endAt
  )).length
}

export async function getScheduleGenerateDurationStatsByBucket(
  bucket: string,
  startAt: string,
  endAt: string,
): Promise<{ p95_ms: number; sample_count: number }> {
  const store = await getUsageEventStore()
  if (store.getScheduleGenerateDurationStatsByBucket) {
    return store.getScheduleGenerateDurationStatsByBucket(bucket, startAt, endAt)
  }
  const events = await store.list(EVENT_PREFIX)
  const durations = events
    .filter((record) =>
      record.event === 'schedule_generate'
      && record.status !== 'failure'
      && record.estimate_bucket === bucket
      && record.created_at >= startAt
      && record.created_at < endAt
      && typeof record.duration_ms === 'number'
      && Number.isFinite(record.duration_ms)
    )
    .map((record) => Math.max(0, Math.round(record.duration_ms ?? 0)))
  return {
    p95_ms: percentile(durations, 95),
    sample_count: durations.length,
  }
}

export function setUsageEventStoreForTesting(store: UsageEventStore | null): void {
  ;(globalThis as unknown as { __maaUsageEventStoreForTesting?: UsageEventStore }).__maaUsageEventStoreForTesting =
    store ?? undefined
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1))
  return sorted[index] ?? 0
}

function getTestingUsageEventStore(): UsageEventStore | null {
  if (process.env.NODE_ENV === 'production') return null
  return (
    (globalThis as unknown as { __maaUsageEventStoreForTesting?: UsageEventStore })
      .__maaUsageEventStoreForTesting ?? null
  )
}
