import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react'
import { Link } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { updateUserAnnouncementQueries, useUserAnnouncementsQuery, type UserAnnouncementsResponse } from '../lib/announcement-query'
import type { Announcement } from '../lib/types'
import { apiJson, apiVoid, getApiErrorMessage } from '../lib/api-client'
import { getAnnouncementReminderState } from '../lib/announcement-reminders'
import AnnouncementMarkdown from './AnnouncementMarkdown'
import { copy } from '../copy/index'

const READ_PREFIX = 'maa-announcement-read:'
const VISIT_SHOWN_KEY = 'maa-announcement-popup-shown'
const sessionReadVersions = new Set<string>()
let visitShownWithoutStorage = false
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
  announcementsPath?: string;
}

export default function AnnouncementPopup({ announcements, userId, onUnreadCountChange, announcementsPath = '/announcements' }: Props) {
  const [current, setCurrent] = useState<Announcement | null>(null)
  const [marking, setMarking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const initialFocusRef = useRef<HTMLButtonElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const currentUserRef = useRef(userId)
  currentUserRef.current = userId
  const candidate = announcements.find((item) => getAnnouncementReminderState(item) === 'active')
  const client = useQueryClient()
  const query = useUserAnnouncementsQuery(userId && candidate && !hasShownThisVisit() ? userId : null)
  const serverReads = useMemo(() => query.data && !query.error && !query.isFetching ? new Set((query.data.announcements ?? [])
    .filter((item) => Boolean(item.read_at)).map((item) => announcementVersionKey(item.announcement))) : null, [query.data, query.error, query.isFetching])

  useEffect(() => {
    if (typeof query.data?.unread_count === 'number') onUnreadCountChange?.(query.data.unread_count)
  }, [query.data, onUnreadCountChange])

  useEffect(() => {
    setCurrent(null)
    setMarking(false)
    setError(null)
  }, [userId])

  useEffect(() => {
    if (current) {
      if (!announcements.some((item) => announcementVersionKey(item) === announcementVersionKey(current)
        && getAnnouncementReminderState(item) === 'active')) setCurrent(null)
      return
    }
    if (hasShownThisVisit() || (userId && !serverReads)) return
    if (!candidate || (userId ? serverReads?.has(announcementVersionKey(candidate)) : isAnnouncementRead(candidate))) return
    setCurrent(candidate)
  }, [announcements, candidate, current, serverReads, userId])

  useEffect(() => {
    if (!current) return
    const dialog = dialogRef.current
    if (!dialog) return

    const activeElement = document.activeElement
    restoreFocusRef.current = activeElement instanceof HTMLElement && activeElement !== document.body ? activeElement : null
    const previousOverflow = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    if (!dialog.open) {
      dialog.showModal()
      rememberShownThisVisit()
      void reportAnnouncementEvent('announcement_impression', current, 'popup_impression')
    }
    initialFocusRef.current?.focus()

    let expiryTimer: number | undefined
    const checkExpiry = () => {
      const remaining = Date.parse(current.popup_until!) - Date.now()
      if (remaining <= 0) setCurrent(null)
      else expiryTimer = window.setTimeout(checkExpiry, Math.min(remaining, 2_147_483_647))
    }
    checkExpiry()

    return () => {
      window.clearTimeout(expiryTimer)
      if (dialog.open) dialog.close()
      document.documentElement.style.overflow = previousOverflow
      const restoreTarget = restoreFocusRef.current
      if (restoreTarget?.isConnected) restoreTarget.focus()
      else focusFirstAppControl()
      restoreFocusRef.current = null
    }
  }, [current])

  if (!current) return null

  const dismiss = () => { setCurrent(null); setError(null) }
  const markCurrentRead = async () => {
    if (marking) return
    setMarking(true)
    setError(null)
    try {
      if (userId) {
        const payload = await apiJson<UserAnnouncementsResponse>('/api/user/announcements', {
          method: 'PATCH', json: { announcement_id: current.id, updated_at: current.updated_at },
        })
        if (currentUserRef.current !== userId) return
        await updateUserAnnouncementQueries(client, userId, payload)
        if (currentUserRef.current !== userId) return
        if (typeof payload.unread_count === 'number') onUnreadCountChange?.(payload.unread_count)
      } else markAnnouncementRead(current)
      void reportAnnouncementEvent('announcement_read', current, 'popup_read')
      dismiss()
    } catch (cause) {
      if (currentUserRef.current === userId) setError(getApiErrorMessage(cause, copy.public.announcement_popup_read_failed))
    } finally {
      if (currentUserRef.current === userId) setMarking(false)
    }
  }

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault()
    dismiss()
  }

  return (
    <dialog ref={dialogRef} aria-labelledby="announcement-popup-title" aria-describedby="announcement-popup-body" aria-modal="true"
      onCancel={handleCancel} className="m-auto max-h-[calc(100dvh-4rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto border-0 bg-transparent p-0 text-left backdrop:bg-black/55">
      <section className="tool-panel w-full max-w-lg p-5 text-left shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="tool-eyebrow">{copy.public.components_AnnouncementPopup_001}</p>
            <h2 id="announcement-popup-title" className="mt-1 break-words text-lg font-semibold text-ink-primary">{current.title}</h2>
          </div>
          <Link to={announcementsPath} onClick={dismiss} className="tool-secondary-action shrink-0 whitespace-nowrap px-3 text-sm">
            {copy.public.components_AnnouncementPopup_002}
          </Link>
        </div>
        <AnnouncementMarkdown id="announcement-popup-body" className="mt-4" onInternalNavigate={dismiss}>{current.body}</AnnouncementMarkdown>
        {error && <p className="tool-alert tool-alert--error mt-4" role="alert">{error}</p>}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button ref={initialFocusRef} type="button" onClick={dismiss} className="tool-secondary-action whitespace-nowrap">{copy.public.announcement_popup_later}</button>
          <button type="button" onClick={() => void markCurrentRead()} disabled={marking} aria-busy={marking} className="tool-primary-action whitespace-nowrap">
            {marking ? copy.public.announcement_popup_marking : copy.public.components_AnnouncementPopup_003}
          </button>
        </div>
      </section>
    </dialog>
  )
}

function hasShownThisVisit(): boolean {
  try { return window.sessionStorage.getItem(VISIT_SHOWN_KEY) === '1' }
  catch { return visitShownWithoutStorage }
}

function rememberShownThisVisit(): void {
  try { window.sessionStorage.setItem(VISIT_SHOWN_KEY, '1') }
  catch { visitShownWithoutStorage = true }
}

function announcementVersionKey(announcement: Announcement): string {
  return `${announcement.id}:${announcement.updated_at}`
}

function focusFirstAppControl(): void {
  const root = document.getElementById('root')
  const target = Array.from(root?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []).find(isAvailableFocusTarget)
  target?.focus()
}

function isAvailableFocusTarget(element: HTMLElement): boolean {
  if (element.closest('[hidden], [aria-hidden="true"], [inert]') || element.closest('details:not([open])')) return false
  const style = window.getComputedStyle(element)
  return style.display !== 'none' && style.visibility !== 'hidden'
}

function isAnnouncementRead(announcement: Announcement): boolean {
  if (sessionReadVersions.has(announcementVersionKey(announcement))) return true
  try { return window.localStorage.getItem(readKey(announcement)) === announcement.updated_at }
  catch { return false }
}

function markAnnouncementRead(announcement: Announcement): void {
  sessionReadVersions.add(announcementVersionKey(announcement))
  try { window.localStorage.setItem(readKey(announcement), announcement.updated_at) }
  catch { /* Session memory retains the read state when storage is unavailable. */ }
}

async function reportAnnouncementEvent(
  event: 'announcement_impression' | 'announcement_read',
  announcement: Announcement,
  source: 'popup_impression' | 'popup_read',
): Promise<void> {
  try {
    await apiVoid('/api/usage-stats', {
      method: 'POST', keepalive: true,
      json: { event, announcement_id: announcement.id, announcement_kind: announcement.kind, announcement_version: announcement.updated_at, source },
    })
  } catch { /* Existing observation failures must not prevent dismissal. */ }
}

function readKey(announcement: Announcement): string {
  return `${READ_PREFIX}${announcement.id}`
}
