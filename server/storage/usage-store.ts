import { query } from './postgres'

export type UsageEventName =
  | 'tool_visit'
  | 'free_preview'
  | 'register'
  | 'cdk_redeem'
  | 'schedule_generate'
  | 'reorder_check'
  | 'skland_import'
  | 'announcement_impression'
  | 'announcement_read'

export type UsageEventStatus = 'success' | 'failure'

export type UsageReasonCode =
  | 'ok'
  | 'validation_failed'
  | 'auth_required'
  | 'auth_profile_missing'
  | 'profile_missing'
  | 'profile_inactive'
  | 'cdk_missing'
  | 'cdk_used'
  | 'cdk_frozen'
  | 'cdk_revoked'
  | 'cdk_status_invalid'
  | 'risk_soft_blocked'
  | 'risk_frozen'
  | 'permission_denied'
  | 'optimizer_runtime_error'
  | 'workspace_save_failed'
  | 'monthly_quota_exceeded'
  | 'registration_failed'
  | 'skland_credential_invalid'
  | 'skland_refresh_forbidden'
  | 'skland_not_bound'
  | 'skland_refresh_failed'
  | 'skland_import_failed'
  | 'skland_account_mismatch'
  | 'skland_pending_expired'
  | 'skland_confirm_invalid'
  | 'announcement_missing'
  | 'unknown_failure'

export interface UsageEventRecord {
  id: string
  event: UsageEventName
  visitor_id: string | null
  created_at: string
  date: string
  status?: UsageEventStatus
  duration_ms?: number
  reason_code?: UsageReasonCode
  permission?: string
  profile_id?: string
  cdk_status?: string
  source?: string
  schedule_mode?: string
  fiammetta_enabled?: boolean
  estimate_bucket?: string
  announcement_id?: string
  announcement_kind?: string
}

export interface UsageDayStats {
  date: string
  unique_visitors: number
  visits: number
  free_previews: number
  registers: number
  schedule_generates: number
  cdk_redeems: number
  failures: number
  schedule_failures: number
  cdk_redeem_failures: number
  skland_imports: number
  skland_import_failures: number
  announcement_impressions: number
  announcement_reads: number
}

export interface UsageRange {
  from: string
  to: string
  days: number
}

export interface UsageFunnelStep {
  key: 'free_preview' | 'register' | 'cdk_redeem' | 'schedule_generate'
  label: string
  count: number
  conversion_rate: number
  dropoff: number
}

export interface UsageFailureReasonStats {
  reason_code: UsageReasonCode
  count: number
  percentage: number
  last_seen_at: string | null
  events: Partial<Record<UsageEventName, number>>
}

export interface UsageFailureSample {
  created_at: string
  event: UsageEventName
  reason_code: UsageReasonCode
  duration_ms: number | null
  permission: string | null
  cdk_status: string | null
  source: string | null
  has_profile: boolean
}

export interface UsageLatencyDayStats {
  date: string
  average_ms: number
  p95_ms: number
  sample_count: number
}

export interface UsageLatencyStats {
  average_ms: number
  p50_ms: number
  p95_ms: number
  max_ms: number
  sample_count: number
  days: UsageLatencyDayStats[]
}

export interface UsageSklandDayStats {
  date: string
  attempts: number
  success: number
  failed: number
  success_rate: number
}

export interface UsageSklandStats {
  attempts: number
  success: number
  failed: number
  success_rate: number
  credential_invalid: number
  refresh_forbidden: number
  not_bound: number
  request_failed: number
  days: UsageSklandDayStats[]
}

export interface UsageAnnouncementStats {
  impressions: number
  reads: number
  unread: number
  read_rate: number
}

export interface UsageCdkDistributionItem {
  permission: string
  total: number
  success: number
  failure: number
  statuses: Record<string, number>
}

export interface UsageStats {
  totals: UsageDayStats
  days: UsageDayStats[]
  range: UsageRange
  funnel: UsageFunnelStep[]
  failure_reasons: UsageFailureReasonStats[]
  recent_failures: UsageFailureSample[]
  latency: {
    schedule_generate: UsageLatencyStats
  }
  skland: UsageSklandStats
  announcement: UsageAnnouncementStats
  cdk_distribution: UsageCdkDistributionItem[]
}

export interface UsageEventStore {
  set: (key: string, record: UsageEventRecord) => Promise<void>
  getStats: (dates: string[]) => Promise<UsageStats>
  list: (prefix: string) => Promise<UsageEventRecord[]>
  countSuccessfulByProfileInRange?: (event: UsageEventName, profileId: string, startAt: string, endAt: string) => Promise<number>
  getScheduleGenerateDurationStatsByBucket?: (bucket: string, startAt: string, endAt: string) => Promise<{ p95_ms: number; sample_count: number }>
}

export function createPostgresUsageEventStore(): UsageEventStore {
  const list = async (prefix: string) => {
    const result = await query<{ record_json: UsageEventRecord }>(
      'select record_json from usage_events where key like $1 order by created_at asc',
      [`${prefix}%`],
    )
    return result.rows.map((row) => row.record_json)
  }

  const listRange = async (prefix: string, startDate: string, endDate: string) => {
    const result = await query<{ record_json: UsageEventRecord }>(
      `select record_json
       from usage_events
       where key like $1 and date between $2 and $3
       order by created_at asc`,
      [`${prefix}%`, startDate, endDate],
    )
    return result.rows.map((row) => row.record_json)
  }

  const countSuccessfulByProfileInRange = async (event: UsageEventName, profileId: string, startAt: string, endAt: string) => {
    const result = await query<{ count: string }>(
      `select count(*)::text as count
       from usage_events
       where event = $1
         and created_at >= $2
         and created_at < $3
         and record_json->>'profile_id' = $4
         and coalesce(record_json->>'status', 'success') = 'success'`,
      [event, startAt, endAt, profileId],
    )
    return Number(result.rows[0]?.count ?? 0)
  }

  const getScheduleGenerateDurationStatsByBucket = async (bucket: string, startAt: string, endAt: string) => {
    const result = await query<{ duration_ms: string | number | null }>(
      `select record_json->>'duration_ms' as duration_ms
       from usage_events
       where event = $1
         and created_at >= $2
         and created_at < $3
         and coalesce(record_json->>'status', 'success') = 'success'
         and record_json->>'estimate_bucket' = $4
         and record_json ? 'duration_ms'`,
      ['schedule_generate', startAt, endAt, bucket],
    )
    const durations = result.rows
      .map((row) => Number(row.duration_ms))
      .filter((value) => Number.isFinite(value) && value >= 0)
      .map((value) => Math.round(value))
    return {
      p95_ms: percentile(durations, 95),
      sample_count: durations.length,
    }
  }

  return {
    set: async (key, record) => {
      await query(
        `insert into usage_events (key, event, visitor_id, date, created_at, record_json)
         values ($1, $2, $3, $4, $5, $6::jsonb)
         on conflict (key) do update set
          event = excluded.event,
          visitor_id = excluded.visitor_id,
          date = excluded.date,
          created_at = excluded.created_at,
          record_json = excluded.record_json`,
        [
          key,
          record.event,
          record.visitor_id,
          record.date,
          record.created_at,
          JSON.stringify(record),
        ],
      )
    },
    getStats: async (dates) => {
      const startDate = dates[0] ?? ''
      const endDate = dates[dates.length - 1] ?? ''
      const events = startDate && endDate ? await listRange('events/', startDate, endDate) : await list('events/')
      return buildUsageStats(events, dates)
    },
    list,
    countSuccessfulByProfileInRange,
    getScheduleGenerateDurationStatsByBucket,
  }
}

export function buildUsageStats(events: UsageEventRecord[], dates: string[]): UsageStats {
  const normalizedDates = dates.filter(Boolean)
  const range: UsageRange = {
    from: normalizedDates[0] ?? '',
    to: normalizedDates[normalizedDates.length - 1] ?? '',
    days: normalizedDates.length,
  }
  const totals = createEmptyDayStats('total')
  const totalVisitors = new Set<string>()
  const dayVisitors = new Map(normalizedDates.map((date) => [date, new Set<string>()]))
  const daysByDate = new Map(normalizedDates.map((date) => [date, createEmptyDayStats(date)]))
  const failureReasons = new Map<UsageReasonCode, UsageFailureReasonStats>()
  const sklandDays = new Map(normalizedDates.map((date) => [date, createEmptySklandDayStats(date)]))
  const sklandReasonCounts = new Map<UsageReasonCode, number>()
  const scheduleDurations: number[] = []
  const scheduleDurationsByDate = new Map<string, number[]>()
  const cdkDistribution = new Map<string, UsageCdkDistributionItem>()
  const recentFailures: UsageFailureSample[] = []

  for (const event of events) {
    applyEventToStats(totals, event, totalVisitors)
    const day = daysByDate.get(event.date)
    if (day) applyEventToStats(day, event, dayVisitors.get(event.date))

    if (isFailure(event)) {
      addFailureReason(failureReasons, event)
      recentFailures.push(toFailureSample(event))
    }

    if (event.event === 'skland_import') {
      const dayStats = sklandDays.get(event.date)
      if (dayStats) applySklandEvent(dayStats, event)
      if (isFailure(event)) {
        const reasonCode = event.reason_code ?? 'unknown_failure'
        sklandReasonCounts.set(reasonCode, (sklandReasonCounts.get(reasonCode) ?? 0) + 1)
      }
    }

    if (event.event === 'schedule_generate' && isSuccess(event) && isFiniteDuration(event.duration_ms)) {
      const duration = Math.max(0, Math.round(event.duration_ms))
      scheduleDurations.push(duration)
      const durations = scheduleDurationsByDate.get(event.date) ?? []
      durations.push(duration)
      scheduleDurationsByDate.set(event.date, durations)
    }

    if (event.event === 'cdk_redeem') {
      addCdkDistribution(cdkDistribution, event)
    }
  }

  totals.unique_visitors = totalVisitors.size
  const days = normalizedDates.map((date) => {
    const day = daysByDate.get(date) ?? createEmptyDayStats(date)
    day.unique_visitors = dayVisitors.get(date)?.size ?? 0
    return day
  })

  const failuresTotal = totals.failures
  const failure_reasons = [...failureReasons.values()]
    .map((item) => ({
      ...item,
      percentage: failuresTotal > 0 ? roundToTenth((item.count / failuresTotal) * 100) : 0,
    }))
    .sort((left, right) => {
      if (left.count !== right.count) return right.count - left.count
      return (Date.parse(right.last_seen_at ?? '') || 0) - (Date.parse(left.last_seen_at ?? '') || 0)
    })
    .slice(0, 10)

  const sklandDayList = normalizedDates.map((date) => {
    const day = sklandDays.get(date) ?? createEmptySklandDayStats(date)
    day.success_rate = rate(day.success, day.attempts)
    return day
  })

  return {
    totals,
    days,
    range,
    funnel: buildFunnel(totals),
    failure_reasons,
    recent_failures: recentFailures
      .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
      .slice(0, 8),
    latency: {
      schedule_generate: buildLatencyStats(scheduleDurations, normalizedDates, scheduleDurationsByDate),
    },
    skland: buildSklandStats(totals, sklandDayList, sklandReasonCounts),
    announcement: {
      impressions: totals.announcement_impressions,
      reads: totals.announcement_reads,
      unread: Math.max(0, totals.announcement_impressions - totals.announcement_reads),
      read_rate: rate(totals.announcement_reads, totals.announcement_impressions),
    },
    cdk_distribution: [...cdkDistribution.values()].sort((left, right) => right.total - left.total),
  }
}

function createEmptyDayStats(date: string): UsageDayStats {
  return {
    date,
    unique_visitors: 0,
    visits: 0,
    free_previews: 0,
    registers: 0,
    schedule_generates: 0,
    cdk_redeems: 0,
    failures: 0,
    schedule_failures: 0,
    cdk_redeem_failures: 0,
    skland_imports: 0,
    skland_import_failures: 0,
    announcement_impressions: 0,
    announcement_reads: 0,
  }
}

function createEmptySklandDayStats(date: string): UsageSklandDayStats {
  return {
    date,
    attempts: 0,
    success: 0,
    failed: 0,
    success_rate: 0,
  }
}

function applyEventToStats(stats: UsageDayStats, event: UsageEventRecord, visitors?: Set<string>): void {
  if (event.event === 'tool_visit') {
    stats.visits += 1
    if (event.visitor_id) visitors?.add(event.visitor_id)
  }
  if (event.event === 'free_preview' && isSuccess(event)) stats.free_previews += 1
  if (event.event === 'register' && isSuccess(event)) stats.registers += 1
  if (event.event === 'schedule_generate' && isSuccess(event)) stats.schedule_generates += 1
  if (event.event === 'cdk_redeem' && isSuccess(event)) stats.cdk_redeems += 1
  if (event.event === 'skland_import' && isSuccess(event)) stats.skland_imports += 1
  if (event.event === 'announcement_impression' && isSuccess(event)) stats.announcement_impressions += 1
  if (event.event === 'announcement_read' && isSuccess(event)) stats.announcement_reads += 1

  if (!isFailure(event)) return
  stats.failures += 1
  if (event.event === 'schedule_generate') stats.schedule_failures += 1
  if (event.event === 'cdk_redeem') stats.cdk_redeem_failures += 1
  if (event.event === 'skland_import') stats.skland_import_failures += 1
}

function applySklandEvent(stats: UsageSklandDayStats, event: UsageEventRecord): void {
  stats.attempts += 1
  if (isSuccess(event)) stats.success += 1
  if (isFailure(event)) stats.failed += 1
}

function addFailureReason(
  failureReasons: Map<UsageReasonCode, UsageFailureReasonStats>,
  event: UsageEventRecord,
): void {
  const reasonCode = event.reason_code ?? 'unknown_failure'
  const current = failureReasons.get(reasonCode) ?? {
    reason_code: reasonCode,
    count: 0,
    percentage: 0,
    last_seen_at: null,
    events: {},
  }
  current.count += 1
  current.events[event.event] = (current.events[event.event] ?? 0) + 1
  if (!current.last_seen_at || Date.parse(event.created_at) > Date.parse(current.last_seen_at)) {
    current.last_seen_at = event.created_at
  }
  failureReasons.set(reasonCode, current)
}

function addCdkDistribution(cdkDistribution: Map<string, UsageCdkDistributionItem>, event: UsageEventRecord): void {
  const permission = event.permission || 'unknown'
  const status = event.cdk_status || event.status || 'unknown'
  const current = cdkDistribution.get(permission) ?? {
    permission,
    total: 0,
    success: 0,
    failure: 0,
    statuses: {},
  }
  current.total += 1
  if (isSuccess(event)) current.success += 1
  if (isFailure(event)) current.failure += 1
  current.statuses[status] = (current.statuses[status] ?? 0) + 1
  cdkDistribution.set(permission, current)
}

function buildFunnel(totals: UsageDayStats): UsageFunnelStep[] {
  const steps: Array<{ key: UsageFunnelStep['key']; label: string; count: number }> = [
    { key: 'free_preview', label: '免费预览', count: totals.free_previews },
    { key: 'register', label: 'Register', count: totals.registers },
    { key: 'cdk_redeem', label: 'Redeem CDK', count: totals.cdk_redeems },
    { key: 'schedule_generate', label: 'Generate schedule', count: totals.schedule_generates },
  ]

  return steps.map((step, index) => {
    const previous = index === 0 ? step.count : steps[index - 1]?.count ?? 0
    return {
      ...step,
      conversion_rate: index === 0 ? 100 : rate(step.count, previous),
      dropoff: index === 0 ? 0 : Math.max(0, previous - step.count),
    }
  })
}

function buildLatencyStats(
  durations: number[],
  dates: string[],
  durationsByDate: Map<string, number[]>,
): UsageLatencyStats {
  return {
    average_ms: average(durations),
    p50_ms: percentile(durations, 50),
    p95_ms: percentile(durations, 95),
    max_ms: durations.length > 0 ? Math.max(...durations) : 0,
    sample_count: durations.length,
    days: dates.map((date) => {
      const dayDurations = durationsByDate.get(date) ?? []
      return {
        date,
        average_ms: average(dayDurations),
        p95_ms: percentile(dayDurations, 95),
        sample_count: dayDurations.length,
      }
    }),
  }
}

function buildSklandStats(
  totals: UsageDayStats,
  days: UsageSklandDayStats[],
  reasonCounts: Map<UsageReasonCode, number>,
): UsageSklandStats {
  const attempts = totals.skland_imports + totals.skland_import_failures
  return {
    attempts,
    success: totals.skland_imports,
    failed: totals.skland_import_failures,
    success_rate: rate(totals.skland_imports, attempts),
    credential_invalid: reasonCounts.get('skland_credential_invalid') ?? 0,
    refresh_forbidden: reasonCounts.get('skland_refresh_forbidden') ?? 0,
    not_bound: reasonCounts.get('skland_not_bound') ?? 0,
    request_failed: (reasonCounts.get('skland_refresh_failed') ?? 0) + (reasonCounts.get('skland_import_failed') ?? 0),
    days,
  }
}

function toFailureSample(event: UsageEventRecord): UsageFailureSample {
  return {
    created_at: event.created_at,
    event: event.event,
    reason_code: event.reason_code ?? 'unknown_failure',
    duration_ms: isFiniteDuration(event.duration_ms) ? Math.max(0, Math.round(event.duration_ms)) : null,
    permission: event.permission ?? null,
    cdk_status: event.cdk_status ?? null,
    source: event.source ?? null,
    has_profile: Boolean(event.profile_id),
  }
}

function isSuccess(event: UsageEventRecord): boolean {
  return event.status !== 'failure'
}

function isFailure(event: UsageEventRecord): boolean {
  return event.status === 'failure'
}

function isFiniteDuration(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1))
  return sorted[index] ?? 0
}

function rate(count: number, total: number): number {
  return total > 0 ? roundToTenth((count / total) * 100) : 0
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10
}
