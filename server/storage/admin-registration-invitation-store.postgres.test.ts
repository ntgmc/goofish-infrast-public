import { randomUUID } from 'node:crypto'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closePool, query } from './postgres'
import { ensureDatabaseSchema } from './schema'
import { saveUserAccountInTransaction } from './cdk-redemption'
import {
  AdminRegistrationInvitationError,
  createAdminRegistrationInvitation,
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
  await query('delete from admin_registration_invitations')
  await query('delete from user_accounts')
})

afterAll(async () => {
  await closePool()
  if (container) await container.stop()
})

describe('administrator registration invitations PostgreSQL store', () => {
  it('creates a hashed one-time code that expires after seven days', async () => {
    const now = new Date('2026-07-21T04:00:00.000Z')
    const created = await createAdminRegistrationInvitation(now)
    expect(created.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/)
    expect(created.invitation).toMatchObject({ status: 'active', consumed_at: null, revoked_at: null })
    expect(Date.parse(created.invitation.expires_at) - now.getTime()).toBe(7 * 24 * 60 * 60 * 1000)

    const stored = await query<{ code_hash: string }>(
      'select code_hash from admin_registration_invitations where id = $1',
      [created.invitation.id],
    )
    expect(stored.rows[0]?.code_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(stored.rows[0]?.code_hash).not.toBe(created.code)

    const listed = await listAdminRegistrationInvitations({ page: 1, pageSize: 20, status: 'active', now })
    expect(listed.records).toEqual([created.invitation])
  })

  it('revokes an active code and rejects revoked or expired codes generically', async () => {
    const now = new Date('2026-07-21T04:00:00.000Z')
    const revoked = await createAdminRegistrationInvitation(now)
    expect(await revokeAdminRegistrationInvitation(revoked.invitation.id, now)).toMatchObject({ status: 'revoked' })
    await expect(validateAdminRegistrationInvitation(revoked.code, now)).rejects.toBeInstanceOf(AdminRegistrationInvitationError)

    const expired = await createAdminRegistrationInvitation(now)
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
    const created = await createAdminRegistrationInvitation(now)
    const validated = await validateAdminRegistrationInvitation(created.code, now)
    const first = userRecord('first@example.test', now)
    const second = userRecord('second@example.test', now)

    const results = await Promise.allSettled([
      saveRegistrationWithAdminInvitation((client) => saveUserAccountInTransaction(client, first), validated, first.id),
      saveRegistrationWithAdminInvitation((client) => saveUserAccountInTransaction(client, second), validated, second.id),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(Number((await query<{ count: string }>('select count(*)::text as count from user_accounts')).rows[0]?.count)).toBe(1)

    const used = await listAdminRegistrationInvitations({ page: 1, pageSize: 20, status: 'used', now })
    expect(used.records).toHaveLength(1)
    expect(used.records[0]?.consumed_by_email).toMatch(/^(first|second)@example\.test$/)
  })

  it('keeps the invitation active when account persistence rolls back', async () => {
    const now = new Date('2026-07-21T04:00:00.000Z')
    const created = await createAdminRegistrationInvitation(now)
    const validated = await validateAdminRegistrationInvitation(created.code, now)
    await expect(saveRegistrationWithAdminInvitation(async () => {
      throw new Error('simulated persistence failure')
    }, validated, randomUUID())).rejects.toThrow('simulated persistence failure')
    await expect(validateAdminRegistrationInvitation(created.code, now)).resolves.toEqual(validated)
  })
})

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
