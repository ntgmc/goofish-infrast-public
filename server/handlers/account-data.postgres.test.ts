import { createHash, randomUUID } from 'node:crypto'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import accountDataHandler from './account-data'
import { closePool, query } from '../storage/postgres'
import { ensureDatabaseSchema } from '../storage/schema'
import type { UserAccountRecord, UserGameAccountRecord, UserSessionRecord } from '../storage/user-store'

let container: StartedPostgreSqlContainer | undefined

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  process.env.DATABASE_URL = container.getConnectionUri()
  await ensureDatabaseSchema()
})

beforeEach(async () => {
  await query('truncate table account_deletion_email_outbox, user_accounts cascade')
})

afterAll(async () => {
  await closePool()
  if (container) await container.stop()
})

describe('personal data export V4 PostgreSQL contract', () => {
  it('exports invitation, reorder submission, idempotency, and legacy workspace fixtures', async () => {
    const now = new Date('2026-07-31T06:00:00.000Z')
    const user = await seedUser('export-user@example.test', now)
    const invitee = await seedUser('export-invitee@example.test', now)
    const profile = await seedProfile(user.id, now)
    const token = await seedSession(user.id, now)
    const ownerKey = `reorder-job:${profile.id}`
    const jobId = randomUUID()
    await query('insert into invitation_codes (user_id, code, created_at) values ($1, $2, $3)', [
      user.id,
      'ABCDEFGHJK',
      now.toISOString(),
    ])
    await query(
      `insert into invitations
        (id, inviter_user_id, invitee_user_id, invitation_code, status, registered_at,
         activated_at, settled_at, settings_snapshot, settlement_json, updated_at)
       values ($1, $2, $3, 'ABCDEFGHJK', 'registered', $4, null, null,
               '{"version":1}'::jsonb, null, $4)`,
      [randomUUID(), user.id, invitee.id, now.toISOString()],
    )
    await query(
      `insert into user_workspaces
        (user_id, operators_json, config_json, elite_overrides_json, last_result_json, record_json, updated_at)
       values ($1, null, null, '{}'::jsonb, null, $2::jsonb, $3)`,
      [user.id, JSON.stringify({ version: 1, marker: 'legacy-workspace' }), now.toISOString()],
    )
    await query(
      `insert into optimize_jobs
        (id, status, priority, owner_key, permission, source, payload_json, result_json,
         created_at, updated_at, profile_id, billing_user_id)
       values ($1, 'succeeded', 0, $2, 'growth', 'reorder_check', '{}'::jsonb,
               '{"result":"exported"}'::jsonb, $3, $3, $4, $5)`,
      [jobId, ownerKey, now.toISOString(), profile.id, user.id],
    )
    await query(
      `insert into optimization_submissions (id, owner_key, billing_user_id, created_at)
       values ($1, $2, $3, $4)`,
      [randomUUID(), ownerKey, user.id, now.toISOString()],
    )
    await query(
      `insert into optimization_idempotency
        (owner_key, idempotency_key, request_hash, status, job_id, response_json, created_at, updated_at)
       values ($1, 'export-idempotency', 'export-request-hash', 'completed', $2,
               '{"response":"exported"}'::jsonb, $3, $3)`,
      [ownerKey, jobId, now.toISOString()],
    )

    const response = await accountDataHandler(new Request('http://localhost/api/user/data/export', {
      headers: { Cookie: `maa_session=${token}` },
    }))
    const body = await response.json() as Record<string, any>

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(body.version).toBe(4)
    expect(body.invitation_code).toMatchObject({ code: 'ABCDEFGHJK' })
    expect(body.invitations).toEqual([
      expect.objectContaining({ role: 'inviter', invitation_code: 'ABCDEFGHJK' }),
    ])
    expect(body.legacy_workspace).toMatchObject({ marker: 'legacy-workspace' })
    expect(body.optimization_submissions).toEqual([
      expect.objectContaining({ owner_key: ownerKey, billing_user_id: user.id }),
    ])
    expect(body.optimization_idempotency).toEqual([
      expect.objectContaining({
        owner_key: ownerKey,
        request_hash: 'export-request-hash',
        response_json: { response: 'exported' },
      }),
    ])
    expect(body.coverage.account_deletion_email_outbox).toMatchObject({ disposition: 'exclude' })
  })
})

async function seedUser(email: string, now: Date): Promise<UserAccountRecord> {
  const timestamp = now.toISOString()
  const user: UserAccountRecord = {
    version: 1,
    id: randomUUID(),
    email,
    password_hash: 'password-hash',
    salt: 'salt',
    iterations: 1,
    permission: 'growth',
    status: 'active',
    cdk_key: null,
    cdk_code_hash: null,
    cdk_order_hash: null,
    email_verified_at: timestamp,
    created_at: timestamp,
    updated_at: timestamp,
  }
  await query(
    `insert into user_accounts
      (id, email, password_hash, salt, iterations, permission, status, cdk_key,
       cdk_code_hash, cdk_order_hash, email_verified_at, record_json, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, 'active', null, null, null, $7, $8::jsonb, $7, $7)`,
    [user.id, user.email, user.password_hash, user.salt, user.iterations, user.permission, timestamp, JSON.stringify(user)],
  )
  return user
}

async function seedProfile(userId: string, now: Date): Promise<UserGameAccountRecord> {
  const timestamp = now.toISOString()
  const profile: UserGameAccountRecord = {
    version: 1,
    id: randomUUID(),
    user_id: userId,
    kind: 'cdk',
    cdk_key: null,
    cdk_code_hash: null,
    cdk_order_hash: null,
    permission: 'growth',
    status: 'active',
    archived_at: null,
    display_name: '导出档案',
    note: '',
    skland_binding: null,
    skland_pending_binding: null,
    created_at: timestamp,
    updated_at: timestamp,
  }
  await query(
    `insert into user_game_accounts
      (id, user_id, cdk_key, cdk_code_hash, cdk_order_hash, permission, status,
       display_name, note, record_json, created_at, updated_at, kind, archived_at)
     values ($1, $2, null, null, null, $3, 'active', $4, '', $5::jsonb, $6, $6, 'cdk', null)`,
    [profile.id, userId, profile.permission, profile.display_name, JSON.stringify(profile), timestamp],
  )
  return profile
}

async function seedSession(userId: string, now: Date): Promise<string> {
  const token = 'a'.repeat(43)
  const timestamp = now.toISOString()
  const session: UserSessionRecord = {
    version: 1,
    id: randomUUID(),
    user_id: userId,
    token_hash: createHash('sha256').update(token).digest('hex'),
    created_at: timestamp,
    last_seen_at: timestamp,
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  }
  await query(
    `insert into user_sessions
      (id, user_id, token_hash, record_json, created_at, last_seen_at, expires_at)
     values ($1, $2, $3, $4::jsonb, $5, $5, $6)`,
    [session.id, session.user_id, session.token_hash, JSON.stringify(session), timestamp, session.expires_at],
  )
  return token
}
