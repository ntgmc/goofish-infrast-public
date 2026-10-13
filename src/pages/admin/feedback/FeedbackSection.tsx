import { useEffect, useId, useRef, useState } from 'react'
import { copy } from '../../../copy'
import { adminApiJson } from '../../../lib/admin-api-client'
import { getApiErrorMessage } from '../../../lib/api-client'
import { FEEDBACK_STATUSES, FEEDBACK_MESSAGE_MAX_LENGTH, type AdminFeedback, type AdminFeedbackPage, type FeedbackStatus } from '../../../lib/feedback-contracts'
import { useFeedbackThread } from '../../../lib/use-feedback-thread'
import FeedbackTimeline from '../../../components/FeedbackTimeline'
import '../../../components/FeedbackDialog.css'
import { formatDate } from '../shared/helpers'
import { PaginationControls } from '../shared/PaginationControls'

export default function FeedbackSection({ active, canManage = false }: { active: boolean; canManage?: boolean }) {
  const text = copy.feedback
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [status, setStatus] = useState<FeedbackStatus | ''>('open')
  const [revision, setRevision] = useState(0)
  const [data, setData] = useState<AdminFeedbackPage | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const detailRegion = useRef<HTMLDivElement>(null)
  useEffect(() => { if (selected && window.matchMedia?.('(max-width: 60rem)').matches) detailRegion.current?.scrollIntoView({ block: 'start', behavior: 'instant' }) }, [selected])
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void adminApiJson<AdminFeedbackPage>(`/api/admin/feedback?page=${page}&page_size=${pageSize}${status ? `&status=${status}` : ''}`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setData(result) })
      .catch((caught) => { if (!controller.signal.aborted) setError(getApiErrorMessage(caught, text.loadFailed)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [active, page, pageSize, status, revision])
  return <section className="tool-panel min-w-0 p-4 sm:p-6">
    <p className="text-sm leading-6 text-ink-secondary">{text.adminDescription}</p>
    <div className="mt-4 flex flex-wrap items-end justify-between gap-3"><label className="grid gap-2 text-sm"><span>{text.status}</span><select className="tool-field" value={status} disabled={saving} onChange={(event) => { setStatus(event.target.value as FeedbackStatus | ''); setPage(1) }}><option value="">{text.allStatuses}</option>{FEEDBACK_STATUSES.map((value) => <option key={value} value={value}>{text.adminStatuses[value]}</option>)}</select></label><button type="button" className="tool-secondary-action" disabled={loading || saving} onClick={() => setRevision((current) => current + 1)}>{text.refresh}</button></div>
    {error && <p role="alert" className="tool-alert tool-alert--error mt-4">{error}</p>}
    {loading && <p role="status" className="mt-4 text-sm text-ink-muted">{text.loading}</p>}
    <div className="feedback-admin-workbench mt-5">
      <div className="min-w-0" aria-busy={loading}>
        {data?.items.length === 0 && <p className="py-8 text-sm text-ink-muted">{text.empty}</p>}
        <ul className="feedback-admin-index divide-y divide-surface-3">{data?.items.map((item) => <li key={item.id}><button type="button" className="feedback-list-item" aria-pressed={selected === item.id} disabled={saving || loading} onClick={() => setSelected(item.id)}>
          <span className="flex flex-wrap items-start justify-between gap-2"><strong className="min-w-0 break-all">{item.email}</strong><span className="tool-status">{text.adminStatuses[item.status]}</span></span>
          <span className="mt-2 block line-clamp-2 break-words leading-6">{item.message}</span>
          <span className="mt-2 block text-xs text-ink-muted">{text.categories[item.category]} · {item.assignee ?? text.unassigned}</span>
          <time dateTime={item.created_at} className="mt-2 block text-xs text-ink-muted">{formatDate(item.created_at)}</time>
        </button></li>)}</ul>
        {data && <PaginationControls pagination={data.pagination} loading={loading || saving} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1) }} />}
      </div>
      <div ref={detailRegion} className="feedback-admin-detail min-w-0">{selected ? <FeedbackWorkspace key={selected} id={selected} active={active} canManage={canManage} onBusyChange={setSaving} onSaved={() => setRevision((current) => current + 1)} /> : <p className="py-8 text-sm text-ink-muted">{text.selectFeedback}</p>}</div>
    </div>
  </section>
}

function FeedbackWorkspace({ id, active, canManage, onBusyChange, onSaved }: { id: string; active: boolean; canManage: boolean; onBusyChange: (busy: boolean) => void; onSaved: () => void }) {
  const text = copy.feedback
  const thread = useFeedbackThread('admin', id, active)
  const formId = useId()
  const [draftStatus, setDraftStatus] = useState<FeedbackStatus | null>(null)
  const [assignment, setAssignment] = useState<'keep' | 'mine' | 'unassigned'>('keep')
  const [message, setMessage] = useState('')
  const [internalNote, setInternalNote] = useState('')
  const [reason, setReason] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => { onBusyChange(thread.saving); return () => onBusyChange(false) }, [onBusyChange, thread.saving])
  const feedback = thread.data?.feedback as AdminFeedback | undefined
  return <div className="grid gap-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">{text.followUp}</h2><button type="button" className="tool-secondary-action" disabled={thread.loading || thread.saving} onClick={() => { setNotice(null); void thread.refresh() }}>{text.refresh}</button></div>
    {thread.error && <p role="alert" className="tool-alert tool-alert--error">{thread.error}</p>}
    {thread.loading && <p role="status" className="text-sm text-ink-muted">{text.loading}</p>}
    {feedback && <>
      <div className="min-w-0"><p className="break-all text-sm font-semibold">{feedback.email}</p><p className="mt-2 text-xs text-ink-secondary">{text.categories[feedback.category]} · {text.adminStatuses[feedback.status]} · {text.assignee}：{feedback.assignee ?? text.unassigned}</p><p className="mt-2 text-xs text-ink-muted">{text.createdAt}：{formatDate(feedback.created_at)}</p></div>
      {feedback.result && <div className="feedback-result"><h3 className="text-sm font-semibold">{text.result}</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7">{feedback.result}</p></div>}
      <FeedbackTimeline data={thread.data!} admin loading={thread.loading} onOlder={() => void thread.loadOlder()} />
      {canManage && <form className="feedback-form border-t border-surface-3 pt-5" aria-busy={thread.saving} onSubmit={(event) => {
        event.preventDefault()
        void thread.save({ status: draftStatus ?? feedback.status, assignment, message: message.trim(), internal_note: internalNote.trim(), reason: reason.trim() }).then((saved) => {
          if (saved) { setMessage(''); setInternalNote(''); setReason(''); setAssignment('keep'); setDraftStatus(null); setNotice(text.saved); onSaved() }
        })
      }}>
        <div className="grid gap-4 sm:grid-cols-2"><label className="feedback-label"><span>{text.status}</span><select className="tool-field" disabled={thread.saving} value={draftStatus ?? feedback.status} onChange={(event) => { setDraftStatus(event.target.value as FeedbackStatus); setNotice(null) }}>{FEEDBACK_STATUSES.map((value) => <option key={value} value={value}>{text.adminStatuses[value]}</option>)}</select></label><label className="feedback-label"><span>{text.assignment}</span><select className="tool-field" disabled={thread.saving} value={assignment} onChange={(event) => { setAssignment(event.target.value as typeof assignment); setNotice(null) }}><option value="keep">{text.keepAssignment}</option><option value="mine">{text.takeAssignment}</option><option value="unassigned">{text.releaseAssignment}</option></select></label></div>
        <div className="feedback-label"><label htmlFor={`${formId}-reply`}>{text.publicReply}</label><textarea id={`${formId}-reply`} aria-describedby={`${formId}-reply-hint`} className="tool-field" rows={3} maxLength={FEEDBACK_MESSAGE_MAX_LENGTH} disabled={thread.saving} value={message} onChange={(event) => { setMessage(event.target.value); setNotice(null) }} /><p id={`${formId}-reply-hint`} className="feedback-hint">{text.publicReplyHint}</p></div>
        <div className="feedback-label"><label htmlFor={`${formId}-note`}>{text.internalNote}</label><textarea id={`${formId}-note`} aria-describedby={`${formId}-note-hint`} className="tool-field" rows={3} maxLength={FEEDBACK_MESSAGE_MAX_LENGTH} disabled={thread.saving} value={internalNote} onChange={(event) => { setInternalNote(event.target.value); setNotice(null) }} /><p id={`${formId}-note-hint`} className="feedback-hint">{text.internalNoteHint}</p></div>
        <label className="feedback-label"><span>{text.reason}</span><input className="tool-field" required minLength={2} maxLength={500} disabled={thread.saving} value={reason} onChange={(event) => { setReason(event.target.value); setNotice(null) }} /></label>
        {notice && <p role="status" className="text-sm text-ink-secondary">{notice}</p>}
        <button type="submit" className="tool-primary-action justify-self-start" disabled={thread.saving || thread.loading || reason.trim().length < 2 || (!message.trim() && !internalNote.trim() && assignment === 'keep' && (!draftStatus || draftStatus === feedback.status))}>{thread.saving ? text.sending : text.save}</button>
      </form>}
    </>}
  </div>
}
