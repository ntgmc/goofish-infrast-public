import type { UserAnnouncementRead } from '../../src/lib/types'
import { getAnnouncementReads, markAnnouncementsRead } from '../storage/user-store'
import { getActiveAnnouncements, jsonResponse, requireUserSession } from './user-auth'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson } from '../security/request-validation'
import { paginateAnnouncements, parseAnnouncementPage } from './announcement-pagination'

export default async (req: Request): Promise<Response> => {

  try {
    const auth = await requireUserSession(req)
    if (!auth) return jsonResponse({ error: '请先登录。' }, 401, noStore())
    const params = new URL(req.url).searchParams
    const paginated = params.has('page') || params.has('announcement_id') || params.has('unread_only')
    const options = parseAnnouncementPage(params)
    if (paginated && !options) return jsonResponse({ error: 'Invalid announcement page' }, 400, noStore())
    const payload = async () => {
      const data = await buildAnnouncementPayload(auth.user.id, paginated)
      return paginated && options
        ? { ...paginateAnnouncements(data.announcements, options), unread_count: data.unread_count }
        : data
    }

    if (req.method === 'GET') {
      return jsonResponse(await payload(), 200, noStore())
    }

    if (req.method === 'PATCH') {
      const body = await getValidatedJson(req, requestSchemas.userAnnouncement)
      const announcements = await getActiveAnnouncements()
      const selected = 'all' in body
        ? announcements
        : announcements.filter((announcement) => announcement.id === body.announcement_id)
      if (!('all' in body) && selected.length === 0) {
        return jsonResponse({ error: '公告不存在或已停用。' }, 404, noStore())
      }
      if (!('all' in body) && selected.some((item) => Date.parse(item.updated_at) !== Date.parse(body.updated_at))) {
        return jsonResponse({ error: '公告内容已更新，请刷新后阅读。', code: 'announcement_version_conflict' }, 409, noStore())
      }
      const updatedCount = await markAnnouncementsRead(auth.user.id, selected)
      return jsonResponse({
        ...await payload(),
        updated_count: updatedCount,
      }, 200, noStore())
    }

    return jsonResponse({ error: 'Method not allowed' }, 405, noStore())
  } catch (error) {
    console.error('user announcements error:', error)
    return jsonResponse({ error: 'Internal server error' }, 500, noStore())
  }
}

async function buildAnnouncementPayload(userId: string, includeBanner = false): Promise<{ announcements: UserAnnouncementRead[]; unread_count: number }> {
  const [announcements, reads] = await Promise.all([getActiveAnnouncements(includeBanner), getAnnouncementReads(userId)])
  const readMap = new Map(reads.map((read) => [
    announcementReadVersionKey(read.announcement_id, read.announcement_version),
    read.read_at,
  ]))
  const items = announcements.map((announcement) => ({
    announcement,
    read_at: readMap.get(announcementReadVersionKey(announcement.id, announcement.updated_at)) ?? null,
  }))
  return {
    announcements: items,
    unread_count: items.filter((item) => item.announcement.kind === 'popup' && !item.read_at).length,
  }
}

function announcementReadVersionKey(announcementId: string, version: string | Date | null): string {
  if (!version) return `${announcementId}:unversioned`
  const timestamp = version instanceof Date ? version.getTime() : Date.parse(version)
  return `${announcementId}:${Number.isFinite(timestamp) ? timestamp : 'invalid'}`
}

function noStore(): Record<string, string> {
  return { 'Cache-Control': 'no-store' }
}
