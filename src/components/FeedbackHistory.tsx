import { BackIcon as ArrowLeft, RefreshIcon as RefreshCw } from './icons'
import { useEffect, useRef, useState } from 'react'
import { copy } from '../copy'
import { apiJson, getApiErrorMessage } from '../lib/api-client'
import { FEEDBACK_MESSAGE_MAX_LENGTH, type FeedbackPage } from '../lib/feedback-contracts'
import { useFeedbackThread } from '../lib/use-feedback-thread'
import FeedbackTimeline from './FeedbackTimeline'

export default function FeedbackHistory({ initialId, onBusyChange, onDraftChange }: { initialId: string | null; onBusyChange: (busy: boolean) => void; onDraftChange: (hasDraft: boolean) => void }) {
  const text = copy.feedback
  const [page, setPage] = useState(1)
  const [revision, setRevision] = useState(0)
  const [list, setList] = useState<FeedbackPage | null>(null)
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [selected, setSelected] = useState(initialId)
  const [reply, setReply] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const replyForm = useRef<HTMLFormElement>(null)
  const thread = useFeedbackThread('user', selected, true)
  useEffect(() => { onBusyChange(thread.saving); if (thread.saving) replyForm.current?.focus(); return () => onBusyChange(false) }, [onBusyChange, thread.saving])
  useEffect(() => { onDraftChange(Boolean(reply)); return () => onDraftChange(false) }, [onDraftChange, reply])
  useEffect(() => {
    const controller = new AbortController()
    setListLoading(true)
    setListError(null)
    void apiJson<FeedbackPage>(`/api/user/feedback?page=${page}&page_size=25`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setList(result) })
      .catch((caught) => { if (!controller.signal.aborted) setListError(getApiErrorMessage(caught, text.loadFailed)) })
      .finally(() => { if (!controller.signal.aborted) setListLoading(false) })
    return () => controller.abort()
  }, [page, revision])
  const feedback = thread.data?.feedback
  return <div className="feedback-history">
    {(selected ? thread.error : listError) && <p role="alert" className="tool-alert tool-alert--error">{selected ? thread.error : listError}</p>}
    {(selected ? thread.loading : listLoading) && <p role="status" className="feedback-hint">{text.loading}</p>}
    {selected ? <>
      <div className="feedback-history-toolbar">
        <button type="button" className="feedback-action feedback-action-quiet" disabled={thread.saving} onClick={() => { setSelected(null); setReply(''); setNotice(null) }}><ArrowLeft size={16} aria-hidden="true" />{text.backToList}</button>
        <button type="button" className="feedback-action" aria-busy={thread.loading} disabled={thread.loading || thread.saving} onClick={() => { setNotice(null); void thread.refresh() }}><RefreshCw size={16} aria-hidden="true" className={thread.loading ? 'feedback-refresh-icon--loading' : undefined} />{text.refresh}</button>
      </div>
      {feedback && <>
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">{text.categories[feedback.category]}</h2><span className="tool-status">{text.statuses[feedback.status]}</span></div>
        {feedback.result && <div className="feedback-result"><h3 className="text-sm font-semibold">{text.result}</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7">{feedback.result}</p></div>}
        <FeedbackTimeline data={thread.data!} loading={thread.loading} onOlder={() => void thread.loadOlder()} />
        <form ref={replyForm} tabIndex={-1} className="feedback-form feedback-reply-form" aria-busy={thread.saving} onSubmit={(event) => { event.preventDefault(); void thread.save({ message: reply.trim() }).then((saved) => { if (saved) { setReply(''); setNotice(text.replySaved); setRevision((value) => value + 1) } }) }}>
          <label className="feedback-label"><span>{text.reply}</span><textarea className="tool-field feedback-field" rows={3} required maxLength={FEEDBACK_MESSAGE_MAX_LENGTH} disabled={thread.saving} value={reply} placeholder={text.replyPlaceholder} onChange={(event) => { setReply(event.target.value); setNotice(null) }} /></label>
          <p className="feedback-hint">{text.replyHint}</p>
          {notice && <p role="status" className="text-sm text-ink-secondary">{notice}</p>}
          <button type="submit" className="feedback-action feedback-action-primary" disabled={thread.saving || thread.loading || !reply.trim()}>{thread.saving ? text.sending : text.sendReply}</button>
        </form>
      </>}
    </> : <>
      <div className="feedback-history-toolbar">
        <h2 className="feedback-history-heading">{text.myFeedback}</h2>
        <button type="button" className="feedback-action" aria-busy={listLoading} disabled={listLoading} onClick={() => setRevision((value) => value + 1)}><RefreshCw size={16} aria-hidden="true" className={listLoading ? 'feedback-refresh-icon--loading' : undefined} />{text.refresh}</button>
      </div>
      {list?.items.length === 0 && <p className="py-5 text-sm leading-7 text-ink-secondary">{text.myEmpty}</p>}
      <ul className="divide-y divide-surface-3">{list?.items.map((item) => <li key={item.id}><button type="button" className="feedback-list-item" onClick={() => { setSelected(item.id); setNotice(null) }}><span className="flex flex-wrap justify-between gap-2"><strong>{text.categories[item.category]}</strong><span className="tool-status">{text.statuses[item.status]}</span></span><span className="mt-2 block line-clamp-2 break-words leading-6">{item.message}</span><time dateTime={item.updated_at} className="mt-2 block text-xs text-ink-muted">{new Date(item.updated_at).toLocaleString('zh-CN')}</time></button></li>)}</ul>
      {list && list.pagination.total_pages > 1 && <nav aria-label={text.myFeedback} className="flex flex-wrap items-center justify-between gap-2"><button type="button" className="feedback-action" disabled={listLoading || list.pagination.page <= 1} onClick={() => setPage(list.pagination.page - 1)}>{text.previousPage}</button><span className="text-xs text-ink-muted">{list.pagination.page} / {list.pagination.total_pages}</span><button type="button" className="feedback-action" disabled={listLoading || list.pagination.page >= list.pagination.total_pages} onClick={() => setPage(list.pagination.page + 1)}>{text.nextPage}</button></nav>}
    </>}
  </div>
}
