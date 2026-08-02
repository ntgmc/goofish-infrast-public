import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getActiveAnnouncements: vi.fn(),
  getAnnouncementReads: vi.fn(),
  getValidatedJson: vi.fn(),
  markAnnouncementsRead: vi.fn(),
  requireUserSession: vi.fn(),
}))

vi.mock('../storage/user-store', () => ({
  getAnnouncementReads: mocks.getAnnouncementReads,
  markAnnouncementsRead: mocks.markAnnouncementsRead,
}))
vi.mock('../security/request-validation', () => ({ getValidatedJson: mocks.getValidatedJson }))
vi.mock('../security/request-policy', () => ({ requestSchemas: { userAnnouncement: {} } }))
vi.mock('./user-auth', () => ({
  getActiveAnnouncements: mocks.getActiveAnnouncements,
  requireUserSession: mocks.requireUserSession,
  jsonResponse: (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(
    status === 204 ? null : JSON.stringify(body),
    { status, headers: { 'Content-Type': 'application/json', ...headers } },
  ),
}))

import handler from './user-announcements'

const announcement = {
  id: 'announcement-1', kind: 'popup' as const, active: true, title: '公告', body: '正文',
  created_at: '2026-07-31T00:00:00.000Z', updated_at: '2026-07-31T01:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireUserSession.mockResolvedValue({ user: { id: 'user-1' } })
  mocks.getActiveAnnouncements.mockResolvedValue([announcement])
  mocks.getAnnouncementReads.mockResolvedValue([])
  mocks.markAnnouncementsRead.mockResolvedValue(0)
})

describe('user announcements handler', () => {
  it('rejects an inactive or unknown announcement id', async () => {
    mocks.getValidatedJson.mockResolvedValue({ announcement_id: 'missing' })
    const response = await handler(request())
    expect(response.status).toBe(404)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(mocks.markAnnouncementsRead).not.toHaveBeenCalled()
  })

  it('treats an empty mark-all mutation as an idempotent success', async () => {
    mocks.getValidatedJson.mockResolvedValue({ all: true })
    mocks.getActiveAnnouncements.mockResolvedValue([])
    const response = await handler(request())
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ announcements: [], unread_count: 0, updated_count: 0 })
    expect(mocks.markAnnouncementsRead).toHaveBeenCalledWith('user-1', [])
  })

  it('only treats a read row for the current announcement version as read', async () => {
    mocks.getAnnouncementReads.mockResolvedValue([{
      user_id: 'user-1', announcement_id: announcement.id,
      announcement_version: '2026-07-30T01:00:00.000Z', read_at: '2026-07-30T02:00:00.000Z',
    }])
    const response = await handler(new Request('http://localhost/api/user/announcements'))
    await expect(response.json()).resolves.toMatchObject({
      announcements: [{ announcement, read_at: null }],
      unread_count: 1,
    })
  })
})

function request(): Request {
  return new Request('http://localhost/api/user/announcements', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ all: true }),
  })
}
