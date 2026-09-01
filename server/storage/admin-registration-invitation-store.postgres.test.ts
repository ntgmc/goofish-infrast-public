import { randomUUID } from 'node:crypto'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closePool, query, withTransaction } from './postgres'
import { ensureDatabaseSchema } from './schema'
import { saveUserAccountInTransaction } from './cdk-redemption'
import {
  AdminRegistrationInvitationError,
  AdminRegistrationInvitationOperationError,
  consumeAdminRegistrationInvitationInTransaction,
  createAdminRegistrationInvitation,
  issueQqBotRegistrationInvitation,
  listAdminRegistrationInvitations,
  revokeAdminRegistrationInvitation,
  saveRegistrationWithAdminInvitation,
  validateAdminRegistrationInvitation,
} from './admin-registration-invitation-store'
import type { UserAccountRecord } from './user-store'

let container: Awaited<ReturnType<PostgreSqlContainer['start']>>

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  process.env.DATABASE_URL = container.getConnectionUri()
  await ensureDatabaseSchema()
})

beforeEach(async () => {
  await query('delete from admin_registration_invitation_audit')
  await query('delete from admin_registration_invitations')
  await query('delete from user_accounts')
})

afterAll(async () => {
  await closePool()
  if (container) await container.stop()
})

describe('administrator registration invitations PostgreSQL store', () => {
  it('issues one recoverable 24-hour invitation per QQ', async () => {
    const now = new Date('2026-09-01T00:00:00.000Z')
    const secret = 'qqbot-integration-token-that-is-at-least-32-bytes'
    const created = await issueQqBotRegistrationInvitation({ qqNumber: '123456789', encryptionSecret: secret, now })
    expect(created).toMatchObject({ status: 'created', code: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{16}$/) })
    if (created.status === 'bound') throw new Error('expected invitation')
    expect(Date.parse(created.expiresAt) - now.getTime()).toBe(24 * 60 * 60 * 1000)

    const repeated = await issueQqBotRegistrationInvitation({ qqNumber: '123456789', encryptionSecret: secret, now })
    expect(repeated).toEqual({ ...created, status: 'active' })

    const stored = await query<{
      code_hash: string
      code_ciphertext: string
      code_recoverable_until: string
      expires_at: string
      qualification_count: string
      invitation_count: string
    }>(
      `select invitation.code_hash, invitation.code_ciphertext,
              invitation.code_recoverable_until::text, invitation.expires_at::text,
              (select count(*)::text from qqbot_registration_qualifications) as qualification_count,
              (select count(*)::text from admin_registration_invitations) as invitation_count
         from qqbot_registration_qualifications qualification
         join admin_registration_invitations invitation on invitation.id = qualification.invitation_id
        where qualification.qq_number = $1`,
      ['123456789'],
    )
    expect(stored.rows[0]).toMatchObject({ qualification_count: '1', invitation_count: '1' })
    expect(stored.rows[0]?.code_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(stored.rows[0]?.code_hash).not.toBe(created.code)
    expect(stored.rows[0]?.code_ciphertext).not.toContain(created.code)
    expect(Date.parse(stored.rows[0]!.code_recoverable_until) - now.getTime()).toBe(24 * 60 * 60 * 1000)
    expect(Date.parse(stored.rows[0]!.expires_at) - now.getTime()).toBe(24 * 60 * 60 * 1000)
  })

  it('renews an expired QQ invitation without leaving two valid codes', async () => {
    const issuedAt = new Date('2026-09-01T00:00:00.000Z')
    const renewedAt = new Date('2026-09-02T01:00:00.000Z')
    const secret = 'qqbot-integration-token-that-is-at-least-32-bytes'
    const created = await issueQqBotRegistrationInvitation({ qqNumber: '223456789', encryptionSecret: secret, now: issuedAt })
    if (created.status === 'bound') throw new Error('expected invitation')

    const renewed = await issueQqBotRegistrationInvitation({ qqNumber: '223456789', encryptionSecret: secret, now: renewedAt })
    expect(renewed).toMatchObject({ status: 'renewed', code: expect.not.stringMatching(created.code) })
    await expect(validateAdminRegistrationInvitation(created.code, renewedAt)).rejects.toBeInstanceOf(AdminRegistrationInvitationError)
    if (renewed.status === 'bound') throw new Error('expected invitation')
    await expect(validateAdminRegistrationInvitation(renewed.code, renewedAt)).resolves.toMatchObject({ id: expect.any(String) })
    expect((await query<{ count: string }>(
      `select count(*)::text as count
         from admin_registration_invitations
        where consumed_at is null and revoked_at is null and expires_at > $1`,
      [renewedAt.toISOString()],
    )).rows[0]?.count).toBe('1')
  })

  it('renews an active QQ invitation when the integration token changes', async () => {
    const now = new Date('2026-09-01T00:00:00.000Z')
    const firstSecret = 'qqbot-integration-token-that-is-at-least-32-bytes'
    const rotatedSecret = 'qqbot-rotated-token-that-is-at-least-32-bytes'
    const created = await issueQqBotRegistrationInvitation({ qqNumber: '523456789', encryptionSecret: firstSecret, now })
    if (created.status === 'bound') throw new Error('expected invitation')

    const renewed = await issueQqBotRegistrationInvitation({ qqNumber: '523456789', encryptionSecret: rotatedSecret, now })
    expect(renewed).toMatchObject({ status: 'renewed', code: expect.not.stringMatching(created.code) })
    await expect(validateAdminRegistrationInvitation(created.code, now)).rejects.toBeInstanceOf(AdminRegistrationInvitationError)
  })

  it('binds the qualifying QQ atomically and prevents a second QQ binding', async () => {
    const now = new Date('2026-09-01T00:00:00.000Z')
    const secret = 'qqbot-integration-token-that-is-at-least-32-bytes'
    const firstInvitation = await issueQqBotRegistrationInvitation({
      qqNumber: '323456789', encryptionSecret: secret, now,
    })
    if (firstInvitation.status === 'bound') throw new Error('expected invitation')
    const firstValidated = await validateAdminRegistrationInvitation(firstInvitation.code, now)
    expect(firstValidated.source).toBe('qqbot')
    const user = userRecord('qq-bound@example.test', now)
    await saveRegistrationWithAdminInvitation(
      (client) => saveUserAccountInTransaction(client, user),
      firstValidated,
      user.id,
      now,
    )

    await expect(issueQqBotRegistrationInvitation({
      qqNumber: '323456789', encryptionSecret: secret, now,
    })).resolves.toEqual({ status: 'bound' })
    expect((await query<{ qq_number: string }>(
      'select qq_number from qqbot_registration_qualifications where bound_user_id = $1',
      [user.id],
    )).rows[0]?.qq_number).toBe('323456789')

    const secondInvitation = await issueQqBotRegistrationInvitation({
      qqNumber: '423456789', encryptionSecret: secret, now,
    })
    if (secondInvitation.status === 'bound') throw new Error('expected invitation')
    const secondValidated = await validateAdminRegistrationInvitation(secondInvitation.code, now)
    await expect(withTransaction((client) => consumeAdminRegistrationInvitationInTransaction(
      client,
      secondValidated,
      user.id,
      now,
    ))).rejects.toMatchObject({ code: '23505' })
    await expect(validateAdminRegistrationInvitation(secondInvitation.code, now)).resolves.toEqual(secondValidated)
  })

  it('claims the configured welcome reward during QQ registration', async () => {
    const now = new Date('2026-09-01T00:00:00.000Z')
    const secret = 'qqbot-integration-token-that-is-at-least-32-bytes'
    await query(
      `update onboarding_task_versions
          set enabled = true,
              rewards_json = '[{"item_code":"priority_compute_coupon","quantity":1,"expiry":{"mode":"never"}}]'::jsonb
        where id = 'onboarding:welcome_inventory:v1'`,
    )
    const invitation = await issueQqBotRegistrationInvitation({ qqNumber: '623456789', encryptionSecret: secret, now })
    if (invitation.status === 'bound') throw new Error('expected invitation')
    const user = userRecord('qq-reward@example.test', now)
    await saveRegistrationWithAdminInvitation(
      (client) => saveUserAccountInTransaction(client, user),
      await validateAdminRegistrationInvitation(invitation.code, now),
      user.id,
      now,
    )

    expect((await query<{ source_type: string; source_id: string; reward_type: string; original_quantity: number }>(
      `select source_type, source_id, reward_type, original_quantity
         from reward_grants where user_id = $1`,
      [user.id],
    )).rows).toEqual([{
      source_type: 'onboarding_task',
      source_id: 'welcome_inventory:onboarding:welcome_inventory:v1',
      reward_type: 'priority_compute_coupon',
      original_quantity: 1,
    }])
    expect((await query<{ claimed_at: string | null }>(
      `select claimed_at from user_onboarding_tasks where user_id = $1 and task_code = 'welcome_inventory'`,
      [user.id],
    )).rows[0]?.claimed_at).toBeTruthy()
  })

  it('creates a hashed one-time code that expires after seven days', async () => {
    const now = new Date('2026-07-21T04:00:00.000Z')
    const created = await createInvitation(now, 'create-hashed')
    expect(created.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/)
    expect(created.invitation).toMatchObject({
      status: 'active', consumed_at: null, revoked_at: null,
      created_by: 'operator', create_reason: 'test issuance',
    })
    expect(Date.parse(created.invitation.expires_at) - now.getTime()).toBe(7 * 24 * 60 * 60 * 1000)

    const stored = await query<{ code_hash: string }>(
      'select code_hash from admin_registration_invitations where id = $1',
      [created.invitation.id],
    )
    expect(stored.rows[0]?.code_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(stored.rows[0]?.code_hash).not.toBe(created.code)

    const replayed = await createInvitation(now, 'create-hashed')
    expect(replayed).toEqual(created)
    const protectedResponse = await query<{ code_ciphertext: string | null; audit_count: string }>(
      `select invitation.code_ciphertext,
              (select count(*)::text from admin_registration_invitation_audit audit
                where audit.invitation_id = invitation.id and audit.action = 'create') as audit_count
         from admin_registration_invitations invitation where invitation.id = $1`,
      [created.invitation.id],
    )
    expect(protectedResponse.rows[0]).toMatchObject({ audit_count: '1', code_ciphertext: expect.any(String) })
    expect(protectedResponse.rows[0]?.code_ciphertext).not.toContain(created.code)
    await expect(createAdminRegistrationInvitation({
      adminUsername: 'operator',
      reason: 'different request',
      idempotencyKey: 'create-hashed',
      encryptionSecret: 'root-secret',
      now,
    })).rejects.toMatchObject<Partial<AdminRegistrationInvitationOperationError>>({ code: 'idempotency_conflict' })

    const listed = await listAdminRegistrationInvitations({ page: 1, pageSize: 20, status: 'active', now })
    expect(listed.records).toEqual([created.invitation])
  })

  it('revokes an active code and rejects revoked or expired codes generically', async () => {
    const now = new Date('2026-07-21T04:00:00.000Z')
    const revoked = await createInvitation(now, 'revoke-active')
    expect(await revokeAdminRegistrationInvitation({
      invitationId: revoked.invitation.id,
      adminUsername: 'operator',
      reason: 'test revoke',
      now,
    })).toMatchObject({ status: 'revoked', revoked_by: 'operator', revoke_reason: 'test revoke' })
    await expect(validateAdminRegistrationInvitation(revoked.code, now)).rejects.toBeInstanceOf(AdminRegistrationInvitationError)

    const expired = await createInvitation(now, 'expired-code')
    await expect(validateAdminRegistrationInvitation(expired.code, new Date('2026-07-29T04:00:00.000Z')))
      .rejects.toBeInstanceOf(AdminRegistrationInvitationError)
    const expiredList = await listAdminRegistrationInvitations({
      page: 1,
      pageSize: 20,
      status: 'expired',
      now: new Date('2026-07-29T04:00:00.000Z'),
    })
    expect(expiredList.records.map((record) => record.id)).toContain(expired.invitation.id)
  })

  it('allows only one concurrent transaction to consume a code', async () => {
    const now = new Date('2026-07-21T04:00:00.000Z')
    const created = await createInvitation(now, 'concurrent-consume')
    const validated = await validateAdminRegistrationInvitation(created.code, now)
    const first = userRecord('first@example.test', now)
    const second = userRecord('second@example.test', now)

    const results = await Promise.allSettled([
      saveRegistrationWithAdminInvitation((client) => saveUserAccountInTransaction(client, first), validated, first.id, now),
      saveRegistrationWithAdminInvitation((client) => saveUserAccountInTransaction(client, second), validated, second.id, now),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(Number((await query<{ count: string }>('select count(*)::text as count from user_accounts')).rows[0]?.count)).toBe(1)

    const used = await listAdminRegistrationInvitations({ page: 1, pageSize: 20, status: 'used', now })
    expect(used.records).toHaveLength(1)
    expect(used.records[0]?.consumed_by_email).toMatch(/^(first|second)@example\.test$/)
    expect(used.records[0]?.verification_status).toBe('pending')
    expect((await query<{ count: string }>(
      'select count(*)::text as count from admin_invitation_verification_outbox where invitation_id = $1',
      [created.invitation.id],
    )).rows[0]?.count).toBe('1')
  })

  it('keeps the invitation active when account persistence rolls back', async () => {
    const now = new Date('2026-07-21T04:00:00.000Z')
    const created = await createInvitation(now, 'rollback-consume')
    const validated = await validateAdminRegistrationInvitation(created.code, now)
    await expect(saveRegistrationWithAdminInvitation(async () => {
      throw new Error('simulated persistence failure')
    }, validated, randomUUID())).rejects.toThrow('simulated persistence failure')
    await expect(validateAdminRegistrationInvitation(created.code, now)).resolves.toEqual(validated)
  })
})

function createInvitation(now: Date, idempotencyKey: string) {
  return createAdminRegistrationInvitation({
    adminUsername: 'operator',
    reason: 'test issuance',
    idempotencyKey,
    encryptionSecret: 'root-secret',
    now,
  })
}

function userRecord(email: string, now: Date): UserAccountRecord {
  const timestamp = now.toISOString()
  return {
    version: 1,
    id: randomUUID(),
    email,
    password_hash: 'test-password-hash',
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
