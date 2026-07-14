import { randomUUID } from 'node:crypto'
import type { FreeScheduleEntitlement } from '../../src/lib/types'
import { hasDatabaseUrl, query, withTransaction } from './postgres'
import { ensureDatabaseSchema } from './schema'

export class ReorderAdmissionError extends Error {
  constructor(readonly code: 'idempotency_conflict' | 'idempotency_in_progress' | 'reorder_check_quota_exceeded', readonly status: 409 | 429, message: string) {
    super(message)
    this.name = 'ReorderAdmissionError'
  }
}

const memoryIdempotency = new Map<string, { requestHash: string; status: 'processing' | 'completed'; response?: unknown }>()
const memoryUsage = new Map<string, number>()

export async function grantStrongReorderBonus(profileId: string, fallback: FreeScheduleEntitlement | null | undefined): Promise<FreeScheduleEntitlement> {
  const now = new Date()
  const month = shanghaiMonthKey(now)
  if (!hasDatabaseUrl()) return withStrongBonus(fallback, month, now.toISOString())
  await ensureDatabaseSchema()
  return withTransaction(async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`entitlement:${profileId}`])
    await client.query(
      `insert into profile_entitlements (profile_id, free_revision_count, updated_at)
       values ($1, 0, now()) on conflict (profile_id) do nothing`, [profileId],
    )
    const result = await client.query<{
      first_generated_at: string | null; free_revision_count: number; confirmed_at: string | null; locked_at: string | null; lock_reason: string | null;
      strong_reorder_bonus_month: string | null; strong_reorder_bonus_granted_at: string | null; strong_reorder_bonus_used_at: string | null;
    }>(
      `update profile_entitlements
       set strong_reorder_bonus_month = case when strong_reorder_bonus_month = $2 then strong_reorder_bonus_month else $2 end,
           strong_reorder_bonus_granted_at = case when strong_reorder_bonus_month = $2 then strong_reorder_bonus_granted_at else $3 end,
           strong_reorder_bonus_used_at = case when strong_reorder_bonus_month = $2 then strong_reorder_bonus_used_at else null end,
           updated_at = $3 where profile_id = $1
       returning first_generated_at, free_revision_count, confirmed_at, locked_at, lock_reason,
                 strong_reorder_bonus_month, strong_reorder_bonus_granted_at, strong_reorder_bonus_used_at`,
      [profileId, month, now.toISOString()],
    )
    const row = result.rows[0]
    return {
      first_generated_at: row?.first_generated_at ?? null,
      revision_count: Number(row?.free_revision_count ?? 0),
      revision_limit: 3,
      revision_window_hours: 24,
      confirmed_at: row?.confirmed_at ?? null,
      locked_at: row?.locked_at ?? null,
      lock_reason: row?.lock_reason === 'confirmed' || row?.lock_reason === 'revision_limit' || row?.lock_reason === 'window_expired' ? row.lock_reason : null,
      strong_reorder_bonus: row?.strong_reorder_bonus_month && row.strong_reorder_bonus_granted_at
        ? { month: row.strong_reorder_bonus_month, granted_at: row.strong_reorder_bonus_granted_at, used_at: row.strong_reorder_bonus_used_at }
        : null,
    }
  })
}

export async function beginReorderCheck(input: { profileId: string; idempotencyKey: string; requestHash: string }): Promise<{ replayed: true; response: unknown } | { replayed: false; used: number }> {
  if (!hasDatabaseUrl()) return beginMemoryReorderCheck(input)
  await ensureDatabaseSchema()
  const ownerKey = `reorder:${input.profileId}`
  return withTransaction(async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [ownerKey])
    const duplicate = await client.query<{ request_hash: string; status: string; response_json: unknown | null }>(
      `select request_hash, status, response_json from optimization_idempotency
       where owner_key = $1 and idempotency_key = $2 for update`, [ownerKey, input.idempotencyKey],
    )
    const existing = duplicate.rows[0]
    if (existing) {
      if (existing.request_hash !== input.requestHash) throw new ReorderAdmissionError('idempotency_conflict', 409, 'Idempotency-Key is already used for a different request.')
      if (existing.status === 'completed' && existing.response_json) return { replayed: true, response: existing.response_json }
      throw new ReorderAdmissionError('idempotency_in_progress', 409, '重排检测正在处理中。')
    }
    const month = shanghaiMonthKey(new Date())
    const reserved = await client.query<{ count: string }>(
      `select count(*)::text as count from entitlement_ledger
       where profile_id = $1 and entitlement_type = 'reorder_check' and window_key = $2 and status in ('reserved', 'consumed')`,
      [input.profileId, month],
    )
    const used = Number(reserved.rows[0]?.count ?? 0)
    if (used >= 2) throw new ReorderAdmissionError('reorder_check_quota_exceeded', 429, '本月重排检测次数已用完。')
    const now = new Date().toISOString()
    await client.query(
      `insert into optimization_idempotency (owner_key, idempotency_key, request_hash, status, created_at, updated_at)
       values ($1, $2, $3, 'processing', $4, $4)`, [ownerKey, input.idempotencyKey, input.requestHash, now],
    )
    await client.query(
      `insert into entitlement_ledger (id, profile_id, entitlement_type, status, reference_type, reference_id, window_key, created_at)
       values ($1, $2, 'reorder_check', 'reserved', 'reorder_check', $3, $4, $5)`,
      [randomUUID(), input.profileId, input.idempotencyKey, month, now],
    )
    return { replayed: false, used: used + 1 }
  })
}

export async function completeReorderCheck(profileId: string, idempotencyKey: string, response: unknown): Promise<void> {
  if (!hasDatabaseUrl()) {
    const key = `${profileId}:${idempotencyKey}`
    const current = memoryIdempotency.get(key)
    if (current) memoryIdempotency.set(key, { ...current, status: 'completed', response })
    return
  }
  await ensureDatabaseSchema()
  const ownerKey = `reorder:${profileId}`
  await withTransaction(async (client) => {
    const now = new Date().toISOString()
    await client.query(
      `update entitlement_ledger set status = 'consumed', settled_at = $3
       where profile_id = $1 and entitlement_type = 'reorder_check' and reference_type = 'reorder_check' and reference_id = $2 and status = 'reserved'`,
      [profileId, idempotencyKey, now],
    )
    await client.query(
      `update optimization_idempotency set status = 'completed', response_json = $3::jsonb, updated_at = $4
       where owner_key = $1 and idempotency_key = $2`,
      [ownerKey, idempotencyKey, JSON.stringify(response), now],
    )
  })
}

function beginMemoryReorderCheck(input: { profileId: string; idempotencyKey: string; requestHash: string }): { replayed: true; response: unknown } | { replayed: false; used: number } {
  const key = `${input.profileId}:${input.idempotencyKey}`
  const existing = memoryIdempotency.get(key)
  if (existing) {
    if (existing.requestHash !== input.requestHash) throw new ReorderAdmissionError('idempotency_conflict', 409, 'Idempotency-Key is already used for a different request.')
    if (existing.status === 'completed') return { replayed: true, response: existing.response }
    throw new ReorderAdmissionError('idempotency_in_progress', 409, '重排检测正在处理中。')
  }
  const month = shanghaiMonthKey(new Date())
  const usageKey = `${input.profileId}:${month}`
  const used = memoryUsage.get(usageKey) ?? 0
  if (used >= 2) throw new ReorderAdmissionError('reorder_check_quota_exceeded', 429, '本月重排检测次数已用完。')
  memoryUsage.set(usageKey, used + 1)
  memoryIdempotency.set(key, { requestHash: input.requestHash, status: 'processing' })
  return { replayed: false, used: used + 1 }
}

function shanghaiMonthKey(value: Date): string {
  const shanghai = new Date(value.getTime() + 8 * 60 * 60_000)
  return `${shanghai.getUTCFullYear()}-${String(shanghai.getUTCMonth() + 1).padStart(2, '0')}`
}

function withStrongBonus(value: FreeScheduleEntitlement | null | undefined, month: string, now: string): FreeScheduleEntitlement {
  if (value?.strong_reorder_bonus?.month === month) return value
  return {
    first_generated_at: value?.first_generated_at ?? null,
    revision_count: value?.revision_count ?? 0,
    revision_limit: 3,
    revision_window_hours: 24,
    confirmed_at: value?.confirmed_at ?? null,
    locked_at: value?.locked_at ?? null,
    lock_reason: value?.lock_reason ?? null,
    strong_reorder_bonus: { month, granted_at: now, used_at: null },
  }
}
