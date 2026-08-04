import { randomUUID } from 'node:crypto'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPostgresAnnouncementStore } from './announcement-store'
import { closePool, query } from './postgres'
import { migrateDatabaseSchema } from './schema'
import {
  createWebsiteNotificationEvent,
  getLatestWebsiteNotificationCursor,
  listWebsiteNotificationEvents,
  WebsiteNotificationEventConflictError,
  type WebsiteNotificationEventInput,
} from './website-notification-event-store'

let container: PostgreSqlContainer

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  process.env.DATABASE_URL = container.getConnectionUri()
  await migrateDatabaseSchema()
})

afterAll(async () => {
  await closePool()
  if (container) await container.stop()
})

describe('website notification events in PostgreSQL', () => {
  it('commits an announcement document and its publication event atomically', async () => {
    const suffix = randomUUID()
    const store = createPostgresAnnouncementStore(`website-event:${suffix}`)
    const event = announcementEvent(suffix)

    await expect(store.set({ announcements: [{ id: suffix }] }, 0, [suffix], [event])).resolves.toBe(1)
    await expect(store.set({ announcements: [{ id: suffix }] }, 1, [suffix], [event])).resolves.toBe(2)

    const stored = await store.get()
    const events = await query<{ count: string }>(
      'select count(*)::text as count from website_notification_events where event_id = $1',
      [event.id],
    )
    expect(stored).toMatchObject({ revision: 2, data: { announcements: [{ id: suffix }] } })
    expect(events.rows[0]?.count).toBe('1')
  })

  it('rolls back an announcement mutation when its publication event is invalid', async () => {
    const suffix = randomUUID()
    const key = `website-event-rollback:${suffix}`
    const store = createPostgresAnnouncementStore(key)

    await expect(store.set(
      { announcements: [{ id: suffix }] },
      0,
      [suffix],
      [{ ...announcementEvent(suffix), url: 'http://example.test/announcement' }],
    )).rejects.toThrow(/HTTPS/)

    const persisted = await query('select key from announcements where key = $1', [key])
    expect(persisted.rows).toHaveLength(0)
  })

  it('paginates by opaque cursor and rejects conflicting release confirmations', async () => {
    const suffix = randomUUID().slice(0, 8)
    const first = releaseEvent(`2.1.${suffix}`, '第一版')
    const second = releaseEvent(`2.2.${suffix}`, '第二版')
    const firstResult = await createWebsiteNotificationEvent(first)
    await createWebsiteNotificationEvent(second)

    const page = await listWebsiteNotificationEvents(String(BigInt(firstResult.event.sequence) - 1n), 1)
    expect(page.events).toEqual([firstResult.event])
    expect(page.nextCursor).toBe(firstResult.event.sequence)
    expect(page.hasMore).toBe(true)
    expect(BigInt(await getLatestWebsiteNotificationCursor())).toBeGreaterThanOrEqual(BigInt(firstResult.event.sequence))

    await expect(createWebsiteNotificationEvent({ ...first, title: '冲突标题' }))
      .rejects.toBeInstanceOf(WebsiteNotificationEventConflictError)
  })
})

function announcementEvent(suffix: string): WebsiteNotificationEventInput {
  return {
    id: `announcement:${suffix}`,
    type: 'announcement.published',
    title: '公告',
    summary: '摘要',
    url: `https://example.test/#announcement-${suffix}`,
    published_at: '2026-08-04T08:00:00.000Z',
    version: null,
  }
}

function releaseEvent(version: string, title: string): WebsiteNotificationEventInput {
  return {
    id: `release:${version}`,
    type: 'release.published',
    title,
    summary: null,
    url: `https://example.test/changelog#release-${version}`,
    published_at: '2026-08-04T09:00:00.000Z',
    version,
  }
}
