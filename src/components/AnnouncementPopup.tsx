import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react'
import { Link } from 'react-router'
import ReactMarkdown from 'react-markdown'
import { useQueryClient } from '@tanstack/react-query'
import { updateUserAnnouncementQueries, useUserAnnouncementsQuery, type UserAnnouncementsResponse } from '../lib/announcement-query'
import type { Announcement } from '../lib/types'
import { apiJson, apiVoid, getApiErrorMessage } from '../lib/api-client'
import { getAnnouncementReminderState, isAnnouncementRead, markAnnouncementRead } from '../lib/announcement-reminders'
import AnnouncementMarkdown from './AnnouncementMarkdown'
import { copy } from '../copy/index'

const VISIT_SHOWN_KEY = 'maa-announcement-popup-shown'
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
  const initialFocusRef = useRef<HTMLHeadingElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
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
    dialog.scrollTop = 0
    if (bodyRef.current) bodyRef.current.scrollTop = 0
    initialFocusRef.current?.focus({ preventScroll: true })

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

  const summary = Array.from(current.body.split(/\r?\n\s*\r?\n/).find((block) => !block.trimStart().startsWith('#')) ?? '').slice(0, 160).join('')
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
      }
      markAnnouncementRead(current)
      void reportAnnouncementEvent('announcement_read', current, 'popup_read')
      dismiss()
    } catch (cause) {
      if (currentUserRef.current === userId) {
        setError(getApiErrorMessage(cause, copy.public.announcement_popup_read_failed))
        if (bodyRef.current) bodyRef.current.scrollTop = 0
      }
    } finally {
      if (currentUserRef.current === userId) setMarking(false)
    }
  }

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault()
    dismiss()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== 'Tab') return
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isAvailableFocusTarget)
    const first = controls[0]
    const last = controls[controls.length - 1]
    const active = document.activeElement
    let target: HTMLElement | undefined
    if (event.shiftKey && (active === first || active === initialFocusRef.current)) target = last
    else if (!event.shiftKey && active === last) target = first
    if (target) {
      event.preventDefault()
      target.focus({ preventScroll: true })
    }
  }

  return (
    <dialog ref={dialogRef} aria-labelledby="announcement-popup-title" aria-describedby={summary ? 'announcement-popup-summary' : undefined} aria-modal="true"
      onCancel={handleCancel} onKeyDown={handleKeyDown} className="m-auto max-h-[calc(100dvh-24px)] w-[calc(100%-24px)] max-w-lg overflow-hidden border-0 bg-transparent p-0 text-left backdrop:bg-black/55">
      <section className="tool-panel flex max-h-[calc(100dvh-24px)] w-full max-w-lg flex-col p-4 text-left shadow-xl sm:p-5">
        <div className="shrink-0">
          <Link to={announcementsPath} onClick={dismiss} className="tool-eyebrow inline-flex min-h-[44px] items-center underline underline-offset-4">
            {copy.public.components_AnnouncementPopup_002}
          </Link>
          <h2 ref={initialFocusRef} id="announcement-popup-title" tabIndex={-1} className="mt-2 break-words text-lg font-semibold text-ink-primary outline-none">{current.title}</h2>
        </div>
        {summary && <p id="announcement-popup-summary" className="mt-3 line-clamp-2 shrink-0 text-sm leading-6 text-ink-secondary"><ReactMarkdown allowedElements={[]} unwrapDisallowed skipHtml>{summary}</ReactMarkdown></p>}
        <div ref={bodyRef} role="region" aria-labelledby="announcement-popup-title" tabIndex={0} className="mt-4 min-h-0 overflow-y-auto overscroll-contain border-y border-surface-3 py-3 focus-visible:outline-2 focus-visible:outline-brand-500">
          {error && <p className="tool-alert tool-alert--error mb-4" role="alert">{error}</p>}
          <AnnouncementMarkdown id="announcement-popup-body" onInternalNavigate={dismiss}>{current.body}</AnnouncementMarkdown>
        </div>
        <div className="mt-4 grid shrink-0 grid-cols-2 gap-2">
          <button type="button" onClick={dismiss} className="tool-secondary-action whitespace-normal px-3">{copy.public.announcement_popup_later}</button>
          <button type="button" onClick={() => void markCurrentRead()} disabled={marking} aria-busy={marking} className="tool-primary-action whitespace-normal px-3">
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
