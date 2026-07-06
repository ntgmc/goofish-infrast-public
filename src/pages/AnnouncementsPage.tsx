import { useEffect, useState } from 'react'
import type { Announcement, AnnouncementPublicResponse } from '../lib/types'
import { apiJson } from '../lib/api-client'

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
    <main className="min-h-screen bg-surface-0 px-4 py-8 text-ink-primary">
      <div className="mx-auto max-w-3xl">
        <div className="flex flex-col gap-3 border-b border-surface-3 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">公告</h1>
            <p className="mt-2 text-sm leading-6 text-ink-secondary">这里会集中展示近期通知，方便你随时回看。</p>
          </div>
          <a
            href="/tool"
            className="text-sm font-semibold text-brand-600 underline-offset-4 hover:underline"
          >
            返回工具
          </a>
        </div>

        {loading && <p className="mt-6 text-sm text-ink-secondary">正在加载公告...</p>}
        {error && <div className="mt-6 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">{error}</div>}
        {!loading && !error && announcements.length === 0 && (
          <div className="mt-6 rounded-lg border border-surface-3 bg-surface-1 px-4 py-5 text-sm text-ink-secondary">
            暂时没有新的公告。
          </div>
        )}

        <div className="mt-6 space-y-4">
          {announcements.map((announcement) => (
            <article key={announcement.id} className="rounded-lg border border-surface-3 bg-surface-1 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-surface-2 px-2 py-1 text-xs font-semibold text-ink-muted">
                  {announcement.kind === 'banner' ? '横幅' : '弹出式公告'}
                </span>
                <time className="text-xs text-ink-muted">{formatDate(announcement.updated_at)}</time>
              </div>
              <h2 className="mt-3 text-base font-semibold text-ink-primary">{announcement.title}</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink-secondary">{announcement.body}</p>
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
