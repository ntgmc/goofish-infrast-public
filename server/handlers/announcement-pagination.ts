import type { AnnouncementPageResponse, UserAnnouncementRead } from '../../src/lib/types'

const PAGE_SIZE = 10

export function parseAnnouncementPage(params: URLSearchParams) {
  const rawPage = params.get('page') ?? '1'
  const page = Number(rawPage)
  const announcementId = params.get('announcement_id')
  const unreadOnly = params.get('unread_only')
  if (!/^\d+$/.test(rawPage) || !Number.isSafeInteger(page) || page < 1
    || (announcementId !== null && (!announcementId || announcementId.length > 128))
    || (unreadOnly !== null && unreadOnly !== '0' && unreadOnly !== '1')) return null
  return { page, announcementId, unreadOnly: unreadOnly === '1' }
}

export function paginateAnnouncements(
  items: UserAnnouncementRead[],
  options: NonNullable<ReturnType<typeof parseAnnouncementPage>>,
): AnnouncementPageResponse {
  const visible = items.filter((item) => !options.unreadOnly || (item.announcement.kind === 'popup' && !item.read_at))
    .sort((a, b) => Date.parse(b.announcement.updated_at) - Date.parse(a.announcement.updated_at)
      || a.announcement.id.localeCompare(b.announcement.id))
  const index = options.announcementId ? visible.findIndex((item) => item.announcement.id === options.announcementId) : -1
  const total = visible.length
  const page = index >= 0 ? Math.floor(index / PAGE_SIZE) + 1
    : Math.min(options.page, Math.max(1, Math.ceil(total / PAGE_SIZE)))
  return { announcements: visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), page, pageSize: PAGE_SIZE, total }
}
