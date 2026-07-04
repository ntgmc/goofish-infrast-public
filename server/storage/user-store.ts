import { query } from './postgres'
import { ensureDatabaseSchema } from './schema'
import type { LicenseConfig, LicenseOperator, OptimizeResult, PermissionMode, UserWorkspace } from '../../src/lib/types'

let schemaReady: Promise<void> | null = null

export interface UserAccountRecord {
  version: 1
  id: string
  email: string
  password_hash: string
  salt: string
  iterations: number
  permission: PermissionMode
  status: 'active' | 'frozen' | 'revoked'
  cdk_key: string
  cdk_code_hash: string
  cdk_order_hash: string | null
  created_at: string
  updated_at: string
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
  user_id: string
  operators: LicenseOperator[] | null
  config: LicenseConfig | null
  elite_overrides: Record<string, number>
  last_result: OptimizeResult | null
  updated_at: string
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

export async function getWorkspace(userId: string): Promise<UserWorkspaceRecord | null> {
  await ensureSchema()
  const result = await query<{ record_json: UserWorkspaceRecord }>(
    'select record_json from user_workspaces where user_id = $1',
    [userId],
  )
  return result.rows[0]?.record_json ?? null
}

export async function saveWorkspace(workspace: UserWorkspaceRecord): Promise<void> {
  await ensureSchema()
  await query(
    `insert into user_workspaces
      (user_id, operators_json, config_json, elite_overrides_json, last_result_json, record_json, updated_at)
     values ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7)
     on conflict (user_id) do update set
      operators_json = excluded.operators_json,
      config_json = excluded.config_json,
      elite_overrides_json = excluded.elite_overrides_json,
      last_result_json = excluded.last_result_json,
      record_json = excluded.record_json,
      updated_at = excluded.updated_at`,
    [
      workspace.user_id,
      JSON.stringify(workspace.operators),
      JSON.stringify(workspace.config),
      JSON.stringify(workspace.elite_overrides),
      JSON.stringify(workspace.last_result),
      JSON.stringify(workspace),
      workspace.updated_at,
    ],
  )
}

export function emptyWorkspace(userId: string): UserWorkspaceRecord {
  return {
    version: 1,
    user_id: userId,
    operators: null,
    config: null,
    elite_overrides: {},
    last_result: null,
    updated_at: new Date().toISOString(),
  }
}

export function toPublicWorkspace(workspace: UserWorkspaceRecord | null): UserWorkspace {
  return {
    operators: workspace?.operators ?? null,
    config: workspace?.config ?? null,
    elite_overrides: workspace?.elite_overrides ?? {},
    last_result: workspace?.last_result ?? null,
    updated_at: workspace?.updated_at ?? null,
  }
}

function ensureSchema(): Promise<void> {
  schemaReady ??= ensureDatabaseSchema()
  return schemaReady
}
