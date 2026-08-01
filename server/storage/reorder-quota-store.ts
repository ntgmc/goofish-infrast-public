import type { PoolClient } from 'pg'
import { query } from './postgres'
import { ensureDatabaseSchema } from './schema'

const REORDER_QUOTA_COUNT_SQL = `select count(*)::text as count
  from entitlement_ledger
  where profile_id = $1
    and entitlement_type = 'reorder_check'
    and window_key = $2
    and status in ('reserved', 'consumed')`

export async function countReorderCheckQuota(profileId: string, windowKey: string): Promise<number> {
  await ensureDatabaseSchema()
  const result = await query<{ count: string }>(REORDER_QUOTA_COUNT_SQL, [profileId, windowKey])
  return Number(result.rows[0]?.count ?? 0)
}

export async function countReorderCheckQuotaInTransaction(
  client: PoolClient,
  profileId: string,
  windowKey: string,
): Promise<number> {
  const result = await client.query<{ count: string }>(REORDER_QUOTA_COUNT_SQL, [profileId, windowKey])
  return Number(result.rows[0]?.count ?? 0)
}
