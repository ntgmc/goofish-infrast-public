import type { UserAnnouncementRead } from '../../src/lib/types'
import { getAnnouncementReads, markAnnouncementsRead } from '../storage/user-store'
import { getActiveAnnouncements, jsonResponse, requireUserSession } from './user-auth'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson } from '../security/request-validation'

export default async (req: Request): Promise<Response> => {

  try {
    const auth = await requireUserSession(req)
    if (!auth) return jsonResponse({ error: '请先登录。' }, 401, noStore())

    if (req.method === 'GET') {
      return jsonResponse(await buildAnnouncementPayload(auth.user.id), 200, noStore())
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
      const updatedCount = await markAnnouncementsRead(auth.user.id, selected)
      return jsonResponse({
        ...await buildAnnouncementPayload(auth.user.id),
        updated_count: updatedCount,
      }, 200, noStore())
    }

    return jsonResponse({ error: 'Method not allowed' }, 405, noStore())
  } catch (error) {
    console.error('user announcements error:', error)
    return jsonResponse({ error: 'Internal server error' }, 500, noStore())
  }
}

async function buildAnnouncementPayload(userId: string): Promise<{ announcements: UserAnnouncementRead[]; unread_count: number }> {
  const [announcements, reads] = await Promise.all([getActiveAnnouncements(), getAnnouncementReads(userId)])
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
    unread_count: items.filter((item) => !item.read_at).length,
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
