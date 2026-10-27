import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { updateUserAnnouncementQueries, useUserAnnouncementsQuery, type UserAnnouncementsResponse } from '../../../lib/announcement-query'
import { apiJson } from '../../../lib/api-client'
import { getAnnouncementReminderState } from '../../../lib/announcement-reminders'
import { formatDate } from '../tool-utils'
import AnnouncementMarkdown from '../../../components/AnnouncementMarkdown'
import { copy } from '../../../copy/index'



function useUserAnnouncements(userId: string, onUnreadCountChange: (count: number) => void) {
  const client = useQueryClient()
  const query = useUserAnnouncementsQuery(userId || null)
  const items = query.data?.announcements ?? []
  const loading = query.isFetching
  const [error, setError] = useState<string | null>(null)
  const [markingId, setMarkingId] = useState<string | null>(null)
  const [markingAll, setMarkingAll] = useState(false)
  const writeAbort = useRef<AbortController | null>(null)
  useEffect(() => {
    if (query.data) onUnreadCountChange(query.data.unread_count ?? 0)
  }, [query.data, onUnreadCountChange])
  useEffect(() => () => writeAbort.current?.abort(), [userId])

  const markRead = async (announcementId?: string) => {
    if (!userId || markingId || markingAll) return
    const controller = new AbortController()
    writeAbort.current = controller
    const isMarkingAll = !announcementId
    setError(null)
    if (isMarkingAll) setMarkingAll(true)
    else setMarkingId(announcementId)

    try {
      const data = await apiJson<UserAnnouncementsResponse>('/api/user/announcements', {
        method: 'PATCH', signal: controller.signal,
        json: announcementId ? { announcement_id: announcementId, updated_at: items.find((item) => item.announcement.id === announcementId)?.announcement.updated_at } : { all: true },
        fallbackMessage: copy.dashboard.pages_tool_dashboard_AnnouncementsSection_002,
      })
      if (controller.signal.aborted) return
      await updateUserAnnouncementQueries(client, userId, data)
      if (!controller.signal.aborted && typeof data.unread_count === 'number') onUnreadCountChange(data.unread_count)
    } catch (caught) {
      if (!controller.signal.aborted) setError((caught as Error).message)
    } finally {
      if (!controller.signal.aborted) {
        if (isMarkingAll) setMarkingAll(false)
        else setMarkingId(null)
      }
    }
  }

  const unreadCount = items.filter((item) => !item.read_at).length
  return { items, loading, error: error ?? query.error?.message, markingId, markingAll, markRead, unreadCount }
}

export default function AnnouncementsSection(props: { userId: string; onUnreadCountChange: (count: number) => void; loadingFallback?: ReactNode }) {
  return <UserAnnouncements key={props.userId} {...props} />
}

function UserAnnouncements({ userId, onUnreadCountChange, loadingFallback }: { userId: string; onUnreadCountChange: (count: number) => void; loadingFallback?: ReactNode }) {
  const { items, loading, error, markingId, markingAll, markRead, unreadCount } = useUserAnnouncements(userId, onUnreadCountChange)
  if (loading && !items.length && loadingFallback) return loadingFallback

  return (
    <section className="workspace-announcements max-w-4xl space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-secondary">{copy.dashboard.pages_tool_dashboard_AnnouncementsSection_003}</p>
        <button
          type="button"
          onClick={() => void markRead()}
          disabled={loading || unreadCount === 0 || markingAll || markingId !== null}
          className="tool-secondary-action disabled:cursor-wait"
        >
          {markingAll ? copy.dashboard.pages_tool_dashboard_AnnouncementsSection_004 : copy.dashboard.pages_tool_dashboard_AnnouncementsSection_005}
        </button>
      </div>
      {loading && <p className="tool-inset p-4 text-sm text-ink-secondary" role="status">{copy.dashboard.pages_tool_dashboard_AnnouncementsSection_006}</p>}
      {error && <div className="tool-alert tool-alert--error" role="alert">{error}</div>}
      {!loading && items.length === 0 && <div className="tool-panel p-6 text-sm text-ink-secondary">{copy.dashboard.pages_tool_dashboard_AnnouncementsSection_007}</div>}
      {items.map(({ announcement, read_at }) => (
        <article key={announcement.id} data-unread={!read_at} className={`workspace-announcement tool-panel p-5 ${read_at ? '' : 'border-brand-500/50 bg-brand-500/10'}`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold text-ink-primary">{announcement.title}</h2>
                {!read_at && <span className="tool-status tool-status--current">{copy.dashboard.pages_tool_dashboard_AnnouncementsSection_008}</span>}
                {getAnnouncementReminderState(announcement) === 'ended' && <span className="tool-status">{copy.public.announcement_reminder_ended}</span>}
              </div>
              <AnnouncementMarkdown className="mt-2">{announcement.body}</AnnouncementMarkdown>
              <p className="mt-3 text-xs text-ink-muted">{copy.dashboard.pages_tool_dashboard_AnnouncementsSection_009}{formatDate(announcement.updated_at)}</p>
            </div>
            {!read_at && (
              <button
                type="button"
                onClick={() => void markRead(announcement.id)}
                disabled={markingAll || markingId === announcement.id}
                className="tool-primary-action w-full shrink-0 disabled:cursor-wait sm:w-28"
              >
                {markingId === announcement.id ? copy.dashboard.pages_tool_dashboard_AnnouncementsSection_010 : copy.dashboard.pages_tool_dashboard_AnnouncementsSection_011}
              </button>
            )}
          </div>
        </article>
      ))}
    </section>
  )
}
