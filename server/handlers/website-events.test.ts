import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SITE_FEATURE_SETTINGS } from '../../src/lib/site-features'

const mocks = vi.hoisted(() => ({
  getLatestWebsiteNotificationCursor: vi.fn(),
  listWebsiteNotificationEvents: vi.fn(),
  reservePersistentRateLimit: vi.fn(),
  retain: vi.fn(),
  getSiteFeatureSettings: vi.fn(),
  routeHandler: vi.fn(),
}))

vi.mock('../storage/feature-settings-store', () => ({ getSiteFeatureSettings: mocks.getSiteFeatureSettings }))
vi.mock('../routes', () => ({ API_ROUTES: [['/api/integrations/qqbot/events', mocks.routeHandler]] }))

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
import { createApiServer } from '../http-server'

const originalToken = process.env.WEBSITE_EVENTS_TOKEN
const originalReleaseToken = process.env.WEBSITE_RELEASE_CONFIRMATION_TOKEN
const token = 'event-feed-token-that-is-at-least-32-bytes'
const releaseToken = 'release-confirmation-token-at-least-32-bytes'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.routeHandler.mockImplementation(handler)
  mocks.getSiteFeatureSettings.mockResolvedValue({
    ...DEFAULT_SITE_FEATURE_SETTINGS,
    features: { ...DEFAULT_SITE_FEATURE_SETTINGS.features, qqbot: false, login: false },
  })
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

  it('serves authenticated events through HTTP with personal QQ closed and honors the independent switch', async () => {
    const server = createApiServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Test server did not expose a TCP address')
      const url = `http://127.0.0.1:${address.port}/api/integrations/qqbot/events?cursor=841`
      expect((await fetch(url)).status).toBe(401)
      expect((await fetch(url, { headers: { Authorization: `Bearer ${releaseToken}` } })).status).toBe(403)
      expect(mocks.listWebsiteNotificationEvents).not.toHaveBeenCalled()

      const headers = { Authorization: `Bearer ${token}` }
      const response = await fetch(url, { headers })
      expect(response.status).toBe(200)
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
      await expect(response.json()).resolves.toMatchObject({ next_cursor: '842' })
      expect(mocks.listWebsiteNotificationEvents).toHaveBeenCalledWith('841', 100)

      mocks.getSiteFeatureSettings.mockResolvedValue({
        ...DEFAULT_SITE_FEATURE_SETTINGS,
        features: { ...DEFAULT_SITE_FEATURE_SETTINGS.features, website_events: false },
      })
      const closed = await fetch(url, { headers })
      expect(closed.status).toBe(503)
      await expect(closed.json()).resolves.toMatchObject({ code: 'feature_disabled', feature: 'website_events' })
      expect(mocks.listWebsiteNotificationEvents).toHaveBeenCalledOnce()
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
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
        summary: '更新 重点',
        markdown: '## 更新\n\n- **重点**\n',
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
    expect(body).toMatchObject({
      events: [{ summary: '更新 重点', markdown: '## 更新\n\n- **重点**\n' }],
      next_cursor: '843', has_more: true,
    })
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
