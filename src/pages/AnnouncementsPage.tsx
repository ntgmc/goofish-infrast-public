import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Announcement, AnnouncementPublicResponse } from '../lib/types'
import { apiJson } from '../lib/api-client'
import AnnouncementMarkdown from '../components/AnnouncementMarkdown'

export default function AnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    apiJson<AnnouncementPublicResponse>('/api/announcement', { fallbackMessage: '加载公告失败' })
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
      <div className="tool-page-frame max-w-3xl">
        <div className="tool-page-header flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="tool-eyebrow">MaaTool 官方</p>
            <h1 className="text-2xl font-semibold">公告</h1>
            <p className="mt-2 text-sm leading-6 text-ink-secondary">这里会集中展示近期通知，方便你随时回看。</p>
          </div>
          <Link
            to="/tool/profiles"
            className="tool-secondary-action shrink-0"
          >
            返回工具
          </Link>
        </div>

        {loading && <p className="tool-inset mt-6 px-4 py-3 text-sm text-ink-secondary" role="status">正在加载公告...</p>}
        {error && <div className="tool-alert tool-alert--error mt-6" role="alert">{error}</div>}
        {!loading && !error && announcements.length === 0 && (
          <div className="tool-inset mt-6 px-4 py-5 text-sm leading-6 text-ink-secondary">
            暂时没有新的公告。
          </div>
        )}

        <div className="mt-6 space-y-4">
          {announcements.map((announcement) => (
            <article key={announcement.id} className="tool-panel p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="tool-status">
                  {announcement.kind === 'banner' ? '横幅' : '弹出式公告'}
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
  return date.toLocaleString('zh-CN', { hour12: false })
}
