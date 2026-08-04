import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticateAdminRequest: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  getAnnouncementEventCounts: vi.fn(),
  getAnnouncementReadCounts: vi.fn(),
  getValidatedJson: vi.fn(),
}))

vi.mock('./admin-auth', () => ({ authenticateAdminRequest: mocks.authenticateAdminRequest }))
vi.mock('../storage/announcement-store', () => ({
  AnnouncementConflictError: class AnnouncementConflictError extends Error {},
  createPostgresAnnouncementStore: () => ({ get: mocks.get, set: mocks.set }),
}))
vi.mock('../storage/usage-store', () => ({ getAnnouncementEventCounts: mocks.getAnnouncementEventCounts }))
vi.mock('../storage/user-store', () => ({ getAnnouncementReadCounts: mocks.getAnnouncementReadCounts }))
vi.mock('../security/request-validation', () => ({ getValidatedJson: mocks.getValidatedJson }))
vi.mock('../security/request-policy', () => ({ requestSchemas: { announcement: {} } }))

import handler from './announcement'
import { AnnouncementConflictError } from '../storage/announcement-store'

const popup = {
  id: 'popup-1', kind: 'popup' as const, active: true, title: '公告', body: '正文',
  created_at: '2026-07-31T00:00:00.000Z', updated_at: '2026-07-31T01:00:00.000Z',
}

const originalPublicAppUrl = process.env.PUBLIC_APP_URL

beforeEach(() => {
  vi.clearAllMocks()
  mocks.authenticateAdminRequest.mockResolvedValue({ ok: true })
  mocks.get.mockResolvedValue({ data: { banner: null, announcements: [popup] }, revision: 3 })
  mocks.set.mockResolvedValue(4)
  mocks.getAnnouncementEventCounts.mockResolvedValue({})
  mocks.getAnnouncementReadCounts.mockResolvedValue({})
  mocks.getValidatedJson.mockResolvedValue({ banner: null, announcements: [popup], expected_revision: 3 })
  process.env.PUBLIC_APP_URL = 'https://example.test'
})

describe('announcement handler', () => {
  it('serves a side-effect-free cacheable public document with an ETag', async () => {
    const response = await handler(new Request('http://localhost/api/announcement'))
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=60, stale-while-revalidate=300')
    expect(response.headers.get('ETag')).toBe('"announcements-3"')
    expect(mocks.set).not.toHaveBeenCalled()
    expect(mocks.getAnnouncementEventCounts).not.toHaveBeenCalled()

    const notModified = await handler(new Request('http://localhost/api/announcement', {
      headers: { 'If-None-Match': '"announcements-3"' },
    }))
    expect(notModified.status).toBe(304)
  })

  it('keeps visitor reads and account reads as separate reach metrics', async () => {
    mocks.getAnnouncementEventCounts.mockResolvedValue({
      'popup-1': { impressions: 5, visitor_reads: 2 },
    })
    mocks.getAnnouncementReadCounts.mockResolvedValue({ 'popup-1': 4 })

    const response = await handler(new Request('http://localhost/api/admin/announcement'))
    await expect(response.json()).resolves.toMatchObject({
      stats: {
        'popup-1': {
          impressions: 5,
          reads: 2,
          visitor_reads: 2,
          server_reads: 4,
          unread: 3,
          read_rate: 40,
        },
      },
    })
  })

  it('conditionally publishes and atomically requests cleanup for deleted announcement ids', async () => {
    const next = { ...popup, id: 'popup-2' }
    mocks.getValidatedJson.mockResolvedValue({ banner: null, announcements: [next], expected_revision: 3 })
    const response = await handler(new Request('http://localhost/api/admin/announcement', { method: 'PUT' }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      revision: 4,
      announcements: [{ id: 'popup-2', title: '公告', updated_at: expect.any(String) }],
    })
    expect(mocks.set).toHaveBeenCalledWith(
      { banner: null, announcements: [expect.objectContaining({ id: 'popup-2', title: '公告' })] },
      3,
      ['popup-2'],
      [{
        id: 'announcement:popup-2',
        type: 'announcement.published',
        title: '公告',
        summary: '正文',
        url: 'https://example.test/#announcement-popup-2',
        published_at: expect.any(String),
        version: null,
      }],
    )
    expect(mocks.getAnnouncementEventCounts).not.toHaveBeenCalled()
  })

  it('returns the latest document with 409 after a stale conditional publish', async () => {
    mocks.set.mockRejectedValue(new AnnouncementConflictError())
    mocks.get
      .mockResolvedValueOnce({ data: { banner: null, announcements: [popup] }, revision: 3 })
      .mockResolvedValueOnce({ data: { banner: null, announcements: [{ ...popup, title: '新公告' }] }, revision: 4 })
    const response = await handler(new Request('http://localhost/api/admin/announcement', { method: 'PUT' }))
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      code: 'announcement_revision_conflict', revision: 4,
      announcements: [{ title: '新公告' }],
    })
  })
})

afterAll(() => {
  if (originalPublicAppUrl === undefined) delete process.env.PUBLIC_APP_URL
  else process.env.PUBLIC_APP_URL = originalPublicAppUrl
})
