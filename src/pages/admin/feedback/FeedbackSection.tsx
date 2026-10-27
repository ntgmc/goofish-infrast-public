import { useEffect, useId, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { usePrivateQueryScope } from '../../../lib/private-query-scope'
import { Link } from 'react-router'
import { adminPath } from '../../../lib/app-routes'
import { copy } from '../../../copy'
import { adminApiJson } from '../../../lib/admin-api-client'
import { getApiErrorMessage } from '../../../lib/api-client'
import { FEEDBACK_CATEGORIES, FEEDBACK_TODOS, FEEDBACK_STATUSES, FEEDBACK_MESSAGE_MAX_LENGTH, type AdminFeedback, type AdminFeedbackPage, type FeedbackStatus } from '../../../lib/feedback-contracts'
import { useFeedbackThread } from '../../../lib/use-feedback-thread'
import FeedbackTimeline from '../../../components/FeedbackTimeline'
import '../../../components/FeedbackDialog.css'
import { formatDate } from '../shared/helpers'
import { PaginationControls } from '../shared/PaginationControls'

export default function FeedbackSection({ active, canManage = false, canViewUser = false, canViewTasks = false, search = '' }: { active: boolean; canManage?: boolean; canViewUser?: boolean; canViewTasks?: boolean; search?: string }) {
  const text = copy.feedback
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [status, setStatus] = useState<FeedbackStatus | ''>('')
  const params = new URLSearchParams(search)
  const requestedTodo = params.get('todo')
  const [todo, setTodo] = useState(requestedTodo && FEEDBACK_TODOS.includes(requestedTodo as typeof FEEDBACK_TODOS[number]) ? requestedTodo : '')
  const [category, setCategory] = useState('')
  const [email, setEmail] = useState('')
  const [minWait, setMinWait] = useState('')
  const userId = params.get('user_id') ?? ''
  const owner = usePrivateQueryScope('admin', active)
  const client = useQueryClient()
  const listQuery = useQuery({
    queryKey: [...owner.key, 'feedback', 'list', page, pageSize, status, todo, category, email, minWait, userId], enabled: owner.enabled,
    queryFn: ({ signal }) => {
      const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
      for (const [key, value] of Object.entries({ status, todo, category, email, min_wait_hours: minWait, user_id: userId })) if (value) query.set(key, value)
      return adminApiJson<AdminFeedbackPage>(`/api/admin/feedback?${query}`, { signal })
    },
  })
  const data = listQuery.data
  const loading = listQuery.isFetching
  const error = listQuery.error ? getApiErrorMessage(listQuery.error, text.loadFailed) : null
  const refreshList = () => client.invalidateQueries({ queryKey: [...owner.key, 'feedback', 'list'] })
  const [selected, setSelected] = useState<string | null>(params.get('feedback_id'))
  const thread = useFeedbackThread('admin', selected, active)
  const saving = thread.saving
  const detailRegion = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setTodo(requestedTodo && FEEDBACK_TODOS.includes(requestedTodo as typeof FEEDBACK_TODOS[number]) ? requestedTodo : '')
    setCategory(''); setEmail(''); setMinWait('')
    setStatus('')
    setPage(1)
    setSelected(new URLSearchParams(search).get('feedback_id'))
  }, [search])
  useEffect(() => { if (selected && window.matchMedia?.('(max-width: 60rem)').matches) detailRegion.current?.scrollIntoView({ block: 'start', behavior: 'instant' }) }, [selected])
  return <section className="tool-panel min-w-0 p-4 sm:p-6">
    <p className="text-sm leading-6 text-ink-secondary">{text.adminDescription}</p>
    {data?.metrics && <dl className="mt-4 grid gap-3 sm:grid-cols-3" aria-label="反馈处理指标">
      <div className="tool-inset p-3"><dt className="text-xs text-ink-muted">{text.firstResponse}</dt><dd className="mt-2 text-xl font-semibold">{formatDuration(data.metrics.first_response_seconds)}</dd></div>
      <div className="tool-inset p-3"><dt className="text-xs text-ink-muted">{text.longestWait}</dt><dd className="mt-2 text-xl font-semibold">{formatDuration(data.metrics.longest_wait_seconds)}</dd></div>
      <div className="tool-inset p-3"><dt className="text-xs text-ink-muted">{text.reopened}</dt><dd className="mt-2 text-xl font-semibold">{data.metrics.reopened_count}</dd></div>
    </dl>}
    {data?.metrics && <p className="mt-2 text-xs text-ink-muted">{text.metricsHint}</p>}
    <div className="mt-4 flex flex-wrap gap-2" aria-label="反馈快捷筛选">{(['', ...FEEDBACK_TODOS] as const).map((value) => <button key={value} type="button" className={`tool-secondary-action whitespace-nowrap ${todo === value ? 'border-brand-500 text-brand-500' : ''}`} aria-pressed={todo === value} disabled={saving} onClick={() => { setTodo(value); setPage(1); setSelected(null) }}>{value ? text.todos[value] : '全部反馈'}</button>)}</div>
    <div className="mt-4 flex flex-wrap items-end gap-3">
      <label className="grid min-w-0 gap-2 text-sm"><span>{text.category}</span><select className="tool-field" value={category} disabled={saving} onChange={(event) => { setCategory(event.target.value); setPage(1) }}><option value="">全部分类</option>{FEEDBACK_CATEGORIES.map((value) => <option key={value} value={value}>{text.categories[value]}</option>)}</select></label>
      <label className="grid min-w-0 gap-2 text-sm"><span>{text.emailFilter}</span><input className="tool-field" value={email} maxLength={254} disabled={saving} onChange={(event) => { setEmail(event.target.value); setPage(1) }} /></label>
      <label className="grid min-w-0 gap-2 text-sm"><span>{text.waitFilter}</span><select className="tool-field" value={minWait} disabled={saving} onChange={(event) => { setMinWait(event.target.value); setPage(1) }}><option value="">{text.allWaits}</option>{[1, 4, 24, 72, 168].map((hours) => <option key={hours} value={hours}>超过 {hours} 小时</option>)}</select></label>
      <label className="grid gap-2 text-sm"><span>{text.status}</span><select className="tool-field" value={status} disabled={saving} onChange={(event) => { setStatus(event.target.value as FeedbackStatus | ''); setPage(1) }}><option value="">{text.allStatuses}</option>{FEEDBACK_STATUSES.map((value) => <option key={value} value={value}>{text.adminStatuses[value]}</option>)}</select></label><button type="button" className="tool-secondary-action" disabled={loading || thread.loading || saving} onClick={() => { void refreshList(); void thread.refresh() }}>{text.refresh}</button></div>
    {error && <p role="alert" className="tool-alert tool-alert--error mt-4">{error}</p>}
    {loading && <p role="status" className="mt-4 text-sm text-ink-muted">{text.loading}</p>}
    <div className="feedback-admin-workbench mt-5">
      <div className="min-w-0" aria-busy={loading}>
        {data?.items.length === 0 && <p className="py-8 text-sm text-ink-muted">{text.empty}</p>}
        <ul className="feedback-admin-index divide-y divide-surface-3">{data?.items.map((item) => <li key={item.id}><button type="button" className="feedback-list-item" aria-pressed={selected === item.id} disabled={saving || loading} onClick={() => setSelected(item.id)}>
          <span className="flex flex-wrap items-start justify-between gap-2"><strong className="min-w-0 break-all">{item.email}</strong><span className="tool-status">{text.adminStatuses[item.status]}</span></span>
          <span className="mt-2 block line-clamp-2 break-words leading-6">{item.message}</span>
          <span className="mt-2 block text-xs text-ink-muted">{text.categories[item.category]} · {item.assignee ?? text.unassigned}</span>
          {item.waiting_since && <span className="mt-2 block text-xs text-ink-secondary">{text.waiting} {formatDate(item.waiting_since)}</span>}
          <time dateTime={item.updated_at} className="mt-2 block text-xs text-ink-muted">{formatDate(item.updated_at)}</time>
        </button></li>)}</ul>
        {data && <PaginationControls pagination={data.pagination} loading={loading || saving} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1) }} />}
      </div>
      <div ref={detailRegion} className="feedback-admin-detail min-w-0">{selected ? <FeedbackWorkspace key={selected} thread={thread} canManage={canManage} canViewUser={canViewUser} canViewTasks={canViewTasks} /> : <p className="py-8 text-sm text-ink-muted">{text.selectFeedback}</p>}</div>
    </div>
  </section>
}

function formatDuration(seconds: number | null) {
  if (seconds === null) return copy.feedback.noSample
  const minutes = Math.ceil(Math.max(0, seconds) / 60)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours} 小时 ${minutes % 60} 分钟` : `${Math.floor(hours / 24)} 天 ${hours % 24} 小时`
}

function FeedbackWorkspace({ thread, canManage, canViewUser, canViewTasks }: { thread: ReturnType<typeof useFeedbackThread>; canManage: boolean; canViewUser: boolean; canViewTasks: boolean }) {
  const text = copy.feedback
  const formId = useId()
  const [draftStatus, setDraftStatus] = useState<FeedbackStatus | null>(null)
  const [assignment, setAssignment] = useState<'keep' | 'mine' | 'unassigned'>('keep')
  const [message, setMessage] = useState('')
  const [internalNote, setInternalNote] = useState('')
  const [reason, setReason] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [operationKey, setOperationKey] = useState('')
  const operation = thread.data?.recent_operations?.find((item) => `${item.source}:${item.id}` === operationKey)
  const feedback = thread.data?.feedback as AdminFeedback | undefined
  return <div className="grid gap-5">
    <h2 className="text-base font-semibold">{text.followUp}</h2>
    {thread.error && <p role="alert" className="tool-alert tool-alert--error">{thread.error}</p>}
    {thread.loading && <p role="status" className="text-sm text-ink-muted">{text.loading}</p>}
    {feedback && <>
      <div className="min-w-0"><p className="break-all text-sm font-semibold">{feedback.email}</p><p className="mt-2 text-xs text-ink-secondary">{text.categories[feedback.category]} · {text.adminStatuses[feedback.status]} · {text.assignee}：{feedback.assignee ?? text.unassigned}</p><p className="mt-2 text-xs text-ink-muted">{text.createdAt}：{formatDate(feedback.created_at)}</p></div>
      <nav className="flex flex-wrap gap-2" aria-label="反馈关联信息">
        {canViewUser && <Link className="tool-secondary-action whitespace-nowrap" to={`${adminPath('users')}?${new URLSearchParams({ user_id: feedback.user_id })}`}>{text.openUser}</Link>}
        {canViewUser && feedback.context?.profile_id && <Link className="tool-secondary-action whitespace-nowrap" to={`${adminPath('users')}?${new URLSearchParams({ user_id: feedback.user_id, profile_id: feedback.context.profile_id })}`}>{text.openProfile}</Link>}
        {canViewTasks && <Link className="tool-secondary-action whitespace-nowrap" to={`${adminPath('queue')}?${new URLSearchParams({ query: feedback.context?.job_id ?? feedback.context?.profile_id ?? feedback.email, ...(feedback.context?.job_id ? { job_id: feedback.context.job_id } : {}) })}`}>{text.openJobs}</Link>}
      </nav>
      {feedback.context && <dl className="grid gap-2 break-all text-xs text-ink-secondary">{Object.entries(feedback.context).map(([key, value]) => <div key={key}><dt className="inline">{key === 'profile_id' ? text.openProfile : key === 'result_id' ? text.resultId : text.jobId}：</dt><dd className="inline">{value}</dd></div>)}</dl>}
      {feedback.result && <div className="feedback-result"><h3 className="text-sm font-semibold">{text.result}</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7">{feedback.result}</p></div>}
      <FeedbackTimeline data={thread.data!} admin loading={thread.loading} onOlder={() => void thread.loadOlder()} />
      {canManage && <form className="feedback-form border-t border-surface-3 pt-5" aria-busy={thread.saving} onSubmit={(event) => {
        event.preventDefault()
        void thread.save({ status: draftStatus ?? feedback.status, assignment, message: message.trim(), internal_note: internalNote.trim(), reason: reason.trim(), ...(operation ? { related_operation: { source: operation.source, id: operation.id } } : {}) }).then((saved) => {
          if (saved) { setMessage(''); setInternalNote(''); setReason(''); setAssignment('keep'); setDraftStatus(null); setOperationKey(''); setNotice(text.saved) }
        })
      }}>
        <div className="grid gap-4 sm:grid-cols-2"><label className="feedback-label"><span>{text.status}</span><select className="tool-field" disabled={thread.saving} value={draftStatus ?? feedback.status} onChange={(event) => { setDraftStatus(event.target.value as FeedbackStatus); setNotice(null) }}>{FEEDBACK_STATUSES.map((value) => <option key={value} value={value}>{text.adminStatuses[value]}</option>)}</select></label><label className="feedback-label"><span>{text.assignment}</span><select className="tool-field" disabled={thread.saving} value={assignment} onChange={(event) => { setAssignment(event.target.value as typeof assignment); setNotice(null) }}><option value="keep">{text.keepAssignment}</option><option value="mine">{text.takeAssignment}</option><option value="unassigned">{text.releaseAssignment}</option></select></label></div>
        <div className="feedback-label"><label htmlFor={`${formId}-reply`}>{text.publicReply}</label><textarea id={`${formId}-reply`} aria-describedby={`${formId}-reply-hint`} className="tool-field" rows={3} maxLength={FEEDBACK_MESSAGE_MAX_LENGTH} disabled={thread.saving} value={message} onChange={(event) => { setMessage(event.target.value); setNotice(null) }} /><p id={`${formId}-reply-hint`} className="feedback-hint">{text.publicReplyHint}</p></div>
        <div className="feedback-label"><label htmlFor={`${formId}-note`}>{text.internalNote}</label><textarea id={`${formId}-note`} aria-describedby={`${formId}-note-hint`} className="tool-field" rows={3} maxLength={FEEDBACK_MESSAGE_MAX_LENGTH} disabled={thread.saving} value={internalNote} onChange={(event) => { setInternalNote(event.target.value); setNotice(null) }} /><p id={`${formId}-note-hint`} className="feedback-hint">{text.internalNoteHint}</p></div>
        <label className="feedback-label"><span>{text.relatedOperation}</span><select className="tool-field" disabled={thread.saving} value={operationKey} onChange={(event) => { setOperationKey(event.target.value); setNotice(null) }}><option value="">{text.noOperation}</option>{thread.data?.recent_operations?.map((item) => <option key={`${item.source}:${item.id}`} value={`${item.source}:${item.id}`}>{formatDate(item.created_at)} · {text.operationActions[item.action as keyof typeof text.operationActions] ?? item.action} · {item.reason}</option>)}</select></label>
        <label className="feedback-label"><span>{text.reason}</span><input className="tool-field" required minLength={2} maxLength={500} disabled={thread.saving} value={reason} onChange={(event) => { setReason(event.target.value); setNotice(null) }} /></label>
        {notice && <p role="status" className="text-sm text-ink-secondary">{notice}</p>}
        <button type="submit" className="tool-primary-action justify-self-start" disabled={thread.saving || thread.loading || reason.trim().length < 2 || (!message.trim() && !internalNote.trim() && !operation && assignment === 'keep' && (!draftStatus || draftStatus === feedback.status))}>{thread.saving ? text.sending : text.save}</button>
      </form>}
    </>}
  </div>
}
