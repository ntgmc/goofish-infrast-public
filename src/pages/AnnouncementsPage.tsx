import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Announcement, AnnouncementPublicResponse } from '../lib/types'
import { apiJson } from '../lib/api-client'
import AnnouncementMarkdown from '../components/AnnouncementMarkdown'
import ThemeSwitcher from '../components/ThemeSwitcher'
import { copy, CURRENT_LOCALE } from '../copy/index'


export default function AnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    apiJson<AnnouncementPublicResponse>('/api/announcement', { fallbackMessage: copy.public.pages_AnnouncementsPage_001 })
      .then((data) => {
        if (cancelled) return
        setAnnouncements(Array.isArray(data.announcements) ? data.announcements : [])
        setError(null)
      })
      .catch((caught) => {
        if (!cancelled) setError((caught as Error).message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="tool-page" tabIndex={-1} data-route-focus>
      <div className="public-document">
        <div className="tool-page-header flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="section-index">{copy.public.pages_AnnouncementsPage_002}</p>
            <h1 className="display-title text-2xl">{copy.public.pages_AnnouncementsPage_003}</h1>
            <p className="mt-2 text-sm leading-6 text-ink-secondary">{copy.public.pages_AnnouncementsPage_004}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ThemeSwitcher />
            <Link to="/tool/profiles" className="tool-secondary-action shrink-0">
              {copy.public.pages_AnnouncementsPage_005}</Link>
          </div>
        </div>

        {loading && <p className="tool-inset mt-6 px-4 py-3 text-sm text-ink-secondary" role="status">{copy.public.pages_AnnouncementsPage_006}</p>}
        {error && <div className="tool-alert tool-alert--error mt-6" role="alert">{error}</div>}
        {!loading && !error && announcements.length === 0 && (
          <div className="tool-inset mt-6 px-4 py-5 text-sm leading-6 text-ink-secondary">
            {copy.public.pages_AnnouncementsPage_007}</div>
        )}

        <div className="mt-6 border-t border-surface-4">
          {announcements.map((announcement) => (
            <article key={announcement.id} className="border-b border-surface-3 py-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className="tool-status">
                  {copy.public.pages_AnnouncementsPage_009}
                </span>
                <time className="text-xs text-ink-muted">{formatDate(announcement.updated_at)}</time>
              </div>
              <h2 className="mt-3 text-base font-semibold text-ink-primary">{announcement.title}</h2>
              <AnnouncementMarkdown className="mt-2">{announcement.body}</AnnouncementMarkdown>
            </article>
          ))}
        </div>
      </div>
    </main>
  )
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(CURRENT_LOCALE, { hour12: false })
}
