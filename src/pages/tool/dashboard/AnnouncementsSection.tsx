import { useCallback, useEffect, useState } from 'react'
import type { UserAnnouncementRead } from '../../../lib/types'
import { apiJson } from '../../../lib/api-client'
import { formatDate } from '../tool-utils'


export default function AnnouncementsSection() {
  const [items, setItems] = useState<UserAnnouncementRead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [markingId, setMarkingId] = useState<string | null>(null)
  const [markingAll, setMarkingAll] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiJson<{ announcements?: UserAnnouncementRead[] }>('/api/user/announcements', { fallbackMessage: '加载公告失败' })
      setItems(data.announcements ?? [])
      setError(null)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const markRead = async (announcementId?: string) => {
    const isMarkingAll = !announcementId
    setError(null)
    if (isMarkingAll) setMarkingAll(true)
    else setMarkingId(announcementId)

    try {
      const data = await apiJson<{ announcements?: UserAnnouncementRead[] }>('/api/user/announcements', {
        method: 'PATCH',
        json: announcementId ? { announcement_id: announcementId } : { all: true },
        fallbackMessage: '标记公告失败',
      })
      if (Array.isArray(data.announcements)) setItems(data.announcements)
      else await load()
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      if (isMarkingAll) setMarkingAll(false)
      else setMarkingId(null)
    }
  }

  return (
    <section className="max-w-4xl space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-secondary">这里会显示近期通知，读过的内容会自动留在公告列表中方便回看。</p>
        <button
          type="button"
          onClick={() => void markRead()}
          disabled={markingAll || markingId !== null}
          className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-3 hover:text-ink-primary disabled:cursor-wait disabled:bg-surface-2 disabled:text-ink-muted"
        >
          {markingAll ? '处理中...' : '全部设为已读'}
        </button>
      </div>
      {loading && <p className="text-sm text-ink-secondary">正在加载公告...</p>}
      {error && <div className="rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">{error}</div>}
      {!loading && items.length === 0 && <div className="rounded-xl border border-surface-3 bg-surface-1 p-6 text-sm text-ink-secondary">暂时没有新的公告。</div>}
      {items.map(({ announcement, read_at }) => (
        <article key={announcement.id} className={`rounded-xl border p-5 ${read_at ? 'border-surface-3 bg-surface-1' : 'border-brand-500/50 bg-brand-500/10'}`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold text-ink-primary">{announcement.title}</h2>
                {!read_at && <span className="rounded-md bg-brand-600 px-2 py-1 text-xs font-semibold text-white">未读</span>}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink-secondary">{announcement.body}</p>
              <p className="mt-3 text-xs text-ink-muted">更新 {formatDate(announcement.updated_at)}</p>
            </div>
            {!read_at && (
              <button
                type="button"
                onClick={() => void markRead(announcement.id)}
                disabled={markingAll || markingId === announcement.id}
                className="w-full shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500 disabled:cursor-wait disabled:bg-surface-3 disabled:text-ink-muted sm:w-28"
              >
                {markingId === announcement.id ? '标记中...' : '标为已读'}
              </button>
            )}
          </div>
        </article>
      ))}
    </section>
  )
}
