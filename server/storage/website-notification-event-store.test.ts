import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  transactionQuery: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('./postgres', () => ({
  query: mocks.query,
  withTransaction: mocks.withTransaction,
}))

import {
  assertWebsiteNotificationCursor,
  createWebsiteNotificationEvent,
  getLatestWebsiteNotificationCursor,
  listWebsiteNotificationEvents,
  normalizeWebsiteNotificationEvent,
  WebsiteNotificationEventConflictError,
} from './website-notification-event-store'

const releaseEvent = {
  id: 'release:2.1.0',
  type: 'release.published' as const,
  title: '2.1.0 正式版',
  summary: '新功能',
  url: 'https://example.test/changelog#release-2.1.0',
  published_at: '2026-08-04T08:00:00.000Z',
  version: '2.1.0',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.withTransaction.mockImplementation(async (work) => work({ query: mocks.transactionQuery }))
})

describe('website notification event store', () => {
  it('reads the current high-water cursor without returning historical events', async () => {
    mocks.query.mockResolvedValue({ rows: [{ cursor: '842' }] })

    await expect(getLatestWebsiteNotificationCursor()).resolves.toBe('842')
  })

  it('returns one ordered page and detects a following row in the same query', async () => {
    mocks.query.mockResolvedValue({
      rows: [
        eventRow('841', 'announcement:1', 'announcement.published'),
        eventRow('842', 'release:2.1.0', 'release.published'),
        eventRow('843', 'announcement:2', 'announcement.published'),
      ],
    })

    await expect(listWebsiteNotificationEvents('840', 2)).resolves.toMatchObject({
      events: [{ sequence: '841' }, { sequence: '842' }],
      nextCursor: '842',
      hasMore: true,
    })
    expect(mocks.query).toHaveBeenCalledWith(expect.stringMatching(/order by sequence asc/), ['840', 3])
  })

  it('treats an identical release confirmation as an idempotent replay', async () => {
    mocks.transactionQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [eventRow('842', releaseEvent.id, releaseEvent.type)] })

    await expect(createWebsiteNotificationEvent(releaseEvent)).resolves.toMatchObject({ created: false })
  })

  it('rejects a reused release event ID with different content', async () => {
    mocks.transactionQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [eventRow('842', releaseEvent.id, releaseEvent.type)] })

    await expect(createWebsiteNotificationEvent({ ...releaseEvent, title: '冲突标题' }))
      .rejects.toBeInstanceOf(WebsiteNotificationEventConflictError)
  })

  it('validates opaque decimal cursors and HTTPS event URLs', () => {
    expect(() => assertWebsiteNotificationCursor('01')).toThrow(RangeError)
    expect(() => assertWebsiteNotificationCursor('9223372036854775808')).toThrow(RangeError)
    expect(() => normalizeWebsiteNotificationEvent({ ...releaseEvent, url: 'http://example.test/changelog' }))
      .toThrow(/HTTPS/)
    expect(() => normalizeWebsiteNotificationEvent({
      ...releaseEvent,
      id: 'release:2.1.0+build.1',
      version: '2.1.0+build.1',
    })).not.toThrow()
  })
})

function eventRow(
  sequence: string,
  eventId: string,
  eventType: 'announcement.published' | 'release.published',
) {
  const isRelease = eventType === 'release.published'
  return {
    sequence,
    event_id: eventId,
    event_type: eventType,
    title: isRelease ? releaseEvent.title : '公告',
    summary: isRelease ? releaseEvent.summary : '摘要',
    url: isRelease ? releaseEvent.url : 'https://example.test/#announcement-1',
    version: isRelease ? releaseEvent.version : null,
    published_at: releaseEvent.published_at,
  }
}
