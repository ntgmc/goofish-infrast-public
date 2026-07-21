import type { Announcement, AnnouncementStats as AnnouncementReachStats } from '../../../lib/types'

import { Permission, GeneratedPermission, CdkStatus, AppUserStatus, FieldErrors, GeneratedCdk, AdminCdkCreateResponse, AdminCdkRecord, UsageTotals, UsageDay, UsageRangeMode, AnnouncementSortKey, UsageRange, UsageFunnelStep, UsageFailureReason, UsageFailureSample, UsageLatencyStats, UsageSklandStats, UsageAnnouncementStats, UsageCdkDistributionItem, UsageStatsResponse, CdkPermissionDistribution, CdkStatusDistribution, RiskReasonStats, RiskTrendDay, CdkOpsSummary, RiskControlSettings, AdminProfileAccessSummary, AdminProfileOperatorData, EMPTY_ANNOUNCEMENT_REACH_STATS, permissionLabels, statusLabels, appUserStatusLabels, cdkProductPermissions, cdkProductPermissionRank } from '../contracts'

export function InfoRow({ label, value }: { label: string; value: string }) {
return <div className="flex items-center justify-between gap-4 border-b border-surface-3 pb-2 last:border-0"><dt className="text-ink-muted">{label}</dt><dd className="font-medium text-ink-primary">{value}</dd></div>
}

export function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="tool-inset min-w-0 px-3 py-2">
      <dt className="text-xs font-medium text-ink-muted">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium text-ink-primary">{value}</dd>
    </div>
  )
}

export function StatusPill({ status }: { status: CdkStatus }) {
  const className = status === 'unused'
    ? 'tool-status--success'
    : status === 'frozen'
      ? 'tool-status--warning'
      : status === 'revoked'
        ? 'tool-status--error'
        : ''
  return <span className={`tool-status ${className}`}>{statusLabels[status]}</span>
}

export function UserStatusPill({ status }: { status: AppUserStatus }) {
  const className = status === 'active'
    ? 'tool-status--success'
    : status === 'frozen'
      ? 'tool-status--warning'
      : 'tool-status--error'
  return <span className={`tool-status ${className}`}>{appUserStatusLabels[status]}</span>
}

export function SmallButton({ children, onClick, loading, tone = 'default', autoFocus = false }: { children: string; onClick: () => void; loading?: boolean; tone?: 'default' | 'success' | 'danger'; autoFocus?: boolean }) {
  const className = tone === 'danger'
    ? 'border-error/40 bg-error/10 text-error hover:border-error/60 hover:bg-error/20 hover:text-error'
    : tone === 'success'
      ? 'border-success/40 bg-success/10 text-success hover:border-success/60 hover:bg-success/20 hover:text-success'
      : ''
  return <button type="button" onClick={onClick} disabled={loading} data-dialog-initial-focus={autoFocus ? '' : undefined} className={`tool-secondary-action min-h-11 px-3 text-xs ${className}`}>{loading ? '处理中' : children}</button>
}

export function buildSummary(records: AdminCdkRecord[], usage?: UsageTotals, adminUsers = 0, ops?: CdkOpsSummary) {
const totalCdks = ops?.status_distribution.reduce((sum, item) => sum + item.total, 0) ?? records.length
const usedCdks = ops?.status_distribution.find((item) => item.status === 'used')?.total ?? records.filter((record) => record.status === 'used').length
const frozenCdks = ops?.freezes ?? records.filter((record) => record.status === 'frozen').length
const riskEvents = ops ? ops.risk_reasons.reduce((sum, item) => sum + item.count, 0) : records.reduce((sum, record) => sum + (record.risk_event_count ?? 0), 0)
const scheduleGenerates = usage?.schedule_generates ?? 0
const scheduleFailures = usage?.schedule_failures ?? 0
const scheduleAttempts = scheduleGenerates + scheduleFailures
  return {
    totalCdks,
    usedCdks,
    frozenCdks,
    riskEvents,
    adminUsers,
    uniqueVisitors: usage?.unique_visitors ?? 0,
    visits: usage?.visits ?? 0,
    freePreviews: usage?.free_previews ?? 0,
    registers: usage?.registers ?? 0,
    scheduleGenerates,
    scheduleFailures,
    scheduleAttempts,
    scheduleSuccessRate: scheduleAttempts ? Math.round((scheduleGenerates / scheduleAttempts) * 1000) / 10 : 0,
    cdkRedeems: usage?.cdk_redeems ?? 0,
    redeemRate: usage?.visits ? Math.round(((usage?.cdk_redeems ?? 0) / usage.visits) * 1000) / 10 : 0,
  }
}

export function buildCdkOpsSummary(records: AdminCdkRecord[]): CdkOpsSummary {
  const permissionMap = new Map<Permission, CdkPermissionDistribution>()
  for (const permission of cdkProductPermissions) {
    permissionMap.set(permission, { permission, total: 0, unused: 0, used: 0, frozen: 0, revoked: 0 })
  }
  const statusMap = new Map<CdkStatus, CdkStatusDistribution>(
    (['unused', 'used', 'frozen', 'revoked'] as CdkStatus[]).map((status) => [status, { status, total: 0 }]),
  )
  const reasonMap = new Map<string, RiskReasonStats>()
  const trendMap = new Map<string, RiskTrendDay>()
  let softBlocks = 0
  let escalations = 0

  for (const record of records) {
    const permission = normalizeProductPermission(record.permission) ?? record.permission
    const distribution = permissionMap.get(permission) ?? { permission, total: 0, unused: 0, used: 0, frozen: 0, revoked: 0 }
    distribution.total += 1
    distribution[record.status] += 1
    permissionMap.set(permission, distribution)

    const statusDistribution = statusMap.get(record.status)
    if (statusDistribution) statusDistribution.total += 1

    for (const event of record.risk_events ?? []) {
      const date = event.at.slice(0, 10)
      const trend = trendMap.get(date) ?? { date, soft_blocks: 0, freezes: 0, escalations: 0, total: 0 }
      trend.total += 1
      if (event.soft_block) {
        trend.soft_blocks += 1
        softBlocks += 1
      }
      if (event.escalation) {
        trend.escalations += 1
        escalations += 1
      }
      if (record.status === 'frozen' && record.latest_risk_event?.at === event.at) {
        trend.freezes += 1
      }
      trendMap.set(date, trend)

      const key = `${event.type}:${event.reason}`
      const current = reasonMap.get(key) ?? {
        type: event.type,
        reason: event.reason,
        count: 0,
        last_seen_at: null,
        latest_record: null,
      }
      current.count += 1
      if (!current.last_seen_at || Date.parse(event.at) > Date.parse(current.last_seen_at)) {
        current.last_seen_at = event.at
        current.latest_record = record
      }
      reasonMap.set(key, current)
    }
  }

  return {
    permission_distribution: [...permissionMap.values()].filter((item) => item.total > 0),
    status_distribution: [...statusMap.values()],
    risk_reasons: [...reasonMap.values()].sort((left, right) => {
      if (left.count !== right.count) return right.count - left.count
      return (Date.parse(right.last_seen_at ?? '') || 0) - (Date.parse(left.last_seen_at ?? '') || 0)
    }),
    risk_trend: buildRiskTrendDays(trendMap),
    soft_blocks: softBlocks,
    freezes: records.filter((record) => record.status === 'frozen').length,
    escalations,
    risk_records: records.filter((record) => (record.risk_event_count ?? 0) > 0 || record.status === 'frozen').length,
    generated_records: records.filter((record) => (record.schedule_generate_count ?? 0) > 0).length,
  }
}

function buildRiskTrendDays(trendMap: Map<string, RiskTrendDay>): RiskTrendDay[] {
  const dates: string[] = []
  const now = new Date()
  for (let offset = 13; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset)).toISOString().slice(0, 10)
    dates.push(date)
  }
  return dates.map((date) => trendMap.get(date) ?? { date, soft_blocks: 0, freezes: 0, escalations: 0, total: 0 })
}

export function buildUsageStatsQuery(range: UsageRangeMode, from: string, to: string): string | null {
  if (range !== 'custom') return `range=${range}`
  if (!isDateInputString(from) || !isDateInputString(to) || from > to) return null
  return `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
}

export function getDateOffsetString(offset: number): string {
  const now = new Date()
  const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() - offset))
  return date.toISOString().slice(0, 10)
}

function isDateInputString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function normalizeUsageTotals(value: Partial<UsageTotals> | undefined): UsageTotals {
  const freePreviews = normalizeCount(value?.free_previews)
  const cdkRedeems = normalizeCount(value?.cdk_redeems)
  return {
    unique_visitors: normalizeCount(value?.unique_visitors),
    visits: normalizeCount(value?.visits),
    free_previews: freePreviews,
    registers: normalizeCount(value?.registers),
    schedule_generates: normalizeCount(value?.schedule_generates),
    cdk_redeems: cdkRedeems,
    account_additions: value?.account_additions === undefined
      ? freePreviews + cdkRedeems
      : normalizeCount(value.account_additions),
    failures: normalizeCount(value?.failures),
    schedule_failures: normalizeCount(value?.schedule_failures),
    cdk_redeem_failures: normalizeCount(value?.cdk_redeem_failures),
    skland_imports: normalizeCount(value?.skland_imports),
    skland_import_failures: normalizeCount(value?.skland_import_failures),
    announcement_impressions: normalizeCount(value?.announcement_impressions),
    announcement_reads: normalizeCount(value?.announcement_reads),
  }
}

function normalizeUsageDay(day: Partial<UsageDay>): UsageDay {
  return { date: typeof day.date === 'string' ? day.date : '', ...normalizeUsageTotals(day) }
}

export function normalizeUsageStats(value: Partial<UsageStatsResponse>): UsageStatsResponse {
  const totals = normalizeUsageTotals(value.totals)
  const days = Array.isArray(value.days) ? value.days.map(normalizeUsageDay) : []
  return {
    totals,
    days,
    range: normalizeUsageRange(value.range, days),
    funnel: Array.isArray(value.funnel) ? value.funnel.map(normalizeFunnelStep) : [],
    failure_reasons: Array.isArray(value.failure_reasons) ? value.failure_reasons.map(normalizeFailureReason) : [],
    recent_failures: Array.isArray(value.recent_failures) ? value.recent_failures.map(normalizeFailureSample) : [],
    latency: {
      schedule_generate: normalizeLatencyStats(value.latency?.schedule_generate),
    },
    skland: normalizeSklandStats(value.skland),
    announcement: normalizeAnnouncementStats(value.announcement),
    cdk_distribution: Array.isArray(value.cdk_distribution) ? value.cdk_distribution.map(normalizeCdkDistributionItem) : [],
  }
}

function normalizeUsageRange(value: Partial<UsageRange> | undefined, days: UsageDay[]): UsageRange {
  return {
    from: typeof value?.from === 'string' ? value.from : days[0]?.date ?? '',
    to: typeof value?.to === 'string' ? value.to : days[days.length - 1]?.date ?? '',
    days: normalizeCount(value?.days) || days.length,
  }
}

function normalizeFunnelStep(value: Partial<UsageFunnelStep>): UsageFunnelStep {
  return {
    key: typeof value.key === 'string' ? value.key : '',
    label: typeof value.label === 'string' ? value.label : '',
    count: normalizeCount(value.count),
    conversion_rate: normalizeNumber(value.conversion_rate),
    dropoff: normalizeCount(value.dropoff),
  }
}

function normalizeFailureReason(value: Partial<UsageFailureReason>): UsageFailureReason {
  return {
    reason_code: typeof value.reason_code === 'string' ? value.reason_code : 'unknown_failure',
    count: normalizeCount(value.count),
    percentage: normalizeNumber(value.percentage),
    last_seen_at: typeof value.last_seen_at === 'string' ? value.last_seen_at : null,
    events: value.events && typeof value.events === 'object' ? value.events : {},
  }
}

function normalizeFailureSample(value: Partial<UsageFailureSample>): UsageFailureSample {
  return {
    created_at: typeof value.created_at === 'string' ? value.created_at : '',
    event: typeof value.event === 'string' ? value.event : '',
    reason_code: typeof value.reason_code === 'string' ? value.reason_code : 'unknown_failure',
    duration_ms: typeof value.duration_ms === 'number' && Number.isFinite(value.duration_ms) ? value.duration_ms : null,
    permission: typeof value.permission === 'string' ? value.permission : null,
    cdk_status: typeof value.cdk_status === 'string' ? value.cdk_status : null,
    source: typeof value.source === 'string' ? value.source : null,
    has_profile: value.has_profile === true,
  }
}

function normalizeLatencyStats(value: Partial<UsageLatencyStats> | undefined): UsageLatencyStats {
  return {
    average_ms: normalizeCount(value?.average_ms),
    p50_ms: normalizeCount(value?.p50_ms),
    p95_ms: normalizeCount(value?.p95_ms),
    max_ms: normalizeCount(value?.max_ms),
    sample_count: normalizeCount(value?.sample_count),
    days: Array.isArray(value?.days)
      ? value.days.map((day) => ({
        date: typeof day.date === 'string' ? day.date : '',
        average_ms: normalizeCount(day.average_ms),
        p95_ms: normalizeCount(day.p95_ms),
        sample_count: normalizeCount(day.sample_count),
      }))
      : [],
  }
}

function normalizeSklandStats(value: Partial<UsageSklandStats> | undefined): UsageSklandStats {
  return {
    attempts: normalizeCount(value?.attempts),
    success: normalizeCount(value?.success),
    failed: normalizeCount(value?.failed),
    success_rate: normalizeNumber(value?.success_rate),
    credential_invalid: normalizeCount(value?.credential_invalid),
    refresh_forbidden: normalizeCount(value?.refresh_forbidden),
    not_bound: normalizeCount(value?.not_bound),
    request_failed: normalizeCount(value?.request_failed),
    days: Array.isArray(value?.days)
      ? value.days.map((day) => ({
        date: typeof day.date === 'string' ? day.date : '',
        attempts: normalizeCount(day.attempts),
        success: normalizeCount(day.success),
        failed: normalizeCount(day.failed),
        success_rate: normalizeNumber(day.success_rate),
      }))
      : [],
  }
}

function normalizeAnnouncementStats(value: Partial<UsageAnnouncementStats> | undefined): UsageAnnouncementStats {
  return {
    impressions: normalizeCount(value?.impressions),
    reads: normalizeCount(value?.reads),
    unread: normalizeCount(value?.unread),
    read_rate: normalizeNumber(value?.read_rate),
  }
}

function normalizeCdkDistributionItem(value: Partial<UsageCdkDistributionItem>): UsageCdkDistributionItem {
  return {
    permission: typeof value.permission === 'string' ? value.permission : 'unknown',
    total: normalizeCount(value.total),
    success: normalizeCount(value.success),
    failure: normalizeCount(value.failure),
    statuses: value.statuses && typeof value.statuses === 'object' ? value.statuses : {},
  }
}

export function normalizeRiskSettings(value: Partial<RiskControlSettings> | null | undefined): RiskControlSettings {
  return {
    operator_data_risk_enabled: value?.operator_data_risk_enabled !== false,
    updated_at: typeof value?.updated_at === 'string' ? value.updated_at : null,
  }
}

function normalizeCount(value: unknown): number {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : 0
}

function normalizeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value * 10) / 10 : 0
}

export function normalizeAnnouncementBanner(value: Announcement | null | undefined): Announcement {
  return normalizeAnnouncement(value, 'banner') ?? createDraftBanner()
}

export function normalizeAnnouncementList(value: Announcement[] | null | undefined): Announcement[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Announcement => Boolean(item) && typeof item === 'object' && item.kind !== 'banner')
    .map((item) => normalizeAnnouncement(item, 'popup'))
    .filter((item): item is Announcement => Boolean(item))
}

function normalizeAnnouncement(value: Announcement | null | undefined, kind: Announcement['kind']): Announcement | null {
  if (!value || typeof value !== 'object') return null
  const now = new Date().toISOString()
  return {
    id: typeof value.id === 'string' && value.id ? value.id : createDraftId(),
    kind,
    active: value.active === true,
    title: typeof value.title === 'string' ? value.title : '',
    body: typeof value.body === 'string' ? value.body : '',
    created_at: typeof value.created_at === 'string' ? value.created_at : now,
    updated_at: typeof value.updated_at === 'string' ? value.updated_at : now,
  }
}

export function normalizeAnnouncementStatsMap(
  value: Partial<Record<string, Partial<AnnouncementReachStats>>> | null | undefined,
  announcements: Announcement[],
): Record<string, AnnouncementReachStats> {
  const source = value && typeof value === 'object' ? value : {}
  return Object.fromEntries(
    announcements.map((announcement) => [announcement.id, normalizeAnnouncementReachStats(source[announcement.id])]),
  )
}

function normalizeAnnouncementReachStats(value: Partial<AnnouncementReachStats> | undefined): AnnouncementReachStats {
  return {
    impressions: normalizeCount(value?.impressions),
    reads: normalizeCount(value?.reads),
    server_reads: normalizeCount(value?.server_reads),
    local_reads: normalizeCount(value?.local_reads),
    unread: normalizeCount(value?.unread),
    read_rate: normalizeNumber(value?.read_rate),
  }
}

export function sortAnnouncements(items: Announcement[], sort: AnnouncementSortKey): Announcement[] {
  const next = [...items]
  return next.sort((left, right) => {
    if (sort === 'updated_asc') return compareAnnouncementUpdatedAt(left, right)
    if (sort === 'active') {
      const activeCompare = Number(right.active) - Number(left.active)
      return activeCompare || compareAnnouncementUpdatedAtDesc(left, right)
    }
    return compareAnnouncementUpdatedAtDesc(left, right)
  })
}

function compareAnnouncementUpdatedAt(left: Announcement, right: Announcement): number {
  return (Date.parse(left.updated_at) || 0) - (Date.parse(right.updated_at) || 0)
}

function compareAnnouncementUpdatedAtDesc(left: Announcement, right: Announcement): number {
  return compareAnnouncementUpdatedAt(right, left)
}

export function createDraftBanner(): Announcement {
  return createDraftAnnouncementItem('banner')
}

export function createDraftAnnouncement(): Announcement {
  return createDraftAnnouncementItem('popup')
}

function createDraftAnnouncementItem(kind: Announcement['kind']): Announcement {
  const now = new Date().toISOString()
  return {
    id: createDraftId(),
    kind,
    active: false,
    title: '',
    body: '',
    created_at: now,
    updated_at: now,
  }
}

function createDraftId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return `draft_${crypto.randomUUID()}`
  return `draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export function formatDate(value: string | null): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

export function formatDuration(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '-'
  if (value < 1000) return `${Math.round(value)}ms`
  return `${Math.round(value / 100) / 10}s`
}

export function validateEmailInput(value: string): string | null {
  const email = value.trim()
  if (!email) return '请输入邮箱'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '请输入正确的邮箱地址'
  return null
}

export function validatePasswordInput(value: string): string | null {
  if (!value) return '请输入密码'
  if (value.length < 8) return '密码至少需要 8 位'
  return null
}

export function omitFieldError(errors: FieldErrors, field: string): FieldErrors {
  if (!errors[field]) return errors
  const next = { ...errors }
  delete next[field]
  return next
}

export function inputClassName(hasError: boolean): string {
  const base = 'tool-field'
  const state = hasError
    ? 'border-error/70 bg-error/10 focus:border-error focus:ring-error/20'
    : ''
  return `${base} ${state}`
}

export function getNextProductPermission(permission: Permission): GeneratedPermission | null {
  const current = permission === 'basic' ? 'growth' : permission === 'premium' ? 'advanced' : cdkProductPermissions.includes(permission as GeneratedPermission) ? permission as GeneratedPermission : null
  if (!current) return null
  return cdkProductPermissions.find((item) => cdkProductPermissionRank[item] === cdkProductPermissionRank[current] + 1) ?? null
}

export function getAdminProfileAccessLabel(profile: AdminProfileAccessSummary): string {
  if (profile.kind === 'free_preview') return '免费预览'
  if (profile.kind === 'depot_value') return '仓库分析'
  return permissionLabels[profile.permission] ?? profile.permission
}

export function formatAdminProfileAccess(profileAccess: AdminProfileAccessSummary[]): string {
  const labels = [...new Set(profileAccess.map(getAdminProfileAccessLabel))]
  return labels.length > 0 ? labels.join(' / ') : '-'
}

export function normalizeGeneratedCdks(data: AdminCdkCreateResponse): GeneratedCdk[] {
  const cdks = Array.isArray(data.cdks)
    ? data.cdks
      .map((item) => {
        const permission = typeof item.permission === 'string' ? normalizeProductPermission(item.permission) : null
        if (typeof item.code !== 'string' || !item.code.trim() || !permission || typeof item.created_at !== 'string') return null
        return { code: item.code, permission, created_at: item.created_at }
      })
      .filter((item): item is GeneratedCdk => Boolean(item))
    : []

  if (cdks.length > 0) return cdks

  const permission = typeof data.permission === 'string' ? normalizeProductPermission(data.permission) : null
  if (typeof data.code === 'string' && data.code.trim() && permission && typeof data.created_at === 'string') {
    return [{ code: data.code, permission, created_at: data.created_at }]
  }
  return []
}

export function normalizeProductPermission(permission: string): GeneratedPermission | null {
  if (permission === 'basic') return 'growth'
  if (permission === 'premium') return 'advanced'
  return cdkProductPermissions.includes(permission as GeneratedPermission) ? permission as GeneratedPermission : null
}

export function isAppUserStatus(status: string): status is AppUserStatus {
  return status === 'active' || status === 'frozen' || status === 'revoked'
}

export function formatNullableNumber(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '-'
}

export function buildCurrentOpsReport(
  usage: UsageStatsResponse,
  cdk: CdkOpsSummary,
  banner: Announcement,
  announcements: Announcement[],
  announcementStats: Record<string, AnnouncementReachStats>,
) {
  return {
    generated_at: new Date().toISOString(),
    range: usage.range,
    totals: usage.totals,
    days: usage.days,
    funnel: usage.funnel,
    failure_reasons: usage.failure_reasons,
    latency: usage.latency,
    skland: usage.skland,
    announcement: usage.announcement,
    banner_item: {
      id: banner.id,
      title: banner.title,
      active: banner.active,
      updated_at: banner.updated_at,
    },
    announcement_items: announcements.map((announcement) => ({
      id: announcement.id,
      kind: announcement.kind,
      title: announcement.title,
      active: announcement.active,
      updated_at: announcement.updated_at,
      stats: announcementStats[announcement.id] ?? EMPTY_ANNOUNCEMENT_REACH_STATS,
    })),
    cdk_permission_distribution: cdk.permission_distribution,
    cdk_status_distribution: cdk.status_distribution,
    risk_trend: cdk.risk_trend,
    risk_reasons: cdk.risk_reasons.map((item) => ({
      type: item.type,
      reason: item.reason,
      count: item.count,
      last_seen_at: item.last_seen_at,
      latest_cdk_id: item.latest_record?.cdk_id ?? null,
    })),
  }
}

export function buildCurrentOpsReportCsv(report: ReturnType<typeof buildCurrentOpsReport>): string {
  const rows: string[][] = [
    ['section', 'key', 'label', 'date', 'value', 'extra'],
    ['range', 'from', 'From', '', report.range.from, ''],
    ['range', 'to', 'To', '', report.range.to, ''],
    ['range', 'days', 'Days', '', String(report.range.days), ''],
  ]
  for (const [key, value] of Object.entries(report.totals)) {
    rows.push(['totals', key, key, '', String(value), ''])
  }
  for (const day of report.days) {
    for (const [key, value] of Object.entries(day)) {
      if (key === 'date') continue
      rows.push(['days', key, key, day.date, String(value), ''])
    }
  }
  for (const item of report.funnel) {
    rows.push(['funnel', item.key, item.label, '', String(item.count), `conversion=${item.conversion_rate};dropoff=${item.dropoff}`])
  }
  for (const item of report.failure_reasons) {
    rows.push(['failure_reasons', item.reason_code, item.reason_code, item.last_seen_at ?? '', String(item.count), `percentage=${item.percentage}`])
  }
  for (const item of report.cdk_permission_distribution) {
    rows.push(['cdk_permission_distribution', String(item.permission), permissionLabels[item.permission] ?? String(item.permission), '', String(item.total), `unused=${item.unused};used=${item.used};frozen=${item.frozen};revoked=${item.revoked}`])
  }
  for (const item of report.cdk_status_distribution) {
    rows.push(['cdk_status_distribution', item.status, statusLabels[item.status], '', String(item.total), ''])
  }
  for (const day of report.risk_trend) {
    rows.push(['risk_trend', 'risk_events', 'Risk events', day.date, String(day.total), `soft=${day.soft_blocks};freeze=${day.freezes};escalation=${day.escalations}`])
  }
  for (const item of report.risk_reasons) {
    rows.push(['risk_reasons', item.type, item.reason, item.last_seen_at ?? '', String(item.count), `latest_cdk=${item.latest_cdk_id ?? ''}`])
  }
  const latency = report.latency.schedule_generate
  rows.push(['latency', 'average_ms', 'Average', '', String(latency.average_ms), ''])
  rows.push(['latency', 'p50_ms', 'P50', '', String(latency.p50_ms), ''])
  rows.push(['latency', 'p95_ms', 'P95', '', String(latency.p95_ms), ''])
  rows.push(['latency', 'max_ms', 'Max', '', String(latency.max_ms), ''])
  rows.push(['skland', 'success_rate', 'Success rate', '', String(report.skland.success_rate), `attempts=${report.skland.attempts};failed=${report.skland.failed}`])
  rows.push(['announcement', 'read_rate', 'Read rate', '', String(report.announcement.read_rate), `impressions=${report.announcement.impressions};reads=${report.announcement.reads}`])
  rows.push([
    'banner',
    'active',
    report.banner_item.title,
    report.banner_item.updated_at,
    String(report.banner_item.active),
    `id=${report.banner_item.id}`,
  ])
  for (const item of report.announcement_items) {
    const extra = `id=${item.id};kind=${item.kind};active=${item.active};server_reads=${item.stats.server_reads};local_reads=${item.stats.local_reads}`
    rows.push(['announcement_item', 'impressions', item.title, item.updated_at, String(item.stats.impressions), extra])
    rows.push(['announcement_item', 'reads', item.title, item.updated_at, String(item.stats.reads), extra])
    rows.push(['announcement_item', 'read_rate', item.title, item.updated_at, String(item.stats.read_rate), extra])
  }
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
}

export function buildGeneratedCdkCsv(cdks: GeneratedCdk[]): string {
  const rows = [
    ['code', 'permission', 'permission_label', 'created_at'],
    ...cdks.map((item) => [item.code, item.permission, permissionLabels[item.permission], item.created_at]),
  ]
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
}

function csvCell(value: string): string {
  if (!/[",\r\n]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function downloadOperatorsJson(data: AdminProfileOperatorData): void {
  const blob = new Blob([JSON.stringify(data.operators, null, 2)], { type: 'application/json' })
  downloadBlob(blob, `skland-operators-${formatFileSegment(data.profile.id)}-${formatDownloadTimestamp()}.json`)
}

function formatFileSegment(value: string): string {
  return value.slice(0, 8).replace(/[^A-Za-z0-9_-]/g, '') || 'profile'
}

export function formatDownloadTimestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('') + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

export function formatOperatorValue(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string' && value.trim()) return value
  return '-'
}

export function omitProfileOperatorData(
  current: Record<string, AdminProfileOperatorData>,
  profileId: string,
): Record<string, AdminProfileOperatorData> {
  if (!(profileId in current)) return current
  const next = { ...current }
  delete next[profileId]
  return next
}

export function formatRiskDetail(detail: Record<string, unknown>): string {
  const visible = Object.entries(detail)
    .filter(([key]) => !/(hash|token|secret|credential|encrypted|salt|password)/i.test(key))
    .slice(0, 6)
    .map(([key, value]) => `${key}: ${formatRiskValue(value)}`)
  return visible.length > 0 ? visible.join(' / ') : '已隐藏敏感详情'
}

function formatRiskValue(value: unknown): string {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `${value.length} 项`
  return '对象摘要'
}
