import type { Context } from '@netlify/functions'
import type { UserAnnouncementRead } from '../../src/lib/types'
import { getAnnouncementReads, markAnnouncementRead } from '../../server/storage/user-store'
import { getActiveAnnouncements, jsonResponse, requireUserSession } from './user-auth'

export default async (req: Request, _context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)

  try {
    const auth = await requireUserSession(req)
    if (!auth) return jsonResponse({ error: '请先登录。' }, 401)

    if (req.method === 'GET') {
      return jsonResponse(await buildAnnouncementPayload(auth.user.id))
    }

    if (req.method === 'PATCH') {
      const body = await req.json() as { announcement_id?: unknown; all?: unknown }
      const announcements = await getActiveAnnouncements()
      const ids = body.all === true
        ? announcements.map((announcement) => announcement.id)
        : typeof body.announcement_id === 'string' && body.announcement_id
          ? [body.announcement_id]
          : []
      if (ids.length === 0) return jsonResponse({ error: '缺少公告 ID。' }, 400)
      for (const id of ids) await markAnnouncementRead(auth.user.id, id)
      return jsonResponse(await buildAnnouncementPayload(auth.user.id))
    }

    return jsonResponse({ error: 'Method not allowed' }, 405)
  } catch (error) {
    console.error('user announcements error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return jsonResponse({ error: message }, 500)
  }
}

async function buildAnnouncementPayload(userId: string): Promise<{ announcements: UserAnnouncementRead[]; unread_count: number }> {
  const [announcements, reads] = await Promise.all([getActiveAnnouncements(), getAnnouncementReads(userId)])
  const readMap = new Map(reads.map((read) => [read.announcement_id, read.read_at]))
  const items = announcements.map((announcement) => ({
    announcement,
    read_at: readMap.get(announcement.id) ?? null,
  }))
  return {
    announcements: items,
    unread_count: items.filter((item) => !item.read_at).length,
  }
}
