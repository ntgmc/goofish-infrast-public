import { useState } from 'react'
import type { AnnouncementStats as AnnouncementReachStats } from '../../../lib/types'

import { Permission, AdminCdkRecord, UsageDay, UsageFunnelStep, UsageFailureReason, UsageFailureSample, UsageLatencyStats, UsageSklandStats, UsageAnnouncementStats, UsageCdkDistributionItem, RiskReasonStats, RiskTrendDay, CdkOpsSummary, permissionLabels } from '../contracts'
import { InfoRow, DetailItem, StatusPill, SmallButton, buildSummary, formatDate, formatDuration } from '../shared/helpers'
import { Metric } from '../cdk/components'

export const EMPTY_LATENCY_STATS: UsageLatencyStats = {
  average_ms: 0,
  p50_ms: 0,
  p95_ms: 0,
  max_ms: 0,
  sample_count: 0,
  days: [],
}

export const EMPTY_SKLAND_STATS: UsageSklandStats = {
  attempts: 0,
  success: 0,
  failed: 0,
  success_rate: 0,
  credential_invalid: 0,
  refresh_forbidden: 0,
  not_bound: 0,
  request_failed: 0,
  days: [],
}

export const EMPTY_ANNOUNCEMENT_STATS: UsageAnnouncementStats = {
  impressions: 0,
  reads: 0,
  unread: 0,
  read_rate: 0,
}

export function FunnelPanel({ steps }: { steps: UsageFunnelStep[] }) {
  return (
    <section className="tool-panel p-5">
      <h2 className="text-base font-semibold text-ink-primary">运营漏斗</h2>
      <div className="mt-4 space-y-3">
        {steps.length === 0 && <div className="tool-inset px-4 py-6 text-center text-sm text-ink-muted">暂无漏斗数据</div>}
        {steps.map((step) => (
          <div key={step.key} className="tool-inset p-3">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium text-ink-primary">{step.label}</span>
              <span className="font-semibold text-ink-primary">{step.count}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.min(100, Math.max(0, step.conversion_rate))}%` }} />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-ink-muted">
              <span>转化 {step.conversion_rate}%</span>
              <span>掉失 {step.dropoff}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

export function FailureReasonPanel({ reasons, samples }: { reasons: UsageFailureReason[]; samples: UsageFailureSample[] }) {
  return (
    <section className="tool-panel p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-ink-primary">失败原因 Top</h2>
        <span className="text-xs text-ink-muted">稳定 reason_code</span>
      </div>
      <div className="mt-4 space-y-3">
        {reasons.length === 0 && <div className="tool-inset px-4 py-6 text-center text-sm text-ink-muted">暂无失败事件</div>}
        {reasons.slice(0, 5).map((item) => (
          <div key={item.reason_code} className="tool-inset p-3">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-mono text-xs font-semibold text-ink-primary">{item.reason_code}</span>
              <span className="font-semibold text-ink-primary">{item.count}</span>
            </div>
            <div className="mt-2 text-xs text-ink-muted">{item.percentage}% · 最近 {formatDate(item.last_seen_at)}</div>
          </div>
        ))}
      </div>
      {samples.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="text-ink-muted">
              <tr>
                <th className="pb-2 pr-3 font-medium">时间</th>
                <th className="pb-2 pr-3 font-medium">事件</th>
                <th className="pb-2 pr-3 font-medium">原因</th>
                <th className="pb-2 font-medium">耗时</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-3">
              {samples.slice(0, 5).map((sample) => (
                <tr key={`${sample.created_at}-${sample.event}-${sample.reason_code}`}>
                  <td className="py-2 pr-3 text-ink-secondary">{formatDate(sample.created_at)}</td>
                  <td className="py-2 pr-3 text-ink-secondary">{sample.event}</td>
                  <td className="py-2 pr-3 font-mono text-ink-primary">{sample.reason_code}</td>
                  <td className="py-2 text-ink-secondary">{sample.duration_ms === null ? '-' : formatDuration(sample.duration_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export function LatencyPanel({ stats }: { stats: UsageLatencyStats }) {
  return (
    <section className="tool-panel p-5">
      <h2 className="text-base font-semibold text-ink-primary">单次计算耗时</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <DetailItem label="平均" value={formatDuration(stats.average_ms)} />
        <DetailItem label="P50" value={formatDuration(stats.p50_ms)} />
        <DetailItem label="P95" value={formatDuration(stats.p95_ms)} />
        <DetailItem label="样本" value={String(stats.sample_count)} />
      </div>
      <div className="mt-4 space-y-2">
        {stats.days.slice(-7).map((day) => (
          <div key={day.date} className="grid grid-cols-[72px_1fr_64px] items-center gap-3 text-xs">
            <span className="text-ink-muted">{day.date.slice(5)}</span>
            <div className="h-2 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-warning" style={{ width: `${Math.min(100, day.p95_ms / 200)}%` }} />
            </div>
            <span className="text-right text-ink-secondary">{formatDuration(day.p95_ms)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

export function OpsSummaryPanel({ summary }: { summary: ReturnType<typeof buildSummary> }) {
  return (
    <section className="tool-panel p-5">
      <h2 className="text-base font-semibold text-ink-primary">运营摘要</h2>
      <dl className="mt-4 space-y-3 text-sm">
        <InfoRow label="独立访客" value={String(summary.uniqueVisitors)} />
        <InfoRow label="访问次数" value={String(summary.visits)} />
        <InfoRow label="管理账号" value={String(summary.adminUsers)} />
        <InfoRow label="CDK 转化" value={`${summary.redeemRate}%`} />
      </dl>
    </section>
  )
}

export function SklandPanel({ stats }: { stats: UsageSklandStats }) {
  return (
    <section className="tool-panel p-5">
      <h2 className="text-base font-semibold text-ink-primary">Skland 导入</h2>
      <dl className="mt-4 space-y-3 text-sm">
        <InfoRow label="尝试" value={String(stats.attempts)} />
        <InfoRow label="成功" value={String(stats.success)} />
        <InfoRow label="失败" value={String(stats.failed)} />
        <InfoRow label="成功率" value={`${stats.success_rate}%`} />
        <InfoRow label="凭据失效" value={String(stats.credential_invalid)} />
      </dl>
    </section>
  )
}

export function AnnouncementStatsPanel({ stats }: { stats: UsageAnnouncementStats }) {
  return (
    <section className="tool-panel p-5">
      <h2 className="text-base font-semibold text-ink-primary">公告触达</h2>
      <dl className="mt-4 space-y-3 text-sm">
        <InfoRow label="触达" value={String(stats.impressions)} />
        <InfoRow label="已读" value={String(stats.reads)} />
        <InfoRow label="未读估算" value={String(stats.unread)} />
        <InfoRow label="阅读率" value={`${stats.read_rate}%`} />
      </dl>
    </section>
  )
}

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

export function CdkDistributionPanel({ items }: { items: UsageCdkDistributionItem[] }) {
  return (
    <section className="tool-panel p-5">
      <h2 className="text-base font-semibold text-ink-primary">CDK 兑换事件分布</h2>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="text-xs text-ink-muted">
            <tr>
              <th className="pb-2 pr-4 font-medium">权限</th>
              <th className="pb-2 pr-4 font-medium">总量</th>
              <th className="pb-2 pr-4 font-medium">成功</th>
              <th className="pb-2 font-medium">失败</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-3">
            {items.length === 0 && (
              <tr><td colSpan={4} className="py-5 text-center text-sm text-ink-muted">暂无 CDK 兑换事件</td></tr>
            )}
            {items.map((item) => (
              <tr key={item.permission}>
                <td className="py-3 pr-4 font-medium text-ink-primary">{permissionLabels[item.permission as Permission] ?? item.permission}</td>
                <td className="py-3 pr-4 text-ink-secondary">{item.total}</td>
                <td className="py-3 pr-4 text-success">{item.success}</td>
                <td className="py-3 text-error">{item.failure}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function CdkRecordDistributionPanel({ summary }: { summary: CdkOpsSummary }) {
  const typeLabels = { profile: '档案兑换', balance: '余额兑换', item: '道具（预留）' } as const
  return (
    <section className="tool-panel p-5">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-semibold text-ink-primary">CDK 权限与状态分布</h2>
        <span className="text-xs text-ink-muted">基于当前 CDK 记录</span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {summary.type_distribution.map((item) => (
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

type TrendMetricKey = 'visits' | 'schedule_generates' | 'account_additions'

const trendMetrics: Array<{ key: TrendMetricKey; label: string; stroke: string; dasharray?: string }> = [
  { key: 'visits', label: '访问', stroke: 'var(--color-brand-500)' },
  { key: 'schedule_generates', label: '生成', stroke: 'var(--color-warning)', dasharray: '8 5' },
  { key: 'account_additions', label: '兑换 / 新增', stroke: 'var(--color-success)', dasharray: '2 5' },
]

const trendChart = {
  width: 640,
  height: 260,
  left: 44,
  right: 18,
  top: 20,
  bottom: 38,
}

export function UsageTrendChart({ days }: { days: UsageDay[] }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  if (days.length === 0) {
    return (
      <div className="tool-inset mt-5 flex h-64 w-full items-center justify-center text-sm text-ink-muted">
        暂无趋势数据
      </div>
    )
  }

  const plotWidth = trendChart.width - trendChart.left - trendChart.right
  const plotHeight = trendChart.height - trendChart.top - trendChart.bottom
  const maxValue = Math.max(0, ...days.flatMap((day) => trendMetrics.map((metric) => Number(day[metric.key]) || 0)))
  const yMax = Math.max(1, maxValue)
  const yTicks = buildTrendTicks(yMax)
  const yFor = (value: number) => trendChart.top + plotHeight - (value / yMax) * plotHeight
  const xFor = (index: number) => trendChart.left + (days.length === 1 ? plotWidth / 2 : (plotWidth * index) / (days.length - 1))
  const points = days.map((day, index) => ({
    day,
    x: xFor(index),
    values: trendMetrics.map((metric) => ({
      ...metric,
      value: Number(day[metric.key]) || 0,
      y: yFor(Number(day[metric.key]) || 0),
    })),
  }))
  const activePoint = activeIndex === null ? null : points[activeIndex]
  const tooltipLeft = activePoint ? Math.min(82, Math.max(18, (activePoint.x / trendChart.width) * 100)) : 50
  const tooltipTop = activePoint
    ? Math.min(72, Math.max(12, (Math.min(...activePoint.values.map((value) => value.y)) / trendChart.height) * 100))
    : 50

  return (
    <div className="tool-inset relative mt-5 h-64 overflow-hidden bg-surface-2/80 p-3 sm:h-72">
      <div className="absolute right-3 top-3 z-10 flex flex-wrap justify-end gap-2 text-xs text-ink-secondary">
        {trendMetrics.map((metric) => (
          <span key={metric.key} className="tool-status bg-surface-1/90">
            <span
              aria-hidden="true"
              className="h-0.5 w-5 rounded-full"
              style={{
                backgroundColor: metric.stroke,
                backgroundImage: metric.dasharray ? `repeating-linear-gradient(90deg, ${metric.stroke} 0 6px, transparent 6px 10px)` : undefined,
              }}
            />
            {metric.label}
          </span>
        ))}
      </div>
      <svg
        className="h-full w-full"
        viewBox={`0 0 ${trendChart.width} ${trendChart.height}`}
        role="img"
        aria-labelledby="usage-trend-title usage-trend-desc"
        onMouseLeave={() => setActiveIndex(null)}
      >
        <title id="usage-trend-title">7 日趋势</title>
        <desc id="usage-trend-desc">所选范围内访问、生成、CDK 兑换与免费预览账号新增三项指标的趋势折线图。</desc>
        {yTicks.map((tick) => {
          const y = yFor(tick)
          return (
            <g key={tick}>
              <line x1={trendChart.left} x2={trendChart.width - trendChart.right} y1={y} y2={y} stroke="var(--color-surface-3)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              <text x={trendChart.left - 10} y={y + 4} textAnchor="end" fontSize="11" fill="var(--color-ink-muted)">
                {tick}
              </text>
            </g>
          )
        })}
        <line x1={trendChart.left} x2={trendChart.left} y1={trendChart.top} y2={trendChart.top + plotHeight} stroke="var(--color-surface-4)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <line x1={trendChart.left} x2={trendChart.width - trendChart.right} y1={trendChart.top + plotHeight} y2={trendChart.top + plotHeight} stroke="var(--color-surface-4)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {trendMetrics.map((metric) => (
          <path
            key={metric.key}
            d={buildTrendPath(points.map((point) => ({ x: point.x, y: point.values.find((value) => value.key === metric.key)?.y ?? yFor(0) })))}
            fill="none"
            stroke={metric.stroke}
            strokeWidth="2.5"
            strokeDasharray={metric.dasharray}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {points.map((point) => (
          <g key={point.day.date}>
            {point.values.map((value) => (
              <circle key={value.key} cx={point.x} cy={value.y} r={activePoint?.day.date === point.day.date ? 4 : 3} fill="var(--color-surface-1)" stroke={value.stroke} strokeWidth="2" vectorEffect="non-scaling-stroke" />
            ))}
            <text x={point.x} y={trendChart.height - 12} textAnchor="middle" fontSize="11" fill="var(--color-ink-muted)">
              {point.day.date.slice(5)}
            </text>
          </g>
        ))}
        {points.map((point, index) => {
          const previousX = index === 0 ? trendChart.left : (points[index - 1].x + point.x) / 2
          const nextX = index === points.length - 1 ? trendChart.width - trendChart.right : (point.x + points[index + 1].x) / 2
          return (
            <rect
              key={`${point.day.date}-hit`}
              x={previousX}
              y={trendChart.top}
              width={Math.max(16, nextX - previousX)}
              height={plotHeight}
              fill="transparent"
              tabIndex={0}
              aria-label={`${point.day.date}，访问 ${point.day.visits}，生成 ${point.day.schedule_generates}，CDK 兑换与免费预览账号新增 ${point.day.account_additions}`}
              onFocus={() => setActiveIndex(index)}
              onBlur={() => setActiveIndex(null)}
              onMouseEnter={() => setActiveIndex(index)}
            />
          )
        })}
      </svg>
      {activePoint && (
        <div
          className="tool-inset pointer-events-none absolute z-20 min-w-36 -translate-x-1/2 px-3 py-2 text-xs shadow-lg"
          style={{ left: `${tooltipLeft}%`, top: `${tooltipTop}%` }}
        >
          <div className="mb-1 font-semibold text-ink-primary">{activePoint.day.date}</div>
          <div className="space-y-1 text-ink-secondary">
            {activePoint.values.map((value) => (
              <div key={value.key} className="flex items-center justify-between gap-4">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: value.stroke }} />
                  {value.label}
                </span>
                <span className="font-medium text-ink-primary">{value.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <dl className="sr-only">
        {days.map((day) => (
          <div key={day.date}>
            <dt>{day.date}</dt>
            <dd>
              访问 {day.visits}，生成 {day.schedule_generates}，CDK 兑换与免费预览账号新增 {day.account_additions}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function buildTrendTicks(maxValue: number) {
  if (maxValue <= 3) {
    return Array.from({ length: maxValue + 1 }, (_, index) => maxValue - index)
  }
  return Array.from(new Set([maxValue, Math.round(maxValue * 0.66), Math.round(maxValue * 0.33), 0]))
}

function buildTrendPath(points: Array<{ x: number; y: number }>) {
  if (points.length === 1) {
    const [point] = points
    return `M ${point.x - 12} ${point.y} L ${point.x + 12} ${point.y}`
  }
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
}
