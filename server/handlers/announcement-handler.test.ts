import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

afterEach(() => {
  vi.unstubAllEnvs()
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

  it('pages active announcements and resolves a direct link without sending other pages', async () => {
    const items = Array.from({ length: 23 }, (_, index) => ({
      ...popup, id: `popup-${index}`, updated_at: new Date(Date.UTC(2026, 7, 23 - index)).toISOString(),
    }))
    const banner = { ...popup, id: 'banner', kind: 'banner', updated_at: '2026-09-01T00:00:00.000Z' }
    mocks.get.mockResolvedValue({ data: { banner, announcements: [...items, { ...popup, id: 'hidden', active: false }] }, revision: 3 })

    const response = await handler(new Request('http://localhost/api/announcement?page=1'))
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const data = await response.json()
    expect(data).toMatchObject({ page: 1, pageSize: 10, total: 24 })
    expect(data.announcements).toHaveLength(10)
    expect(data.announcements[0].announcement.id).toBe('banner')
    expect(data.popups).toBeUndefined()
    expect(data.banner).toBeUndefined()

    const direct = await handler(new Request('http://localhost/api/announcement?page=1&announcement_id=popup-20'))
    const directData = await direct.json()
    expect(directData).toMatchObject({ page: 3, total: 24 })
    expect(directData.announcements).toHaveLength(4)
    expect(directData.announcements.some((item: { announcement: { id: string } }) => item.announcement.id === 'popup-20')).toBe(true)

    const oversized = await handler(new Request('http://localhost/api/announcement?page=999'))
    await expect(oversized.json()).resolves.toMatchObject({ page: 3 })
  })

  it.each(['page=0', 'page=-1', 'page=1.5', 'page=9007199254740992', 'page=1&announcement_id='])('rejects invalid paging input (%s)', async (query) => {
    const response = await handler(new Request(`http://localhost/api/announcement?${query}`))
    expect(response.status).toBe(400)
    expect(mocks.get).not.toHaveBeenCalled()
  })

  it.each(['banner', 'popup'] as const)('publishes a local %s without a public URL or notification event', async (kind) => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('PUBLIC_APP_URL', undefined)
    const next = { ...popup, id: `${kind}-local`, kind }
    mocks.getValidatedJson.mockResolvedValue({
      banner: kind === 'banner' ? next : null,
      announcements: kind === 'popup' ? [next] : [popup],
      expected_revision: 3,
    })

    const response = await handler(new Request('http://localhost/api/admin/announcement', { method: 'PUT' }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ revision: 4 })
    expect(mocks.set).toHaveBeenCalledWith(expect.any(Object), 3, expect.any(Array), [])
  })

  it('requires a public URL before publishing notification events in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('PUBLIC_APP_URL', undefined)
    mocks.getValidatedJson.mockResolvedValue({ banner: null, announcements: [{ ...popup, id: 'popup-2' }], expected_revision: 3 })

    await expect(handler(new Request('http://localhost/api/admin/announcement', { method: 'PUT' })))
      .rejects.toThrow('PUBLIC_APP_URL is required before publishing website notifications.')
    expect(mocks.set).not.toHaveBeenCalled()
  })

  it.each(['development', 'production'])('conditionally publishes notification events and requests cleanup in %s', async (environment) => {
    vi.stubEnv('NODE_ENV', environment)
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
        url: 'https://example.test/v2?section=announcements#announcement-popup-2',
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
