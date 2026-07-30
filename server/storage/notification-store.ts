import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import type {
  UserNotification,
  UserNotificationItemGrantDetail,
  UserNotificationPage,
} from '../../src/lib/types'
import { notificationsCopy } from '../../src/copy/zh-CN/notifications'
import { ensureDatabaseSchema } from './schema'
import { query } from './postgres'

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 50

type InternalItemGrantDetail = UserNotificationItemGrantDetail & { grant_ids: string[] }
type InternalItemGrantPayload = { kind: 'item_grant'; items: InternalItemGrantDetail[] }

type StoredNotification = {
  id: string
  type: string
  title: string
  body: string
  action_kind: string | null
  payload_json: unknown
  read_at: string | null
  created_at: string
  updated_at: string
}

export class NotificationError extends Error {
  constructor(readonly code: string, message: string, readonly status: 400 | 404) {
    super(message)
    this.name = 'NotificationError'
  }
}

let schemaReady: Promise<void> | null = null

export async function upsertItemGrantNotificationInTransaction(client: PoolClient, input: {
  userId: string
  grantId: string
  sourceType: string
  sourceId: string
  itemCode: string
  itemName: string
  iconKey: string
  quantity: number
  expiresAt: string | null
  now: string
}): Promise<void> {
  const item: InternalItemGrantDetail = {
    item_code: input.itemCode,
    name: input.itemName,
    icon_key: input.iconKey,
    quantity: input.quantity,
    expires_at: input.expiresAt,
    grant_ids: [input.grantId],
  }
  const payload: InternalItemGrantPayload = { kind: 'item_grant', items: [item] }
  const inserted = await client.query<{ id: string }>(
    `insert into user_notifications
      (id, user_id, type, source_type, source_id, title, body, action_kind, payload_json, read_at, created_at, updated_at)
     values ($1, $2, 'item_grant', $3, $4, $5, $6, 'inventory', $7::jsonb, null, $8, $8)
     on conflict (user_id, type, source_type, source_id) do nothing
     returning id`,
    [randomUUID(), input.userId, input.sourceType, input.sourceId, notificationsCopy.itemGrantTitle,
      itemGrantBody(payload.items), JSON.stringify(payload), input.now],
  )
  if (inserted.rowCount) return

  const existing = await client.query<{ id: string; payload_json: unknown }>(
    `select id, payload_json from user_notifications
      where user_id = $1 and type = 'item_grant' and source_type = $2 and source_id = $3
      for update`,
    [input.userId, input.sourceType, input.sourceId],
  )
  const row = existing.rows[0]
  if (!row) throw new Error('Expected an existing item grant notification after a uniqueness conflict.')
  const current = normalizeInternalPayload(row.payload_json)
  if (current.items.some((entry) => entry.grant_ids.includes(input.grantId))) return

  const matching = current.items.find((entry) => (
    entry.item_code === item.item_code && entry.expires_at === item.expires_at
  ))
  if (matching) {
    matching.quantity += item.quantity
    matching.grant_ids.push(input.grantId)
  } else {
    current.items.push(item)
  }
  await client.query(
    `update user_notifications
        set title = $2, body = $3, payload_json = $4::jsonb, read_at = null, updated_at = $5
      where id = $1`,
    [row.id, notificationsCopy.itemGrantTitle, itemGrantBody(current.items), JSON.stringify(current), input.now],
  )
}

export async function listUserNotifications(
  userId: string,
  options: { cursor?: string | null; limit?: number } = {},
): Promise<UserNotificationPage> {
  await ensureSchema()
  const limit = normalizeLimit(options.limit)
  const cursor = decodeCursor(options.cursor)
  const values: unknown[] = [userId, limit + 1]
  const cursorClause = cursor ? 'and (updated_at, id) < ($3::timestamptz, $4::text)' : ''
  if (cursor) values.push(cursor.updatedAt, cursor.id)
  const [notifications, unread] = await Promise.all([
    query<StoredNotification>(
      `select id, type, title, body, action_kind, payload_json, read_at, created_at, updated_at
         from user_notifications
        where user_id = $1 ${cursorClause}
        order by updated_at desc, id desc limit $2`,
      values,
    ),
    query<{ count: string }>(
      'select count(*)::text as count from user_notifications where user_id = $1 and read_at is null',
      [userId],
    ),
  ])
  const rows = notifications.rows.slice(0, limit)
  return {
    notifications: rows.map(toPublicNotification),
    unread_count: Number(unread.rows[0]?.count ?? 0),
    next_cursor: notifications.rows.length > limit && rows.length > 0 ? encodeCursor(rows.at(-1)!) : null,
  }
}

export async function markUserNotificationRead(userId: string, notificationId: string, now = new Date().toISOString()): Promise<number> {
  await ensureSchema()
  const updated = await query(
    `update user_notifications set read_at = coalesce(read_at, $3), updated_at = updated_at
      where id = $1 and user_id = $2 returning id`,
    [notificationId, userId, now],
  )
  if (!updated.rowCount) throw new NotificationError('notification_not_found', notificationsCopy.apiNotFound, 404)
  return countUnread(userId)
}

export async function markAllUserNotificationsRead(userId: string, now = new Date().toISOString()): Promise<number> {
  await ensureSchema()
  await query('update user_notifications set read_at = $2 where user_id = $1 and read_at is null', [userId, now])
  return countUnread(userId)
}

export async function exportUserNotifications(userId: string): Promise<UserNotification[]> {
  await ensureSchema()
  const result = await query<StoredNotification>(
    `select id, type, title, body, action_kind, payload_json, read_at, created_at, updated_at
       from user_notifications where user_id = $1 order by created_at asc, id asc`,
    [userId],
  )
  return result.rows.map(toPublicNotification)
}

function toPublicNotification(row: StoredNotification): UserNotification {
  const payload = normalizeInternalPayload(row.payload_json)
  return {
    id: row.id,
    type: 'item_grant',
    title: row.title,
    body: row.body,
    action: row.action_kind === 'inventory' ? { kind: 'inventory' } : null,
    payload: {
      kind: 'item_grant',
      items: payload.items.map(({ grant_ids: _grantIds, ...item }) => item),
    },
    read_at: row.read_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

function normalizeInternalPayload(value: unknown): InternalItemGrantPayload {
  if (!value || typeof value !== 'object' || !('items' in value) || !Array.isArray(value.items)) {
    return { kind: 'item_grant', items: [] }
  }
  const items = value.items.flatMap((raw): InternalItemGrantDetail[] => {
    if (!raw || typeof raw !== 'object') return []
    const item = raw as Record<string, unknown>
    if (typeof item.item_code !== 'string' || typeof item.name !== 'string' || typeof item.icon_key !== 'string') return []
    if (typeof item.quantity !== 'number' || !Number.isFinite(item.quantity) || item.quantity <= 0) return []
    const expiresAt = typeof item.expires_at === 'string' ? item.expires_at : null
    const grantIds = Array.isArray(item.grant_ids) ? item.grant_ids.filter((id): id is string => typeof id === 'string') : []
    return [{
      item_code: item.item_code,
      name: item.name,
      icon_key: item.icon_key,
      quantity: item.quantity,
      expires_at: expiresAt,
      grant_ids: grantIds,
    }]
  })
  return { kind: 'item_grant', items }
}

function itemGrantBody(items: InternalItemGrantDetail[]): string {
  return items.length === 1
    ? notificationsCopy.itemGrantSingleBody(items[0]!.name, items[0]!.quantity)
    : notificationsCopy.itemGrantMultipleBody(items.length)
}

function normalizeLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_PAGE_SIZE
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new NotificationError('invalid_limit', notificationsCopy.apiInvalidLimit, 400)
  }
  return limit
}

function encodeCursor(row: Pick<StoredNotification, 'updated_at' | 'id'>): string {
  return Buffer.from(JSON.stringify({ updatedAt: row.updated_at, id: row.id }), 'utf8').toString('base64url')
}

function decodeCursor(value: string | null | undefined): { updatedAt: string; id: string } | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>
    if (typeof parsed.updatedAt !== 'string' || Number.isNaN(Date.parse(parsed.updatedAt)) || typeof parsed.id !== 'string' || !parsed.id) {
      throw new Error('invalid cursor')
    }
    return { updatedAt: parsed.updatedAt, id: parsed.id }
  } catch {
    throw new NotificationError('invalid_cursor', notificationsCopy.apiInvalidCursor, 400)
  }
}

async function countUnread(userId: string): Promise<number> {
  const result = await query<{ count: string }>(
    'select count(*)::text as count from user_notifications where user_id = $1 and read_at is null',
    [userId],
  )
  return Number(result.rows[0]?.count ?? 0)
}

function ensureSchema(): Promise<void> {
  schemaReady ??= ensureDatabaseSchema().catch((error) => {
    schemaReady = null
    throw error
  })
  return schemaReady
}
