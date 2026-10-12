import { useEffect, useState } from 'react'
import { copy } from '../../../copy'
import { adminApiJson } from '../../../lib/admin-api-client'
import { getApiErrorMessage } from '../../../lib/api-client'
import type { AdminFeedbackPage } from '../../../lib/feedback-contracts'
import { formatDate } from '../shared/helpers'
import { PaginationControls } from '../shared/PaginationControls'

export default function FeedbackSection({ active }: { active: boolean }) {
  const text = copy.feedback
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [revision, setRevision] = useState(0)
  const [data, setData] = useState<AdminFeedbackPage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedImages, setExpandedImages] = useState<string[]>([])
  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void adminApiJson<AdminFeedbackPage>(`/api/admin/feedback?page=${page}&page_size=${pageSize}`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) { setData(result); setExpandedImages([]) } })
      .catch((caught) => { if (!controller.signal.aborted) setError(getApiErrorMessage(caught, text.loadFailed)) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [active, page, pageSize, revision])
  return <section className="tool-panel min-w-0 p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-ink-secondary">{text.adminDescription}</p><button type="button" className="tool-secondary-action" disabled={loading} onClick={() => setRevision((current) => current + 1)}>{text.refresh}</button></div>
    {error && <p role="alert" className="tool-alert tool-alert--error mt-4">{error}</p>}
    {loading && <p role="status" className="mt-4 text-sm text-ink-muted">{text.loading}</p>}
    {data?.items.length === 0 && <p className="py-8 text-sm text-ink-muted">{text.empty}</p>}
    <div className="mt-4 divide-y divide-surface-3" aria-busy={loading}>{data?.items.map((item) => <article key={item.id} className="min-w-0 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-all text-sm font-semibold">{text.account}：{item.email}</h2><p className="mt-1 break-all text-xs text-ink-muted">ID：{item.user_id}</p></div><span className="tool-status">{text.categories[item.category]}</span></div>
      <p className="mt-2 text-xs text-ink-muted">{text.createdAt}：<time dateTime={item.created_at}>{formatDate(item.created_at)}</time></p>
      <p className="my-4 whitespace-pre-wrap break-words text-sm leading-7 text-ink-primary">{item.message}</p>
      {item.has_image && (expandedImages.includes(item.id) ? <a href={`/api/admin/feedback?image_id=${item.id}`} target="_blank" rel="noreferrer" aria-label={text.viewImage}><img src={`/api/admin/feedback?image_id=${item.id}`} alt={text.imagePreview} loading="lazy" className="max-h-80 max-w-full rounded object-contain" /></a> : <button type="button" className="tool-secondary-action" onClick={() => setExpandedImages((current) => [...current, item.id])}>{text.viewImage}</button>)}
    </article>)}</div>
    {data && <PaginationControls pagination={data.pagination} loading={loading} onPageChange={setPage} onPageSizeChange={(size) => { setPageSize(size); setPage(1) }} />}
  </section>
}
