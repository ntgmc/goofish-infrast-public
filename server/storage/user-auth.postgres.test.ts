import { randomUUID } from 'node:crypto'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { FREE_PREVIEW_LIMITED_CDK_ACTIVITY } from '../free-preview-trial'
import { runAuthDataMaintenance } from '../auth-data-maintenance'
import {
  createAdminRegistrationInvitation,
  saveRegistrationWithAdminInvitation,
  validateAdminRegistrationInvitation,
} from './admin-registration-invitation-store'
import { redeemCdkAtomically, saveUserAccountInTransaction } from './cdk-redemption'
import { saveRegistrationWithInvitation } from './invitation-store'
import { closePool, query } from './postgres'
import { ensureDatabaseSchema } from './schema'
import {
  getPasswordResetTokenByHash,
  getRecentEmailVerificationTokenForUser,
  getRecentPasswordResetTokenForUser,
  getSessionByTokenHash,
  getUserById,
  getWorkspace,
  insertUserAccountForRegistration,
  RegistrationEmailConflictError,
  saveEmailVerificationToken,
  savePasswordResetToken,
  saveUserSession,
  updateUserPasswordAtomically,
  verifyUserEmailWithToken,
  type EmailVerificationTokenRecord,
  type PasswordResetTokenRecord,
  type UserAccountRecord,
  type UserSessionRecord,
} from './user-store'

let container: StartedPostgreSqlContainer | undefined

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  process.env.DATABASE_URL = container.getConnectionUri()
  await ensureDatabaseSchema()
})

beforeEach(async () => {
  await query(
    'truncate table user_accounts, brevo_email_deliveries, admin_registration_invitations, cdk_records cascade',
  )
})

afterAll(async () => {
  await closePool()
  if (container) await container.stop()
})

describe('atomic password lifecycle', () => {
  it('invalidates every reset token and revokes every session after a token reset', async () => {
    const now = new Date('2026-07-31T04:00:00.000Z')
    const user = await seedUser('reset-all@example.test', now)
    const firstToken = await seedPasswordResetToken(user.id, now, 'reset-first')
    const secondToken = await seedPasswordResetToken(user.id, now, 'reset-second')
    await seedSession(user.id, now, 'session-first')
    await seedSession(user.id, now, 'session-second')

    const result = await updateUserPasswordAtomically({
      userId: user.id,
      expectedPasswordHash: user.password_hash,
      replacement: replacementPassword('reset-replacement'),
      resetTokenHash: firstToken.token_hash,
      updatedAt: now,
    })

    expect(result).toMatchObject({ ok: true })
    expect(await readPasswordHash(user.id)).toBe('reset-replacement-hash')
    expect(await readTokenUseTimes([firstToken.id, secondToken.id])).toEqual([true, true])
    expect(await countRows('user_sessions', 'user_id', user.id)).toBe(0)
  })

  it('keeps only the current session and invalidates reset links after an active password change', async () => {
    const now = new Date('2026-07-31T05:00:00.000Z')
    const user = await seedUser('active-change@example.test', now)
    const token = await seedPasswordResetToken(user.id, now, 'active-change-reset')
    const currentSession = await seedSession(user.id, now, 'current-session')
    const otherSession = await seedSession(user.id, now, 'other-session')

    const result = await updateUserPasswordAtomically({
      userId: user.id,
      expectedPasswordHash: user.password_hash,
      replacement: replacementPassword('active-replacement'),
      keepSessionTokenHash: currentSession.token_hash,
      updatedAt: now,
    })

    expect(result).toMatchObject({ ok: true })
    expect(await getSessionByTokenHash(currentSession.token_hash)).not.toBeNull()
    expect(await getSessionByTokenHash(otherSession.token_hash)).toBeNull()
    expect(await readTokenUseTimes([token.id])).toEqual([true])
  })

  it('does not consume a token or overwrite the account on stale hash and status conflicts', async () => {
    const now = new Date('2026-07-31T06:00:00.000Z')
    const staleUser = await seedUser('stale-hash@example.test', now)
    const staleToken = await seedPasswordResetToken(staleUser.id, now, 'stale-hash-reset')
    const staleSession = await seedSession(staleUser.id, now, 'stale-hash-session')

    const staleResult = await updateUserPasswordAtomically({
      userId: staleUser.id,
      expectedPasswordHash: 'outdated-password-hash',
      replacement: replacementPassword('must-not-win'),
      resetTokenHash: staleToken.token_hash,
      updatedAt: now,
    })

    expect(staleResult).toEqual({ ok: false, reason: 'password_update_conflict' })
    expect(await readPasswordHash(staleUser.id)).toBe(staleUser.password_hash)
    expect(await readTokenUseTimes([staleToken.id])).toEqual([false])
    expect(await getSessionByTokenHash(staleSession.token_hash)).not.toBeNull()

    const frozenUser = await seedUser('frozen@example.test', now)
    const frozenToken = await seedPasswordResetToken(frozenUser.id, now, 'frozen-reset')
    await query(
      `update user_accounts
          set status = 'frozen',
              record_json = record_json || '{"status":"frozen"}'::jsonb
        where id = $1`,
      [frozenUser.id],
    )

    const frozenResult = await updateUserPasswordAtomically({
      userId: frozenUser.id,
      expectedPasswordHash: frozenUser.password_hash,
      replacement: replacementPassword('must-not-unfreeze'),
      resetTokenHash: frozenToken.token_hash,
      updatedAt: now,
    })

    expect(frozenResult).toEqual({ ok: false, reason: 'password_update_conflict' })
    expect(await readPasswordHash(frozenUser.id)).toBe(frozenUser.password_hash)
    expect(await readTokenUseTimes([frozenToken.id])).toEqual([false])
    expect((await getUserById(frozenUser.id))?.status).toBe('frozen')
  })

  it('allows only one concurrent consumer of the same reset token', async () => {
    const now = new Date('2026-07-31T07:00:00.000Z')
    const user = await seedUser('concurrent-reset@example.test', now)
    const token = await seedPasswordResetToken(user.id, now, 'concurrent-reset')
    const attempt = (suffix: string) => updateUserPasswordAtomically({
      userId: user.id,
      expectedPasswordHash: user.password_hash,
      replacement: replacementPassword(suffix),
      resetTokenHash: token.token_hash,
      updatedAt: now,
    })

    const results = await Promise.all([attempt('concurrent-first'), attempt('concurrent-second')])

    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok && result.reason === 'reset_token_invalid')).toHaveLength(1)
    expect(['concurrent-first-hash', 'concurrent-second-hash']).toContain(await readPasswordHash(user.id))
  })

  it('rolls back the claimed token and password when session revocation fails', async () => {
    const now = new Date('2026-07-31T08:00:00.000Z')
    const user = await seedUser('rollback@example.test', now)
    const token = await seedPasswordResetToken(user.id, now, 'rollback-reset')
    const session = await seedSession(user.id, now, 'rollback-session')
    await query(`
      create function reject_auth_session_deletion() returns trigger language plpgsql as $$
      begin
        raise exception 'injected session deletion failure';
      end
      $$
    `)
    await query(`
      create trigger reject_auth_session_deletion
      before delete on user_sessions
      for each row execute function reject_auth_session_deletion()
    `)

    try {
      await expect(updateUserPasswordAtomically({
        userId: user.id,
        expectedPasswordHash: user.password_hash,
        replacement: replacementPassword('rolled-back'),
        resetTokenHash: token.token_hash,
        updatedAt: now,
      })).rejects.toThrow('injected session deletion failure')
    } finally {
      await query('drop trigger reject_auth_session_deletion on user_sessions')
      await query('drop function reject_auth_session_deletion()')
    }

    expect(await readPasswordHash(user.id)).toBe(user.password_hash)
    expect(await readTokenUseTimes([token.id])).toEqual([false])
    expect(await getSessionByTokenHash(session.token_hash)).not.toBeNull()
  })
})

describe('registration email serialization', () => {
  it('creates at most one account for concurrent inserts of the same normalized email', async () => {
    const now = new Date('2026-07-31T09:00:00.000Z')
    const email = 'same-email@example.test'
    const attempts = await Promise.allSettled([
      insertUserAccountForRegistration(userRecord(email, now)),
      insertUserAccountForRegistration(userRecord(email, now)),
    ])

    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.filter(
      (result) => result.status === 'rejected' && result.reason instanceof RegistrationEmailConflictError,
    )).toHaveLength(1)
    expect(await countRows('user_accounts', 'email', email)).toBe(1)
  })

  it('serializes ordinary, invitation, administrator invitation, and CDK registration', async () => {
    const now = new Date('2026-07-31T09:30:00.000Z')
    const email = 'cross-path@example.test'
    const inviter = await seedUser('inviter@example.test', now)
    const ordinaryUser = userRecord(email, now)
    const recommendedUser = userRecord(email, now)
    const administratorInvitedUser = userRecord(email, now)
    const cdkUser = userRecord(email, now)
    const invitation = await createAdminRegistrationInvitation(now)
    const validatedInvitation = await validateAdminRegistrationInvitation(invitation.code, now)
    const cdkKey = await seedRegistrationCdk(now)

    const attempts = await Promise.allSettled([
      insertUserAccountForRegistration(ordinaryUser),
      saveRegistrationWithInvitation(recommendedUser, {
        code: 'ABCDEFGHJK',
        inviter_user_id: inviter.id,
      }),
      saveRegistrationWithAdminInvitation(
        (client) => saveUserAccountInTransaction(client, administratorInvitedUser),
        validatedInvitation,
        administratorInvitedUser.id,
        now,
      ),
      redeemCdkAtomically({
        key: cdkKey,
        idempotencyScope: `register:${email}`,
        requestHash: 'cross-path-registration',
        prepare: (client) => saveUserAccountInTransaction(client, cdkUser),
        complete: async (_client, record) => ({
          record: { ...record, status: 'used' as const, used_at: now.toISOString() },
          response: null,
        }),
      }),
    ])

    const winningIndex = attempts.findIndex((result) => result.status === 'fulfilled')
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(3)
    expect(await countRows('user_accounts', 'email', email)).toBe(1)

    const recommendationCount = await countRows('invitations', 'invitee_user_id', recommendedUser.id)
    expect(recommendationCount).toBe(winningIndex === 1 ? 1 : 0)

    const invitationRow = await query<{ consumed_at: string | null }>(
      'select consumed_at from admin_registration_invitations where id = $1',
      [invitation.invitation.id],
    )
    expect(invitationRow.rows[0]?.consumed_at !== null).toBe(winningIndex === 2)
    const cdkRow = await query<{ status: string }>('select status from cdk_records where key = $1', [cdkKey])
    expect(cdkRow.rows[0]?.status).toBe(winningIndex === 3 ? 'used' : 'unused')
  })
})

describe('email delivery-backed tokens', () => {
  it('rejects failed password deliveries while retaining uncertain deliveries and their cooldown', async () => {
    const now = new Date('2026-07-31T10:00:00.000Z')
    const user = await seedUser('password-delivery@example.test', now)
    const failedDelivery = await seedDelivery('password_reset', 'failed', now)
    const uncertainDelivery = await seedDelivery('password_reset', 'uncertain', now)
    const failedToken = await seedPasswordResetToken(user.id, now, 'failed-password-delivery', failedDelivery)
    const uncertainToken = await seedPasswordResetToken(user.id, now, 'uncertain-password-delivery', uncertainDelivery)

    expect(await getPasswordResetTokenByHash(failedToken.token_hash)).toBeNull()
    expect(await getRecentPasswordResetTokenForUser(user.id, new Date(now.getTime() - 300_000).toISOString()))
      .toMatchObject({ id: uncertainToken.id, delivery_id: uncertainDelivery })

    const failedReset = await updateUserPasswordAtomically({
      userId: user.id,
      expectedPasswordHash: user.password_hash,
      replacement: replacementPassword('failed-delivery-must-not-apply'),
      resetTokenHash: failedToken.token_hash,
      updatedAt: now,
    })
    expect(failedReset).toEqual({ ok: false, reason: 'reset_token_invalid' })
    expect(await readPasswordHash(user.id)).toBe(user.password_hash)
  })

  it('rejects failed verification deliveries and accepts uncertain deliveries', async () => {
    const now = new Date('2026-07-31T11:00:00.000Z')
    const user = await seedUser('verification-delivery@example.test', now)
    const failedDelivery = await seedDelivery('email_verification', 'failed', now)
    const uncertainDelivery = await seedDelivery('email_verification', 'uncertain', now)
    const failedToken = await seedVerificationToken(user.id, now, 'failed-verification', failedDelivery)
    const uncertainToken = await seedVerificationToken(user.id, now, 'uncertain-verification', uncertainDelivery)

    expect(await getRecentEmailVerificationTokenForUser(user.id, new Date(now.getTime() - 300_000).toISOString()))
      .toMatchObject({ id: uncertainToken.id, delivery_id: uncertainDelivery })
    expect(await verifyUserEmailWithToken(failedToken.token_hash, now)).toBeNull()
    expect(await verifyUserEmailWithToken(uncertainToken.token_hash, now)).toMatchObject({
      id: user.id,
      email_verified_at: now.toISOString(),
    })
  })
})

describe('authentication data maintenance', () => {
  it('deletes failed-delivery tokens after their 30-day audit retention', async () => {
    const failedAt = new Date('2026-08-31T00:00:00.000Z')
    const now = new Date('2026-09-30T00:00:00.000Z')
    const user = await seedUser('failed-retention@example.test', failedAt)
    const passwordDelivery = await seedDelivery('password_reset', 'failed', failedAt)
    const verificationDelivery = await seedDelivery('email_verification', 'failed', failedAt)
    await seedPasswordResetToken(user.id, failedAt, 'failed-retention-password', passwordDelivery)
    await seedVerificationToken(user.id, failedAt, 'failed-retention-verification', verificationDelivery)

    expect(await runAuthDataMaintenance(now)).toMatchObject({
      passwordResetTokens: 1,
      emailVerificationTokens: 1,
    })
  })

  it('enforces batch limits, retention boundaries, and idempotent workspace normalization', async () => {
    const now = new Date('2026-09-30T00:00:00.000Z')
    const cutoff = new Date('2026-08-31T00:00:00.000Z')
    const user = await seedUser('maintenance@example.test', now)
    await seedMaintenanceSessions(user.id, now)
    await seedMaintenanceTokens('password_reset_tokens', user.id, cutoff)
    await seedMaintenanceTokens('email_verification_tokens', user.id, cutoff)
    await seedFreePreviewWorkspaces(user.id, 101)

    expect(await runAuthDataMaintenance(now)).toEqual({
      expiredSessions: 500,
      passwordResetTokens: 500,
      emailVerificationTokens: 500,
      freePreviewWorkspaces: 100,
    })
    expect(await runAuthDataMaintenance(now)).toEqual({
      expiredSessions: 1,
      passwordResetTokens: 1,
      emailVerificationTokens: 1,
      freePreviewWorkspaces: 1,
    })
    expect(await runAuthDataMaintenance(now)).toEqual({
      expiredSessions: 0,
      passwordResetTokens: 0,
      emailVerificationTokens: 0,
      freePreviewWorkspaces: 0,
    })

    expect(await getSessionByTokenHash('maintenance-session-active')).not.toBeNull()
    expect(await countRows('password_reset_tokens', 'token_hash', 'password-reset-retained')).toBe(1)
    expect(await countRows('email_verification_tokens', 'token_hash', 'email-verification-retained')).toBe(1)
    const workspace = await getWorkspace(`${user.id}-free-preview-101`)
    expect(workspace?.free_preview_normalized_activity_id).toBe(FREE_PREVIEW_LIMITED_CDK_ACTIVITY.id)
  })
})

function userRecord(email: string, now: Date): UserAccountRecord {
  const timestamp = now.toISOString()
  return {
    version: 1,
    id: randomUUID(),
    email,
    password_hash: `${randomUUID()}-hash`,
    salt: 'test-salt',
    iterations: 1,
    password_algorithm: 'pbkdf2-sha256',
    permission: 'growth',
    status: 'active',
    cdk_key: null,
    cdk_code_hash: null,
    cdk_order_hash: null,
    email_verified_at: null,
    created_at: timestamp,
    updated_at: timestamp,
  }
}

async function seedUser(email: string, now: Date): Promise<UserAccountRecord> {
  const user = userRecord(email, now)
  await insertUserAccountForRegistration(user)
  return user
}

function replacementPassword(prefix: string) {
  return {
    password_hash: `${prefix}-hash`,
    salt: `${prefix}-salt`,
    iterations: 3,
    password_algorithm: 'argon2id' as const,
  }
}

async function seedSession(userId: string, now: Date, prefix: string): Promise<UserSessionRecord> {
  const session: UserSessionRecord = {
    version: 1,
    id: randomUUID(),
    user_id: userId,
    token_hash: `${prefix}-${randomUUID()}`,
    created_at: now.toISOString(),
    last_seen_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 86_400_000).toISOString(),
  }
  await saveUserSession(session)
  return session
}

async function seedPasswordResetToken(
  userId: string,
  now: Date,
  prefix: string,
  deliveryId: string | null = null,
): Promise<PasswordResetTokenRecord> {
  const token: PasswordResetTokenRecord = {
    id: randomUUID(),
    user_id: userId,
    token_hash: `${prefix}-${randomUUID()}`,
    delivery_id: deliveryId,
    expires_at: new Date(now.getTime() + 3_600_000).toISOString(),
    used_at: null,
    created_at: now.toISOString(),
  }
  await savePasswordResetToken(token)
  return token
}

async function seedVerificationToken(
  userId: string,
  now: Date,
  prefix: string,
  deliveryId: string | null = null,
): Promise<EmailVerificationTokenRecord> {
  const token: EmailVerificationTokenRecord = {
    id: randomUUID(),
    user_id: userId,
    token_hash: `${prefix}-${randomUUID()}`,
    delivery_id: deliveryId,
    expires_at: new Date(now.getTime() + 3_600_000).toISOString(),
    used_at: null,
    created_at: now.toISOString(),
  }
  await saveEmailVerificationToken(token)
  return token
}

async function seedDelivery(
  purpose: 'password_reset' | 'email_verification',
  status: 'failed' | 'uncertain',
  now: Date,
): Promise<string> {
  const id = randomUUID()
  await query(
    `insert into brevo_email_deliveries
      (id, quota_date, purpose, status, reserved_at, completed_at)
     values ($1, $2, $3, $4, $5, $5)`,
    [id, now.toISOString().slice(0, 10), purpose, status, now.toISOString()],
  )
  return id
}

async function seedRegistrationCdk(now: Date): Promise<string> {
  const codeHash = randomUUID().replaceAll('-', '')
  const key = `cdk/${codeHash}.json`
  const record = {
    version: 1,
    code_hash: codeHash,
    permission: 'growth',
    status: 'unused',
    created_at: now.toISOString(),
    used_at: null,
    order_note: null,
    license_order_hash: null,
    operator_count: null,
    config_desc: null,
  }
  await query(
    `insert into cdk_records
      (key, code_hash, status, permission, license_order_hash, record_json, created_at, updated_at)
     values ($1, $2, 'unused', 'growth', null, $3::jsonb, $4, $4)`,
    [key, codeHash, JSON.stringify(record), now.toISOString()],
  )
  return key
}

async function readPasswordHash(userId: string): Promise<string | undefined> {
  return (await query<{ password_hash: string }>(
    'select password_hash from user_accounts where id = $1',
    [userId],
  )).rows[0]?.password_hash
}

async function readTokenUseTimes(ids: string[]): Promise<boolean[]> {
  const result = await query<{ id: string; used: boolean }>(
    `select id, used_at is not null as used
       from password_reset_tokens
      where id = any($1::text[])
      order by array_position($1::text[], id)`,
    [ids],
  )
  return result.rows.map((row) => row.used)
}

async function countRows(table: string, column: string, value: string): Promise<number> {
  const allowed = new Set([
    'user_accounts:email',
    'user_sessions:user_id',
    'password_reset_tokens:token_hash',
    'email_verification_tokens:token_hash',
    'invitations:invitee_user_id',
  ])
  if (!allowed.has(`${table}:${column}`)) throw new Error('Unsupported count query')
  const result = await query<{ count: string }>(
    `select count(*)::text as count from ${table} where ${column} = $1`,
    [value],
  )
  return Number(result.rows[0]?.count ?? 0)
}

async function seedMaintenanceSessions(userId: string, now: Date): Promise<void> {
  await query(
    `insert into user_sessions
      (id, user_id, token_hash, record_json, created_at, last_seen_at, expires_at)
     select 'maintenance-session-' || item,
            $1,
            'maintenance-session-hash-' || item,
            jsonb_build_object(
              'version', 1,
              'id', 'maintenance-session-' || item,
              'user_id', $1,
              'token_hash', 'maintenance-session-hash-' || item,
              'created_at', ($2::timestamptz - interval '1 day')::text,
              'last_seen_at', ($2::timestamptz - interval '1 day')::text,
              'expires_at', case when item <= 500
                then ($2::timestamptz - interval '1 day')::text
                else $2::timestamptz::text
              end
            ),
            $2::timestamptz - interval '1 day',
            $2::timestamptz - interval '1 day',
            case when item <= 500 then $2::timestamptz - interval '1 day' else $2::timestamptz end
       from generate_series(1, 501) item`,
    [userId, now.toISOString()],
  )
  const active: UserSessionRecord = {
    version: 1,
    id: 'maintenance-session-active',
    user_id: userId,
    token_hash: 'maintenance-session-active',
    created_at: now.toISOString(),
    last_seen_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 86_400_000).toISOString(),
  }
  await saveUserSession(active)
}

async function seedMaintenanceTokens(
  table: 'password_reset_tokens' | 'email_verification_tokens',
  userId: string,
  cutoff: Date,
): Promise<void> {
  const prefix = table === 'password_reset_tokens' ? 'password-reset' : 'email-verification'
  await query(
    `insert into ${table} (id, user_id, token_hash, delivery_id, expires_at, used_at, created_at)
     select $1 || '-old-' || item,
            $2,
            $1 || '-old-hash-' || item,
            null,
            case when item <= 499 then $3::timestamptz - interval '1 day' else $3::timestamptz + interval '1 day' end,
            case when item = 500 then $3::timestamptz - interval '1 day' else null end,
            $3::timestamptz - interval '40 days'
       from generate_series(1, 500) item`,
    [prefix, userId, cutoff.toISOString()],
  )
  await query(
    `insert into ${table} (id, user_id, token_hash, delivery_id, expires_at, used_at, created_at)
     values
       ($1 || '-boundary', $2, $1 || '-boundary-hash', null, $3, null, $3),
       ($1 || '-retained', $2, $1 || '-retained', null, $3::timestamptz + interval '1 millisecond', null, $3)`,
    [prefix, userId, cutoff.toISOString()],
  )
}

async function seedFreePreviewWorkspaces(userId: string, count: number): Promise<void> {
  const createdAt = FREE_PREVIEW_LIMITED_CDK_ACTIVITY.startsAt
  const endsAt = FREE_PREVIEW_LIMITED_CDK_ACTIVITY.endsAt
  await query(
    `insert into user_game_accounts
      (id, user_id, cdk_key, cdk_code_hash, cdk_order_hash, permission, status, display_name, note,
       kind, archived_at, record_json, created_at, updated_at)
     select $1 || '-free-preview-' || item,
            $1,
            null,
            null,
            null,
            'free_preview',
            'active',
            'Free preview ' || item,
            '',
            'free_preview',
            null,
            jsonb_build_object(
              'version', 1,
              'id', $1 || '-free-preview-' || item,
              'user_id', $1,
              'kind', 'free_preview',
              'cdk_key', null,
              'cdk_code_hash', null,
              'cdk_order_hash', null,
              'permission', 'free_preview',
              'status', 'active',
              'display_name', 'Free preview ' || item,
              'note', '',
              'temporary_permission', jsonb_build_object(
                'source', 'limited_profile_voucher',
                'activity_id', $2,
                'permission', 'advanced',
                'starts_at', $3,
                'ends_at', $4,
                'operation_id', 'maintenance-test'
              ),
              'created_at', $3,
              'updated_at', $3
            ),
            $3,
            $3
       from generate_series(1, $5::integer) item`,
    [userId, FREE_PREVIEW_LIMITED_CDK_ACTIVITY.id, createdAt, endsAt, count],
  )
  await query(
    `insert into user_profile_workspaces
      (profile_id, operators_json, config_json, elite_overrides_json, last_result_json, record_json, updated_at)
     select $1 || '-free-preview-' || item,
            null,
            null,
            '{}'::jsonb,
            null,
            jsonb_build_object(
              'version', 1,
              'profile_id', $1 || '-free-preview-' || item,
              'operators', null,
              'config', null,
              'elite_overrides', '{}'::jsonb,
              'last_result', null,
              'saved_configs', '[]'::jsonb,
              'result_history', '[]'::jsonb,
              'archived_results', '[]'::jsonb,
              'free_schedule_entitlement', null,
              'free_preview_normalized_activity_id', null,
              'updated_at', $2
            ),
            $2
       from generate_series(1, $3::integer) item`,
    [userId, createdAt, count],
  )
}
