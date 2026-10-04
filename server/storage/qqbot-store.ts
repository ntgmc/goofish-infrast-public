import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { query, withTransaction } from './postgres'
import { ensureDatabaseSchema } from './schema'
import { getUserById, type UserAccountRecord } from './user-store'

const BINDING_CODE_TTL_MS = 10 * 60_000
let schemaReady: Promise<void> | null = null

type Binding = {
  id: string
  user_id: string
  qq_number: string
  notifications_enabled: boolean
  created_at: string
}

export class QqBotError extends Error {
  constructor(readonly code: string, message: string, readonly status: 400 | 403 | 404 | 409) {
    super(message)
    this.name = 'QqBotError'
  }
}

export async function getUserQqBotBinding(userId: string): Promise<Binding | null> {
  await ensureSchema()
  const result = await query<Binding>('select * from qqbot_account_bindings where user_id = $1', [userId])
  return result.rows[0] ?? null
}

export async function createQqBotBindingCode(userId: string): Promise<{ binding_code: string; expires_at: string }> {
  await ensureSchema()
  const code = randomBytes(18).toString('base64url')
  const expiresAt = new Date(Date.now() + BINDING_CODE_TTL_MS).toISOString()
  await withTransaction(async (client) => {
    await client.query('select id from user_accounts where id = $1 for update', [userId])
    const existing = await client.query('select id from qqbot_account_bindings where user_id = $1', [userId])
    if (existing.rowCount) throw new QqBotError('already_bound', '请先解除当前 QQ 绑定。', 409)
    await client.query(
      `insert into qqbot_binding_codes (user_id, code_hash, expires_at)
       values ($1, $2, $3) on conflict (user_id) do update
       set code_hash = excluded.code_hash, expires_at = excluded.expires_at`,
      [userId, hashCode(code), expiresAt],
    )
  })
  return { binding_code: code, expires_at: expiresAt }
}

export async function bindQqBotAccount(qqNumber: string, code: string): Promise<Binding> {
  await ensureSchema()
  return withTransaction(async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtextextended('qqbot-binding:' || $1, 0))", [qqNumber])
    const token = await client.query<{ user_id: string }>(
      'select user_id from qqbot_binding_codes where code_hash = $1 and expires_at > now()',
      [hashCode(code)],
    )
    const userId = token.rows[0]?.user_id
    if (!userId) throw new QqBotError('binding_code_invalid', '绑定码已失效，请在网站重新生成。', 400)
    const account = await client.query('select id from user_accounts where id = $1 and status = $2 for update', [userId, 'active'])
    if (!account.rowCount) throw new QqBotError('account_unavailable', '网站账号暂时不可用。', 403)
    const consumed = await client.query(
      'delete from qqbot_binding_codes where user_id = $1 and code_hash = $2 and expires_at > now() returning user_id',
      [userId, hashCode(code)],
    )
    if (!consumed.rowCount) throw new QqBotError('binding_code_invalid', '绑定码已失效，请在网站重新生成。', 400)
    const result = await client.query<Binding>(
      `insert into qqbot_account_bindings (id, user_id, qq_number, notifications_enabled, created_at)
       values ($1, $2, $3, false, now()) on conflict do nothing returning *`,
      [randomUUID(), userId, qqNumber],
    )
    if (!result.rows[0]) throw new QqBotError('binding_conflict', 'QQ 或网站账号已绑定，请先解除原绑定。', 409)
    return result.rows[0]
  })
}

export async function getQqBotAccount(qqNumber: string): Promise<{ binding: Binding; user: UserAccountRecord }> {
  await ensureSchema()
  const result = await query<Binding>('select * from qqbot_account_bindings where qq_number = $1', [qqNumber])
  const binding = result.rows[0]
  if (!binding) throw new QqBotError('account_not_bound', '请先在网站生成绑定码，并私聊 bot 完成绑定。', 404)
  const user = await getUserById(binding.user_id)
  if (!user || user.status !== 'active') throw new QqBotError('account_unavailable', '网站账号暂时不可用。', 403)
  return { binding, user }
}

export async function setQqBotNotifications(userId: string, enabled: boolean, bindingId?: string): Promise<Binding> {
  await ensureSchema()
  return withTransaction(async (client) => {
    const result = await client.query<Binding>(
      'update qqbot_account_bindings set notifications_enabled = $2 where user_id = $1 and ($3::text is null or id = $3) returning *',
      [userId, enabled, bindingId ?? null],
    )
    const binding = result.rows[0]
    if (!binding) throw new QqBotError('account_not_bound', '请先绑定 QQ。', 404)
    if (!enabled) await client.query('delete from qqbot_schedule_notifications where binding_id = $1 and delivered_at is null', [binding.id])
    return binding
  })
}

export async function unbindQqBotAccount(userId: string, bindingId?: string): Promise<void> {
  await ensureSchema()
  await withTransaction(async (client) => {
    await client.query('select id from user_accounts where id = $1 for update', [userId])
    const deleted = await client.query('delete from qqbot_account_bindings where user_id = $1 and ($2::text is null or id = $2)', [userId, bindingId ?? null])
    if (bindingId && !deleted.rowCount) throw new QqBotError('binding_changed', 'QQ 绑定已变化，请重新查询。', 409)
    await client.query('delete from qqbot_binding_codes where user_id = $1', [userId])
  })
}

export async function enqueueQqBotScheduleNotificationInTransaction(
  client: PoolClient,
  input: { profileId: string; resultId: string; title: string; now: string },
): Promise<void> {
  await client.query(
    `insert into qqbot_schedule_notifications (id, binding_id, profile_id, result_id, title, created_at)
     select $1, binding.id, profile.id, $3, $4, $5
     from qqbot_account_bindings binding
     join user_game_accounts profile on profile.user_id = binding.user_id
     join user_accounts account on account.id = binding.user_id
     where profile.id = $2 and binding.notifications_enabled and account.status = 'active'
       and profile.status = 'active' and profile.archived_at is null
     for share of binding
     on conflict (binding_id, result_id) do nothing`,
    [randomUUID(), input.profileId, input.resultId, input.title, input.now],
  )
}

export async function listQqBotScheduleNotifications(limit: number, cursor: string | null = null) {
  const after = decodeNotificationCursor(cursor)
  await ensureSchema()
  await query("delete from qqbot_schedule_notifications where created_at < now() - interval '7 days'")
  const result = await query<{
    id: string; binding_id: string; qq_number: string; profile_id: string; profile_name: string
    result_id: string; title: string; created_at: string
  }>(
    `select notification.id, binding.id as binding_id, binding.qq_number, notification.profile_id,
            profile.display_name as profile_name, notification.result_id, notification.title, notification.created_at
     from qqbot_schedule_notifications notification
     join qqbot_account_bindings binding on binding.id = notification.binding_id
     join user_accounts account on account.id = binding.user_id
     join user_game_accounts profile on profile.id = notification.profile_id and profile.user_id = binding.user_id
     where notification.delivered_at is null and binding.notifications_enabled
       and account.status = 'active' and profile.status = 'active' and profile.archived_at is null
       and ($2::timestamptz is null or (notification.created_at, notification.id) > ($2::timestamptz, $3::text))
     order by notification.created_at, notification.id limit $1`,
    [limit + 1, after?.createdAt ?? null, after?.id ?? null],
  )
  const notifications = result.rows.slice(0, limit)
  const hasMore = result.rows.length > limit
  const last = notifications.at(-1)
  return {
    notifications, has_more: hasMore,
    next_cursor: hasMore && last ? Buffer.from(JSON.stringify({
      createdAt: new Date(last.created_at).toISOString(), id: last.id,
    })).toString('base64url') : null,
  }
}

export async function acknowledgeQqBotNotification(qqNumber: string, notificationId: string): Promise<void> {
  const { binding } = await getQqBotAccount(qqNumber)
  const result = await query(
    `update qqbot_schedule_notifications set delivered_at = coalesce(delivered_at, now())
     where id = $1 and binding_id = $2`,
    [notificationId, binding.id],
  )
  if (!result.rowCount) throw new QqBotError('notification_not_found', '通知已失效。', 404)
}

function decodeNotificationCursor(cursor: string | null): { createdAt: string; id: string } | null {
  if (cursor === null) return null
  try {
    if (!cursor || cursor.length > 512) throw new Error('invalid cursor')
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (!value || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))
      || typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.id)) throw new Error('invalid cursor')
    return { createdAt: new Date(value.createdAt).toISOString(), id: value.id }
  } catch {
    throw new QqBotError('invalid_cursor', '通知加载位置无效，请重新加载。', 400)
  }
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

function ensureSchema(): Promise<void> {
  schemaReady ??= ensureDatabaseSchema().catch((error) => { schemaReady = null; throw error })
  return schemaReady
}
