import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react'
import { Link } from 'react-router-dom'
import type { Announcement } from '../lib/types'
import { apiVoid } from '../lib/api-client'
import AnnouncementMarkdown from './AnnouncementMarkdown'
import { AnimatedPresenceRegion } from './MotionPrimitives'
import { copy } from '../copy/index'


const READ_PREFIX = 'maa-announcement-read:'
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
}

export default function AnnouncementPopup({ announcements }: Props) {
  const candidates = useMemo(
    () => announcements.filter((item) => item.active && item.kind === 'popup'),
    [announcements],
  )
  const [queue, setQueue] = useState<Announcement[]>([])
  const dialogRef = useRef<HTMLDialogElement>(null)
  const initialFocusRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const dismissedRef = useRef(new Set<string>())

  useEffect(() => {
    setQueue(candidates.filter((item) => (
      !isAnnouncementRead(item) && !dismissedRef.current.has(announcementVersionKey(item))
    )))
  }, [candidates])

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
    if (!dialog.open) dialog.showModal()
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
  }, [Boolean(current)])

  if (!current) return null

  const markCurrentRead = () => {
    markAnnouncementRead(current)
    void reportAnnouncementRead(current)
    setQueue((items) => items.slice(1))
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
            className="tool-secondary-action shrink-0 px-3 text-sm"
          >
            {copy.public.components_AnnouncementPopup_002}</Link>
        </div>
        <AnnouncementMarkdown id="announcement-popup-body" className="mt-4">{current.body}</AnnouncementMarkdown>
        <div className="mt-6 flex justify-end">
          <button
            ref={initialFocusRef}
            type="button"
            onClick={markCurrentRead}
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
