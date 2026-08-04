import type { FreeScheduleEntitlement } from '../../src/lib/types'
import { hasDatabaseUrl, withTransaction } from './postgres'
import { ensureDatabaseSchema } from './schema'
import { getShanghaiMonthKey } from '../reorder-check-policy'
import {
  emptyWorkspace,
  updateProfileWorkspaceAtomically,
  updateProfileWorkspaceInTransaction,
  type UserWorkspaceRecord,
} from './user-store'
import {
  getProfileOptimizationResult,
  getProfileOptimizationResultWithClient,
} from './optimization-result-store'

type FreeScheduleEntitlementRow = {
  first_generated_at: string | Date | null
  free_revision_count: number
  confirmed_at: string | Date | null
  locked_at: string | Date | null
  lock_reason: string | null
  strong_reorder_bonus_month: string | null
  strong_reorder_bonus_granted_at: string | Date | null
  strong_reorder_bonus_used_at: string | Date | null
}

export async function getFreeScheduleEntitlement(
  profileId: string,
  fallback: FreeScheduleEntitlement | null | undefined,
): Promise<FreeScheduleEntitlement | null> {
  if (!hasDatabaseUrl()) return fallback ?? null
  await ensureDatabaseSchema()
  return withTransaction(async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`entitlement:${profileId}`])
    await client.query(
      `insert into profile_entitlements (profile_id, free_revision_count, updated_at)
       values ($1, 0, now()) on conflict (profile_id) do nothing`,
      [profileId],
    )
    const stale = await client.query<{ revision_count: string; bonus_count: string }>(
      `select
         count(*) filter (where coalesce(job.payload_json #>> '{freeScheduleDecision,mode}', 'revision') <> 'strong_reorder_bonus')::text as revision_count,
         count(*) filter (where job.payload_json #>> '{freeScheduleDecision,mode}' = 'strong_reorder_bonus')::text as bonus_count
       from entitlement_ledger ledger
       join optimize_jobs job on job.id = ledger.reference_id and ledger.reference_type = 'optimization_job'
       where ledger.profile_id = $1 and ledger.entitlement_type = 'free_schedule'
         and ledger.status = 'reserved' and job.status in ('failed', 'cancelled', 'dead_lettered')`,
      [profileId],
    )
    const staleRevisions = Number(stale.rows[0]?.revision_count ?? 0)
    const staleBonuses = Number(stale.rows[0]?.bonus_count ?? 0)
    if (staleRevisions > 0 || staleBonuses > 0) {
      await client.query(
        `update profile_entitlements
         set free_revision_count = greatest(0, free_revision_count - $2),
             first_generated_at = case when greatest(0, free_revision_count - $2) = 0 then null else first_generated_at end,
             locked_at = case when lock_reason = 'revision_limit' and greatest(0, free_revision_count - $2) < 3 then null else locked_at end,
             lock_reason = case when lock_reason = 'revision_limit' and greatest(0, free_revision_count - $2) < 3 then null else lock_reason end,
             strong_reorder_bonus_used_at = case when $3 > 0 then null else strong_reorder_bonus_used_at end,
             updated_at = now()
         where profile_id = $1`,
        [profileId, staleRevisions, staleBonuses],
      )
      await client.query(
        `update entitlement_ledger ledger set status = 'released', settled_at = now()
         from optimize_jobs job
         where ledger.profile_id = $1 and ledger.entitlement_type = 'free_schedule'
           and ledger.status = 'reserved' and ledger.reference_type = 'optimization_job'
           and job.id = ledger.reference_id and job.status in ('failed', 'cancelled', 'dead_lettered')`,
        [profileId],
      )
    }
    const result = await client.query<FreeScheduleEntitlementRow>(
      `select first_generated_at, free_revision_count, confirmed_at, locked_at, lock_reason,
              strong_reorder_bonus_month, strong_reorder_bonus_granted_at, strong_reorder_bonus_used_at
       from profile_entitlements where profile_id = $1`,
      [profileId],
    )
    return fromFreeScheduleEntitlementRow(result.rows[0])
  })
}

export async function confirmFreeScheduleEntitlement(
  profileId: string,
  resultHistoryId: string,
  now = new Date().toISOString(),
): Promise<UserWorkspaceRecord> {
  if (!hasDatabaseUrl()) {
    const historyItem = await getProfileOptimizationResult(profileId, resultHistoryId)
    if (!historyItem) throw new FreeScheduleConfirmationError('暂无可确认的免费排班方案。', 409)
    return updateProfileWorkspaceAtomically(profileId, (currentWorkspace) => {
      const workspace = currentWorkspace ?? emptyWorkspace(profileId)
      return {
        ...workspace,
        free_schedule_entitlement: confirmedEntitlement(
          workspace.free_schedule_entitlement,
          historyItem.created_at,
          now,
        ),
        updated_at: now,
      }
    })
  }

  await ensureDatabaseSchema()
  return withTransaction(async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`entitlement:${profileId}`])
    const historyItem = await getProfileOptimizationResultWithClient(client, profileId, resultHistoryId)
    if (!historyItem) throw new FreeScheduleConfirmationError('暂无可确认的免费排班方案。', 409)

    await client.query(
      `insert into profile_entitlements (profile_id, free_revision_count, updated_at)
       values ($1, 0, $2) on conflict (profile_id) do nothing`,
      [profileId, now],
    )
    const updated = await client.query<FreeScheduleEntitlementRow>(
      `update profile_entitlements
       set first_generated_at = coalesce(first_generated_at, $2),
           free_revision_count = greatest(free_revision_count, 1),
           confirmed_at = $3,
           locked_at = $3,
           lock_reason = 'confirmed',
           updated_at = $3
       where profile_id = $1
       returning first_generated_at, free_revision_count, confirmed_at, locked_at, lock_reason,
                 strong_reorder_bonus_month, strong_reorder_bonus_granted_at, strong_reorder_bonus_used_at`,
      [profileId, historyItem.created_at, now],
    )
    const entitlement = fromFreeScheduleEntitlementRow(updated.rows[0])
    return updateProfileWorkspaceInTransaction(client, profileId, (currentWorkspace) => ({
      ...(currentWorkspace ?? emptyWorkspace(profileId)),
      free_schedule_entitlement: entitlement,
      updated_at: now,
    }))
  })
}

export class FreeScheduleConfirmationError extends Error {
  constructor(message: string, readonly status: 409) {
    super(message)
    this.name = 'FreeScheduleConfirmationError'
  }
}

export function withStrongReorderBonusFallback(
  value: FreeScheduleEntitlement | null | undefined,
  now = new Date(),
): FreeScheduleEntitlement {
  const month = getShanghaiMonthKey(now)
  if (value?.strong_reorder_bonus?.month === month) return value
  return {
    first_generated_at: value?.first_generated_at ?? null,
    revision_count: value?.revision_count ?? 0,
    revision_limit: 3,
    revision_window_hours: 24,
    confirmed_at: value?.confirmed_at ?? null,
    locked_at: value?.locked_at ?? null,
    lock_reason: value?.lock_reason ?? null,
    strong_reorder_bonus: { month, granted_at: now.toISOString(), used_at: null },
  }
}

function fromFreeScheduleEntitlementRow(row: FreeScheduleEntitlementRow | undefined): FreeScheduleEntitlement {
  return {
    first_generated_at: normalizeTimestamp(row?.first_generated_at),
    revision_count: Number(row?.free_revision_count ?? 0),
    revision_limit: 3,
    revision_window_hours: 24,
    confirmed_at: normalizeTimestamp(row?.confirmed_at),
    locked_at: normalizeTimestamp(row?.locked_at),
    lock_reason: row?.lock_reason === 'confirmed' || row?.lock_reason === 'revision_limit' || row?.lock_reason === 'window_expired' ? row.lock_reason : null,
    strong_reorder_bonus: row?.strong_reorder_bonus_month && row.strong_reorder_bonus_granted_at
      ? {
          month: row.strong_reorder_bonus_month,
          granted_at: normalizeTimestamp(row.strong_reorder_bonus_granted_at)!,
          used_at: normalizeTimestamp(row.strong_reorder_bonus_used_at),
        }
      : null,
  }
}

function confirmedEntitlement(
  value: FreeScheduleEntitlement | null | undefined,
  firstGeneratedAt: string,
  now: string,
): FreeScheduleEntitlement {
  return {
    first_generated_at: value?.first_generated_at ?? firstGeneratedAt,
    revision_count: Math.max(1, Math.floor(Number(value?.revision_count ?? 0))),
    revision_limit: 3,
    revision_window_hours: 24,
    confirmed_at: now,
    locked_at: now,
    lock_reason: 'confirmed',
    strong_reorder_bonus: value?.strong_reorder_bonus ?? null,
  }
}

function normalizeTimestamp(value: string | Date | null | undefined): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : value
}
