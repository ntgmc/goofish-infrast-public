import type { AdminCdkRecord, CdkOpsSummary, CdkPermissionDistribution, CdkStatus, CdkStatusDistribution, Permission, RiskReasonStats, RiskTrendDay } from '../../src/pages/admin/contracts'
import { cdkProductPermissions } from '../../src/pages/admin/contracts'

export function buildAdminCdkOpsSummary(records: AdminCdkRecord[]): CdkOpsSummary {
  const permissionMap = new Map<Permission, CdkPermissionDistribution>()
  for (const permission of cdkProductPermissions) permissionMap.set(permission, { permission, total: 0, unused: 0, claiming: 0, used: 0, frozen: 0, revoked: 0 })
  const statuses: CdkStatus[] = ['unused', 'claiming', 'used', 'frozen', 'revoked']
  const statusMap = new Map<CdkStatus, CdkStatusDistribution>(statuses.map((status) => [status, { status, total: 0 }]))
  const reasonMap = new Map<string, RiskReasonStats>()
  const trendMap = new Map<string, RiskTrendDay>()
  let softBlocks = 0
  let escalations = 0
  for (const record of records) {
    if (record.cdk_type === 'profile' && record.permission) {
      const distribution = permissionMap.get(record.permission) ?? { permission: record.permission, total: 0, unused: 0, claiming: 0, used: 0, frozen: 0, revoked: 0 }
      distribution.total += 1
      distribution[record.status] += 1
      permissionMap.set(record.permission, distribution)
    }
    const status = statusMap.get(record.status)
    if (status) status.total += 1
    for (const event of record.risk_events ?? []) {
      const date = event.at.slice(0, 10)
      const trend = trendMap.get(date) ?? { date, soft_blocks: 0, freezes: 0, escalations: 0, total: 0 }
      trend.total += 1
      if (event.soft_block) { trend.soft_blocks += 1; softBlocks += 1 }
      if (event.escalation) { trend.escalations += 1; escalations += 1 }
      if (record.status === 'frozen' && record.latest_risk_event?.at === event.at) trend.freezes += 1
      trendMap.set(date, trend)
      const key = `${event.type}:${event.reason}`
      const reason = reasonMap.get(key) ?? { type: event.type, reason: event.reason, count: 0, last_seen_at: null, latest_record: null }
      reason.count += 1
      if (!reason.last_seen_at || Date.parse(event.at) > Date.parse(reason.last_seen_at)) {
        reason.last_seen_at = event.at
        reason.latest_record = record
      }
      reasonMap.set(key, reason)
    }
  }
  const days: RiskTrendDay[] = []
  const now = new Date()
  for (let offset = 13; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset)).toISOString().slice(0, 10)
    days.push(trendMap.get(date) ?? { date, soft_blocks: 0, freezes: 0, escalations: 0, total: 0 })
  }
  return {
    type_distribution: (['profile', 'balance', 'item'] as const).map((cdk_type) => ({
      cdk_type,
      total: records.filter((record) => record.cdk_type === cdk_type).length,
    })),
    permission_distribution: [...permissionMap.values()].filter((item) => item.total > 0),
    status_distribution: [...statusMap.values()],
    risk_reasons: [...reasonMap.values()].sort((left, right) => right.count - left.count || (Date.parse(right.last_seen_at ?? '') || 0) - (Date.parse(left.last_seen_at ?? '') || 0)),
    risk_trend: days,
    soft_blocks: softBlocks,
    freezes: records.filter((record) => record.status === 'frozen').length,
    escalations,
    risk_records: records.filter((record) => record.status === 'frozen' || (record.risk_event_count ?? 0) > 0).length,
    generated_records: records.filter((record) => (record.schedule_generate_count ?? 0) > 0).length,
  }
}
