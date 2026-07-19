import { ChevronDown, ChevronRight, RefreshCw, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { adminApiJson } from '../../../lib/admin-api-client'
import type {
  AdminOptimizationQueueJob,
  AdminOptimizationQueueSnapshot,
  AdminOptimizationQueueStatus,
} from '../contracts'
import DeadLetterPanel from './DeadLetterPanel'

const POLL_INTERVAL_MS = 5_000
const HEARTBEAT_STALE_MS = 60_000

type Filters = {
  query: string
  status: AdminOptimizationQueueStatus | 'all'
  source: string
  priority: AdminOptimizationQueueJob['priority']['label'] | 'all'
}

const DEFAULT_FILTERS: Filters = { query: '', status: 'all', source: 'all', priority: 'all' }

export default function QueueMonitorPanel() {
  const [snapshot, setSnapshot] = useState<AdminOptimizationQueueSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(() => new Set())
  const requestRef = useRef<AbortController | null>(null)

  const loadSnapshot = useCallback(async () => {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setRefreshing(true)
    try {
      const data = await adminApiJson<AdminOptimizationQueueSnapshot>('/api/admin/optimization?view=queue', {
        signal: controller.signal,
        fallbackMessage: '加载异步队列失败',
      })
      if (controller.signal.aborted) return
      setSnapshot(data)
      setError(null)
    } catch (caught) {
      if (controller.signal.aborted) return
      setError(caught instanceof Error ? caught.message : '加载异步队列失败')
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null
        setRefreshing(false)
      }
    }
  }, [])

  useEffect(() => {
    void loadSnapshot()
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadSnapshot()
    }, POLL_INTERVAL_MS)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void loadSnapshot()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(poll)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      requestRef.current?.abort()
    }
  }, [loadSnapshot])

  const allJobs = useMemo(() => snapshot
    ? [...snapshot.queued_jobs, ...snapshot.running_jobs, ...snapshot.recent_jobs]
    : [], [snapshot])
  const sources = useMemo(() => [...new Set(allJobs.map((job) => job.source))].sort(), [allJobs])
  const filtered = useMemo(() => ({
    queued: snapshot?.queued_jobs.filter((job) => matchesFilters(job, filters)) ?? [],
    running: snapshot?.running_jobs.filter((job) => matchesFilters(job, filters)) ?? [],
    recent: snapshot?.recent_jobs.filter((job) => matchesFilters(job, filters)) ?? [],
  }), [filters, snapshot])

  const toggleJob = (id: string) => {
    setExpandedJobs((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <section className="space-y-5" aria-labelledby="optimization-queue-title">
      <section className="tool-panel p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="tool-eyebrow">实时运维</p>
            <h2 id="optimization-queue-title" className="mt-2 text-lg font-semibold text-ink-primary">异步优化队列</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-ink-secondary">
              展示当前全部等待和执行任务。队列位置按基础优先级与入队时间计算，实际调度仍受账号串行、重试和公平性规则影响。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-ink-muted" aria-live="polite">
              {snapshot ? `数据时间 ${formatDateTime(snapshot.snapshot_at)}` : '等待首次同步'}
            </span>
            <button type="button" onClick={() => void loadSnapshot()} disabled={refreshing} className="tool-secondary-action gap-2">
              <RefreshCw aria-hidden="true" className={`h-4 w-4 ${refreshing ? 'animate-spin motion-reduce:animate-none' : ''}`} />
              {refreshing ? '刷新中' : '立即刷新'}
            </button>
          </div>
        </div>

        {error && (
          <div className="tool-alert tool-alert--error mt-4" role="alert">
            {error}{snapshot ? '；当前继续显示上一次成功快照。' : ''}
          </div>
        )}

        {!snapshot ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="正在加载队列摘要">
            {Array.from({ length: 4 }, (_, index) => <div key={index} className="tool-inset h-24 animate-pulse motion-reduce:animate-none" />)}
          </div>
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <QueueMetric label="等待任务" value={`${snapshot.counts.queued} / ${snapshot.capacity.queue_limit}`} hint="当前排队 / 全局容量" tone={snapshot.counts.queued >= snapshot.capacity.queue_limit ? 'warning' : 'default'} />
            <QueueMetric label="正在执行" value={`${snapshot.counts.running} / ${snapshot.capacity.worker_concurrency}`} hint="当前执行 / 全局并发" tone={snapshot.counts.running >= snapshot.capacity.worker_concurrency ? 'current' : 'default'} />
            <QueueMetric label="重试等待" value={String(snapshot.counts.retry_waiting)} hint="已有执行尝试的排队任务" tone={snapshot.counts.retry_waiting > 0 ? 'warning' : 'default'} />
            <QueueMetric label="近期失败" value={String(snapshot.counts.recent_failed)} hint="最近 20 条终态任务" tone={snapshot.counts.recent_failed > 0 ? 'error' : 'default'} />
          </div>
        )}
      </section>

      <QueueFilters filters={filters} sources={sources} onChange={setFilters} />

      {snapshot && (
        <>
          <QueueJobsSection
            id="queue-waiting"
            title="等待执行"
            description="按基础队列位置展示所有等待任务。"
            jobs={filtered.queued}
            total={snapshot.queued_jobs.length}
            expandedJobs={expandedJobs}
            onToggle={toggleJob}
          />
          <QueueJobsSection
            id="queue-running"
            title="正在执行"
            description="关注 Worker、运行时长、最后心跳和取消请求状态。"
            jobs={filtered.running}
            total={snapshot.running_jobs.length}
            expandedJobs={expandedJobs}
            onToggle={toggleJob}
          />
          <details className="tool-panel group" open={false}>
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
              <div>
                <h3 className="font-semibold text-ink-primary">最近结束</h3>
                <p className="mt-1 text-sm text-ink-muted">最近 20 条成功、失败、取消或死信任务。</p>
              </div>
              <span className="flex items-center gap-2 text-sm text-ink-secondary">
                {filtered.recent.length} / {snapshot.recent_jobs.length}
                <ChevronDown aria-hidden="true" className="h-4 w-4 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" />
              </span>
            </summary>
            <div className="border-t border-surface-3 p-5">
              <QueueJobsContent jobs={filtered.recent} expandedJobs={expandedJobs} onToggle={toggleJob} />
            </div>
          </details>
        </>
      )}

      <DeadLetterPanel />
    </section>
  )
}

function QueueMetric({ label, value, hint, tone }: { label: string; value: string; hint: string; tone: 'default' | 'current' | 'warning' | 'error' }) {
  const toneClass = tone === 'warning' ? 'text-warning' : tone === 'error' ? 'text-error' : tone === 'current' ? 'text-brand-500' : 'text-ink-primary'
  return (
    <div className="tool-inset p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
      <p className="mt-1 text-xs text-ink-muted">{hint}</p>
    </div>
  )
}

function QueueFilters({ filters, sources, onChange }: { filters: Filters; sources: string[]; onChange: (filters: Filters) => void }) {
  return (
    <section className="tool-panel p-4" aria-label="队列筛选">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(260px,1fr)_180px_200px_180px_auto]">
        <label className="relative block">
          <span className="sr-only">搜索任务</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-ink-muted" />
          <input
            value={filters.query}
            onChange={(event) => onChange({ ...filters, query: event.currentTarget.value })}
            className="tool-field pl-9"
            placeholder="任务 ID、邮箱或档案"
          />
        </label>
        <FilterSelect label="状态" value={filters.status} onChange={(status) => onChange({ ...filters, status: status as Filters['status'] })} options={[
          ['all', '全部状态'], ['queued', '排队中'], ['running', '执行中'], ['succeeded', '已成功'], ['failed', '已失败'], ['cancelled', '已取消'], ['dead_lettered', '死信'],
        ]} />
        <FilterSelect label="来源" value={filters.source} onChange={(source) => onChange({ ...filters, source })} options={[
          ['all', '全部来源'], ...sources.map((source) => [source, sourceLabel(source)] as [string, string]),
        ]} />
        <FilterSelect label="优先级" value={filters.priority} onChange={(priority) => onChange({ ...filters, priority: priority as Filters['priority'] })} options={[
          ['all', '全部优先级'], ['优先券', '优先券'], ['付费任务', '付费任务'], ['分析任务', '分析任务'], ['标准任务', '标准任务'],
        ]} />
        <button type="button" onClick={() => onChange(DEFAULT_FILTERS)} className="tool-secondary-action">重置筛选</button>
      </div>
    </section>
  )
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: Array<[string, string]>; onChange: (value: string) => void }) {
  return (
    <label>
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(event) => onChange(event.currentTarget.value)} className="tool-field">
        {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
      </select>
    </label>
  )
}

function QueueJobsSection({ id, title, description, jobs, total, expandedJobs, onToggle }: {
  id: string
  title: string
  description: string
  jobs: AdminOptimizationQueueJob[]
  total: number
  expandedJobs: Set<string>
  onToggle: (id: string) => void
}) {
  return (
    <section className="tool-panel overflow-hidden" aria-labelledby={`${id}-title`}>
      <div className="flex items-start justify-between gap-3 border-b border-surface-3 p-5">
        <div>
          <h3 id={`${id}-title`} className="font-semibold text-ink-primary">{title}</h3>
          <p className="mt-1 text-sm text-ink-muted">{description}</p>
        </div>
        <span className="tool-status tool-status--current">{jobs.length} / {total}</span>
      </div>
      <div className="p-5">
        <QueueJobsContent jobs={jobs} expandedJobs={expandedJobs} onToggle={onToggle} />
      </div>
    </section>
  )
}

function QueueJobsContent({ jobs, expandedJobs, onToggle }: { jobs: AdminOptimizationQueueJob[]; expandedJobs: Set<string>; onToggle: (id: string) => void }) {
  if (jobs.length === 0) return <p className="py-6 text-center text-sm text-ink-muted">当前筛选条件下没有任务。</p>
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="pb-3 pr-4">任务</th>
              <th className="pb-3 pr-4">用户 / 档案</th>
              <th className="pb-3 pr-4">来源 / 优先级</th>
              <th className="pb-3 pr-4">状态</th>
              <th className="pb-3">时间 / 尝试</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-3">
            {jobs.map((job) => {
              const expanded = expandedJobs.has(job.id)
              return (
                <JobTableRows key={job.id} job={job} expanded={expanded} onToggle={onToggle} />
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 md:hidden">
        {jobs.map((job) => {
          const expanded = expandedJobs.has(job.id)
          return (
            <article key={job.id} className="tool-inset overflow-hidden">
              <button type="button" onClick={() => onToggle(job.id)} aria-expanded={expanded} className="flex min-h-12 w-full items-start justify-between gap-3 p-4 text-left">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><StatusPill status={job.status} />{job.queue_position && <span className="text-xs font-semibold text-ink-muted">第 {job.queue_position} 位</span>}</div>
                  <p className="mt-2 break-all font-mono text-xs font-semibold text-ink-primary">{job.id}</p>
                  <p className="mt-2 text-sm text-ink-secondary">{job.user?.email ?? '未关联用户'} · {job.profile?.display_name ?? '未关联档案'}</p>
                  <p className="mt-1 text-xs text-ink-muted">{sourceLabel(job.source)} · {job.priority.label} · {timingLabel(job)}</p>
                </div>
                {expanded ? <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0" /> : <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0" />}
              </button>
              {expanded && <div className="border-t border-surface-3 p-4"><JobDetails job={job} /></div>}
            </article>
          )
        })}
      </div>
    </>
  )
}

function JobTableRows({ job, expanded, onToggle }: { job: AdminOptimizationQueueJob; expanded: boolean; onToggle: (id: string) => void }) {
  return (
    <>
      <tr className="align-top hover:bg-surface-2/50">
        <td className="py-3 pr-4">
          <button type="button" onClick={() => onToggle(job.id)} aria-expanded={expanded} className="flex min-h-11 max-w-60 items-center gap-2 text-left font-mono text-xs font-semibold text-ink-primary hover:text-brand-500">
            {expanded ? <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0" /> : <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0" />}
            <span className="break-all">{job.id}</span>
          </button>
          {job.queue_position && <span className="ml-6 text-xs text-ink-muted">队列第 {job.queue_position} 位</span>}
        </td>
        <td className="py-3 pr-4">
          <p className="max-w-56 break-all font-medium text-ink-primary">{job.user?.email ?? '未关联用户'}</p>
          <p className="mt-1 text-xs text-ink-muted">{job.profile?.display_name ?? '未关联档案'}</p>
        </td>
        <td className="py-3 pr-4">
          <p className="text-ink-secondary">{sourceLabel(job.source)}</p>
          <p className="mt-1 text-xs text-ink-muted">{job.priority.label} · {job.priority.value}</p>
        </td>
        <td className="py-3 pr-4"><StatusPill status={job.status} />{heartbeatWarning(job)}</td>
        <td className="py-3">
          <p className="whitespace-nowrap text-ink-secondary">{timingLabel(job)}</p>
          <p className="mt-1 text-xs text-ink-muted">尝试 {job.attempt_count} · 失败 {job.failure_count}</p>
        </td>
      </tr>
      {expanded && <tr><td colSpan={5} className="bg-surface-2/40 px-4 py-4"><JobDetails job={job} /></td></tr>}
    </>
  )
}

function JobDetails({ job }: { job: AdminOptimizationQueueJob }) {
  const fields: Array<[string, string]> = [
    ['任务 ID', job.id],
    ['用户', job.user ? `${job.user.email} (${job.user.id})` : '未关联'],
    ['档案', job.profile ? `${job.profile.display_name} (${job.profile.id})` : '未关联'],
    ['来源', `${sourceLabel(job.source)} (${job.source})`],
    ['权限', job.permission ?? '无'],
    ['Worker', job.worker_id ?? '未分配'],
    ['创建时间', formatDateTime(job.created_at)],
    ['开始时间', formatOptionalDateTime(job.started_at)],
    ['结束时间', formatOptionalDateTime(job.finished_at)],
    ['最后心跳', formatOptionalDateTime(job.heartbeat_at)],
    ['下次尝试', formatOptionalDateTime(job.next_attempt_at)],
    ['排队过期', formatOptionalDateTime(job.expires_at)],
    ['取消请求', formatOptionalDateTime(job.cancel_requested_at)],
    ['失败类型', job.failure_kind ?? '无'],
    ['公开错误码', job.public_error_code ?? '无'],
  ]
  return (
    <div>
      <dl className="grid gap-x-5 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
        {fields.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs font-semibold text-ink-muted">{label}</dt><dd className="mt-1 break-all text-sm text-ink-secondary">{value}</dd></div>)}
      </dl>
      {job.error_summary && <div className="tool-alert tool-alert--error mt-4" role="status">{job.error_summary}</div>}
    </div>
  )
}

function StatusPill({ status }: { status: AdminOptimizationQueueStatus }) {
  const className = status === 'succeeded'
    ? 'tool-status--success'
    : status === 'failed' || status === 'dead_lettered'
      ? 'tool-status--error'
      : status === 'queued' || status === 'cancelled'
        ? 'tool-status--warning'
        : 'tool-status--current'
  return <span className={`tool-status ${className}`}>{statusLabel(status)}</span>
}

function matchesFilters(job: AdminOptimizationQueueJob, filters: Filters): boolean {
  if (filters.status !== 'all' && job.status !== filters.status) return false
  if (filters.source !== 'all' && job.source !== filters.source) return false
  if (filters.priority !== 'all' && job.priority.label !== filters.priority) return false
  const query = filters.query.trim().toLocaleLowerCase()
  if (!query) return true
  return [job.id, job.user?.email, job.user?.id, job.profile?.id, job.profile?.display_name]
    .some((value) => value?.toLocaleLowerCase().includes(query))
}

function statusLabel(status: AdminOptimizationQueueStatus): string {
  return ({ queued: '排队中', running: '执行中', succeeded: '已成功', failed: '已失败', cancelled: '已取消', dead_lettered: '死信' } as const)[status] ?? status
}

function sourceLabel(source: string): string {
  return ({ free_preview: '免费预览', account_profile: '主排班', optimize_suggestions: '优化建议', scenario_comparison: '场景分析' } as Record<string, string>)[source] ?? source
}

function timingLabel(job: AdminOptimizationQueueJob): string {
  const now = Date.now()
  if (job.status === 'queued') return `等待 ${formatElapsed(Date.parse(job.created_at), now)}`
  if (job.status === 'running') return `运行 ${formatElapsed(Date.parse(job.started_at ?? job.created_at), now)}`
  return job.finished_at ? `结束于 ${formatDateTime(job.finished_at)}` : `更新于 ${formatDateTime(job.updated_at)}`
}

function heartbeatWarning(job: AdminOptimizationQueueJob) {
  if (job.status !== 'running' || !job.heartbeat_at || Date.now() - Date.parse(job.heartbeat_at) <= HEARTBEAT_STALE_MS) return null
  return <p className="mt-2 text-xs font-semibold text-warning">心跳已超过 60 秒</p>
}

function formatElapsed(from: number, to: number): string {
  const seconds = Math.max(0, Math.floor((to - from) / 1_000))
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分 ${seconds % 60} 秒`
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`
}

function formatDateTime(value: string): string {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString('zh-CN', { hour12: false }) : value
}

function formatOptionalDateTime(value: string | null): string {
  return value ? formatDateTime(value) : '无'
}
