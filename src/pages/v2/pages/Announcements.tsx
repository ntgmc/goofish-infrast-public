import { memo, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { NextIcon as ArrowRight } from '../../../components/icons'
import { copy } from '../../../copy'
import AnnouncementMarkdown from '../../../components/AnnouncementMarkdown'
import { apiJson, getApiErrorMessage } from '../../../lib/api-client'
import { getAnnouncementReminderState } from '../../../lib/announcement-reminders'
import type { AnnouncementPageResponse } from '../../../lib/types'
import { formatShanghaiDateTime } from '../../tool/tool-utils'
import type { V2Session } from '../OptionsDrawer'
import { EmptyState, Loading, Notice } from '../components/WorkspaceUI'

const text = copy.dashboard
const Markdown = memo(AnnouncementMarkdown)

export default function Announcements({ session }: { session: V2Session }) {
  return <AnnouncementFeed key={session.authStatus === 'authenticated' ? session.user?.id ?? 'public' : 'public'} session={session} />
}

function AnnouncementFeed({ session }: { session: V2Session }) {
  const location = useLocation()
  const navigate = useNavigate()
  const search = new URLSearchParams(location.search)
  const rawPage = Number(search.get('page') ?? 1)
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1
  const signedIn = session.authStatus === 'authenticated' && Boolean(session.user)
  const unreadOnly = signedIn && search.get('unread_only') === '1'
  let announcementId = location.hash.startsWith('#announcement-') ? location.hash.slice(14) : ''
  try { announcementId = decodeURIComponent(announcementId) } catch { /* Keep malformed anchors visible as missing announcements. */ }
  const endpoint = signedIn ? '/api/user/announcements' : '/api/announcement'
  const [data, setData] = useState<AnnouncementPageResponse | null>(null)
  const cachedPage = useRef<{ data: AnnouncementPageResponse; unreadOnly: boolean } | null>(null)
  const requestVersion = useRef(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [marking, setMarking] = useState<string | null>(null)
  const params = new URLSearchParams({ page: String(page) })
  if (unreadOnly) params.set('unread_only', '1')
  if (announcementId) params.set('announcement_id', announcementId)
  const apiUrl = `${endpoint}?${params}`

  useEffect(() => {
    requestVersion.current += 1
    const cached = cachedPage.current
    if (cached?.unreadOnly === unreadOnly && cached.data.page === page
      && (!announcementId || cached.data.announcements.some((item) => item.announcement.id === announcementId))) {
      setLoading(false)
      setError(null)
      return () => { requestVersion.current += 1 }
    }
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    void apiJson<AnnouncementPageResponse>(apiUrl, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return
      cachedPage.current = { data: result, unreadOnly }
      setData(result)
      setLoading(false)
      if (typeof result.unread_count === 'number') session.setAnnouncementUnreadCount(result.unread_count)
      if (result.page !== page) {
        const normalized = new URLSearchParams(location.search)
        normalized.set('section', 'announcements')
        normalized.set('page', String(result.page))
        navigate({ search: `?${normalized}`, hash: location.hash }, { replace: true })
      }
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return
      setError(getApiErrorMessage(cause, copy.public.pages_AnnouncementsPage_001))
      setLoading(false)
    })
    return () => { controller.abort(); requestVersion.current += 1 }
  }, [apiUrl, page, announcementId, unreadOnly, retry, location.search, location.hash, navigate, session.setAnnouncementUnreadCount])

  function openPage(nextPage: number, id = '', unread = unreadOnly) {
    const next = new URLSearchParams(location.search)
    next.set('section', 'announcements')
    next.set('page', String(nextPage))
    if (unread) next.set('unread_only', '1')
    else next.delete('unread_only')
    navigate({ search: `?${next}`, hash: id ? `#announcement-${encodeURIComponent(id)}` : '' })
  }

  async function markRead(id?: string) {
    const version = requestVersion.current
    setMarking(id ?? 'all')
    setError(null)
    try {
      const result = await apiJson<AnnouncementPageResponse>(apiUrl, {
        method: 'PATCH', json: id ? { announcement_id: id, updated_at: data?.announcements.find((item) => item.announcement.id === id)?.announcement.updated_at } : { all: true },
        fallbackMessage: text.pages_tool_dashboard_AnnouncementsSection_002,
      })
      if (version !== requestVersion.current) return
      cachedPage.current = { data: result, unreadOnly }
      setData(result)
      if (typeof result.unread_count === 'number') session.setAnnouncementUnreadCount(result.unread_count)
      if (unreadOnly || result.page !== page) openPage(result.page, unreadOnly ? '' : announcementId)
    } catch (cause: unknown) {
      if (version === requestVersion.current) setError(getApiErrorMessage(cause, text.pages_tool_dashboard_AnnouncementsSection_002))
    } finally {
      setMarking(null)
    }
  }

  const selected = data?.announcements.find((item) => item.announcement.id === announcementId)
    ?? (!announcementId ? data?.announcements[0] : undefined)
  const unreadCount = data?.unread_count ?? session.announcementUnreadCount
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const busy = loading || marking !== null
  return <div className="v2-announcement-inbox">
    {!signedIn && <p className="v2-lead">{copy.public.pages_AnnouncementsPage_004}</p>}
    {error && <Notice error>{error}<button className="v2-text-button" onClick={() => { cachedPage.current = null; setRetry((value) => value + 1) }}>{copy.v2.retry}</button></Notice>}
    {signedIn && <div className="v2-inbox-toolbar">
      <div className="v2-filter-group"><button disabled={busy} aria-pressed={!unreadOnly} onClick={() => openPage(1, '', false)}>{copy.v2.readAll}</button><button disabled={busy} aria-pressed={unreadOnly} onClick={() => openPage(1, '', true)}>{copy.v2.readUnread} {unreadCount}</button></div>
      <button className="v2-text-button" disabled={busy || unreadCount === 0} onClick={() => void markRead()}>{marking === 'all' ? text.pages_tool_dashboard_AnnouncementsSection_004 : text.pages_tool_dashboard_AnnouncementsSection_005}</button>
    </div>}
    {loading && <Loading label={copy.public.pages_AnnouncementsPage_006} />}
    {data && <>
      <div className="v2-selection-workspace v2-inbox-layout" aria-busy={busy}>
        <nav className="v2-inbox-index" aria-label={copy.v2.announcements}>
          {data.announcements.map(({ announcement, read_at }) => {
            const unread = signedIn && announcement.kind === 'popup' && !read_at
            return <button key={announcement.id} disabled={busy} aria-pressed={selected?.announcement.id === announcement.id} data-unread={unread} onClick={() => openPage(data.page, announcement.id)}><time dateTime={announcement.updated_at}>{formatShanghaiDateTime(announcement.updated_at)}</time><strong>{announcement.title}</strong>{unread && <small>{text.pages_tool_dashboard_AnnouncementsSection_008}</small>}{getAnnouncementReminderState(announcement) === 'ended' && <small>{copy.public.announcement_reminder_ended}</small>}<ArrowRight size={16} aria-hidden="true" /></button>
          })}
        </nav>
        {selected ? <article key={selected.announcement.id} className="v2-announcement-reading">
          <time dateTime={selected.announcement.updated_at}>{formatShanghaiDateTime(selected.announcement.updated_at)}</time><h2>{selected.announcement.title}</h2>
          {getAnnouncementReminderState(selected.announcement) === 'ended' && <p className="v2-muted">{copy.public.announcement_reminder_ended}</p>}
          <Markdown>{selected.announcement.body}</Markdown>
          {signedIn && selected.announcement.kind === 'popup' && !selected.read_at && <button className="v2-button v2-button-primary" disabled={busy} onClick={() => void markRead(selected.announcement.id)}>{marking === selected.announcement.id ? text.pages_tool_dashboard_AnnouncementsSection_010 : text.pages_tool_dashboard_AnnouncementsSection_011}</button>}
        </article> : !loading && !error && <EmptyState title={announcementId ? copy.v2.announcementsNotFound : text.pages_tool_dashboard_AnnouncementsSection_007} />}
      </div>
      <nav className="v2-actions" aria-label={copy.v2.announcementsPagination}>
        <button className="v2-button v2-button-secondary" disabled={busy || data.page <= 1} onClick={() => openPage(data.page - 1)}>{copy.v2.previousPage}</button>
        <span aria-live="polite">{copy.v2.pageNumber(data.page, pages)}</span>
        <button className="v2-button v2-button-secondary" disabled={busy || data.page >= pages} onClick={() => openPage(data.page + 1)}>{copy.v2.nextPage}</button>
      </nav>
    </>}
  </div>
}
