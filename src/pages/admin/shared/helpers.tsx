import type { Announcement, AnnouncementStats as AnnouncementReachStats } from '../../../lib/types'
import type { ReactNode } from 'react'

import { Permission, GeneratedPermission, CdkStatus, AppUserStatus, FieldErrors, GeneratedCdk, AdminCdkCreateResponse, AdminCdkRecord, CdkPermissionDistribution, CdkStatusDistribution, RiskReasonStats, RiskTrendDay, CdkOpsSummary, RiskControlSettings, AdminProfileAccessSummary, AdminProfileOperatorData, permissionLabels, statusLabels, appUserStatusLabels, cdkProductPermissions, cdkProductPermissionRank } from '../contracts'

export function DetailItem({ label, value }: { label: ReactNode; value: string }) {
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

export function getAppUserStatusLabel(status: AppUserStatus, emailVerifiedAt?: string | null): string {
  return status === 'active' && emailVerifiedAt === null ? '未验证' : appUserStatusLabels[status]
}

export function UserStatusPill({ status, emailVerifiedAt }: { status: AppUserStatus; emailVerifiedAt?: string | null }) {
  const className = status === 'active' && emailVerifiedAt === null
    ? 'tool-status--warning'
    : status === 'active'
      ? 'tool-status--success'
      : status === 'frozen'
        ? 'tool-status--warning'
        : 'tool-status--error'
  return <span className={`tool-status ${className}`}>{getAppUserStatusLabel(status, emailVerifiedAt)}</span>
}

export function SmallButton({ children, onClick, loading, tone = 'default', autoFocus = false }: { children: ReactNode; onClick: () => void; loading?: boolean; tone?: 'default' | 'success' | 'danger'; autoFocus?: boolean }) {
  const className = tone === 'danger'
    ? 'border-error/40 bg-error/10 text-error hover:border-error/60 hover:bg-error/20 hover:text-error'
    : tone === 'success'
      ? 'border-success/40 bg-success/10 text-success hover:border-success/60 hover:bg-success/20 hover:text-success'
      : ''
  return <button type="button" onClick={onClick} disabled={loading} data-dialog-initial-focus={autoFocus ? '' : undefined} className={`tool-secondary-action min-h-11 px-3 text-xs ${className}`}>{loading ? '处理中' : children}</button>
}

export function buildCdkOpsSummary(records: AdminCdkRecord[]): CdkOpsSummary {
  const permissionMap = new Map<Permission, CdkPermissionDistribution>()
  for (const permission of cdkProductPermissions) {
    permissionMap.set(permission, { permission, total: 0, unused: 0, claiming: 0, used: 0, frozen: 0, revoked: 0 })
  }
  const statusMap = new Map<CdkStatus, CdkStatusDistribution>(
    (['unused', 'claiming', 'used', 'frozen', 'revoked'] as CdkStatus[]).map((status) => [status, { status, total: 0 }]),
  )
  const reasonMap = new Map<string, RiskReasonStats>()
  const trendMap = new Map<string, RiskTrendDay>()
  let softBlocks = 0
  let escalations = 0

  for (const record of records) {
    if (record.cdk_type === 'profile' && record.permission) {
      const permission = normalizeProductPermission(record.permission) ?? record.permission
      const distribution = permissionMap.get(permission) ?? { permission, total: 0, unused: 0, claiming: 0, used: 0, frozen: 0, revoked: 0 }
      distribution.total += 1
      distribution[record.status] += 1
      permissionMap.set(permission, distribution)
    }

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
    type_distribution: (['profile', 'balance', 'item'] as const).map((cdk_type) => ({
      cdk_type,
      total: records.filter((record) => record.cdk_type === cdk_type).length,
    })),
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

export function normalizeRiskSettings(value: Partial<RiskControlSettings> | null | undefined): RiskControlSettings {
  return {
    operator_data_risk_enabled: value?.operator_data_risk_enabled !== false,
    revision: Number.isSafeInteger(value?.revision) && Number(value?.revision) >= 0 ? Number(value?.revision) : 0,
    can_configure: value?.can_configure === true,
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
    ...(kind === 'popup' && value.popup_until ? { popup_until: value.popup_until } : {}),
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
    visitor_reads: normalizeCount(value?.visitor_reads),
    unread: normalizeCount(value?.unread),
    read_rate: normalizeNumber(value?.read_rate),
  }
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
    active: kind === 'popup',
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

export function getNextProductPermission(permission: Permission | null): GeneratedPermission | null {
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
        const cdkType = item.cdk_type === 'balance' ? 'balance' : item.cdk_type === 'item' ? 'item' : 'profile'
        const permission = typeof item.permission === 'string' ? normalizeProductPermission(item.permission) : null
        const amount = typeof item.amount === 'string' ? item.amount : undefined
        const itemCode = item.item_code === 'lifetime_profile_voucher' || item.item_code === 'limited_profile_voucher' ? item.item_code : undefined
        if (typeof item.code !== 'string' || !item.code.trim() || typeof item.created_at !== 'string') return null
        if (cdkType === 'profile' && !permission) return null
        if (cdkType === 'balance' && !amount) return null
        if (cdkType === 'item' && !itemCode) return null
        const profileDuration = item.profile_duration === 'lifetime' || item.profile_duration === 'month' || item.profile_duration === 'half_year' || item.profile_duration === 'year'
          ? item.profile_duration
          : undefined
        return {
          code: item.code,
          cdk_type: cdkType,
          ...(permission ? { permission } : {}),
          ...(profileDuration ? { profile_duration: profileDuration, profile_duration_days: item.profile_duration_days, profile_expires_at: item.profile_expires_at } : {}),
          ...(amount ? { amount } : {}),
          ...(itemCode ? { item_code: itemCode, item_name: item.item_name, item_expires_at: item.item_expires_at } : {}),
          created_at: item.created_at,
        }
      })
      .filter((item): item is GeneratedCdk => Boolean(item))
    : []

  if (cdks.length > 0) return cdks

  const cdkType = data.cdk_type === 'balance' ? 'balance' : data.cdk_type === 'item' ? 'item' : 'profile'
  const permission = typeof data.permission === 'string' ? normalizeProductPermission(data.permission) : null
  const amount = typeof data.amount === 'string' ? data.amount : undefined
  const itemCode = data.item_code === 'lifetime_profile_voucher' || data.item_code === 'limited_profile_voucher' ? data.item_code : undefined
  if (typeof data.code === 'string' && data.code.trim() && typeof data.created_at === 'string'
    && ((cdkType === 'profile' && permission) || (cdkType === 'balance' && amount) || (cdkType === 'item' && itemCode))) {
    const profileDuration = data.profile_duration === 'lifetime' || data.profile_duration === 'month' || data.profile_duration === 'half_year' || data.profile_duration === 'year'
      ? data.profile_duration
      : undefined
    return [{
      code: data.code,
      cdk_type: cdkType,
      ...(permission ? { permission } : {}),
      ...(profileDuration ? { profile_duration: profileDuration, profile_duration_days: data.profile_duration_days, profile_expires_at: data.profile_expires_at } : {}),
      ...(amount ? { amount } : {}),
      ...(itemCode ? { item_code: itemCode, item_name: data.item_name, item_expires_at: data.item_expires_at } : {}),
      created_at: data.created_at,
    }]
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

export function buildGeneratedCdkCsv(cdks: GeneratedCdk[]): string {
  const rows = [
    ['code', 'cdk_type', 'permission', 'permission_label', 'profile_duration', 'profile_duration_days', 'profile_expires_at', 'amount', 'item_code', 'item_name', 'item_expires_at', 'created_at'],
    ...cdks.map((item) => [item.code, item.cdk_type, item.permission ?? '', item.permission ? permissionLabels[item.permission] : '', item.profile_duration ?? '', item.profile_duration_days == null ? '' : String(item.profile_duration_days), item.profile_expires_at ?? '', item.amount ?? '', item.item_code ?? '', item.item_name ?? '', item.item_expires_at ?? '', item.created_at]),
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
  const operators = data.operators.map((operator) => ({ ...operator, rarity: operator.rarity + 1 }))
  const blob = new Blob([JSON.stringify(operators, null, 2)], { type: 'application/json' })
  downloadBlob(blob, `skland-operators-${formatFileSegment(data.profile.id)}-${formatDownloadTimestamp()}.json`)
}

export function buildUserWorkspaceExportFilename(userId: string, date = new Date()): string {
  return `maa-user-workspaces-${formatFileSegment(userId)}-${formatDownloadTimestamp(date)}.json`
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
