import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react'
import { Link } from 'react-router'
import type { Announcement } from '../lib/types'
import { apiJson, apiVoid } from '../lib/api-client'
import { getOrCreateToolVisitorId } from '../lib/usage-tracking'
import type { UserAnnouncementRead } from '../lib/types'
import AnnouncementMarkdown from './AnnouncementMarkdown'
import { AnimatedPresenceRegion } from './MotionPrimitives'
import { copy } from '../copy/index'


const READ_PREFIX = 'maa-announcement-read:'
const sessionReadVersions = new Set<string>()
const sessionDismissedVersions = new Set<string>()
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

interface Props {
  announcements: Announcement[];
  userId?: string;
  onUnreadCountChange?: (count: number) => void;
}

export default function AnnouncementPopup({ announcements, userId, onUnreadCountChange }: Props) {
  const candidates = useMemo(
    () => announcements.filter((item) => item.active && item.kind === 'popup'),
    [announcements],
  )
  const [queue, setQueue] = useState<Announcement[]>([])
  const [serverReadVersions, setServerReadVersions] = useState<Set<string> | null>(null)
  const [marking, setMarking] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const initialFocusRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const dismissedRef = useRef(sessionDismissedVersions)

  useEffect(() => {
    if (!userId) {
      setServerReadVersions(null)
      return
    }
    let active = true
    setServerReadVersions(null)
    void apiJson<{ announcements?: UserAnnouncementRead[]; unread_count?: number }>('/api/user/announcements')
      .then((payload) => {
        if (!active) return
        setServerReadVersions(new Set((payload.announcements ?? [])
          .filter((item) => Boolean(item.read_at))
          .map((item) => announcementVersionKey(item.announcement))))
        if (typeof payload.unread_count === 'number') onUnreadCountChange?.(payload.unread_count)
      })
      .catch(() => {
        // Logged-in read state remains server-authoritative when the request fails.
      })
    return () => { active = false }
  }, [onUnreadCountChange, userId])

  useEffect(() => {
    if (userId && serverReadVersions === null) {
      setQueue([])
      return
    }
    setQueue(candidates.filter((item) => (
      !(userId ? serverReadVersions?.has(announcementVersionKey(item)) : isAnnouncementRead(item))
      && !dismissedRef.current.has(announcementVersionKey(item))
    )))
  }, [candidates, serverReadVersions, userId])

  const current = queue[0]

  useEffect(() => {
    if (!current) return

    const dialog = dialogRef.current
    if (!dialog) return

    const activeElement = document.activeElement
    restoreFocusRef.current = activeElement instanceof HTMLElement && activeElement !== document.body
      ? activeElement
      : null

    const previousOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    if (!dialog.open) {
      dialog.showModal()
      void reportAnnouncementEvent('announcement_impression', current, 'popup_impression')
    }
    initialFocusRef.current?.focus()

    return () => {
      if (dialog.open) dialog.close()
      document.documentElement.style.overflow = previousOverflow

      const restoreTarget = restoreFocusRef.current
      if (restoreTarget?.isConnected) {
        restoreTarget.focus()
      } else {
        focusFirstAppControl()
      }
      restoreFocusRef.current = null
    }
  }, [current ? announcementVersionKey(current) : null])

  if (!current) return null

  const markCurrentRead = async () => {
    if (marking) return
    setMarking(true)
    try {
      if (userId) {
        const payload = await apiJson<{ unread_count?: number }>('/api/user/announcements', {
          method: 'PATCH',
          json: { announcement_id: current.id },
        })
        setServerReadVersions((versions) => new Set(versions ?? []).add(announcementVersionKey(current)))
        if (typeof payload.unread_count === 'number') onUnreadCountChange?.(payload.unread_count)
      } else {
        markAnnouncementRead(current)
      }
      void reportAnnouncementEvent('announcement_read', current, 'popup_read')
      setQueue((items) => items.slice(1))
    } catch {
      // Keep the popup open so the user can retry the server-authoritative mutation.
    } finally {
      setMarking(false)
    }
  }

  const dismissPopupSession = () => {
    queue.forEach((item) => dismissedRef.current.add(announcementVersionKey(item)))
    setQueue([])
  }

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault()
    dismissPopupSession()
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="announcement-popup-title"
      aria-describedby="announcement-popup-body"
      aria-modal="true"
      onCancel={handleCancel}
      className="m-auto max-h-[calc(100dvh-4rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto border-0 bg-transparent p-0 text-left backdrop:bg-black/55"
    >
      <section className="tool-panel w-full max-w-lg p-5 text-left shadow-xl">
        <AnimatedPresenceRegion motionKey={announcementVersionKey(current)}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="tool-eyebrow">{copy.public.components_AnnouncementPopup_001}</p>
            <h2 id="announcement-popup-title" className="mt-1 text-lg font-semibold text-ink-primary">
              {current.title}
            </h2>
          </div>
          <Link
            to="/announcements"
            onClick={dismissPopupSession}
            className="tool-secondary-action shrink-0 px-3 text-sm"
          >
            {copy.public.components_AnnouncementPopup_002}</Link>
        </div>
        <AnnouncementMarkdown id="announcement-popup-body" className="mt-4">{current.body}</AnnouncementMarkdown>
        <div className="mt-6 flex justify-end">
          <button
            ref={initialFocusRef}
            type="button"
            onClick={() => void markCurrentRead()}
            disabled={marking}
            className="tool-primary-action"
          >
            {copy.public.components_AnnouncementPopup_003}</button>
        </div>
        </AnimatedPresenceRegion>
      </section>
    </dialog>
  )
}

function announcementVersionKey(announcement: Announcement): string {
  return `${announcement.id}:${announcement.updated_at}`
}

function focusFirstAppControl(): void {
  const root = document.getElementById('root')
  const target = Array.from(root?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])
    .find(isAvailableFocusTarget)
  target?.focus()
}

function isAvailableFocusTarget(element: HTMLElement): boolean {
  if (element.closest('[hidden], [aria-hidden="true"], [inert]')) return false
  if (element.closest('details:not([open])')) return false
  const style = window.getComputedStyle(element)
  return style.display !== 'none' && style.visibility !== 'hidden'
}

function isAnnouncementRead(announcement: Announcement): boolean {
  const versionKey = announcementVersionKey(announcement)
  if (sessionReadVersions.has(versionKey)) return true
  try {
    return window.localStorage.getItem(readKey(announcement)) === announcement.updated_at
  } catch {
    return false
  }
}

function markAnnouncementRead(announcement: Announcement): void {
  sessionReadVersions.add(announcementVersionKey(announcement))
  try {
    window.localStorage.setItem(readKey(announcement), announcement.updated_at)
  } catch {
    // Session memory remains authoritative when persistent storage is unavailable.
  }
}

async function reportAnnouncementEvent(
  event: 'announcement_impression' | 'announcement_read',
  announcement: Announcement,
  source: 'popup_impression' | 'popup_read',
): Promise<void> {
  try {
    await apiVoid('/api/usage-stats', {
      method: 'POST',
      keepalive: true,
      json: {
        event,
        visitor_id: getOrCreateToolVisitorId(),
        announcement_id: announcement.id,
        announcement_kind: announcement.kind,
        announcement_version: announcement.updated_at,
        source,
      },
    })
  } catch {
    // Local read state must keep working for logged-out/offline users.
  }
}

function readKey(announcement: Announcement): string {
  return `${READ_PREFIX}${announcement.id}`
}
