import { createHash, createHmac } from 'node:crypto'
import type { PoolClient } from 'pg'
import { getPool, query, withTransaction } from './postgres'
import { ensureDatabaseSchema } from './schema'
import { markPersonalUseDeclarationAcceptancesDeleted } from './personal-use-declaration-store'
import type { PasswordAlgorithm, PasswordHashRecord } from '../security/password'
import type {
  LicenseConfig,
  FreeScheduleEntitlement,
  LicenseOperator,
  OptimizeResult,
  PermissionMode,
  SklandCredentialInvalidReason,
  SklandCredentialStatus,
  UserGameAccountKind,
  UserGameAccount,
  UserWorkspace,
  WorkspaceResultHistoryItem,
  WorkspaceSavedConfig,
  FreePreviewTrial,
  TemporaryProfilePermission,
} from '../../src/lib/types'
import {
  WORKSPACE_RESULT_HISTORY_LIMIT,
  WORKSPACE_RESULT_HISTORY_MAX_LIMIT,
  WORKSPACE_SAVED_CONFIG_LIMIT,
  WORKSPACE_SAVED_CONFIG_MAX_LIMIT,
} from '../../src/lib/workspace-limits'

let schemaReady: Promise<void> | null = null

export interface UserAccountRecord {
  version: 1
  id: string
  email: string
  password_hash: string
  salt: string
  iterations: number
  password_algorithm?: PasswordAlgorithm
  permission: PermissionMode
  status: 'active' | 'frozen' | 'revoked' | 'pending_deletion'
  cdk_key: string | null
  cdk_code_hash: string | null
  cdk_order_hash: string | null
  email_verified_at: string | null
  created_at: string
  updated_at: string
}

export interface UserGameAccountRecord {
  version: 1
  id: string
  user_id: string
  kind?: UserGameAccountKind
  cdk_key: string | null
  cdk_code_hash: string | null
  cdk_order_hash: string | null
  permission: PermissionMode
  status: 'active' | 'frozen' | 'revoked'
  archived_at?: string | null
  display_name: string
  note: string
  skland_binding?: SklandBindingRecord | null
  skland_pending_binding?: SklandPendingBindingRecord | null
  skland_risk?: SklandRiskRecord | null
  temporary_permission?: TemporaryProfilePermission | null
  created_at: string
  updated_at: string
}

export interface SklandBindingRecord {
  uid: string
  nickname: string
  channel_name: string
  bound_at: string
  last_imported_at: string | null
  encrypted_cred: string
  credential_status?: SklandCredentialStatus
  credential_invalid_at?: string | null
  credential_invalid_reason?: SklandCredentialInvalidReason | null
}

interface SklandPendingAccountOption {
  uid: string
  nickname: string
  channel_name: string
  is_default: boolean
}

interface SklandPendingBindingBase {
  confirmation_id: string
  encrypted_cred: string
  created_at: string
  expires_at: string
}

export interface SklandPendingAccountSelectionRecord extends SklandPendingBindingBase {
  stage: 'account_selection'
  accounts: SklandPendingAccountOption[]
  source?: 'manual' | 'bookmarklet'
}

export interface SklandPendingConfirmationRecord extends SklandPendingBindingBase {
  stage?: 'confirmation'
  uid: string
  nickname: string
  channel_name: string
  operator_count: number
}

export type SklandPendingBindingRecord =
  | SklandPendingAccountSelectionRecord
  | SklandPendingConfirmationRecord

interface SklandRiskRecord {
  uid_mismatch_count: number
  last_mismatch_uid: string | null
  last_mismatch_nickname: string | null
  last_mismatch_at: string | null
}

export interface FreePreviewClaimRecord {
  uid_hash: string
  user_id: string
  profile_id: string
  claimed_at: string
  uid?: string
  nickname?: string
  channel_name?: string
}

interface FreePreviewPendingClaimBase {
  confirmation_id: string
  user_id: string
  encrypted_cred: string
  display_name: string
  note: string
  created_at: string
  expires_at: string
}

export interface FreePreviewPendingAccountSelectionRecord extends FreePreviewPendingClaimBase {
  stage: 'account_selection'
  accounts: SklandPendingAccountOption[]
  source?: 'manual' | 'bookmarklet'
}

export interface FreePreviewPendingConfirmationRecord extends FreePreviewPendingClaimBase {
  stage?: 'confirmation'
  uid: string
  nickname: string
  channel_name: string
  operator_count: number
}

export type FreePreviewPendingClaimRecord =
  | FreePreviewPendingAccountSelectionRecord
  | FreePreviewPendingConfirmationRecord

interface LifetimeVoucherPendingBindingBase {
  confirmation_id: string
  user_id: string
  encrypted_cred: string
  created_at: string
  expires_at: string
}

export interface LifetimeVoucherPendingAccountSelectionRecord extends LifetimeVoucherPendingBindingBase {
  stage: 'account_selection'
  accounts: SklandPendingAccountOption[]
  source?: 'manual' | 'bookmarklet'
}

export interface LifetimeVoucherPendingConfirmationRecord extends LifetimeVoucherPendingBindingBase {
  stage: 'confirmation'
  uid: string
  nickname: string
  channel_name: string
  operator_count: number
}

export type LifetimeVoucherPendingBindingRecord =
  | LifetimeVoucherPendingAccountSelectionRecord
  | LifetimeVoucherPendingConfirmationRecord

export interface UserSessionRecord {
  version: 1
  id: string
  user_id: string
  token_hash: string
  created_at: string
  last_seen_at: string
  expires_at: string
}

export interface UserWorkspaceRecord {
  version: 1
  profile_id: string
  operators: LicenseOperator[] | null
  config: LicenseConfig | null
  elite_overrides: Record<string, number>
  last_result: OptimizeResult | null
  saved_configs: WorkspaceSavedConfig[]
  result_history: WorkspaceResultHistoryItem[]
  archived_results: WorkspaceResultHistoryItem[]
  free_schedule_entitlement: FreeScheduleEntitlement | null
  free_preview_normalized_activity_id?: string | null
  updated_at: string
}

interface LegacyUserWorkspaceRecord {
  version: 1
  user_id: string
  operators: LicenseOperator[] | null
  config: LicenseConfig | null
  elite_overrides: Record<string, number>
  last_result: OptimizeResult | null
  saved_configs?: WorkspaceSavedConfig[]
  result_history?: WorkspaceResultHistoryItem[]
  archived_results?: WorkspaceResultHistoryItem[]
  free_schedule_entitlement?: FreeScheduleEntitlement | null
  updated_at: string
}

export interface AnnouncementReadRecord {
  user_id: string
  announcement_id: string
  read_at: string
}

export interface PasswordResetTokenRecord {
  id: string
  user_id: string
  token_hash: string
  delivery_id: string | null
  expires_at: string
  used_at: string | null
  created_at: string
}

export interface EmailVerificationTokenRecord {
  id: string
  user_id: string
  token_hash: string
  delivery_id: string | null
  expires_at: string
  used_at: string | null
  created_at: string
}

export class RegistrationEmailConflictError extends Error {
  constructor() {
    super('Registration email already exists.')
    this.name = 'RegistrationEmailConflictError'
  }
}

export async function insertUserAccountForRegistration(user: UserAccountRecord): Promise<void> {
  await ensureSchema()
  await withTransaction((client) => insertUserAccountForRegistrationInTransaction(client, user))
}

export async function insertUserAccountForRegistrationInTransaction(
  client: PoolClient,
  user: UserAccountRecord,
): Promise<void> {
  await client.query(
    "select pg_advisory_xact_lock(hashtextextended('registration-email:' || $1, 0))",
    [user.email],
  )
  const inserted = await client.query(
    `insert into user_accounts
      (id, email, password_hash, salt, iterations, permission, status, cdk_key, cdk_code_hash, cdk_order_hash, email_verified_at, record_json, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14)
     on conflict (email) do nothing
     returning id`,
    [
      user.id,
      user.email,
      user.password_hash,
      user.salt,
      user.iterations,
      user.permission,
      user.status,
      user.cdk_key,
      user.cdk_code_hash,
      user.cdk_order_hash,
      user.email_verified_at,
      JSON.stringify(user),
      user.created_at,
      user.updated_at,
    ],
  )
  if (inserted.rowCount !== 1) throw new RegistrationEmailConflictError()
}

export async function getUserByEmail(email: string): Promise<UserAccountRecord | null> {
  await ensureSchema()
  const result = await query<{ record_json: UserAccountRecord }>(
    'select record_json from user_accounts where email = $1',
    [email],
  )
  return result.rows[0]?.record_json ?? null
}

export async function getUserById(id: string): Promise<UserAccountRecord | null> {
  await ensureSchema()
  const result = await query<{ record_json: UserAccountRecord }>(
    'select record_json from user_accounts where id = $1',
    [id],
  )
  return result.rows[0]?.record_json ?? null
}

export async function listUserAccounts(): Promise<UserAccountRecord[]> {
  await ensureSchema()
  const result = await query<{ record_json: UserAccountRecord }>(
    'select record_json from user_accounts order by created_at desc',
  )
  return result.rows.map((row) => row.record_json)
}

export async function saveUserAccount(user: UserAccountRecord): Promise<void> {
  await ensureSchema()
  await query(
    `insert into user_accounts
      (id, email, password_hash, salt, iterations, permission, status, cdk_key, cdk_code_hash, cdk_order_hash, email_verified_at, record_json, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14)
     on conflict (id) do update set
      email = excluded.email,
      password_hash = excluded.password_hash,
      salt = excluded.salt,
      iterations = excluded.iterations,
      permission = excluded.permission,
      status = excluded.status,
      cdk_key = excluded.cdk_key,
      cdk_code_hash = excluded.cdk_code_hash,
      cdk_order_hash = excluded.cdk_order_hash,
      email_verified_at = excluded.email_verified_at,
      record_json = excluded.record_json,
      updated_at = excluded.updated_at`,
    [
      user.id,
      user.email,
      user.password_hash,
      user.salt,
      user.iterations,
      user.permission,
      user.status,
      user.cdk_key,
      user.cdk_code_hash,
      user.cdk_order_hash,
      user.email_verified_at,
      JSON.stringify(user),
      user.created_at,
      user.updated_at,
    ],
  )
}

export async function deleteUserAccount(userId: string): Promise<void> {
  await ensureSchema()
  const client = await getPool().connect()
  try {
    await client.query('begin')
    const profileRows = await client.query<{ record_json: UserGameAccountRecord }>('select record_json from user_game_accounts where user_id = $1', [userId])
    const sampleSecret = process.env.DEPOT_SAMPLE_HASH_SECRET?.trim()
    if (!sampleSecret) throw new Error('DEPOT_SAMPLE_HASH_SECRET is not configured')
    const sampleHashes = profileRows.rows
      .map((row) => row.record_json.skland_binding?.uid)
      .filter((uid): uid is string => Boolean(uid))
      .map((uid) => createHmac('sha256', sampleSecret).update(`skland:${uid}`).digest('hex'))
    await client.query('delete from depot_value_samples where contributor_profile_id in (select id from user_game_accounts where user_id = $1)', [userId])
    if (sampleHashes.length > 0) await client.query('delete from depot_value_samples where uid_hash = any($1)', [sampleHashes])
    await client.query('delete from usage_events where user_id = $1 or profile_id in (select id from user_game_accounts where user_id = $1)', [userId])
    await client.query("delete from optimization_idempotency where owner_key in (select 'profile:' || id from user_game_accounts where user_id = $1)", [userId])
    await client.query("delete from optimization_submissions where owner_key in (select 'profile:' || id from user_game_accounts where user_id = $1)", [userId])
    await client.query("delete from optimize_jobs where profile_id in (select id from user_game_accounts where user_id = $1) or owner_key in (select 'profile:' || id from user_game_accounts where user_id = $1)", [userId])
    await client.query('delete from free_preview_pending_claims where user_id = $1', [userId])
    await client.query('delete from free_preview_claims where user_id = $1 or profile_id in (select id from user_game_accounts where user_id = $1)', [userId])
    await client.query(
      'delete from user_profile_workspaces where profile_id in (select id from user_game_accounts where user_id = $1)',
      [userId],
    )
    await client.query('delete from user_workspaces where user_id = $1', [userId])
    await client.query('delete from user_announcement_reads where user_id = $1', [userId])
    await client.query('delete from user_sessions where user_id = $1', [userId])
    await markPersonalUseDeclarationAcceptancesDeleted(client, userId)
    const deletedTargetHash = `deleted_user:${createHash('sha256').update(userId).digest('hex').slice(0, 16)}`
    await client.query(
      `update inventory_admin_audit
          set target_id = case when target_id = $1 then $2 else target_id end,
              before_json = case when before_json is null then null else jsonb_build_object('deleted_target', true, 'target_hash', $2) end,
              after_json = case when after_json is null then null else jsonb_build_object('deleted_target', true, 'target_hash', $2) end
        where target_id = $1 or before_json->>'user_id' = $1 or after_json->>'user_id' = $1`,
      [userId, deletedTargetHash],
    )
    await client.query('delete from user_game_accounts where user_id = $1', [userId])
    await client.query('delete from user_accounts where id = $1', [userId])
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export async function saveUserSession(session: UserSessionRecord): Promise<void> {
  await ensureSchema()
  await query(
    `insert into user_sessions
      (id, user_id, token_hash, record_json, created_at, last_seen_at, expires_at)
     values ($1, $2, $3, $4::jsonb, $5, $6, $7)
     on conflict (id) do update set
      token_hash = excluded.token_hash,
      record_json = excluded.record_json,
      last_seen_at = excluded.last_seen_at,
      expires_at = excluded.expires_at`,
    [
      session.id,
      session.user_id,
      session.token_hash,
      JSON.stringify(session),
      session.created_at,
      session.last_seen_at,
      session.expires_at,
    ],
  )
}

export async function getSessionByTokenHash(tokenHash: string): Promise<UserSessionRecord | null> {
  await ensureSchema()
  const result = await query<{ record_json: UserSessionRecord }>(
    'select record_json from user_sessions where token_hash = $1',
    [tokenHash],
  )
  return result.rows[0]?.record_json ?? null
}

export async function touchSession(session: UserSessionRecord, now: Date, cutoff: Date): Promise<boolean> {
  await ensureSchema()
  const lastSeenAt = now.toISOString()
  const updated = { ...session, last_seen_at: lastSeenAt }
  const result = await query(
    `update user_sessions
     set record_json = $4::jsonb,
         last_seen_at = $3
     where id = $1
       and token_hash = $2
       and last_seen_at <= $5`,
    [session.id, session.token_hash, lastSeenAt, JSON.stringify(updated), cutoff.toISOString()],
  )
  return (result.rowCount ?? 0) > 0
}

export async function deleteSessionByTokenHash(tokenHash: string): Promise<void> {
  await ensureSchema()
  await query('delete from user_sessions where token_hash = $1', [tokenHash])
}

export async function deleteSessionsForUser(userId: string, keepTokenHash?: string): Promise<void> {
  await ensureSchema()
  if (keepTokenHash) {
    await query('delete from user_sessions where user_id = $1 and token_hash <> $2', [userId, keepTokenHash])
    return
  }
  await query('delete from user_sessions where user_id = $1', [userId])
}

export async function savePasswordResetToken(token: PasswordResetTokenRecord): Promise<void> {
  await ensureSchema()
  await query(
    `insert into password_reset_tokens
      (id, user_id, token_hash, delivery_id, expires_at, used_at, created_at)
      values ($1, $2, $3, $4, $5, $6, $7)
      on conflict (id) do update set
        token_hash = excluded.token_hash,
        delivery_id = excluded.delivery_id,
        expires_at = excluded.expires_at,
        used_at = excluded.used_at,
        created_at = excluded.created_at`,
    [
      token.id,
      token.user_id,
      token.token_hash,
      token.delivery_id,
      token.expires_at,
      token.used_at,
      token.created_at,
    ],
  )
}

export async function getPasswordResetTokenByHash(tokenHash: string): Promise<PasswordResetTokenRecord | null> {
  await ensureSchema()
  const result = await query<PasswordResetTokenRecord>(
    `select token.id, token.user_id, token.token_hash, token.delivery_id,
            token.expires_at, token.used_at, token.created_at
       from password_reset_tokens token
       left join brevo_email_deliveries delivery on delivery.id = token.delivery_id
      where token.token_hash = $1
        and (token.delivery_id is null or delivery.status in ('reserved', 'sent', 'uncertain'))`,
    [tokenHash],
  )
  return result.rows[0] ?? null
}

export async function getRecentPasswordResetTokenForUser(
  userId: string,
  since: string,
): Promise<PasswordResetTokenRecord | null> {
  await ensureSchema()
  const result = await query<PasswordResetTokenRecord>(
    `select token.id, token.user_id, token.token_hash, token.delivery_id,
            token.expires_at, token.used_at, token.created_at
       from password_reset_tokens token
       left join brevo_email_deliveries delivery on delivery.id = token.delivery_id
      where token.user_id = $1
        and token.created_at >= $2
        and token.used_at is null
        and token.expires_at > current_timestamp
        and (token.delivery_id is null or delivery.status in ('reserved', 'sent', 'uncertain'))
      order by token.created_at desc
      limit 1`,
    [userId, since],
  )
  return result.rows[0] ?? null
}

export interface UpdateUserPasswordAtomicallyInput {
  userId: string
  expectedPasswordHash: string
  replacement: PasswordHashRecord
  updatedAt: Date
  resetTokenHash?: string
  keepSessionTokenHash?: string
}

export type UpdateUserPasswordAtomicallyResult =
  | { ok: true; user: UserAccountRecord }
  | { ok: false; reason: 'reset_token_invalid' | 'password_update_conflict' }

class PasswordLifecycleConflictError extends Error {
  constructor(readonly reason: 'reset_token_invalid' | 'password_update_conflict') {
    super(reason)
    this.name = 'PasswordLifecycleConflictError'
  }
}

export async function updateUserPasswordAtomically(
  input: UpdateUserPasswordAtomicallyInput,
): Promise<UpdateUserPasswordAtomicallyResult> {
  await ensureSchema()
  const updatedAt = input.updatedAt.toISOString()
  try {
    return await withTransaction(async (client) => {
      if (input.resetTokenHash) {
        const claimed = await client.query(
          `update password_reset_tokens
              set used_at = $3
            where token_hash = $1
              and user_id = $2
              and used_at is null
              and expires_at > $3
              and (
                delivery_id is null
                or exists (
                  select 1
                    from brevo_email_deliveries delivery
                   where delivery.id = password_reset_tokens.delivery_id
                     and delivery.status in ('reserved', 'sent', 'uncertain')
                )
              )`,
          [input.resetTokenHash, input.userId, updatedAt],
        )
        if (claimed.rowCount !== 1) throw new PasswordLifecycleConflictError('reset_token_invalid')
      }

      const passwordPatch = {
        password_hash: input.replacement.password_hash,
        salt: input.replacement.salt,
        iterations: input.replacement.iterations,
        password_algorithm: input.replacement.password_algorithm,
        updated_at: updatedAt,
      }
      const updated = await client.query<{ record_json: UserAccountRecord }>(
        `update user_accounts
            set password_hash = $3,
                salt = $4,
                iterations = $5,
                record_json = record_json || $6::jsonb,
                updated_at = $7
          where id = $1
            and password_hash = $2
            and status = 'active'
        returning record_json`,
        [
          input.userId,
          input.expectedPasswordHash,
          input.replacement.password_hash,
          input.replacement.salt,
          input.replacement.iterations,
          JSON.stringify(passwordPatch),
          updatedAt,
        ],
      )
      if (updated.rowCount !== 1 || !updated.rows[0]) {
        throw new PasswordLifecycleConflictError('password_update_conflict')
      }

      await client.query(
        'update password_reset_tokens set used_at = $2 where user_id = $1 and used_at is null',
        [input.userId, updatedAt],
      )
      if (input.keepSessionTokenHash) {
        await client.query(
          'delete from user_sessions where user_id = $1 and token_hash <> $2',
          [input.userId, input.keepSessionTokenHash],
        )
      } else {
        await client.query('delete from user_sessions where user_id = $1', [input.userId])
      }
      return { ok: true, user: updated.rows[0].record_json }
    })
  } catch (error) {
    if (error instanceof PasswordLifecycleConflictError) {
      return { ok: false, reason: error.reason }
    }
    throw error
  }
}

export async function listProfilesForUser(userId: string): Promise<UserGameAccountRecord[]> {
  await ensureSchema()
  const result = await query<{ record_json: UserGameAccountRecord }>(
    'select record_json from user_game_accounts where user_id = $1 order by created_at asc',
    [userId],
  )
  return result.rows.map((row) => row.record_json)
}

export async function getProfileById(profileId: string): Promise<UserGameAccountRecord | null> {
  await ensureSchema()
  const result = await query<{ record_json: UserGameAccountRecord }>(
    'select record_json from user_game_accounts where id = $1',
    [profileId],
  )
  return result.rows[0]?.record_json ?? null
}

export async function getProfileForUser(userId: string, profileId: string): Promise<UserGameAccountRecord | null> {
  await ensureSchema()
  const result = await query<{ record_json: UserGameAccountRecord }>(
    'select record_json from user_game_accounts where id = $1 and user_id = $2',
    [profileId, userId],
  )
  return result.rows[0]?.record_json ?? null
}

export async function saveUserProfile(profile: UserGameAccountRecord): Promise<void> {
  await ensureSchema()
  await query(
    `insert into user_game_accounts
      (id, user_id, cdk_key, cdk_code_hash, cdk_order_hash, permission, status, display_name, note, kind, archived_at, record_json, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14)
     on conflict (id) do update set
      cdk_key = excluded.cdk_key,
      cdk_code_hash = excluded.cdk_code_hash,
      cdk_order_hash = excluded.cdk_order_hash,
      permission = excluded.permission,
      status = excluded.status,
      display_name = excluded.display_name,
      note = excluded.note,
      kind = excluded.kind,
      archived_at = excluded.archived_at,
      record_json = excluded.record_json,
      updated_at = excluded.updated_at`,
    [
      profile.id,
      profile.user_id,
      profile.cdk_key,
      profile.cdk_code_hash,
      profile.cdk_order_hash,
      profile.permission,
      profile.status,
      profile.display_name,
      profile.note,
      normalizeProfileKind(profile),
      profile.archived_at ?? null,
      JSON.stringify(profile),
      profile.created_at,
      profile.updated_at,
    ],
  )
}

export async function getFreePreviewClaim(uidHash: string): Promise<FreePreviewClaimRecord | null> {
  await ensureSchema()
  const result = await query<{ record_json: FreePreviewClaimRecord }>(
    'select record_json from free_preview_claims where uid_hash = $1',
    [uidHash],
  )
  return result.rows[0]?.record_json ?? null
}

export async function claimFreePreviewUid(
  claim: FreePreviewClaimRecord,
): Promise<{ ok: true; claim: FreePreviewClaimRecord } | { ok: false; claim: FreePreviewClaimRecord | null }> {
  await ensureSchema()
  const result = await query<{ record_json: FreePreviewClaimRecord }>(
    `insert into free_preview_claims
      (uid_hash, user_id, profile_id, claimed_at, record_json)
     values ($1, $2, $3, $4, $5::jsonb)
     on conflict (uid_hash) do nothing
     returning record_json`,
    [
      claim.uid_hash,
      claim.user_id,
      claim.profile_id,
      claim.claimed_at,
      JSON.stringify(claim),
    ],
  )
  const inserted = result.rows[0]?.record_json
  if (inserted) return { ok: true, claim: inserted }
  return { ok: false, claim: await getFreePreviewClaim(claim.uid_hash) }
}

export async function deleteFreePreviewClaim(uidHash: string, profileId?: string): Promise<void> {
  await ensureSchema()
  if (profileId) {
    await query('delete from free_preview_claims where uid_hash = $1 and profile_id = $2', [uidHash, profileId])
    return
  }
  await query('delete from free_preview_claims where uid_hash = $1', [uidHash])
}

export async function saveFreePreviewPendingClaim(claim: FreePreviewPendingClaimRecord): Promise<void> {
  await ensureSchema()
  await query(
    `insert into free_preview_pending_claims
      (confirmation_id, user_id, expires_at, record_json, created_at)
     values ($1, $2, $3, $4::jsonb, $5)
     on conflict (confirmation_id) do update set
      user_id = excluded.user_id,
      expires_at = excluded.expires_at,
      record_json = excluded.record_json,
      created_at = excluded.created_at`,
    [
      claim.confirmation_id,
      claim.user_id,
      claim.expires_at,
      JSON.stringify(claim),
      claim.created_at,
    ],
  )
}

export async function getFreePreviewPendingClaim(
  userId: string,
  confirmationId: string,
): Promise<FreePreviewPendingClaimRecord | null> {
  await ensureSchema()
  const result = await query<{ record_json: FreePreviewPendingClaimRecord }>(
    'select record_json from free_preview_pending_claims where user_id = $1 and confirmation_id = $2',
    [userId, confirmationId],
  )
  return result.rows[0]?.record_json ?? null
}

export async function deleteFreePreviewPendingClaim(userId: string, confirmationId: string): Promise<void> {
  await ensureSchema()
  await query('delete from free_preview_pending_claims where user_id = $1 and confirmation_id = $2', [userId, confirmationId])
}

export async function saveLifetimeVoucherPendingBinding(binding: LifetimeVoucherPendingBindingRecord): Promise<void> {
  await ensureSchema()
  await query(
    `insert into lifetime_voucher_pending_bindings
      (confirmation_id, user_id, expires_at, record_json, created_at)
     values ($1, $2, $3, $4::jsonb, $5)
     on conflict (confirmation_id) do update set
      user_id = excluded.user_id,
      expires_at = excluded.expires_at,
      record_json = excluded.record_json,
      created_at = excluded.created_at`,
    [binding.confirmation_id, binding.user_id, binding.expires_at, JSON.stringify(binding), binding.created_at],
  )
}

export async function getLifetimeVoucherPendingBinding(
  userId: string,
  confirmationId: string,
): Promise<LifetimeVoucherPendingBindingRecord | null> {
  await ensureSchema()
  const result = await query<{ record_json: LifetimeVoucherPendingBindingRecord }>(
    'select record_json from lifetime_voucher_pending_bindings where user_id = $1 and confirmation_id = $2',
    [userId, confirmationId],
  )
  return result.rows[0]?.record_json ?? null
}

export async function deleteLifetimeVoucherPendingBinding(userId: string, confirmationId: string): Promise<void> {
  await ensureSchema()
  await query('delete from lifetime_voucher_pending_bindings where user_id = $1 and confirmation_id = $2', [userId, confirmationId])
}

export async function getOrCreateDepotValueProfile(user: UserAccountRecord): Promise<UserGameAccountRecord> {
  await ensureSchema()
  const existing = (await listProfilesForUser(user.id)).find((profile) => normalizeProfileKind(profile) === 'depot_value')
  if (existing) return existing

  const now = new Date().toISOString()
  const profile: UserGameAccountRecord = {
    version: 1,
    id: `depot-${user.id}`,
    user_id: user.id,
    kind: 'depot_value',
    cdk_key: null,
    cdk_code_hash: null,
    cdk_order_hash: null,
    permission: 'growth',
    status: 'active',
    display_name: '仓库分析',
    note: '用于森空岛仓库价值分析，不解锁排班工作台。',
    skland_binding: null,
    skland_pending_binding: null,
    skland_risk: null,
    created_at: now,
    updated_at: now,
  }
  await saveUserProfile(profile)
  return profile
}

export async function getWorkspace(profileId: string): Promise<UserWorkspaceRecord | null> {
  return getProfileWorkspace(profileId)
}

export async function getProfileWorkspace(profileId: string): Promise<UserWorkspaceRecord | null> {
  await ensureSchema()
  const result = await query<{ record_json: UserWorkspaceRecord }>(
    'select record_json from user_profile_workspaces where profile_id = $1',
    [profileId],
  )
  return normalizeWorkspaceRecord(result.rows[0]?.record_json ?? null)
}

export async function listProfileWorkspaces(profileIds: string[]): Promise<Map<string, UserWorkspaceRecord>> {
  if (profileIds.length === 0) return new Map()
  await ensureSchema()
  const result = await query<{ profile_id: string; record_json: UserWorkspaceRecord }>(
    `select profile_id, record_json
     from user_profile_workspaces
     where profile_id = any($1::text[])`,
    [profileIds],
  )
  const workspaces = new Map<string, UserWorkspaceRecord>()
  for (const row of result.rows) {
    const workspace = normalizeWorkspaceRecord(row.record_json)
    if (workspace) workspaces.set(row.profile_id, workspace)
  }
  return workspaces
}

async function getLegacyWorkspace(userId: string): Promise<LegacyUserWorkspaceRecord | null> {
  await ensureSchema()
  const result = await query<{ record_json: LegacyUserWorkspaceRecord }>(
    'select record_json from user_workspaces where user_id = $1',
    [userId],
  )
  return result.rows[0]?.record_json ?? null
}

export async function saveWorkspace(workspace: UserWorkspaceRecord): Promise<void> {
  return saveProfileWorkspace(workspace)
}

export async function saveProfileWorkspace(workspace: UserWorkspaceRecord): Promise<void> {
  await ensureSchema()
  const normalized = normalizeWorkspaceRecord(workspace) ?? workspace
  await withTransaction(async (client) => {
    await lockWorkspaceForUpdate(client, normalized.profile_id)
    await saveProfileWorkspaceWithClient(client, normalized)
  })
}

export interface AdminUserAccountPage {
  users: UserAccountRecord[]
  profiles: UserGameAccountRecord[]
  total: number
  page: number
  totalPages: number
}

export async function listAdminUserAccountsPage(options: {
  page: number
  pageSize: number
  search: string
}): Promise<AdminUserAccountPage> {
  await ensureSchema()
  const values: unknown[] = []
  let where = ''
  if (options.search) {
    values.push(`%${options.search.toLowerCase()}%`)
    where = `where lower(user_accounts.email) like $1
      or lower(user_accounts.id) like $1
      or exists (
        select 1 from user_game_accounts profile
        where profile.user_id = user_accounts.id
          and (
            lower(profile.display_name) like $1
            or lower(profile.id) like $1
            or lower(coalesce(profile.cdk_order_hash, '')) like $1
          )
      )`
  }
  const countResult = await query<{ total: string }>(
    `select count(*)::text as total from user_accounts ${where}`,
    values,
  )
  const total = Number(countResult.rows[0]?.total ?? 0)
  const totalPages = total === 0 ? 0 : Math.ceil(total / options.pageSize)
  const page = totalPages === 0 ? 1 : Math.min(options.page, totalPages)
  values.push(options.pageSize, (page - 1) * options.pageSize)
  const usersResult = await query<{ record_json: UserAccountRecord }>(
    `select record_json from user_accounts ${where}
     order by created_at desc, id asc limit $${values.length - 1} offset $${values.length}`,
    values,
  )
  const users = usersResult.rows.map((row) => row.record_json)
  if (users.length === 0) return { users, profiles: [], total, page, totalPages }
  const profilesResult = await query<{ record_json: UserGameAccountRecord }>(
    'select record_json from user_game_accounts where user_id = any($1::text[]) order by created_at asc',
    [users.map((user) => user.id)],
  )
  return {
    users,
    profiles: profilesResult.rows.map((row) => row.record_json),
    total,
    page,
    totalPages,
  }
}

export async function updateProfileWorkspaceAtomically(
  profileId: string,
  updater: (workspace: UserWorkspaceRecord | null) => UserWorkspaceRecord,
): Promise<UserWorkspaceRecord> {
  await ensureSchema()
  return withTransaction((client) => updateProfileWorkspaceInTransaction(client, profileId, updater))
}

export async function updateProfileWorkspaceInTransaction(
  client: PoolClient,
  profileId: string,
  updater: (workspace: UserWorkspaceRecord | null) => UserWorkspaceRecord,
): Promise<UserWorkspaceRecord> {
  await lockWorkspaceForUpdate(client, profileId)
  const current = await client.query<{ record_json: UserWorkspaceRecord }>(
    'select record_json from user_profile_workspaces where profile_id = $1',
    [profileId],
  )
  const next = normalizeWorkspaceRecord(updater(normalizeWorkspaceRecord(current.rows[0]?.record_json ?? null)))
  if (!next || next.profile_id !== profileId) throw new Error('Workspace update must preserve its profile id.')
  await saveProfileWorkspaceWithClient(client, next)
  return next
}

async function lockWorkspaceForUpdate(client: PoolClient, profileId: string): Promise<void> {
  await client.query("select pg_advisory_xact_lock(hashtextextended('workspace:' || $1, 0))", [profileId])
}

async function saveProfileWorkspaceWithClient(client: PoolClient, normalized: UserWorkspaceRecord): Promise<void> {
  await client.query(
    `insert into user_profile_workspaces
      (profile_id, operators_json, config_json, elite_overrides_json, last_result_json, record_json, updated_at)
     values ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7)
     on conflict (profile_id) do update set
      operators_json = excluded.operators_json,
      config_json = excluded.config_json,
      elite_overrides_json = excluded.elite_overrides_json,
      last_result_json = excluded.last_result_json,
      record_json = excluded.record_json,
      updated_at = excluded.updated_at`,
    [
      normalized.profile_id,
      JSON.stringify(normalized.operators),
      JSON.stringify(normalized.config),
      JSON.stringify(normalized.elite_overrides),
      JSON.stringify(normalized.last_result),
      JSON.stringify(normalized),
      normalized.updated_at,
    ],
  )
}

export async function saveEmailVerificationToken(token: EmailVerificationTokenRecord): Promise<void> {
  await ensureSchema()
  await query(
    `insert into email_verification_tokens
      (id, user_id, token_hash, delivery_id, expires_at, used_at, created_at)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      token.id,
      token.user_id,
      token.token_hash,
      token.delivery_id,
      token.expires_at,
      token.used_at,
      token.created_at,
    ],
  )
}

export async function deleteEmailVerificationTokenByHash(tokenHash: string): Promise<void> {
  await ensureSchema()
  await query('delete from email_verification_tokens where token_hash = $1 and used_at is null', [tokenHash])
}

export async function getRecentEmailVerificationTokenForUser(
  userId: string,
  since: string,
): Promise<EmailVerificationTokenRecord | null> {
  await ensureSchema()
  const result = await query<EmailVerificationTokenRecord>(
    `select token.id, token.user_id, token.token_hash, token.delivery_id,
            token.expires_at, token.used_at, token.created_at
       from email_verification_tokens token
       left join brevo_email_deliveries delivery on delivery.id = token.delivery_id
      where token.user_id = $1
        and token.created_at >= $2
        and token.used_at is null
        and token.expires_at > current_timestamp
        and (token.delivery_id is null or delivery.status in ('reserved', 'sent', 'uncertain'))
      order by token.created_at desc
      limit 1`,
    [userId, since],
  )
  return result.rows[0] ?? null
}

export async function verifyUserEmailWithToken(tokenHash: string, verifiedAt: Date): Promise<UserAccountRecord | null> {
  await ensureSchema()
  return withTransaction(async (client) => {
    const verifiedAtIso = verifiedAt.toISOString()
    const claimed = await client.query<{ user_id: string }>(
      `update email_verification_tokens
          set used_at = $2
        where token_hash = $1
          and used_at is null
          and expires_at > $2
          and (
            delivery_id is null
            or exists (
              select 1
                from brevo_email_deliveries delivery
               where delivery.id = email_verification_tokens.delivery_id
                 and delivery.status in ('reserved', 'sent', 'uncertain')
            )
          )
      returning user_id`,
      [tokenHash, verifiedAtIso],
    )
    const userId = claimed.rows[0]?.user_id
    if (!userId) return null

    const updated = await client.query<{ record_json: UserAccountRecord }>(
      `update user_accounts
          set email_verified_at = $2,
              record_json = record_json || jsonb_build_object('email_verified_at', $2::timestamptz, 'updated_at', $2::timestamptz),
              updated_at = $2
        where id = $1
          and status = 'active'
          and email_verified_at is null
      returning record_json`,
      [userId, verifiedAtIso],
    )
    const user = updated.rows[0]?.record_json
    if (!user) return null

    await client.query(
      `update email_verification_tokens
          set used_at = $2
        where user_id = $1 and used_at is null`,
      [userId, verifiedAtIso],
    )
    return user
  })
}

export async function migrateLegacyUserIfNeeded(user: UserAccountRecord): Promise<UserGameAccountRecord[]> {
  const existingProfiles = await listProfilesForUser(user.id)
  if (existingProfiles.length > 0 || !user.cdk_key || !user.cdk_code_hash) return existingProfiles

  const now = new Date().toISOString()
  const profile: UserGameAccountRecord = {
    version: 1,
    id: user.id,
    user_id: user.id,
    kind: 'cdk',
    cdk_key: user.cdk_key,
    cdk_code_hash: user.cdk_code_hash,
    cdk_order_hash: user.cdk_order_hash,
    permission: user.permission,
    status: user.status,
    display_name: '账号 1',
    note: '',
    created_at: user.created_at,
    updated_at: now,
  }
  await saveUserProfile(profile)

  const legacyWorkspace = await getLegacyWorkspace(user.id)
  await saveProfileWorkspace(
    legacyWorkspace
      ? {
          version: 1,
          profile_id: profile.id,
          operators: legacyWorkspace.operators,
          config: legacyWorkspace.config,
          elite_overrides: legacyWorkspace.elite_overrides ?? {},
          last_result: legacyWorkspace.last_result ?? null,
          saved_configs: normalizeSavedConfigs(legacyWorkspace.saved_configs),
          result_history: normalizeResultHistory(legacyWorkspace.result_history),
          updated_at: legacyWorkspace.updated_at ?? now,
        }
      : emptyWorkspace(profile.id),
  )
  return [profile]
}

export async function getAnnouncementReads(userId: string): Promise<AnnouncementReadRecord[]> {
  await ensureSchema()
  const result = await query<AnnouncementReadRecord>(
    'select user_id, announcement_id, read_at from user_announcement_reads where user_id = $1',
    [userId],
  )
  return result.rows
}

export async function getAnnouncementReadCounts(): Promise<Record<string, number>> {
  await ensureSchema()
  const result = await query<{ announcement_id: string; read_count: number }>(
    `select announcement_id, count(*)::int as read_count
     from user_announcement_reads
     group by announcement_id`,
  )
  return Object.fromEntries(
    result.rows.map((row) => [row.announcement_id, Number.isFinite(Number(row.read_count)) ? Number(row.read_count) : 0]),
  )
}

export async function markAnnouncementRead(userId: string, announcementId: string, readAt = new Date().toISOString()): Promise<void> {
  await ensureSchema()
  await query(
    `insert into user_announcement_reads (user_id, announcement_id, read_at)
     values ($1, $2, $3)
     on conflict (user_id, announcement_id) do update set read_at = excluded.read_at`,
    [userId, announcementId, readAt],
  )
}

export function emptyWorkspace(profileId: string): UserWorkspaceRecord {
  return {
    version: 1,
    profile_id: profileId,
    operators: null,
    config: null,
    elite_overrides: {},
    last_result: null,
    saved_configs: [],
    result_history: [],
    archived_results: [],
    free_schedule_entitlement: null,
    free_preview_normalized_activity_id: null,
    updated_at: new Date().toISOString(),
  }
}

export async function upgradeUserPasswordHash(
  userId: string,
  expectedPasswordHash: string,
  replacement: PasswordHashRecord,
): Promise<UserAccountRecord | null> {
  await ensureSchema()
  const updatedAt = new Date().toISOString()
  const passwordPatch = {
    password_hash: replacement.password_hash,
    salt: replacement.salt,
    iterations: replacement.iterations,
    password_algorithm: replacement.password_algorithm,
    updated_at: updatedAt,
  }
  const result = await query<{ record_json: UserAccountRecord }>(
    `update user_accounts
     set password_hash = $3,
         salt = $4,
         iterations = $5,
         record_json = record_json || $6::jsonb,
         updated_at = $7
     where id = $1 and password_hash = $2
     returning record_json`,
    [
      userId,
      expectedPasswordHash,
      replacement.password_hash,
      replacement.salt,
      replacement.iterations,
      JSON.stringify(passwordPatch),
      updatedAt,
    ],
  )
  return result.rows[0]?.record_json ?? null
}

export function toPublicWorkspace(
  workspace: UserWorkspaceRecord | null,
  limits: { plan: number; history: number; archive: number } = {
    plan: WORKSPACE_SAVED_CONFIG_LIMIT,
    history: WORKSPACE_RESULT_HISTORY_LIMIT,
    archive: 0,
  },
): UserWorkspace {
  const normalized = normalizeWorkspaceRecord(workspace)
  const resultHistory = normalized ? getPublicResultHistory(normalized) : []
  return {
    profile_id: normalized?.profile_id ?? null,
    operators: normalized?.operators ?? null,
    config: normalized?.config ?? null,
    elite_overrides: normalized?.elite_overrides ?? {},
    last_result: normalized?.last_result ?? null,
    saved_configs: (normalized?.saved_configs ?? []).slice(0, limits.plan),
    result_history: resultHistory.slice(0, limits.history),
    archived_results: (normalized?.archived_results ?? []).slice(0, limits.archive),
    free_schedule_entitlement: normalized?.free_schedule_entitlement ?? null,
    updated_at: normalized?.updated_at ?? null,
  }
}

export function toPublicProfile(
  profile: UserGameAccountRecord,
  workspace?: UserWorkspaceRecord | null,
  trial: FreePreviewTrial | null = null,
): UserGameAccount {
  return {
    id: profile.id,
    user_id: profile.user_id,
    kind: normalizeProfileKind(profile),
    permission: profile.permission,
    trial,
    status: profile.status,
    archived_at: profile.archived_at ?? null,
    cdk_order_hash: profile.cdk_order_hash,
    display_name: profile.display_name,
    note: profile.note,
    skland_binding: profile.skland_binding
      ? {
          uid: profile.skland_binding.uid,
          nickname: profile.skland_binding.nickname,
          channel_name: profile.skland_binding.channel_name,
          bound_at: profile.skland_binding.bound_at,
          last_imported_at: profile.skland_binding.last_imported_at,
          credential_status: profile.skland_binding.credential_status === 'invalid' ? 'invalid' : 'available',
          credential_invalid_at: profile.skland_binding.credential_invalid_at ?? null,
          credential_invalid_reason: normalizeSklandCredentialInvalidReason(profile.skland_binding.credential_invalid_reason),
        }
      : null,
    operator_count: countOwnedOperators(workspace?.operators),
    updated_at: workspace?.updated_at ?? profile.updated_at,
    created_at: profile.created_at,
  }
}

export function normalizeWorkspaceRecord(workspace: UserWorkspaceRecord | null | undefined): UserWorkspaceRecord | null {
  if (!workspace) return null
  return {
    version: 1,
    profile_id: workspace.profile_id,
    operators: Array.isArray(workspace.operators) ? workspace.operators : null,
    config: isRecord(workspace.config) ? workspace.config as LicenseConfig : null,
    elite_overrides: isRecord(workspace.elite_overrides) ? workspace.elite_overrides as Record<string, number> : {},
    last_result: isRecord(workspace.last_result) ? workspace.last_result as OptimizeResult : null,
    saved_configs: normalizeSavedConfigs((workspace as { saved_configs?: unknown }).saved_configs),
    result_history: normalizeResultHistory((workspace as { result_history?: unknown }).result_history),
    archived_results: normalizeResultHistory((workspace as { archived_results?: unknown }).archived_results),
    free_schedule_entitlement: normalizeFreeScheduleEntitlement((workspace as { free_schedule_entitlement?: unknown }).free_schedule_entitlement),
    free_preview_normalized_activity_id: typeof workspace.free_preview_normalized_activity_id === 'string'
      ? workspace.free_preview_normalized_activity_id
      : null,
    updated_at: typeof workspace.updated_at === 'string' ? workspace.updated_at : new Date().toISOString(),
  }
}

function normalizeFreeScheduleEntitlement(value: unknown): FreeScheduleEntitlement | null {
  if (!isRecord(value)) return null
  const firstGeneratedAt = typeof value.first_generated_at === 'string' ? value.first_generated_at : null
  const revisionCount = Number(value.revision_count ?? 0)
  const confirmedAt = typeof value.confirmed_at === 'string' ? value.confirmed_at : null
  const lockedAt = typeof value.locked_at === 'string' ? value.locked_at : null
  const lockReason = value.lock_reason === 'confirmed' || value.lock_reason === 'revision_limit' || value.lock_reason === 'window_expired'
    ? value.lock_reason
    : null
  const rawBonus = isRecord(value.strong_reorder_bonus) ? value.strong_reorder_bonus : null
  const strongReorderBonus = rawBonus && typeof rawBonus.month === 'string' && typeof rawBonus.granted_at === 'string'
    ? {
      month: rawBonus.month,
      granted_at: rawBonus.granted_at,
      used_at: typeof rawBonus.used_at === 'string' ? rawBonus.used_at : null,
    }
    : null
  return {
    first_generated_at: firstGeneratedAt,
    revision_count: Number.isFinite(revisionCount) ? Math.max(0, Math.floor(revisionCount)) : 0,
    revision_limit: 3,
    revision_window_hours: 24,
    confirmed_at: confirmedAt,
    locked_at: lockedAt,
    lock_reason: lockReason,
    strong_reorder_bonus: strongReorderBonus,
  }
}

function normalizeSavedConfigs(value: unknown): WorkspaceSavedConfig[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw) => {
    if (!isRecord(raw) || !isRecord(raw.config)) return []
    const id = typeof raw.id === 'string' ? raw.id : ''
    const name = typeof raw.name === 'string' ? raw.name : ''
    const createdAt = typeof raw.created_at === 'string' ? raw.created_at : ''
    const updatedAt = typeof raw.updated_at === 'string' ? raw.updated_at : createdAt
    if (!id || !name || !createdAt || !updatedAt) return []
    return [{
      id,
      name,
      config: raw.config as LicenseConfig,
      created_at: createdAt,
      updated_at: updatedAt,
      last_used_at: typeof raw.last_used_at === 'string' ? raw.last_used_at : null,
      read_only: raw.read_only === true,
    }]
  }).slice(0, WORKSPACE_SAVED_CONFIG_MAX_LIMIT)
}

function normalizeResultHistory(value: unknown): WorkspaceResultHistoryItem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw) => {
    if (!isRecord(raw) || !isRecord(raw.result)) return []
    const id = typeof raw.id === 'string' ? raw.id : ''
    const name = typeof raw.name === 'string' ? raw.name : ''
    const createdAt = typeof raw.created_at === 'string' ? raw.created_at : ''
    if (!id || !name || !createdAt) return []
    const source = raw.source === 'applied_suggestions' || raw.source === 'legacy' ? raw.source : 'generated'
    return [{
      id,
      name,
      created_at: createdAt,
      config: isRecord(raw.config) ? raw.config as LicenseConfig : null,
      result: raw.result as OptimizeResult,
      operator_count: typeof raw.operator_count === 'number' && Number.isFinite(raw.operator_count) ? raw.operator_count : 0,
      source,
    }]
  }).slice(0, WORKSPACE_RESULT_HISTORY_MAX_LIMIT)
}

function getPublicResultHistory(workspace: UserWorkspaceRecord): WorkspaceResultHistoryItem[] {
  if (workspace.result_history.length > 0) return workspace.result_history
  if (!workspace.last_result) return []
  return [{
    id: 'legacy-last-result',
    name: '上次排班结果',
    created_at: workspace.updated_at,
    config: workspace.config,
    result: workspace.last_result,
    operator_count: countOwnedOperators(workspace.operators),
    source: 'legacy',
  }]
}

function normalizeSklandCredentialInvalidReason(value: unknown): SklandCredentialInvalidReason | null {
  return value === 'expired_or_revoked' || value === 'credential_format_invalid' ? value : null
}

export function normalizeProfileKind(profile: Pick<UserGameAccountRecord, 'kind'>): UserGameAccountKind {
  if (profile.kind === 'free_preview' || profile.kind === 'depot_value'
    || profile.kind === 'metered_personal' || profile.kind === 'metered_commercial') return profile.kind
  return 'cdk'
}

export function isDepotValueProfile(profile: Pick<UserGameAccountRecord, 'kind'>): boolean {
  return normalizeProfileKind(profile) === 'depot_value'
}

export function isFreePreviewProfile(profile: Pick<UserGameAccountRecord, 'kind'>): boolean {
  return normalizeProfileKind(profile) === 'free_preview'
}

function countOwnedOperators(operators: LicenseOperator[] | null | undefined): number {
  return operators?.filter((operator) => operator.own !== false).length ?? 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function ensureSchema(): Promise<void> {
  schemaReady ??= ensureDatabaseSchema().catch((error) => {
    schemaReady = null
    throw error
  })
  return schemaReady
}
