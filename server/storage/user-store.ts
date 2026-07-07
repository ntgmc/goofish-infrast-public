import { getPool, query } from './postgres'
import { ensureDatabaseSchema } from './schema'
import type {
  LicenseConfig,
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
} from '../../src/lib/types'

let schemaReady: Promise<void> | null = null
const WORKSPACE_SAVED_CONFIG_LIMIT = 20
const WORKSPACE_RESULT_HISTORY_LIMIT = 10

export interface UserAccountRecord {
  version: 1
  id: string
  email: string
  password_hash: string
  salt: string
  iterations: number
  permission: PermissionMode
  status: 'active' | 'frozen' | 'revoked'
  cdk_key: string | null
  cdk_code_hash: string | null
  cdk_order_hash: string | null
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
  display_name: string
  note: string
  skland_binding?: SklandBindingRecord | null
  skland_pending_binding?: SklandPendingBindingRecord | null
  skland_risk?: SklandRiskRecord | null
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

export interface SklandPendingBindingRecord {
  confirmation_id: string
  uid: string
  nickname: string
  channel_name: string
  encrypted_cred: string
  operator_count: number
  created_at: string
  expires_at: string
}

export interface SklandRiskRecord {
  uid_mismatch_count: number
  last_mismatch_uid: string | null
  last_mismatch_nickname: string | null
  last_mismatch_at: string | null
}

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
  expires_at: string
  used_at: string | null
  created_at: string
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
      (id, email, password_hash, salt, iterations, permission, status, cdk_key, cdk_code_hash, cdk_order_hash, record_json, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13)
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
    await client.query(
      'delete from user_profile_workspaces where profile_id in (select id from user_game_accounts where user_id = $1)',
      [userId],
    )
    await client.query('delete from user_workspaces where user_id = $1', [userId])
    await client.query('delete from user_announcement_reads where user_id = $1', [userId])
    await client.query('delete from user_sessions where user_id = $1', [userId])
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

export async function touchSession(session: UserSessionRecord): Promise<void> {
  const updated = { ...session, last_seen_at: new Date().toISOString() }
  await saveUserSession(updated)
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
      (id, user_id, token_hash, expires_at, used_at, created_at)
      values ($1, $2, $3, $4, $5, $6)
      on conflict (id) do update set
        token_hash = excluded.token_hash,
        expires_at = excluded.expires_at,
        used_at = excluded.used_at,
        created_at = excluded.created_at`,
    [token.id, token.user_id, token.token_hash, token.expires_at, token.used_at, token.created_at],
  )
}

export async function getPasswordResetTokenByHash(tokenHash: string): Promise<PasswordResetTokenRecord | null> {
  await ensureSchema()
  const result = await query<PasswordResetTokenRecord>(
    `select id, user_id, token_hash, expires_at, used_at, created_at
      from password_reset_tokens
      where token_hash = $1`,
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
    `select id, user_id, token_hash, expires_at, used_at, created_at
      from password_reset_tokens
      where user_id = $1 and created_at >= $2
      order by created_at desc
      limit 1`,
    [userId, since],
  )
  return result.rows[0] ?? null
}

export async function markPasswordResetTokenUsed(tokenId: string, usedAt = new Date().toISOString()): Promise<void> {
  await ensureSchema()
  await query('update password_reset_tokens set used_at = $2 where id = $1 and used_at is null', [tokenId, usedAt])
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
      (id, user_id, cdk_key, cdk_code_hash, cdk_order_hash, permission, status, display_name, note, record_json, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
     on conflict (id) do update set
      permission = excluded.permission,
      status = excluded.status,
      display_name = excluded.display_name,
      note = excluded.note,
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
      JSON.stringify(profile),
      profile.created_at,
      profile.updated_at,
    ],
  )
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

export async function getLegacyWorkspace(userId: string): Promise<LegacyUserWorkspaceRecord | null> {
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
  await query(
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
    updated_at: new Date().toISOString(),
  }
}

export function toPublicWorkspace(workspace: UserWorkspaceRecord | null): UserWorkspace {
  const normalized = normalizeWorkspaceRecord(workspace)
  const resultHistory = normalized ? getPublicResultHistory(normalized) : []
  return {
    profile_id: normalized?.profile_id ?? null,
    operators: normalized?.operators ?? null,
    config: normalized?.config ?? null,
    elite_overrides: normalized?.elite_overrides ?? {},
    last_result: normalized?.last_result ?? null,
    saved_configs: normalized?.saved_configs ?? [],
    result_history: resultHistory,
    updated_at: normalized?.updated_at ?? null,
  }
}

export function toPublicProfile(profile: UserGameAccountRecord, workspace?: UserWorkspaceRecord | null): UserGameAccount {
  return {
    id: profile.id,
    user_id: profile.user_id,
    kind: normalizeProfileKind(profile),
    permission: profile.permission,
    status: profile.status,
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
    updated_at: typeof workspace.updated_at === 'string' ? workspace.updated_at : new Date().toISOString(),
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
    }]
  }).slice(0, WORKSPACE_SAVED_CONFIG_LIMIT)
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
  }).slice(0, WORKSPACE_RESULT_HISTORY_LIMIT)
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
  return profile.kind === 'depot_value' ? 'depot_value' : 'cdk'
}

export function isDepotValueProfile(profile: Pick<UserGameAccountRecord, 'kind'>): boolean {
  return normalizeProfileKind(profile) === 'depot_value'
}

function countOwnedOperators(operators: LicenseOperator[] | null | undefined): number {
  return operators?.filter((operator) => operator.own !== false).length ?? 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function ensureSchema(): Promise<void> {
  schemaReady ??= ensureDatabaseSchema()
  return schemaReady
}
