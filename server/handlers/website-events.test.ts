import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getLatestWebsiteNotificationCursor: vi.fn(),
  listWebsiteNotificationEvents: vi.fn(),
  reservePersistentRateLimit: vi.fn(),
  retain: vi.fn(),
}))

vi.mock('../storage/website-notification-event-store', async (importOriginal) => ({
  ...await importOriginal<typeof import('../storage/website-notification-event-store')>(),
  getLatestWebsiteNotificationCursor: mocks.getLatestWebsiteNotificationCursor,
  listWebsiteNotificationEvents: mocks.listWebsiteNotificationEvents,
}))
vi.mock('../security/persistent-rate-limit', async (importOriginal) => ({
  ...await importOriginal<typeof import('../security/persistent-rate-limit')>(),
  reservePersistentRateLimit: mocks.reservePersistentRateLimit,
}))

import handler from './website-events'

const originalToken = process.env.WEBSITE_EVENTS_TOKEN
const originalReleaseToken = process.env.WEBSITE_RELEASE_CONFIRMATION_TOKEN
const token = 'event-feed-token-that-is-at-least-32-bytes'
const releaseToken = 'release-confirmation-token-at-least-32-bytes'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.WEBSITE_EVENTS_TOKEN = token
  process.env.WEBSITE_RELEASE_CONFIRMATION_TOKEN = releaseToken
  mocks.reservePersistentRateLimit.mockResolvedValue({
    allowed: true,
    attempt: { retain: mocks.retain, refund: vi.fn() },
  })
  mocks.getLatestWebsiteNotificationCursor.mockResolvedValue('842')
  mocks.listWebsiteNotificationEvents.mockResolvedValue({ events: [], nextCursor: '842', hasMore: false })
})

afterEach(() => {
  if (originalToken === undefined) delete process.env.WEBSITE_EVENTS_TOKEN
  else process.env.WEBSITE_EVENTS_TOKEN = originalToken
  if (originalReleaseToken === undefined) delete process.env.WEBSITE_RELEASE_CONFIRMATION_TOKEN
  else process.env.WEBSITE_RELEASE_CONFIRMATION_TOKEN = originalReleaseToken
})

describe('website event feed handler', () => {
  it('returns the same generic 401 for a missing or incorrect bearer token', async () => {
    for (const authorization of [null, 'Bearer incorrect-token']) {
      const response = await handler(request('latest', authorization))
      expect(response.status).toBe(401)
      expect(response.headers.get('WWW-Authenticate')).toBe('Bearer')
      await expect(response.json()).resolves.toEqual({ error: 'Unauthorized', code: 'unauthorized' })
    }
    expect(mocks.getLatestWebsiteNotificationCursor).not.toHaveBeenCalled()
  })

  it('returns 403 when a valid release-only token is used on the read feed', async () => {
    const response = await handler(request('latest', `Bearer ${releaseToken}`))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden', code: 'forbidden' })
    expect(mocks.getLatestWebsiteNotificationCursor).not.toHaveBeenCalled()
  })

  it('registers a first consumer at the current high-water cursor', async () => {
    const response = await handler(request('latest'))

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    await expect(response.json()).resolves.toEqual({
      schema_version: 1,
      events: [],
      next_cursor: '842',
      has_more: false,
    })
    expect(mocks.retain).toHaveBeenCalledOnce()
  })

  it('returns validated events without exposing their internal sequence field', async () => {
    mocks.listWebsiteNotificationEvents.mockResolvedValue({
      events: [{
        sequence: '843',
        id: 'announcement:1',
        type: 'announcement.published',
        title: '公告',
        summary: null,
        url: 'https://example.test/#announcement-1',
        published_at: '2026-08-04T08:00:00.000Z',
        version: null,
      }],
      nextCursor: '843',
      hasMore: true,
    })

    const response = await handler(request('842', undefined, '&limit=1'))

    expect(mocks.listWebsiteNotificationEvents).toHaveBeenCalledWith('842', 1)
    const body = await response.json()
    expect(body.events[0]).not.toHaveProperty('sequence')
    expect(body).toMatchObject({ next_cursor: '843', has_more: true })
  })

  it('rejects invalid cursors and limits without querying the feed', async () => {
    const invalidCursor = await handler(request('01'))
    expect(invalidCursor.status).toBe(400)
    await expect(invalidCursor.json()).resolves.toMatchObject({ code: 'invalid_cursor' })

    const invalidLimit = await handler(request('0', undefined, '&limit=101'))
    expect(invalidLimit.status).toBe(400)
    await expect(invalidLimit.json()).resolves.toMatchObject({ code: 'invalid_limit' })
    expect(mocks.listWebsiteNotificationEvents).not.toHaveBeenCalled()
  })

  it('returns Retry-After when the persistent rate limit is exceeded', async () => {
    mocks.reservePersistentRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 17 })

    const response = await handler(request('842'))

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('17')
    await expect(response.json()).resolves.toMatchObject({ code: 'rate_limited' })
  })
})

function request(cursor: string, authorization: string | null = `Bearer ${token}`, suffix = ''): Request {
  return new Request(`https://example.test/api/integrations/qqbot/events?cursor=${cursor}${suffix}`, {
    headers: authorization ? { Authorization: authorization } : {},
  })
}
