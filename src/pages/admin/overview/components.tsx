import type { AnnouncementStats as AnnouncementReachStats } from '../../../lib/types'
import { AdminCdkRecord, RiskReasonStats, RiskTrendDay, CdkOpsSummary, permissionLabels } from '../contracts'
import { StatusPill, SmallButton, formatDate } from '../shared/helpers'
import { Metric } from '../cdk/components'
import { METERED_BILLING_AVAILABLE } from '../../../lib/site-features'

export function AnnouncementReachMetrics({ stats }: { stats: AnnouncementReachStats }) {
  return (
    <dl className="mt-4 grid gap-y-3 border-y border-surface-3 py-3 text-sm sm:grid-cols-4 sm:divide-x sm:divide-surface-3">
      <div className="sm:px-3 first:sm:pl-0">
        <dt className="text-xs text-ink-muted">触达</dt>
        <dd className="mt-1 font-semibold text-ink-primary">{stats.impressions}</dd>
      </div>
      <div className="sm:px-3">
        <dt className="text-xs text-ink-muted">独立访客已读</dt>
        <dd className="mt-1 font-semibold text-ink-primary">{stats.reads}</dd>
        <dd className="mt-0.5 text-xs text-ink-muted">账号已读 {stats.server_reads}（单独统计）</dd>
      </div>
      <div className="sm:px-3">
        <dt className="text-xs text-ink-muted">未读估算</dt>
        <dd className="mt-1 font-semibold text-ink-primary">{stats.unread}</dd>
      </div>
      <div className="sm:px-3">
        <dt className="text-xs text-ink-muted">阅读率</dt>
        <dd className="mt-1 font-semibold text-ink-primary">{stats.read_rate}%</dd>
      </div>
    </dl>
  )
}

export function CdkRecordDistributionPanel({ summary }: { summary: CdkOpsSummary }) {
  const typeLabels = { profile: '档案兑换', balance: '余额兑换', item: '道具' } as const
  return (
    <section className="tool-panel p-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-semibold text-ink-primary">CDK 权限与状态分布</h2>
        <span className="text-xs text-ink-muted">基于当前 CDK 记录</span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {summary.type_distribution.filter((item) => item.cdk_type !== 'balance' || METERED_BILLING_AVAILABLE).map((item) => (
          <div key={item.cdk_type} className="tool-inset flex items-center justify-between gap-3 p-3">
            <span className="text-sm text-ink-secondary">{typeLabels[item.cdk_type]}</span>
            <span className="text-lg font-semibold text-ink-primary">{item.total}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-5 xl:grid-cols-[1fr_0.75fr]">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="text-xs text-ink-muted">
              <tr>
                <th className="pb-2 pr-4 font-medium">权限</th>
                <th className="pb-2 pr-4 font-medium">总量</th>
                <th className="pb-2 pr-4 font-medium">未用</th>
                <th className="pb-2 pr-4 font-medium">已用</th>
                <th className="pb-2 pr-4 font-medium">冻结</th>
                <th className="pb-2 font-medium">撤销</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-3">
              {summary.permission_distribution.map((item) => (
                <tr key={item.permission}>
                  <td className="py-3 pr-4 font-medium text-ink-primary">{permissionLabels[item.permission] ?? item.permission}</td>
                  <td className="py-3 pr-4 text-ink-secondary">{item.total}</td>
                  <td className="py-3 pr-4 text-ink-secondary">{item.unused}</td>
                  <td className="py-3 pr-4 text-ink-secondary">{item.used}</td>
                  <td className="py-3 pr-4 text-warning">{item.frozen}</td>
                  <td className="py-3 text-error">{item.revoked}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          {summary.status_distribution.map((item) => (
            <div key={item.status} className="tool-inset p-3">
              <div className="flex items-center justify-between gap-3">
                <StatusPill status={item.status} />
                <span className="text-lg font-semibold text-ink-primary">{item.total}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export function RiskConsoleSummary({ summary }: { summary: CdkOpsSummary }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="风险 CDK" value={summary.risk_records} tone={summary.risk_records > 0 ? 'warning' : 'default'} />
      <Metric label="软拦截" value={summary.soft_blocks} tone={summary.soft_blocks > 0 ? 'warning' : 'default'} />
      <Metric label="冻结事件" value={summary.freezes} tone={summary.freezes > 0 ? 'warning' : 'default'} />
      <Metric label="升级冻结" value={summary.escalations} tone={summary.escalations > 0 ? 'warning' : 'default'} />
    </div>
  )
}

export function RiskTrendPanel({ days }: { days: RiskTrendDay[] }) {
  const maxValue = Math.max(1, ...days.map((day) => day.total))
  return (
    <section className="tool-panel p-5">
      <h2 className="text-base font-semibold text-ink-primary">风控趋势</h2>
      <div className="mt-4 space-y-2">
        {days.length === 0 && <div className="tool-inset px-4 py-6 text-center text-sm text-ink-muted">暂无风控趋势数据</div>}
        {days.map((day) => (
          <div key={day.date} className="grid grid-cols-[72px_1fr_116px] items-center gap-3 text-xs">
            <span className="text-ink-muted">{day.date.slice(5)}</span>
            <div className="flex h-2 overflow-hidden rounded-full bg-surface-3">
              <div className="bg-warning" style={{ width: `${(day.soft_blocks / maxValue) * 100}%` }} />
              <div className="bg-error" style={{ width: `${(day.freezes / maxValue) * 100}%` }} />
            </div>
            <span className="text-right text-ink-secondary">软 {day.soft_blocks} / 冻 {day.freezes}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

export function RiskReasonPanel({ reasons, onOpenDetail }: { reasons: RiskReasonStats[]; onOpenDetail: (record: AdminCdkRecord) => Promise<void> }) {
  return (
    <section className="tool-panel p-5">
      <h2 className="text-base font-semibold text-ink-primary">风险原因分布</h2>
      <div className="mt-4 space-y-3">
        {reasons.length === 0 && <div className="tool-inset px-4 py-6 text-center text-sm text-ink-muted">暂无风险原因</div>}
        {reasons.slice(0, 6).map((item) => (
          <div key={`${item.type}:${item.reason}`} className="tool-inset p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="font-medium text-ink-primary">{item.type}</div>
                <div className="mt-1 line-clamp-2 text-sm text-ink-secondary">{item.reason}</div>
                <div className="mt-1 text-xs text-ink-muted">最近 {formatDate(item.last_seen_at)}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="tool-status">{item.count}</span>
                {item.latest_record && <SmallButton onClick={() => void onOpenDetail(item.latest_record!)}>详情</SmallButton>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
