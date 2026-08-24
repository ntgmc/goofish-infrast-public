import {
  assertWebsiteNotificationCursor,
  getLatestWebsiteNotificationCursor,
  listWebsiteNotificationEvents,
} from '../storage/website-notification-event-store'
import {
  authenticateWebsiteIntegrationRequest,
  websiteIntegrationResponse,
} from '../security/website-integration-auth'
import { getRequestClientIp } from '../security/client-ip'
import { RateLimitStoreError, reservePersistentRateLimit } from '../security/persistent-rate-limit'

const EVENT_FEED_RATE_LIMIT = 120
const EVENT_FEED_RATE_LIMIT_WINDOW_MS = 60_000

export default async function websiteEventsHandler(req: Request): Promise<Response> {
  const authentication = authenticateWebsiteIntegrationRequest(req, 'WEBSITE_EVENTS_TOKEN')
  if (!authentication.ok) return authentication.response
  if (req.method !== 'GET') return websiteIntegrationResponse({ error: 'Method not allowed' }, 405)

  try {
    const rateLimit = await reservePersistentRateLimit(
      'website-event-feed',
      getRequestClientIp(req),
      EVENT_FEED_RATE_LIMIT,
      EVENT_FEED_RATE_LIMIT_WINDOW_MS,
    )
    if (!rateLimit.allowed) {
      return websiteIntegrationResponse(
        { error: 'Too many requests', code: 'rate_limited' },
        429,
        { 'Retry-After': String(rateLimit.retryAfterSeconds) },
      )
    }
    rateLimit.attempt.retain()
  } catch (error) {
    if (error instanceof RateLimitStoreError) {
      return websiteIntegrationResponse({ error: 'Service unavailable', code: 'service_unavailable' }, 503)
    }
    throw error
  }

  const url = new URL(req.url)
  const cursor = url.searchParams.get('cursor')
  if (cursor === null || (cursor !== 'latest' && !isValidCursor(cursor))) {
    return websiteIntegrationResponse(
      { error: '活动记录加载位置已失效，请重新打开页面。', code: 'invalid_cursor' },
      400,
    )
  }
  const limit = parseLimit(url.searchParams.get('limit'))
  if (limit === null) {
    return websiteIntegrationResponse(
      { error: '活动记录数量设置无效，请刷新后重试。', code: 'invalid_limit' },
      400,
    )
  }

  try {
    if (cursor === 'latest') {
      return websiteIntegrationResponse({
        schema_version: 1,
        events: [],
        next_cursor: await getLatestWebsiteNotificationCursor(),
        has_more: false,
      })
    }
    const page = await listWebsiteNotificationEvents(cursor, limit)
    return websiteIntegrationResponse({
      schema_version: 1,
      events: page.events.map(({ sequence: _sequence, ...event }) => event),
      next_cursor: page.nextCursor,
      has_more: page.hasMore,
    })
  } catch (error) {
    console.error('website event feed request failed', {
      error_type: error instanceof Error ? error.name : typeof error,
    })
    return websiteIntegrationResponse({ error: 'Service unavailable', code: 'service_unavailable' }, 503)
  }
}

function isValidCursor(cursor: string): boolean {
  try {
    assertWebsiteNotificationCursor(cursor)
    return true
  } catch {
    return false
  }
}

function parseLimit(value: string | null): number | null {
  if (value === null) return 100
  if (!/^(?:[1-9]|[1-9]\d|100)$/.test(value)) return null
  return Number(value)
}
