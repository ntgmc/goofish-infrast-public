import { useEffect, useMemo, useState } from 'react'
import type { Announcement } from '../lib/types'
import { apiVoid } from '../lib/api-client'

const READ_PREFIX = 'maa-announcement-read:'

interface Props {
  announcements: Announcement[];
}

export default function AnnouncementPopup({ announcements }: Props) {
  const candidates = useMemo(
    () => announcements.filter((item) => item.active && item.kind === 'popup'),
    [announcements],
  )
  const [queue, setQueue] = useState<Announcement[]>([])

  useEffect(() => {
    setQueue(candidates.filter((item) => !isAnnouncementRead(item)))
  }, [candidates])

  const current = queue[0]
  if (!current) return null

  const markCurrentRead = () => {
    markAnnouncementRead(current)
    void reportAnnouncementRead(current)
    setQueue((items) => items.slice(1))
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink-primary/45 px-4 py-8">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="announcement-popup-title"
        className="w-full max-w-lg rounded-xl bg-surface-0 p-5 text-left shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-brand-600">站内公告</p>
            <h2 id="announcement-popup-title" className="mt-1 text-lg font-semibold text-ink-primary">
              {current.title}
            </h2>
          </div>
          <a
            href="/announcements"
            className="shrink-0 text-sm font-semibold text-brand-600 underline-offset-4 hover:underline"
          >
            历史
          </a>
        </div>
        <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-ink-secondary">{current.body}</p>
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={markCurrentRead}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-brand-500"
          >
            已读
          </button>
        </div>
      </section>
    </div>
  )
}

function isAnnouncementRead(announcement: Announcement): boolean {
  if (!canUseLocalStorage()) return false
  return window.localStorage.getItem(readKey(announcement)) === announcement.updated_at
}

function markAnnouncementRead(announcement: Announcement): void {
  if (!canUseLocalStorage()) return
  window.localStorage.setItem(readKey(announcement), announcement.updated_at)
}

async function reportAnnouncementRead(announcement: Announcement): Promise<void> {
  try {
    await apiVoid('/api/usage-stats', {
      method: 'POST',
      json: {
        event: 'announcement_read',
        announcement_id: announcement.id,
        announcement_kind: announcement.kind,
        source: 'popup_local',
      },
    })
  } catch {
    // Local read state must keep working for logged-out/offline users.
  }
}

function readKey(announcement: Announcement): string {
  return `${READ_PREFIX}${announcement.id}`
}

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined' && Boolean(window.localStorage)
}
