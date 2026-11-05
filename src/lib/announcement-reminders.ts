import type { Announcement } from './types'

const READ_PREFIX = 'maa-announcement-read:'
const sessionReadVersions = new Set<string>()

export function getAnnouncementReminderState(announcement: Announcement, now = Date.now()): 'none' | 'active' | 'ended' {
  if (announcement.kind !== 'popup' || typeof announcement.popup_until !== 'string') return 'none'
  const deadline = Date.parse(announcement.popup_until)
  if (!Number.isFinite(deadline)) return 'none'
  return deadline <= now ? 'ended' : announcement.active ? 'active' : 'none'
}

export function isAnnouncementRead(announcement: Announcement): boolean {
  if (sessionReadVersions.has(`${announcement.id}:${announcement.updated_at}`)) return true
  try { return window.localStorage.getItem(`${READ_PREFIX}${announcement.id}`) === announcement.updated_at }
  catch { return false }
}

export function markAnnouncementRead(announcement: Announcement): void {
  sessionReadVersions.add(`${announcement.id}:${announcement.updated_at}`)
  try { window.localStorage.setItem(`${READ_PREFIX}${announcement.id}`, announcement.updated_at) }
  catch { /* Session memory retains the read state when storage is unavailable. */ }
}
