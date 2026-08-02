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

export async function countReorderCheckQuotas(profileIds: string[], windowKey: string): Promise<Map<string, number>> {
  await ensureDatabaseSchema()
  if (profileIds.length === 0) return new Map()
  const result = await query<{ profile_id: string; count: string }>(
    `select profile_id, count(*)::text as count
       from entitlement_ledger
      where profile_id = any($1::text[])
        and entitlement_type = 'reorder_check'
        and window_key = $2
        and status in ('reserved', 'consumed')
      group by profile_id`,
    [profileIds, windowKey],
  )
  return new Map(result.rows.map((row) => [row.profile_id, Number(row.count)]))
}

export async function countReorderCheckQuotaInTransaction(
  client: PoolClient,
  profileId: string,
  windowKey: string,
): Promise<number> {
  const result = await client.query<{ count: string }>(REORDER_QUOTA_COUNT_SQL, [profileId, windowKey])
  return Number(result.rows[0]?.count ?? 0)
}
