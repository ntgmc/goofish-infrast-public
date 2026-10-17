import type { PoolClient } from 'pg'
import type { SklandResource } from '../../src/lib/skland-snapshot'
import { query } from './postgres'
import { ensureDatabaseSchema as ensureSchema } from './schema'
import type { UserGameAccountRecord } from './user-store'

type SklandSnapshotPart = { data: unknown; fetchedAt: string }
export type SklandSnapshotRecord = {
  game?: SklandSnapshotPart
  inventory?: SklandSnapshotPart
  errors: Partial<Record<SklandResource, string>>
  errorCodes?: Partial<Record<SklandResource, string>>
  lastAttemptAt: string
  retryAt: string | null
}
export type StoredSklandSnapshot = SklandSnapshotRecord & { version: string }

export async function readSklandSnapshot(userId: string, uid: string, client?: Pick<PoolClient, 'query'>): Promise<StoredSklandSnapshot | null> {
  if (!client) await ensureSchema()
  const result = await (client ?? { query }).query<{ record_json: SklandSnapshotRecord; version: string }>(
    "select record_json, version::text from skland_snapshots where user_id = $1 and uid = $2 and record_json->>'schemaVersion' = '1'", [userId, uid],
  )
  const row = result.rows[0]
  return row ? { ...row.record_json, version: row.version } : null
}

// The profile lock serializes publication with credential clearing and binding changes.
export async function saveSklandSnapshot(
  client: Pick<PoolClient, 'query'>, profile: UserGameAccountRecord, snapshot: SklandSnapshotRecord,
): Promise<StoredSklandSnapshot | null> {
  const binding = profile.skland_binding
  if (!binding?.encrypted_cred) return null
  const result = await client.query<{ record_json: SklandSnapshotRecord; version: string }>(
    `with authorized as (
       select id from user_game_accounts where id = $1 and user_id = $2
         and status = 'active' and archived_at is null
         and record_json->'skland_binding'->>'uid' = $3
         and record_json->'skland_binding'->>'encrypted_cred' = $4
         and coalesce(record_json->'skland_binding'->>'credential_status', 'available') = 'available'
       for update
     )
     insert into skland_snapshots (user_id, uid, record_json, updated_at)
       select $2, $3, $5::jsonb, $6::timestamptz from authorized
     on conflict (user_id, uid) do update set record_json = excluded.record_json,
       version = nextval('skland_snapshot_version_seq'), updated_at = excluded.updated_at
     returning record_json, version::text`,
    [profile.id, profile.user_id, binding.uid, binding.encrypted_cred, JSON.stringify({ ...snapshot, schemaVersion: 1 }), snapshot.lastAttemptAt],
  )
  const row = result.rows[0]
  return row ? { ...row.record_json, version: row.version } : null
}
