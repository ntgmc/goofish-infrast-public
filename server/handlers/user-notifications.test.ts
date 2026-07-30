import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getValidatedJson: vi.fn(),
  listUserNotifications: vi.fn(),
  markAllUserNotificationsRead: vi.fn(),
  markUserNotificationRead: vi.fn(),
  requireUserSession: vi.fn(),
}))

vi.mock('../security/request-validation', () => ({ getValidatedJson: mocks.getValidatedJson }))
vi.mock('../security/request-policy', () => ({ requestSchemas: { userNotification: {} } }))
vi.mock('../storage/notification-store', () => ({
  NotificationError: class NotificationError extends Error {},
  listUserNotifications: mocks.listUserNotifications,
  markAllUserNotificationsRead: mocks.markAllUserNotificationsRead,
  markUserNotificationRead: mocks.markUserNotificationRead,
}))
vi.mock('./user-auth', () => ({
  requireUserSession: mocks.requireUserSession,
  jsonResponse: (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(
    status === 204 ? null : JSON.stringify(body),
    { status, headers: { 'Content-Type': 'application/json', ...headers } },
  ),
}))

import userNotificationsHandler from './user-notifications'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireUserSession.mockResolvedValue({ user: { id: 'user-1' } })
  mocks.listUserNotifications.mockResolvedValue({ notifications: [], unread_count: 0, next_cursor: null })
  mocks.markAllUserNotificationsRead.mockResolvedValue(0)
  mocks.markUserNotificationRead.mockResolvedValue(2)
})

describe('user notifications handler', () => {
  it('requires an authenticated user and prevents caching', async () => {
    mocks.requireUserSession.mockResolvedValue(null)
    const response = await userNotificationsHandler(new Request('http://localhost/api/user/notifications'))
    expect(response.status).toBe(401)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('lists a cursor page for the authenticated user', async () => {
    const response = await userNotificationsHandler(new Request('http://localhost/api/user/notifications?cursor=abc&limit=10'))
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(mocks.listUserNotifications).toHaveBeenCalledWith('user-1', { cursor: 'abc', limit: 10 })
  })

  it('marks one notification or all notifications read', async () => {
    mocks.getValidatedJson.mockResolvedValueOnce({ notification_id: 'notification-1' })
    const one = await userNotificationsHandler(request('PATCH'))
    await expect(one.json()).resolves.toEqual({ unread_count: 2 })
    expect(mocks.markUserNotificationRead).toHaveBeenCalledWith('user-1', 'notification-1')

    mocks.getValidatedJson.mockResolvedValueOnce({ all: true })
    const all = await userNotificationsHandler(request('PATCH'))
    await expect(all.json()).resolves.toEqual({ unread_count: 0 })
    expect(mocks.markAllUserNotificationsRead).toHaveBeenCalledWith('user-1')
  })

  it('rejects unsupported methods', async () => {
    const response = await userNotificationsHandler(request('POST'))
    expect(response.status).toBe(405)
  })
})

function request(method: string): Request {
  return new Request('http://localhost/api/user/notifications', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'PATCH' ? JSON.stringify({ notification_id: 'notification-1' }) : undefined,
  })
}
