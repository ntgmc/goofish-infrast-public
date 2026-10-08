import { useState } from 'react'
import { AdminTabs } from '../shared/AdminTabs'
import type { AdminController } from '../useAdminController'
import { Metric } from '../cdk/components'
import { formatDuration } from '../shared/helpers'
import { AnnouncementStatsPanel, EMPTY_ANNOUNCEMENT_STATS, EMPTY_LATENCY_STATS, EMPTY_SKLAND_STATS,
  FailureReasonPanel, FunnelPanel, LatencyPanel, OpsSummaryPanel, SklandPanel, UsageTrendChart } from './components'

const tabs = [{ id: 'summary', label: '运营摘要' }, { id: 'analysis', label: '详细分析' }] as const
export default function OverviewSection({ model: c }: { model: AdminController }) {
  const [view, setView] = useState<'summary' | 'analysis'>('summary')
  const stats = c.usageStats
  return <section className="space-y-5">
    <div className="admin-actions"><div className="flex flex-wrap items-center gap-2" role="group" aria-label="统计范围">
      {(['7d', '14d', '30d', 'custom'] as const).map((range) => <button key={range} type="button" onClick={() => c.setUsageRange(range)}
        aria-pressed={c.usageRange === range} className={`tool-secondary-action ${c.usageRange === range ? 'tool-option-selected' : ''}`}>
        {range === 'custom' ? '自定义' : `${range.slice(0, -1)} 天`}</button>)}
      {c.usageRange === 'custom' && <div className="flex flex-wrap items-center gap-2">
        <input type="date" value={c.usageRangeFrom} max={c.usageRangeTo} onChange={(e) => c.setUsageRangeFrom(e.currentTarget.value)} className="tool-field w-auto" aria-label="统计开始日期" />
        <span>至</span><input type="date" value={c.usageRangeTo} min={c.usageRangeFrom} onChange={(e) => c.setUsageRangeTo(e.currentTarget.value)} className="tool-field w-auto" aria-label="统计结束日期" />
      </div>}
    </div><div className="flex flex-wrap gap-2">{(['csv', 'json'] as const).map((format) => <button key={format} type="button"
      disabled={!stats || c.busyAction === `report:${format}`} onClick={() => void c.handleExportUsageReport(format)} className="tool-secondary-action">导出 {format.toUpperCase()}</button>)}</div></div>
    <h2 className="sr-only">运营概览</h2>
    {stats && !stats.completeness.complete && <div className="tool-alert tool-alert--warning" role="status">当前范围的数据不完整，成功率与失败分析请结合记录核对。</div>}
    <div className="admin-metrics">
      <Metric label="注册数" value={c.summary.registers} /><Metric label="CDK 兑换" value={c.summary.cdkRedeems} />
      <Metric label="排班生成" value={c.summary.scheduleGenerates} /><Metric label="生成成功率" value={`${c.summary.scheduleSuccessRate}%`} tone={c.summary.scheduleSuccessRate < 80 && c.summary.scheduleAttempts > 0 ? 'warning' : 'default'} />
    </div>
    <AdminTabs label="运营分析" items={tabs} value={view} onChange={setView} />
    <div hidden={view !== 'summary'} role="tabpanel" aria-label="运营摘要" className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]"><section className="tool-panel p-5"><h2 className="text-base font-semibold">趋势</h2><UsageTrendChart days={stats?.days ?? []} /></section>
        <FailureReasonPanel reasons={stats?.failure_reasons ?? []} samples={stats?.recent_failures ?? []} /></div>
      <div className="admin-metrics"><Metric label="免费预览新增" value={c.summary.freePreviews} /><Metric label="平均单次计算耗时" value={formatDuration(stats?.latency.schedule_generate.average_ms ?? 0)} />
        <Metric label="P95 单次计算耗时" value={formatDuration(stats?.latency.schedule_generate.p95_ms ?? 0)} /><Metric label="冻结/软拦截" value={c.summary.frozenCdks + c.summary.riskEvents} tone={c.summary.frozenCdks + c.summary.riskEvents > 0 ? 'warning' : 'default'} /></div>
    </div>
    <div hidden={view !== 'analysis'} role="tabpanel" aria-label="详细分析" className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-2"><FunnelPanel steps={stats?.funnel ?? []} /><LatencyPanel stats={stats?.latency.schedule_generate ?? EMPTY_LATENCY_STATS} /></div>
      <div className="grid gap-5 xl:grid-cols-3"><OpsSummaryPanel summary={c.summary} /><SklandPanel stats={stats?.skland ?? EMPTY_SKLAND_STATS} /><AnnouncementStatsPanel stats={stats?.announcement ?? EMPTY_ANNOUNCEMENT_STATS} /></div>
      {stats && <details className="tool-panel p-4"><summary className="min-h-11 cursor-pointer text-sm">统计范围与数据状态</summary><p className="mt-3 text-xs leading-6 text-ink-muted">
        {stats.range.from} 至 {stats.range.to}，按 UTC 自然日统计。原始事件保留 {stats.completeness.retention_days || '-'} 天，指标版本 {stats.metrics_version}。
        数据生成时间：{stats.generated_at || '-'}。缺少状态的事件：{stats.completeness.unknown_status_events}。
        {stats.completeness.raw_events_truncated && `原始事件超过 ${stats.completeness.raw_event_limit} 条读取上限。`}</p></details>}
    </div>
  </section>
}
