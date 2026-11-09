import { useId, useState } from 'react'
import { useAdminPanelQuery } from '../../../lib/admin-panel-query'
import { getApiErrorMessage } from '../../../lib/api-client'
import type { AdminAuditDetail, AdminAuditFilters, AdminAuditPage, AdminAuditRecord, AdminAuditSource } from '../../../lib/admin-audit-contracts'
import { AdminDetailDialog } from '../shared/AdminDetailDialog'
import { PaginationControls } from '../shared/PaginationControls'
import { formatDate } from '../shared/helpers'
import { auditChanges } from './audit-diff'

const sourceLabels: Record<AdminAuditSource, string> = { admin: '后台操作', inventory: '道具操作', risk_review: '风控复核', risk_access: '风控访问', risk_settings: '风控配置', registration: '注册邀请', commercial: '商用限额', balance: '积分调整' }
const emptyFilters = { actor: '', from: '', to: '', action: '', target_type: '', target_id: '', request_id: '' }
type FilterDraft = typeof emptyFilters

export default function OperationAuditSection() {
  const [draft, setDraft] = useState<FilterDraft>(emptyFilters)
  const [filters, setFilters] = useState<AdminAuditFilters>({})
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [selected, setSelected] = useState<Pick<AdminAuditRecord, 'source' | 'id'> | null>(null)
  const [validation, setValidation] = useState<string | null>(null)
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value)
  const query = useAdminPanelQuery<AdminAuditPage>('operation-audit', `/api/admin/operation-audit?${params}`)
  const error = query.error ? getApiErrorMessage(query.error, '加载操作审计失败') : null
  const field = (name: keyof FilterDraft, label: string, type = 'text', maxLength = 256) => <label className="grid min-w-0 gap-2 text-sm">
    <span>{label}</span><input className="tool-field min-w-0 w-full" type={type} value={draft[name]} maxLength={maxLength}
      onChange={(event) => { setDraft({ ...draft, [name]: event.target.value }); setValidation(null) }} />
  </label>
  return <section className="tool-panel min-w-0 p-4 sm:p-6">
    <p className="text-sm leading-6 text-ink-secondary">检索管理员操作，查看操作原因、变更内容与关联记录。</p>
    <form className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-4" onSubmit={(event) => {
      event.preventDefault()
      const from = draft.from ? new Date(draft.from).toISOString() : ''
      const to = draft.to ? new Date(draft.to).toISOString() : ''
      if (from && to && from > to) { setValidation('开始时间不能晚于结束时间。'); return }
      setFilters({ ...Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value.trim()])), from, to })
      setPage(1)
    }}>
      {field('actor', '管理员账号', 'text', 32)}
      {field('from', '开始时间', 'datetime-local')}
      {field('to', '结束时间', 'datetime-local')}
      {field('action', '动作')}
      {field('target_type', '对象类型')}
      {field('target_id', '对象 ID')}
      {field('request_id', '请求 ID')}
      <div className="flex flex-wrap items-end gap-2">
        <button className="tool-primary-action" type="submit">查询</button>
        <button className="tool-secondary-action" type="button" onClick={() => { setDraft(emptyFilters); setFilters({}); setPage(1); setValidation(null) }}>重置</button>
        <button className="tool-secondary-action" type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>刷新</button>
      </div>
    </form>
    <p className="mt-3 text-xs leading-5 text-ink-muted">按完整账号、动作或对象标识匹配；时间使用当前设备时区。</p>
    {validation && <p role="alert" className="tool-alert tool-alert--error mt-4">{validation}</p>}
    {error && <p role="alert" className="tool-alert tool-alert--error mt-4">{error}</p>}
    {query.isFetching && <p role="status" className="mt-4 text-sm text-ink-muted">正在加载操作审计…</p>}
    <div className="mt-5" aria-busy={query.isFetching}>
      {query.data?.items.length === 0 && <p className="py-8 text-sm text-ink-muted">没有符合条件的操作记录。</p>}
      <ol className="divide-y divide-surface-3">{query.data?.items.map((item) => <li key={`${item.source}:${item.id}`} className="grid min-w-0 gap-3 py-4 sm:grid-cols-[1fr_auto]">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <strong className="break-all">{item.action}</strong><span className="tool-status">{sourceLabels[item.source]}</span>
          <span className="break-all text-ink-secondary">{item.actor_username ?? '未记录管理员'}</span>
          <time className="text-xs text-ink-muted" dateTime={item.created_at}>{formatDate(item.created_at)}</time>
        </div><p className="mt-2 break-all text-xs text-ink-secondary">{item.target_type} / {item.target_id}</p>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{item.reason}</p></div>
        <button type="button" className="tool-secondary-action self-start" onClick={() => setSelected(item)}>查看详情</button>
      </li>)}</ol>
      {query.data && <PaginationControls pagination={query.data.pagination} loading={query.isFetching} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1) }} />}
    </div>
    {selected && <AuditDialog selected={selected} onSelect={setSelected} onClose={() => setSelected(null)} />}
  </section>
}

function AuditDialog({ selected, onSelect, onClose }: { selected: Pick<AdminAuditRecord, 'source' | 'id'>; onSelect: (item: AdminAuditRecord) => void; onClose: () => void }) {
  const titleId = useId()
  return <AdminDetailDialog labelledBy={titleId} onClose={onClose}>
    <section className="tool-panel flex max-h-[calc(100dvh-4rem)] min-w-0 flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-surface-3 p-4 sm:px-6">
        <h2 id={titleId} className="text-lg font-semibold" tabIndex={-1} data-dialog-initial-focus>操作审计详情</h2>
        <button type="button" className="tool-secondary-action" onClick={onClose}>关闭</button>
      </header>
      <div className="min-w-0 overflow-y-auto p-4 sm:p-6"><AuditDetail key={`${selected.source}:${selected.id}`} selected={selected} onSelect={onSelect} /></div>
    </section>
  </AdminDetailDialog>
}

function AuditDetail({ selected, onSelect }: { selected: Pick<AdminAuditRecord, 'source' | 'id'>; onSelect: (item: AdminAuditRecord) => void }) {
  const params = new URLSearchParams(selected)
  const query = useAdminPanelQuery<{ item: AdminAuditDetail }>('operation-audit-detail', `/api/admin/operation-audit?${params}`)
  const [relatedPage, setRelatedPage] = useState(1)
  const [relatedSize, setRelatedSize] = useState(25)
  const related = useAdminPanelQuery<AdminAuditPage>('operation-audit-related', `/api/admin/operation-audit?${new URLSearchParams({ related_source: selected.source, related_id: selected.id, page: String(relatedPage), page_size: String(relatedSize) })}`, Boolean(query.data))
  const item = query.data?.item
  const changes = item ? auditChanges(item.before_json, item.after_json) : []
  return <div className="grid min-w-0 gap-6">
    {query.isFetching && <p role="status" className="text-sm text-ink-muted">正在加载详情…</p>}
    {query.error && <div role="alert" className="tool-alert tool-alert--error">{getApiErrorMessage(query.error, '加载审计详情失败')}<button className="tool-secondary-action ml-3" type="button" onClick={() => void query.refetch()}>重试</button></div>}
    {item && <>
      <dl className="grid min-w-0 gap-4 text-sm sm:grid-cols-2">{[
        ['动作', item.action], ['管理员', item.actor_username ?? '未记录'], ['操作时间', formatDate(item.created_at)], ['来源', sourceLabels[item.source]],
        ['操作对象', `${item.target_type} / ${item.target_id}`], ['记录 ID', item.id], ['请求 ID', item.request_id || '未记录'], ['来源 IP', item.client_ip ?? '未记录'],
      ].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-ink-muted">{label}</dt><dd className="mt-1 break-all leading-6">{value}</dd></div>)}</dl>
      <div><h3 className="text-sm font-semibold">操作原因</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7">{item.reason}</p></div>
      <section aria-label="变更差异" className="min-w-0"><h3 className="text-sm font-semibold">变更差异</h3>
        {item.before_json === null && item.after_json === null ? <p className="mt-2 text-sm text-ink-muted">此记录未保存变更前后快照。</p>
          : changes.length === 0 ? <p className="mt-2 text-sm text-ink-muted">已保存的快照没有字段变化。</p>
            : <ol className="mt-3 divide-y divide-surface-3">{changes.map((change) => <li key={change.path} className="min-w-0 py-3">
              <p className="break-all font-mono text-xs text-ink-secondary">{change.path}</p><div className="mt-2 grid min-w-0 gap-3 sm:grid-cols-2"><JsonValue label="变更前" value={change.before} /><JsonValue label="变更后" value={change.after} /></div>
            </li>)}</ol>}
        {(item.before_json !== null || item.after_json !== null) && <details className="mt-3"><summary className="cursor-pointer text-sm text-ink-secondary">完整变更数据</summary><div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2"><JsonValue label="变更前快照" value={item.before_json} /><JsonValue label="变更后快照" value={item.after_json} /></div></details>}
      </section>
      {item.context_json !== null && <details><summary className="cursor-pointer text-sm font-semibold">{item.source === 'risk_review' ? '复核快照与执行结果' : item.source === 'risk_access' ? '访问判定' : '关联信息'}</summary><div className="mt-3"><JsonValue label="原始记录" value={item.context_json} /></div></details>}
      <section aria-label="关联记录" className="min-w-0"><h3 className="text-sm font-semibold">关联记录</h3><p className="mt-1 text-xs leading-5 text-ink-muted">同一操作对象或同一请求的其他记录。</p>
        {related.isFetching && <p role="status" className="mt-3 text-sm text-ink-muted">正在加载关联记录…</p>}
        {related.error && <div role="alert" className="tool-alert tool-alert--error mt-3">{getApiErrorMessage(related.error, '加载关联记录失败')}<button type="button" className="tool-secondary-action ml-3" onClick={() => void related.refetch()}>重试</button></div>}
        {related.data?.items.length === 0 && <p className="mt-3 text-sm text-ink-muted">暂无关联记录。</p>}
        <ul className="mt-3 divide-y divide-surface-3">{related.data?.items.map((record) => <li key={`${record.source}:${record.id}`} className="min-w-0 py-3"><button type="button" className="tool-secondary-action max-w-full whitespace-normal text-left" onClick={() => onSelect(record)}><span className="min-w-0 break-all">{formatDate(record.created_at)} · {record.actor_username ?? '未记录管理员'} · {record.action}</span></button><p className="mt-2 break-words text-sm leading-6">{record.reason}</p></li>)}</ul>
        {related.data && <PaginationControls pagination={related.data.pagination} loading={related.isFetching} onPageChange={setRelatedPage} onPageSizeChange={(size) => { setRelatedSize(size); setRelatedPage(1) }} />}
      </section>
    </>}
  </div>
}

function JsonValue({ label, value }: { label: string; value: unknown }) {
  return <div className="tool-inset min-w-0 p-3"><p className="text-xs font-medium text-ink-muted">{label}</p><pre className="mt-2 whitespace-pre-wrap break-all font-mono text-xs leading-6">{value === undefined ? '字段不存在' : JSON.stringify(value, null, 2)}</pre></div>
}
