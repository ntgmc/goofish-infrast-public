import { createHash } from 'node:crypto'
import type { PoolClient } from 'pg'
import type { UserAccountRecord, UserGameAccountRecord, UserWorkspaceRecord } from './user-store'
import { emptyWorkspace, insertUserAccountForRegistrationInTransaction } from './user-store'
import { claimCdkRecord, completeCdkRedemption } from './cdk-store'
import { withTransaction } from './postgres'
import { ensureDatabaseSchema } from './schema'
import type { CdkRecord, ProfileCdkRecord } from '../handlers/license-utils'

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

export interface LifetimeVoucherProfileAuthorization {
  cdkKey: string
  codeHash: string
  orderHash: string
}

export function buildLifetimeVoucherProfileAuthorization(operationId: string): LifetimeVoucherProfileAuthorization {
  const normalizedOperationId = operationId.trim().toLowerCase()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalizedOperationId)) {
    throw new Error('Lifetime voucher operation ID must be a UUID.')
  }
  const codeHash = `inventory-lifetime-${normalizedOperationId}`
  return {
    cdkKey: `cdk/${codeHash}.json`,
    codeHash,
    orderHash: `inventory-lifetime-order-${normalizedOperationId}`,
  }
}

export async function createLifetimeVoucherProfileAuthorizationInTransaction(
  client: PoolClient,
  input: {
    operationId: string
    userId: string
    profileId: string
    authorizedAt: string
    operatorCount?: number | null
  },
): Promise<LifetimeVoucherProfileAuthorization> {
  const authorization = buildLifetimeVoucherProfileAuthorization(input.operationId)
  const record: ProfileCdkRecord & {
    authorization_source: 'lifetime_profile_voucher'
    inventory_operation_id: string
  } = {
    version: 2,
    cdk_type: 'profile',
    code_hash: authorization.codeHash,
    permission: 'advanced',
    balance_amount: null,
    status: 'used',
    created_at: input.authorizedAt,
    used_at: input.authorizedAt,
    order_note: 'inventory:lifetime_profile_voucher',
    license_order_hash: authorization.orderHash,
    operator_count: input.operatorCount ?? null,
    config_desc: null,
    account_id: input.userId,
    profile_id: input.profileId,
    authorization_source: 'lifetime_profile_voucher',
    inventory_operation_id: input.operationId,
  }
  await client.query(
    `insert into cdk_records
      (key, code_hash, cdk_type, status, permission, balance_amount, item_code, item_expires_at,
       license_order_hash, record_json, created_at, updated_at)
     values ($1, $2, 'profile', 'used', 'advanced', null, null, null, $3, $4::jsonb, $5, $5)`,
    [authorization.cdkKey, authorization.codeHash, authorization.orderHash, JSON.stringify(record), input.authorizedAt],
  )
  return authorization
}

export async function redeemCdkAtomically<T>(options: {
  key: string
  idempotencyKey?: string | null
  idempotencyScope: string
  requestHash: string
  prepare?: (client: PoolClient) => Promise<void>
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

    await options.prepare?.(client)
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
  await insertUserAccountForRegistrationInTransaction(client, user)
}

export async function updateRegisteredUserCdkInTransaction(
  client: PoolClient,
  user: UserAccountRecord,
): Promise<void> {
  const patch = {
    permission: user.permission,
    cdk_key: user.cdk_key,
    cdk_code_hash: user.cdk_code_hash,
    cdk_order_hash: user.cdk_order_hash,
    updated_at: user.updated_at,
  }
  const updated = await client.query(
    `update user_accounts
        set permission = $3,
            cdk_key = $4,
            cdk_code_hash = $5,
            cdk_order_hash = $6,
            record_json = record_json || $7::jsonb,
            updated_at = $8
      where id = $1 and email = $2`,
    [
      user.id,
      user.email,
      user.permission,
      user.cdk_key,
      user.cdk_code_hash,
      user.cdk_order_hash,
      JSON.stringify(patch),
      user.updated_at,
    ],
  )
  if (updated.rowCount !== 1) throw new Error('Registered user disappeared during CDK redemption.')
}

export async function saveProfileInTransaction(client: PoolClient, profile: UserGameAccountRecord): Promise<void> {
  await client.query(
    `insert into user_game_accounts
      (id,user_id,cdk_key,cdk_code_hash,cdk_order_hash,permission,status,display_name,note,kind,archived_at,record_json,created_at,updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)
     on conflict (id) do update set cdk_key=excluded.cdk_key, cdk_code_hash=excluded.cdk_code_hash,
       cdk_order_hash=excluded.cdk_order_hash, permission=excluded.permission, status=excluded.status, display_name=excluded.display_name,
       note=excluded.note, kind=excluded.kind, archived_at=excluded.archived_at, record_json=excluded.record_json, updated_at=excluded.updated_at`,
    [profile.id, profile.user_id, profile.cdk_key, profile.cdk_code_hash, profile.cdk_order_hash, profile.permission, profile.status,
      profile.display_name, profile.note, profile.kind ?? 'cdk', profile.archived_at ?? null, JSON.stringify(profile), profile.created_at, profile.updated_at],
  )
}

export async function saveWorkspaceInTransaction(client: PoolClient, workspace: UserWorkspaceRecord = emptyWorkspace('')): Promise<void> {
  await client.query(
    `insert into user_profile_workspaces
      (profile_id,operators_json,config_json,elite_overrides_json,last_result_json,record_json,updated_at)
     values ($1,$2::jsonb,$3::jsonb,$4::jsonb,null,$5::jsonb,$6)
     on conflict (profile_id) do nothing`,
    [workspace.profile_id, JSON.stringify(workspace.operators), JSON.stringify(workspace.config), JSON.stringify(workspace.elite_overrides), JSON.stringify(workspace), workspace.updated_at],
  )
}
