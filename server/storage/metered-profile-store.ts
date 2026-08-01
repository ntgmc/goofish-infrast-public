import { randomUUID } from 'node:crypto'
import { getCommercialTierSummary, getMeteredBillingPolicy, pointsToMinor } from '../../src/lib/metered-billing'
import type { UserGameAccount } from '../../src/lib/types'
import { ensureDatabaseSchema } from './schema'
import { withTransaction } from './postgres'
import {
  emptyWorkspace,
  getProfileWorkspace,
  toPublicProfile,
  updateProfileWorkspaceInTransaction,
  type UserGameAccountRecord,
} from './user-store'
import { releaseScheduleBalanceInTransaction } from './balance-store'
import {
  recordPersonalUseDeclarationUsageInTransaction,
  requireCurrentPersonalUseAcceptanceInTransaction,
} from './personal-use-declaration-store'

const policy = getMeteredBillingPolicy()

export class MeteredProfileError extends Error {
  constructor(
    readonly code: 'profile_not_found' | 'personal_profile_already_claimed' | 'invalid_conversion'
      | 'commercial_not_eligible' | 'commercial_suspended' | 'active_profile_limit'
      | 'total_profile_limit' | 'profile_archived' | 'profile_active' | 'active_job_exists'
      | 'confirmation_required' | 'invalid_cursor' | 'invalid_limit',
    message: string,
    readonly status: 400 | 404 | 409 | 429,
  ) {
    super(message)
    this.name = 'MeteredProfileError'
  }
}

export interface CommercialProfileLimits {
  active: number
  total: number
  active_limit: number
  total_limit: number
  suspended: boolean
  suspension_reason: string | null
}

export async function createOrConvertMeteredPersonal(input: {
  userId: string
  profileId?: string | null
  displayName?: string
  note?: string
  personalUseClientIp?: string
}): Promise<UserGameAccount> {
  await ensureDatabaseSchema()
  const result = await withTransaction(async (client) => {
    await client.query('select id from user_accounts where id = $1 for update', [input.userId])
    if (input.personalUseClientIp) {
      await requireCurrentPersonalUseAcceptanceInTransaction(client, input.userId)
    }
    const complete = async (profile: UserGameAccountRecord, created: boolean) => {
      if (input.personalUseClientIp) {
        await recordPersonalUseDeclarationUsageInTransaction(client, {
          userId: input.userId,
          profileId: profile.id,
          action: 'metered_personal_create',
          clientIp: input.personalUseClientIp,
        })
      }
      return { profile, created }
    }
    const claimed = await client.query<{ profile_id: string }>(
      'select profile_id from metered_personal_claims where user_id = $1 for update',
      [input.userId],
    )
    if (claimed.rows[0]) {
      const existing = await client.query<{ record_json: UserGameAccountRecord }>(
        'select record_json from user_game_accounts where id = $1 and user_id = $2',
        [claimed.rows[0].profile_id, input.userId],
      )
      if (existing.rows[0]?.record_json.kind === 'metered_personal') {
        await ensureProfileWorkspaceInTransaction(client, existing.rows[0].record_json.id)
        return complete(existing.rows[0].record_json, false)
      }
      throw new MeteredProfileError('personal_profile_already_claimed', '每个账号终身只能创建或转换一个个人按次档案。', 409)
    }

    const now = new Date().toISOString()
    if (input.profileId) {
      const selected = await client.query<{ record_json: UserGameAccountRecord }>(
        'select record_json from user_game_accounts where id = $1 and user_id = $2 for update',
        [input.profileId, input.userId],
      )
      const current = selected.rows[0]?.record_json
      if (!current) throw new MeteredProfileError('profile_not_found', '档案不存在。', 404)
      if (current.kind !== 'free_preview') {
        throw new MeteredProfileError('invalid_conversion', '只能将现有免费档案原地转换为个人按次档案。', 409)
      }
      const profile: UserGameAccountRecord = {
        ...current,
        kind: 'metered_personal',
        permission: 'metered_advanced',
        display_name: normalizeDisplayName(input.displayName) || current.display_name,
        note: normalizeNote(input.note) || current.note,
        archived_at: null,
        updated_at: now,
      }
      await updateProfileInTransaction(client, profile)
      await client.query(
        'insert into metered_personal_claims (user_id, profile_id, claimed_at) values ($1, $2, $3)',
        [input.userId, profile.id, now],
      )
      await ensureProfileWorkspaceInTransaction(client, profile.id)
      return complete(profile, false)
    }

    const existing = await client.query<{ id: string }>(
      "select id from user_game_accounts where user_id = $1 and kind = 'metered_personal' limit 1",
      [input.userId],
    )
    if (existing.rowCount) throw new MeteredProfileError('personal_profile_already_claimed', '每个账号终身只能拥有一个个人按次档案。', 409)
    const profile = createMeteredProfile(input.userId, 'metered_personal', input.displayName || '个人按次档案', input.note, now)
    await insertProfileInTransaction(client, profile)
    await client.query(
      'insert into metered_personal_claims (user_id, profile_id, claimed_at) values ($1, $2, $3)',
      [input.userId, profile.id, now],
    )
    await ensureProfileWorkspaceInTransaction(client, profile.id)
    return complete(profile, true)
  })
  return toPublicProfile(result.profile, await getProfileWorkspace(result.profile.id))
}

export async function listCommercialProfiles(input: {
  userId: string
  state: 'active' | 'archived'
  query?: string | null
  cursor?: string | null
  limit?: number
}): Promise<{ profiles: UserGameAccount[]; next_cursor: string | null; limits: CommercialProfileLimits }> {
  await ensureDatabaseSchema()
  const limit = input.limit ?? 20
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new MeteredProfileError('invalid_limit', '分页数量必须是 1 到 100 的整数。', 400)
  const cursor = decodeCursor(input.cursor)
  const search = input.query?.trim().slice(0, 100) ?? ''
  return withTransaction(async (client) => {
    const values: unknown[] = [input.userId, input.state === 'archived', `%${search}%`, limit + 1]
    let cursorClause = ''
    if (cursor) {
      values.push(cursor.createdAt, cursor.id)
      cursorClause = 'and (created_at, id) < ($5::timestamptz, $6)'
    }
    const rows = await client.query<{ record_json: UserGameAccountRecord; created_at: string; id: string }>(
      `select record_json, created_at, id from user_game_accounts
        where user_id = $1 and kind = 'metered_commercial'
          and (($2::boolean and archived_at is not null) or (not $2::boolean and archived_at is null))
          and ($3 = '%%' or display_name ilike $3 or note ilike $3)
          ${cursorClause}
        order by created_at desc, id desc limit $4`,
      values,
    )
    const page = rows.rows.slice(0, limit)
    return {
      profiles: page.map((row) => toPublicProfile(row.record_json, null)),
      next_cursor: rows.rows.length > limit && page.length ? encodeCursor(page.at(-1)!) : null,
      limits: await getCommercialLimitsInTransaction(client, input.userId),
    }
  })
}

export async function createCommercialProfile(input: {
  userId: string
  displayName?: string
  note?: string
}): Promise<{ profile: UserGameAccount; limits: CommercialProfileLimits }> {
  await ensureDatabaseSchema()
  const record = await withTransaction(async (client) => {
    await lockCommercialAccount(client, input.userId)
    await assertCommercialEligibleInTransaction(client, input.userId)
    const limits = await getCommercialLimitsInTransaction(client, input.userId)
    if (limits.total >= limits.total_limit) throw new MeteredProfileError('total_profile_limit', '商用档案总量已达上限。', 429)
    if (limits.active >= limits.active_limit) throw new MeteredProfileError('active_profile_limit', '活跃商用档案数量已达上限。', 429)
    const now = new Date().toISOString()
    const profile = createMeteredProfile(input.userId, 'metered_commercial', input.displayName || `商用档案 ${limits.total + 1}`, input.note, now)
    await insertProfileInTransaction(client, profile)
    await ensureProfileWorkspaceInTransaction(client, profile.id)
    return profile
  })
  return { profile: toPublicProfile(record, await getProfileWorkspace(record.id)), limits: await getCommercialLimits(record.user_id) }
}

export async function patchCommercialProfile(input: {
  userId: string
  profileId: string
  action: 'update' | 'archive' | 'restore'
  displayName?: string
  note?: string
}): Promise<{ profile: UserGameAccount; limits: CommercialProfileLimits }> {
  await ensureDatabaseSchema()
  const profile = await withTransaction(async (client) => {
    await lockCommercialAccount(client, input.userId)
    const selected = await client.query<{ record_json: UserGameAccountRecord }>(
      "select record_json from user_game_accounts where id = $1 and user_id = $2 and kind = 'metered_commercial' for update",
      [input.profileId, input.userId],
    )
    const current = selected.rows[0]?.record_json
    if (!current) throw new MeteredProfileError('profile_not_found', '商用档案不存在。', 404)
    const now = new Date().toISOString()
    if (input.action === 'archive' && current.archived_at) throw new MeteredProfileError('profile_archived', '档案已经归档。', 409)
    if (input.action === 'restore') {
      if (!current.archived_at) throw new MeteredProfileError('profile_active', '档案当前处于活跃状态。', 409)
      await assertCommercialEligibleInTransaction(client, input.userId)
      const limits = await getCommercialLimitsInTransaction(client, input.userId)
      if (limits.active >= limits.active_limit) throw new MeteredProfileError('active_profile_limit', '活跃商用档案数量已达上限。', 429)
    }
    const updated: UserGameAccountRecord = {
      ...current,
      display_name: normalizeDisplayName(input.displayName) || current.display_name,
      note: input.note === undefined ? current.note : normalizeNote(input.note),
      archived_at: input.action === 'archive' ? now : input.action === 'restore' ? null : current.archived_at ?? null,
      updated_at: now,
    }
    await updateProfileInTransaction(client, updated)
    return updated
  })
  return { profile: toPublicProfile(profile, null), limits: await getCommercialLimits(input.userId) }
}

export async function deleteCommercialProfile(input: {
  userId: string
  profileId: string
  confirmed: boolean
}): Promise<{ deleted: true; limits: CommercialProfileLimits }> {
  if (!input.confirmed) throw new MeteredProfileError('confirmation_required', '永久删除必须显式确认。', 400)
  await ensureDatabaseSchema()
  await withTransaction(async (client) => {
    await lockCommercialAccount(client, input.userId)
    const selected = await client.query(
      "select id from user_game_accounts where id = $1 and user_id = $2 and kind = 'metered_commercial' for update",
      [input.profileId, input.userId],
    )
    if (!selected.rowCount) throw new MeteredProfileError('profile_not_found', '商用档案不存在。', 404)
    const active = await client.query<{ id: string }>(
      "select id from optimize_jobs where profile_id = $1 and status in ('queued', 'running') for update",
      [input.profileId],
    )
    if (active.rowCount) throw new MeteredProfileError('active_job_exists', '档案仍有排队或运行中的任务，不能永久删除。', 409)
    const reservations = await client.query<{ job_id: string }>(
      "select job_id from user_balance_reservations where profile_id = $1 and status = 'reserved' for update",
      [input.profileId],
    )
    for (const reservation of reservations.rows) await releaseScheduleBalanceInTransaction(client, reservation.job_id)
    await client.query('delete from user_balance_reservations where profile_id = $1', [input.profileId])
    await client.query(
      'delete from optimization_dead_letters where job_id in (select id from optimize_jobs where profile_id = $1)',
      [input.profileId],
    )
    await client.query('delete from optimize_jobs where profile_id = $1', [input.profileId])
    await client.query('delete from user_game_accounts where id = $1', [input.profileId])
  })
  return { deleted: true, limits: await getCommercialLimits(input.userId) }
}

export async function getCommercialLimits(userId: string): Promise<CommercialProfileLimits> {
  await ensureDatabaseSchema()
  return withTransaction((client) => getCommercialLimitsInTransaction(client, userId))
}

export async function updateCommercialAccount(input: {
  userId: string
  activeLimit?: number
  totalLimit?: number
  suspended?: boolean
  reason?: string | null
}): Promise<CommercialProfileLimits> {
  await ensureDatabaseSchema()
  await withTransaction(async (client) => {
    await lockCommercialAccount(client, input.userId)
    const current = await client.query<{ active_profile_limit: number; total_profile_limit: number }>(
      'select active_profile_limit, total_profile_limit from commercial_account_limits where user_id = $1 for update',
      [input.userId],
    )
    const active = input.activeLimit ?? current.rows[0]!.active_profile_limit
    const total = input.totalLimit ?? current.rows[0]!.total_profile_limit
    if (!Number.isInteger(active) || !Number.isInteger(total) || active < 1 || total < active || total > 100_000) {
      throw new MeteredProfileError('invalid_limit', '商用档案上限必须为正整数，且总量不得小于活跃量。', 400)
    }
    const now = new Date().toISOString()
    await client.query(
      `update commercial_account_limits set active_profile_limit = $2, total_profile_limit = $3,
              suspended_at = case
                when $4::boolean is null then suspended_at
                when $4::boolean then coalesce(suspended_at, $6::timestamptz)
                else null
              end,
              suspension_reason = case
                when $4::boolean is null then suspension_reason
                when $4::boolean then $5
                else null
              end,
              updated_at = $6
        where user_id = $1`,
      [input.userId, active, total, input.suspended ?? null, input.reason?.trim() || null, now],
    )
  })
  return getCommercialLimits(input.userId)
}

async function lockCommercialAccount(client: import('pg').PoolClient, userId: string): Promise<void> {
  const user = await client.query('select id from user_accounts where id = $1 for update', [userId])
  if (!user.rowCount) throw new MeteredProfileError('commercial_not_eligible', '用户不存在。', 404)
  await client.query(
    `insert into commercial_account_limits
      (user_id, active_profile_limit, total_profile_limit, updated_at)
     values ($1, $2, $3, now()) on conflict (user_id) do nothing`,
    [userId, policy.commercial.default_active_profile_limit, policy.commercial.default_total_profile_limit],
  )
}

async function assertCommercialEligibleInTransaction(client: import('pg').PoolClient, userId: string): Promise<void> {
  const result = await client.query<{
    lifetime_credited: string; qualification_reversed: string; debt: string; suspended_at: string | null;
  }>(
    `select coalesce(b.lifetime_credited, 0)::text as lifetime_credited,
            coalesce(b.qualification_reversed, 0)::text as qualification_reversed,
            coalesce(b.debt, 0)::text as debt, l.suspended_at
       from user_accounts u
       left join user_balance_accounts b on b.user_id = u.id
       left join commercial_account_limits l on l.user_id = u.id
      where u.id = $1`,
    [userId],
  )
  const row = result.rows[0]
  if (row?.suspended_at) throw new MeteredProfileError('commercial_suspended', '商用账户已暂停。', 409)
  const net = pointsToMinor(row?.lifetime_credited ?? '0') - pointsToMinor(row?.qualification_reversed ?? '0')
  const summary = getCommercialTierSummary(`${net / 100n}.${String(net % 100n).padStart(2, '0')}`, row?.debt ?? '0')
  if (!summary.eligible) throw new MeteredProfileError('commercial_not_eligible', '累计获得积分未达到商用门槛或账户存在待追偿。', 409)
}

async function getCommercialLimitsInTransaction(client: import('pg').PoolClient, userId: string): Promise<CommercialProfileLimits> {
  const result = await client.query<{
    active: string; total: string; active_profile_limit: number | null; total_profile_limit: number | null;
    suspended_at: string | null; suspension_reason: string | null;
  }>(
    `select count(p.id) filter (where p.archived_at is null)::text as active,
            count(p.id)::text as total,
            l.active_profile_limit, l.total_profile_limit, l.suspended_at, l.suspension_reason
       from user_accounts u
       left join commercial_account_limits l on l.user_id = u.id
       left join user_game_accounts p on p.user_id = u.id and p.kind = 'metered_commercial'
      where u.id = $1
      group by l.active_profile_limit, l.total_profile_limit, l.suspended_at, l.suspension_reason`,
    [userId],
  )
  const row = result.rows[0]
  return {
    active: Number(row?.active ?? 0), total: Number(row?.total ?? 0),
    active_limit: row?.active_profile_limit ?? policy.commercial.default_active_profile_limit,
    total_limit: row?.total_profile_limit ?? policy.commercial.default_total_profile_limit,
    suspended: Boolean(row?.suspended_at), suspension_reason: row?.suspension_reason ?? null,
  }
}

function createMeteredProfile(
  userId: string,
  kind: 'metered_personal' | 'metered_commercial',
  displayName: string,
  note: string | undefined,
  now: string,
): UserGameAccountRecord {
  return {
    version: 1, id: randomUUID(), user_id: userId, kind,
    cdk_key: null, cdk_code_hash: null, cdk_order_hash: null,
    permission: 'metered_advanced', status: 'active', archived_at: null,
    display_name: normalizeDisplayName(displayName) || (kind === 'metered_personal' ? '个人按次档案' : '商用档案'),
    note: normalizeNote(note), created_at: now, updated_at: now,
  }
}

async function insertProfileInTransaction(client: import('pg').PoolClient, profile: UserGameAccountRecord): Promise<void> {
  await client.query(
    `insert into user_game_accounts
      (id, user_id, cdk_key, cdk_code_hash, cdk_order_hash, permission, status, display_name, note,
       kind, archived_at, record_json, created_at, updated_at)
     values ($1, $2, null, null, null, $3, $4, $5, $6, $7, null, $8::jsonb, $9, $9)`,
    [profile.id, profile.user_id, profile.permission, profile.status, profile.display_name,
      profile.note, profile.kind, JSON.stringify(profile), profile.created_at],
  )
}

async function updateProfileInTransaction(client: import('pg').PoolClient, profile: UserGameAccountRecord): Promise<void> {
  await client.query(
    `update user_game_accounts set kind = $2, permission = $3, status = $4,
            display_name = $5, note = $6, archived_at = $7, record_json = $8::jsonb, updated_at = $9
      where id = $1`,
    [profile.id, profile.kind, profile.permission, profile.status, profile.display_name,
      profile.note, profile.archived_at ?? null, JSON.stringify(profile), profile.updated_at],
  )
}

async function ensureProfileWorkspaceInTransaction(client: import('pg').PoolClient, profileId: string): Promise<void> {
  await updateProfileWorkspaceInTransaction(client, profileId, (workspace) => workspace ?? emptyWorkspace(profileId))
}

function normalizeDisplayName(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 40) : ''
}

function normalizeNote(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 500) : ''
}

function encodeCursor(row: { created_at: string; id: string }): string {
  return Buffer.from(JSON.stringify({ createdAt: row.created_at, id: row.id }), 'utf8').toString('base64url')
}

function decodeCursor(value: string | null | undefined): { createdAt: string; id: string } | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>
    if (typeof parsed.createdAt !== 'string' || Number.isNaN(Date.parse(parsed.createdAt)) || typeof parsed.id !== 'string' || !parsed.id) throw new Error()
    return { createdAt: parsed.createdAt, id: parsed.id }
  } catch {
    throw new MeteredProfileError('invalid_cursor', '商用档案分页游标无效。', 400)
  }
}
