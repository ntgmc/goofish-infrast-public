import type { PoolClient } from 'pg'
import { query, withTransaction } from './postgres'

type WebsiteNotificationEventType = 'announcement.published' | 'release.published'

export interface WebsiteNotificationEventInput {
  id: string
  type: WebsiteNotificationEventType
  title: string
  summary: string | null
  url: string
  published_at: string
  version: string | null
}

export interface WebsiteNotificationEvent extends WebsiteNotificationEventInput {
  sequence: string
}

export interface WebsiteNotificationEventPage {
  events: WebsiteNotificationEvent[]
  nextCursor: string
  hasMore: boolean
}

export class WebsiteNotificationEventConflictError extends Error {
  constructor(readonly eventId: string) {
    super(`Website notification event ${eventId} conflicts with an existing event.`)
    this.name = 'WebsiteNotificationEventConflictError'
  }
}

interface WebsiteNotificationEventRow {
  sequence: string
  event_id: string
  event_type: WebsiteNotificationEventType
  title: string
  summary: string | null
  url: string
  version: string | null
  published_at: Date | string
}

const EVENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:+._-]{0,127}$/
const MAX_CURSOR = 9_223_372_036_854_775_807n

export async function getLatestWebsiteNotificationCursor(): Promise<string> {
  const result = await query<{ cursor: string }>(
    'select coalesce(max(sequence), 0)::text as cursor from website_notification_events',
  )
  return result.rows[0]?.cursor ?? '0'
}

export async function listWebsiteNotificationEvents(
  cursor: string,
  limit: number,
): Promise<WebsiteNotificationEventPage> {
  assertWebsiteNotificationCursor(cursor)
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError('Website notification event limit must be between 1 and 100.')
  }

  const result = await query<WebsiteNotificationEventRow>(
    `select sequence::text, event_id, event_type, title, summary, url, version, published_at
       from website_notification_events
      where sequence > $1::bigint
      order by sequence asc
      limit $2`,
    [cursor, limit + 1],
  )
  const pageRows = result.rows.slice(0, limit)
  return {
    events: pageRows.map(mapEventRow),
    nextCursor: pageRows.at(-1)?.sequence ?? cursor,
    hasMore: result.rows.length > limit,
  }
}

export async function createWebsiteNotificationEvent(
  event: WebsiteNotificationEventInput,
): Promise<{ created: boolean; event: WebsiteNotificationEvent }> {
  return withTransaction(async (client) => {
    const result = await insertWebsiteNotificationEventInTransaction(client, event, true)
    return { created: result.created, event: result.event }
  })
}

export async function insertWebsiteNotificationEventsInTransaction(
  client: Pick<PoolClient, 'query'>,
  events: readonly WebsiteNotificationEventInput[],
): Promise<void> {
  for (const event of events) {
    await insertWebsiteNotificationEventInTransaction(client, event, false)
  }
}

async function insertWebsiteNotificationEventInTransaction(
  client: Pick<PoolClient, 'query'>,
  rawEvent: WebsiteNotificationEventInput,
  rejectConflict: boolean,
): Promise<{ created: boolean; event: WebsiteNotificationEvent }> {
  const event = normalizeWebsiteNotificationEvent(rawEvent)
  const inserted = await client.query<WebsiteNotificationEventRow>(
    `insert into website_notification_events
       (event_id, event_type, title, summary, url, version, published_at, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, now())
     on conflict (event_id) do nothing
     returning sequence::text, event_id, event_type, title, summary, url, version, published_at`,
    [event.id, event.type, event.title, event.summary, event.url, event.version, event.published_at],
  )
  const insertedRow = inserted.rows[0]
  if (insertedRow) return { created: true, event: mapEventRow(insertedRow) }

  const existing = await client.query<WebsiteNotificationEventRow>(
    `select sequence::text, event_id, event_type, title, summary, url, version, published_at
       from website_notification_events
      where event_id = $1`,
    [event.id],
  )
  const existingEvent = existing.rows[0] ? mapEventRow(existing.rows[0]) : null
  if (!existingEvent) throw new Error('Website notification event conflict could not be resolved.')
  if (rejectConflict && !sameEvent(existingEvent, event)) {
    throw new WebsiteNotificationEventConflictError(event.id)
  }
  return { created: false, event: existingEvent }
}

export function normalizeWebsiteNotificationEvent(
  event: WebsiteNotificationEventInput,
): WebsiteNotificationEventInput {
  const id = event.id.trim()
  const title = event.title.trim()
  const summary = event.summary === null ? null : event.summary.trim()
  const version = event.version === null ? null : event.version.trim()
  if (!EVENT_ID_PATTERN.test(id)) throw new TypeError('Website notification event ID is invalid.')
  if (event.type !== 'announcement.published' && event.type !== 'release.published') {
    throw new TypeError('Website notification event type is invalid.')
  }
  if (!title || title.length > 120 || containsControlCharacters(title)) {
    throw new TypeError('Website notification event title is invalid.')
  }
  if (summary !== null && (summary.length > 500 || containsControlCharacters(summary))) {
    throw new TypeError('Website notification event summary is invalid.')
  }
  let url: URL
  try {
    url = new URL(event.url)
  } catch {
    throw new TypeError('Website notification event URL is invalid.')
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new TypeError('Website notification event URL must use HTTPS without credentials.')
  }
  const publishedAt = new Date(event.published_at)
  if (Number.isNaN(publishedAt.getTime())) {
    throw new TypeError('Website notification event published time is invalid.')
  }
  if (event.type === 'announcement.published' && version !== null) {
    throw new TypeError('Announcement notification events must not include a version.')
  }
  if (event.type === 'release.published' && (!version || version.length > 128)) {
    throw new TypeError('Release notification events require a valid version.')
  }
  return {
    id,
    type: event.type,
    title,
    summary: summary || null,
    url: url.toString(),
    published_at: publishedAt.toISOString(),
    version,
  }
}

export function assertWebsiteNotificationCursor(cursor: string): void {
  if (!/^(0|[1-9]\d*)$/.test(cursor) || BigInt(cursor) > MAX_CURSOR) {
    throw new RangeError('Website notification event cursor is invalid.')
  }
}

function mapEventRow(row: WebsiteNotificationEventRow): WebsiteNotificationEvent {
  const publishedAt = row.published_at instanceof Date
    ? row.published_at.toISOString()
    : new Date(row.published_at).toISOString()
  return {
    sequence: row.sequence,
    id: row.event_id,
    type: row.event_type,
    title: row.title,
    summary: row.summary,
    url: row.url,
    published_at: publishedAt,
    version: row.version,
  }
}

function sameEvent(
  existing: WebsiteNotificationEvent,
  incoming: WebsiteNotificationEventInput,
): boolean {
  return existing.id === incoming.id
    && existing.type === incoming.type
    && existing.title === incoming.title
    && existing.summary === incoming.summary
    && existing.url === incoming.url
    && existing.published_at === incoming.published_at
    && existing.version === incoming.version
}

function containsControlCharacters(value: string): boolean {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)
}
