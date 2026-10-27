import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { adminApiJson } from '../../../lib/admin-api-client'
import { adminPath } from '../../../lib/app-routes'
import type { OperationsTodos } from '../../../lib/operations-drilldown'
import type { AdminCapability } from '../contracts'

const items = [
  { key: 'feedback_unassigned', label: '待认领反馈', capability: 'user_view', path: `${adminPath('feedback')}?todo=unassigned` },
  { key: 'feedback_reply', label: '待回复反馈', capability: 'user_view', path: `${adminPath('feedback')}?todo=reply` },
  { key: 'risk_pending', label: '待复核风险', capability: 'risk_view', path: `${adminPath('risk')}?status=pending` },
  { key: 'abnormal_jobs', label: '异常任务', capability: 'optimization_view', path: `${adminPath('queue')}?view=dead&status=pending_review` },
] as const

export default function OperationsTodosPanel({ adminUsername, active, capabilities, refreshKey }: { adminUsername: string | null; active: boolean; capabilities: AdminCapability[]; refreshKey: string }) {
  const enabled = active && Boolean(adminUsername) && capabilities.includes('usage_view')
  const query = useQuery({
    queryKey: ['admin', enabled ? adminUsername : null, 'operations-todos', capabilities, refreshKey],
    enabled,
    queryFn: ({ signal }) => adminApiJson<OperationsTodos>('/api/admin/usage-stats?view=todos', { signal, fallbackMessage: '今日待办加载失败。' }),
  })
  const data = query.data
  const error = query.error?.message
  const loading = query.isFetching
  return <section className="tool-panel p-5" aria-labelledby="ops-todos-title" aria-busy={loading}>
    <div className="ops-question-heading"><div><h2 id="ops-todos-title">今日待办</h2><p className="mt-2 text-sm text-ink-secondary">当前未处理事项，包含此前积压。打开名单后可继续查看和处理。</p></div>
      <button type="button" className="tool-secondary-action" disabled={loading || !enabled} onClick={() => void query.refetch({ cancelRefetch: false })}>{loading ? '正在刷新…' : '刷新待办'}</button></div>
    {error && <p role="alert" className="tool-alert tool-alert--error mt-4">{error}</p>}
    <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">{items.filter((item) => capabilities.includes(item.capability)).map((item) => <Link key={item.key} to={item.path} className="tool-inset p-4">
      <span className="block text-sm text-ink-secondary">{item.label}</span><strong className="mt-2 block text-2xl tabular-nums">{error || !data ? '—' : data[item.key] ?? '—'}</strong><span className="mt-2 block text-sm text-brand-600">打开名单 →</span>
    </Link>)}</div>
    {data && !error && <p className="mt-3 text-xs text-ink-muted">更新于 {new Date(data.generated_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}{loading ? ' · 正在更新' : ''}</p>}
  </section>
}
