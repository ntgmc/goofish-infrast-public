import type { PoolClient } from 'pg'
import { saveProfileInTransaction } from './cdk-redemption'
import type { UserGameAccountRecord } from './user-store'

export async function lockSklandUidProfilesInTransaction(
  client: PoolClient,
  uid: string,
): Promise<UserGameAccountRecord[]> {
  await client.query(
    "select pg_advisory_xact_lock(hashtextextended('skland-uid:' || $1, 0))",
    [uid],
  )
  const profiles = await client.query<{ record_json: UserGameAccountRecord }>(
    `select record_json from user_game_accounts
      where record_json->'skland_binding'->>'uid' = $1
      order by created_at asc
      for update`,
    [uid],
  )
  return profiles.rows.map((row) => row.record_json)
}

export async function recordSklandUidMismatchInTransaction(
  client: PoolClient,
  input: {
    userId: string
    profileId: string
    uid: string
    nickname: string
    freezeThreshold: number
    now: string
  },
): Promise<UserGameAccountRecord | null> {
  const locked = await client.query<{ record_json: UserGameAccountRecord }>(
    'select record_json from user_game_accounts where id = $1 and user_id = $2 for update',
    [input.profileId, input.userId],
  )
  const current = locked.rows[0]?.record_json
  if (!current) return null
  const mismatchCount = (current.skland_risk?.uid_mismatch_count ?? 0) + 1
  const next: UserGameAccountRecord = {
    ...current,
    status: mismatchCount >= input.freezeThreshold ? 'frozen' : current.status,
    skland_pending_binding: null,
    skland_risk: {
      uid_mismatch_count: mismatchCount,
      last_mismatch_uid: input.uid,
      last_mismatch_nickname: input.nickname,
      last_mismatch_at: input.now,
    },
    updated_at: input.now,
  }
  await saveProfileInTransaction(client, next)
  return next
}
