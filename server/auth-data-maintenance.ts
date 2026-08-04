import { FREE_PREVIEW_LIMITED_CDK_ACTIVITY } from './free-preview-trial'
import { projectExpiredFreePreviewWorkspace } from './free-preview-workspace'
import { ensureDatabaseSchema } from './storage/schema'
import { query, withTransaction } from './storage/postgres'
import {
  normalizeWorkspaceRecord,
  type UserGameAccountRecord,
  type UserWorkspaceRecord,
} from './storage/user-store'

const AUTH_MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000
const TOKEN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const SESSION_BATCH_SIZE = 500
const TOKEN_BATCH_SIZE = 500
const WORKSPACE_BATCH_SIZE = 100

export interface AuthDataMaintenanceResult {
  expiredSessions: number
  passwordResetTokens: number
  emailVerificationTokens: number
  freePreviewWorkspaces: number
  sklandPendingBindings: number
}

let initialized = false
let running = false
let timer: ReturnType<typeof setInterval> | null = null

export async function initializeAuthDataMaintenance(): Promise<void> {
  if (initialized) return
  initialized = true
  timer = setInterval(() => void runSafely(), AUTH_MAINTENANCE_INTERVAL_MS)
  timer.unref?.()
  void runSafely()
}

export function shutdownAuthDataMaintenance(): void {
  if (timer) clearInterval(timer)
  timer = null
  initialized = false
}

export async function runAuthDataMaintenance(now = new Date()): Promise<AuthDataMaintenanceResult> {
  await ensureDatabaseSchema()
  const nowIso = now.toISOString()
  const tokenRetentionCutoff = new Date(now.getTime() - TOKEN_RETENTION_MS).toISOString()
  const expiredSessions = await deleteExpiredSessions(nowIso)
  const passwordResetTokens = await deleteRetainedPasswordResetTokens(tokenRetentionCutoff)
  const emailVerificationTokens = await deleteRetainedEmailVerificationTokens(tokenRetentionCutoff)
  const freePreviewWorkspaces = await persistExpiredFreePreviewWorkspaces(now)
  const sklandPendingBindings = await deleteExpiredSklandPendingBindings(nowIso)
  return { expiredSessions, passwordResetTokens, emailVerificationTokens, freePreviewWorkspaces, sklandPendingBindings }
}

async function runSafely(): Promise<void> {
  if (running) return
  running = true
  try {
    await runAuthDataMaintenance()
  } catch (error) {
    console.warn('[auth-data-maintenance] batch skipped', {
      error: error instanceof Error ? error.name : typeof error,
    })
  } finally {
    running = false
  }
}

async function deleteExpiredSessions(now: string): Promise<number> {
  const deleted = await query(
    `delete from user_sessions
      where id in (
        select id
          from user_sessions
         where expires_at <= $1
         order by expires_at, id
         for update skip locked
         limit $2
      )`,
    [now, SESSION_BATCH_SIZE],
  )
  return deleted.rowCount ?? 0
}

async function deleteRetainedPasswordResetTokens(cutoff: string): Promise<number> {
  const deleted = await query(
    `delete from password_reset_tokens
      where id in (
        select token.id
          from password_reset_tokens token
          left join brevo_email_deliveries delivery on delivery.id = token.delivery_id
         where token.expires_at <= $1
            or (token.used_at is not null and token.used_at <= $1)
            or (delivery.status = 'failed' and delivery.completed_at <= $1)
         order by least(
           token.expires_at,
           coalesce(token.used_at, token.expires_at),
           coalesce(delivery.completed_at, token.expires_at)
         ), token.id
         for update of token skip locked
         limit $2
      )`,
    [cutoff, TOKEN_BATCH_SIZE],
  )
  return deleted.rowCount ?? 0
}

async function deleteRetainedEmailVerificationTokens(cutoff: string): Promise<number> {
  const deleted = await query(
    `delete from email_verification_tokens
      where id in (
        select token.id
          from email_verification_tokens token
          left join brevo_email_deliveries delivery on delivery.id = token.delivery_id
         where token.expires_at <= $1
            or (token.used_at is not null and token.used_at <= $1)
            or (delivery.status = 'failed' and delivery.completed_at <= $1)
         order by least(
           token.expires_at,
           coalesce(token.used_at, token.expires_at),
           coalesce(delivery.completed_at, token.expires_at)
         ), token.id
         for update of token skip locked
         limit $2
      )`,
    [cutoff, TOKEN_BATCH_SIZE],
  )
  return deleted.rowCount ?? 0
}

async function deleteExpiredSklandPendingBindings(now: string): Promise<number> {
  return withTransaction(async (client) => {
    const freePreview = await client.query(
      'delete from free_preview_pending_claims where expires_at <= $1',
      [now],
    )
    const lifetimeVoucher = await client.query(
      'delete from lifetime_voucher_pending_bindings where expires_at <= $1',
      [now],
    )
    const profiles = await client.query(
      `update user_game_accounts
          set record_json = jsonb_set(
                record_json || jsonb_build_object('updated_at', $1::text),
                '{skland_pending_binding}',
                'null'::jsonb,
                true
              ),
              updated_at = greatest(updated_at, $1::timestamptz)
        where record_json->'skland_pending_binding' is not null
          and record_json->'skland_pending_binding' <> 'null'::jsonb
          and (record_json->'skland_pending_binding'->>'expires_at')::timestamptz <= $1::timestamptz`,
      [now],
    )
    return (freePreview.rowCount ?? 0) + (lifetimeVoucher.rowCount ?? 0) + (profiles.rowCount ?? 0)
  })
}

async function persistExpiredFreePreviewWorkspaces(now: Date): Promise<number> {
  if (now.getTime() < Date.parse(FREE_PREVIEW_LIMITED_CDK_ACTIVITY.endsAt)) return 0
  return withTransaction(async (client) => {
    const candidates = await client.query<{
      profile_json: UserGameAccountRecord
      workspace_json: UserWorkspaceRecord
    }>(
      `select profile.record_json as profile_json, workspace.record_json as workspace_json
         from user_profile_workspaces workspace
         join user_game_accounts profile on profile.id = workspace.profile_id
        where coalesce(profile.record_json->>'kind', 'cdk') = 'free_preview'
          and profile.record_json->'temporary_permission'->>'activity_id' = $1
          and profile.record_json->'temporary_permission'->>'ends_at' <= $2
          and coalesce(workspace.record_json->>'free_preview_normalized_activity_id', '') <> $1
        order by workspace.profile_id
        for update of workspace skip locked
        limit $3`,
      [FREE_PREVIEW_LIMITED_CDK_ACTIVITY.id, now.toISOString(), WORKSPACE_BATCH_SIZE],
    )
    let persisted = 0
    for (const row of candidates.rows) {
      const workspace = normalizeWorkspaceRecord(row.workspace_json)
      if (!workspace) continue
      const projection = projectExpiredFreePreviewWorkspace(row.profile_json, workspace, now)
      if (!projection.changed) continue
      const next = projection.workspace
      const updated = await client.query(
        `update user_profile_workspaces
            set operators_json = $2::jsonb,
                config_json = $3::jsonb,
                elite_overrides_json = $4::jsonb,
                last_result_json = null,
                record_json = $5::jsonb,
                updated_at = $6
          where profile_id = $1
            and coalesce(record_json->>'free_preview_normalized_activity_id', '') <> $7`,
        [
          next.profile_id,
          JSON.stringify(next.operators),
          JSON.stringify(next.config),
          JSON.stringify(next.elite_overrides),
          JSON.stringify(next),
          next.updated_at,
          FREE_PREVIEW_LIMITED_CDK_ACTIVITY.id,
        ],
      )
      persisted += updated.rowCount ?? 0
    }
    return persisted
  })
}
