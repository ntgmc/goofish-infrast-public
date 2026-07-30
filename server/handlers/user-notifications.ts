import { notificationsCopy } from '../../src/copy/zh-CN/notifications'
import {
  listUserNotifications,
  markAllUserNotificationsRead,
  markUserNotificationRead,
  NotificationError,
} from '../storage/notification-store'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson } from '../security/request-validation'
import { jsonResponse, requireUserSession } from './user-auth'

export default async function userNotificationsHandler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return noStoreJson(null, 204)

  try {
    const auth = await requireUserSession(req)
    if (!auth) return noStoreJson({ error: notificationsCopy.apiLoginRequired }, 401)

    if (req.method === 'GET') {
      const url = new URL(req.url)
      const rawLimit = url.searchParams.get('limit')
      const limit = rawLimit === null ? undefined : Number(rawLimit)
      return noStoreJson(await listUserNotifications(auth.user.id, {
        cursor: url.searchParams.get('cursor'),
        limit,
      }))
    }

    if (req.method === 'PATCH') {
      const body = await getValidatedJson(req, requestSchemas.userNotification)
      const unreadCount = 'all' in body
        ? await markAllUserNotificationsRead(auth.user.id)
        : await markUserNotificationRead(auth.user.id, body.notification_id)
      return noStoreJson({ unread_count: unreadCount })
    }

    return noStoreJson({ error: notificationsCopy.apiMethodNotAllowed }, 405)
  } catch (error) {
    if (error instanceof NotificationError) {
      return noStoreJson({ error: { code: error.code, message: error.message } }, error.status)
    }
    console.error('user notifications error:', error)
    return noStoreJson({ error: notificationsCopy.apiInternalError }, 500)
  }
}

function noStoreJson(body: unknown, status = 200): Response {
  return jsonResponse(body, status, { 'Cache-Control': 'no-store' })
}
