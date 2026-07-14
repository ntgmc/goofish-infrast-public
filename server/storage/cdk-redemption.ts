import { createHash } from 'node:crypto'
import type { PoolClient } from 'pg'
import type { UserAccountRecord, UserGameAccountRecord, UserWorkspaceRecord } from './user-store'
import { emptyWorkspace } from './user-store'
import { claimCdkRecord, completeCdkRedemption } from './cdk-store'
import { withTransaction } from './postgres'
import { query } from './postgres'
import { ensureDatabaseSchema } from './schema'
import type { CdkRecord } from '../handlers/license-utils'

export class CdkAlreadyRedeemedError extends Error {}
export class IdempotencyConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IdempotencyConflictError'
  }
}

export function createRequestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export async function hasCompletedIdempotentRedemption(scope: string, idempotencyKey: string, requestHash: string): Promise<boolean> {
  await ensureDatabaseSchema()
  const result = await query<{ request_hash: string; status: string }>(
    `select request_hash, status from cdk_redemption_idempotency where scope = $1 and idempotency_key = $2`,
    [scope, idempotencyKey],
  )
  const row = result.rows[0]
  if (!row) return false
  if (row.request_hash !== requestHash) throw new IdempotencyConflictError('Idempotency-Key is already used for a different request.')
  return row.status === 'completed'
}

export async function redeemCdkAtomically<T>(options: {
  key: string
  idempotencyKey?: string | null
  idempotencyScope: string
  requestHash: string
  complete: (client: PoolClient, record: CdkRecord) => Promise<{ record: CdkRecord; response: T }>
}): Promise<{ response: T; replayed: boolean }> {
  await ensureDatabaseSchema()
  return withTransaction(async (client) => {
    if (options.idempotencyKey) {
      const inserted = await client.query<{ response_json: T }>(
        `insert into cdk_redemption_idempotency
          (scope, idempotency_key, request_hash, status, created_at, updated_at)
         values ($1, $2, $3, 'claiming', now(), now())
         on conflict (scope, idempotency_key) do nothing
         returning response_json`,
        [options.idempotencyScope, options.idempotencyKey, options.requestHash],
      )
      if (inserted.rowCount === 0) {
        const existing = await client.query<{ request_hash: string; status: string; response_json: T | null }>(
          `select request_hash, status, response_json from cdk_redemption_idempotency
           where scope = $1 and idempotency_key = $2 for update`,
          [options.idempotencyScope, options.idempotencyKey],
        )
        const row = existing.rows[0]
        if (!row || row.request_hash !== options.requestHash) throw new IdempotencyConflictError('Idempotency-Key is already used for a different request.')
        if (row.status === 'completed' && row.response_json) return { response: row.response_json, replayed: true }
        throw new CdkAlreadyRedeemedError('CDK redemption is already in progress.')
      }
    }

    const claimed = await claimCdkRecord(client, options.key)
    if (!claimed) throw new CdkAlreadyRedeemedError('CDK has already been used.')
    const completed = await options.complete(client, claimed)
    await completeCdkRedemption(client, options.key, completed.record)
    if (options.idempotencyKey) {
      await client.query(
        `update cdk_redemption_idempotency set status = 'completed', response_json = $3::jsonb, updated_at = now()
         where scope = $1 and idempotency_key = $2`,
        [options.idempotencyScope, options.idempotencyKey, JSON.stringify(completed.response)],
      )
    }
    return { response: completed.response, replayed: false }
  })
}

export async function saveUserAccountInTransaction(client: PoolClient, user: UserAccountRecord): Promise<void> {
  await client.query(
    `insert into user_accounts
      (id, email, password_hash, salt, iterations, permission, status, cdk_key, cdk_code_hash, cdk_order_hash, record_json, created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13)
     on conflict (id) do update set email=excluded.email, password_hash=excluded.password_hash, salt=excluded.salt,
       iterations=excluded.iterations, permission=excluded.permission, status=excluded.status, cdk_key=excluded.cdk_key,
       cdk_code_hash=excluded.cdk_code_hash, cdk_order_hash=excluded.cdk_order_hash, record_json=excluded.record_json, updated_at=excluded.updated_at`,
    [user.id, user.email, user.password_hash, user.salt, user.iterations, user.permission, user.status, user.cdk_key, user.cdk_code_hash, user.cdk_order_hash, JSON.stringify(user), user.created_at, user.updated_at],
  )
}

export async function saveProfileInTransaction(client: PoolClient, profile: UserGameAccountRecord): Promise<void> {
  await client.query(
    `insert into user_game_accounts
      (id,user_id,cdk_key,cdk_code_hash,cdk_order_hash,permission,status,display_name,note,record_json,created_at,updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)
     on conflict (id) do update set cdk_key=excluded.cdk_key, cdk_code_hash=excluded.cdk_code_hash,
       cdk_order_hash=excluded.cdk_order_hash, permission=excluded.permission, status=excluded.status, display_name=excluded.display_name,
       note=excluded.note, record_json=excluded.record_json, updated_at=excluded.updated_at`,
    [profile.id, profile.user_id, profile.cdk_key, profile.cdk_code_hash, profile.cdk_order_hash, profile.permission, profile.status, profile.display_name, profile.note, JSON.stringify(profile), profile.created_at, profile.updated_at],
  )
}

export async function saveWorkspaceInTransaction(client: PoolClient, workspace: UserWorkspaceRecord = emptyWorkspace('')): Promise<void> {
  await client.query(
    `insert into user_profile_workspaces
      (profile_id,operators_json,config_json,elite_overrides_json,last_result_json,record_json,updated_at)
     values ($1,$2::jsonb,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7)
     on conflict (profile_id) do nothing`,
    [workspace.profile_id, JSON.stringify(workspace.operators), JSON.stringify(workspace.config), JSON.stringify(workspace.elite_overrides), JSON.stringify(workspace.last_result), JSON.stringify(workspace), workspace.updated_at],
  )
}
