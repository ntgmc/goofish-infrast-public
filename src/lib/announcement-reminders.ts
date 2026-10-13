import type { Announcement } from './types'

export function getAnnouncementReminderState(announcement: Announcement, now = Date.now()): 'none' | 'active' | 'ended' {
  if (announcement.kind !== 'popup' || typeof announcement.popup_until !== 'string') return 'none'
  const deadline = Date.parse(announcement.popup_until)
  if (!Number.isFinite(deadline)) return 'none'
  return deadline <= now ? 'ended' : announcement.active ? 'active' : 'none'
}
