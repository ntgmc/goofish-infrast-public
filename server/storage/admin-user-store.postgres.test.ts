import { randomUUID } from 'node:crypto'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AdminUserRecord } from '../handlers/admin-auth'
import { createPostgresAdminSessionStore } from './admin-session-store'
import { createPostgresAdminUserStore } from './admin-user-store'
import { closePool, query } from './postgres'
import { ensureDatabaseSchema } from './schema'

let container: StartedPostgreSqlContainer | undefined
const users = createPostgresAdminUserStore()
const sessions = createPostgresAdminSessionStore()
const user: AdminUserRecord = {
  version: 1,
  username: 'operator',
  disabled: false,
  password_hash: 'fixture-hash',
  salt: 'fixture-salt',
  iterations: 100_000,
  created_at: '2026-11-08T00:00:00.000Z',
  updated_at: '2026-11-08T00:00:00.000Z',
}
const audit = {
  actorUsername: 'security-admin',
  action: 'admin_user.update',
  targetType: 'admin_user',
  targetId: user.username,
  reason: 'transaction test',
  requestId: randomUUID(),
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  process.env.DATABASE_URL = container.getConnectionUri()
  await ensureDatabaseSchema()
})
beforeEach(async () => {
  await query('truncate table admin_users, admin_operation_audit cascade')
})
afterAll(async () => {
  await closePool()
  if (container) await container.stop()
})

describe('administrator transactions and audit persistence', () => {
  it('creates a concurrent administrator once and records only the successful change', async () => {
    const results = await Promise.all([
      users.create(user.username, user, audit),
      users.create(user.username, user, audit),
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await users.get(user.username)).toEqual(user)
    expect((await query('select * from admin_operation_audit')).rows).toHaveLength(1)
  })

  it('commits administrator changes, session revocation and audit records together', async () => {
    await users.create(user.username, user)
    await saveSession()
    const updated = { ...user, password_hash: 'replacement-hash', updated_at: '2026-11-08T01:00:00.000Z' }
    await users.set(user.username, updated, audit)
    expect(await users.get(user.username)).toEqual(updated)
    expect((await query('select * from admin_sessions')).rows).toHaveLength(0)
    expect((await query('select * from admin_operation_audit')).rows).toHaveLength(1)

    await saveSession()
    await users.delete(user.username, { ...audit, action: 'admin_user.delete' })
    expect(await users.get(user.username)).toBeNull()
    expect((await query('select * from admin_sessions')).rows).toHaveLength(0)
    expect((await query('select * from admin_operation_audit')).rows).toHaveLength(2)
  })

  it.each(['create', 'set', 'delete'] as const)(
    'rolls back %s and session changes when the audit write fails',
    async (operation) => {
      if (operation !== 'create') {
        await users.create(user.username, user)
        await saveSession()
      }
      const invalidAudit = { ...audit, createdAt: 'invalid timestamp' }
      const mutation =
        operation === 'delete'
          ? users.delete(user.username, invalidAudit)
          : users[operation](user.username, { ...user, disabled: true }, invalidAudit)
      await expect(mutation).rejects.toMatchObject({ code: '22007' })
      expect(await users.get(user.username)).toEqual(operation === 'create' ? null : user)
      expect((await query('select * from admin_sessions')).rows).toHaveLength(operation === 'create' ? 0 : 1)
      expect((await query('select * from admin_operation_audit')).rows).toHaveLength(0)
    },
  )
})

async function saveSession(): Promise<void> {
  await sessions.save({
    id: randomUUID(),
    username: user.username,
    token_hash: randomUUID(),
    created_at: user.created_at,
    last_seen_at: user.created_at,
    expires_at: '2026-11-09T00:00:00.000Z',
  })
}
