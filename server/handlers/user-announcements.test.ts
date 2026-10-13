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

  it('rejects confirmation of a version the user did not see', async () => {
    mocks.getValidatedJson.mockResolvedValue({ announcement_id: announcement.id, updated_at: '2026-07-30T01:00:00.000Z' })
    const response = await handler(request())
    expect(response.status).toBe(409)
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

  it('filters unread announcements before paging and reports the full unread count', async () => {
    const items = Array.from({ length: 23 }, (_, index) => ({
      ...announcement, id: `popup-${index}`, updated_at: new Date(Date.UTC(2026, 7, 23 - index)).toISOString(),
    }))
    mocks.getActiveAnnouncements.mockResolvedValue([...items, { ...announcement, id: 'banner', kind: 'banner' }])
    mocks.getAnnouncementReads.mockResolvedValue([{
      announcement_id: items[0].id, announcement_version: items[0].updated_at, read_at: items[0].updated_at,
    }])
    const response = await handler(new Request('http://localhost/api/user/announcements?page=2&unread_only=1'))
    const data = await response.json()
    expect(data).toMatchObject({ page: 2, pageSize: 10, total: 22, unread_count: 22 })
    expect(data.announcements).toHaveLength(10)
    expect(data.announcements[0].announcement.id).toBe('popup-11')
    expect(data.announcements.every((item: { read_at: string | null }) => item.read_at === null)).toBe(true)
    expect(mocks.getActiveAnnouncements).toHaveBeenCalledWith(true)
  })

  it('marks all pages read while returning only the requested page', async () => {
    const items = Array.from({ length: 23 }, (_, index) => ({ ...announcement, id: `popup-${index}` }))
    mocks.getActiveAnnouncements.mockResolvedValue(items)
    mocks.getValidatedJson.mockResolvedValue({ all: true })
    mocks.markAnnouncementsRead.mockImplementation(async () => {
      mocks.getAnnouncementReads.mockResolvedValue(items.map((item) => ({
        announcement_id: item.id, announcement_version: item.updated_at, read_at: item.updated_at,
      })))
      return items.length
    })
    const response = await handler(new Request('http://localhost/api/user/announcements?page=2', { method: 'PATCH' }))
    const data = await response.json()
    expect(mocks.markAnnouncementsRead).toHaveBeenCalledWith('user-1', items)
    expect(data).toMatchObject({ page: 2, total: 23, unread_count: 0, updated_count: 23 })
    expect(data.announcements).toHaveLength(10)
    expect(data.announcements.every((item: { read_at: string | null }) => item.read_at !== null)).toBe(true)
  })

  it('rejects invalid paging before a mutation or read lookup', async () => {
    const response = await handler(new Request('http://localhost/api/user/announcements?page=0', { method: 'PATCH' }))
    expect(response.status).toBe(400)
    expect(mocks.markAnnouncementsRead).not.toHaveBeenCalled()
    expect(mocks.getAnnouncementReads).not.toHaveBeenCalled()
  })
})

function request(): Request {
  return new Request('http://localhost/api/user/announcements', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ all: true }),
  })
}
