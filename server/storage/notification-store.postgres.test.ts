import { randomUUID } from 'node:crypto'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { closePool, withTransaction } from './postgres'
import { ensureDatabaseSchema } from './schema'
import { grantItemInTransaction } from './inventory-store'
import { getAnnouncementReads, insertUserAccountForRegistration, markAnnouncementsRead } from './user-store'
import { listUserNotifications, markUserNotificationRead } from './notification-store'

let container: StartedPostgreSqlContainer
let userId: string
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  process.env.DATABASE_URL = container.getConnectionUri()
  await ensureDatabaseSchema()
  userId = randomUUID()
  const now = new Date().toISOString()
  await insertUserAccountForRegistration({ version: 1, id: userId, email: `${userId}@example.test`, password_hash: 'fixture', salt: 'fixture', iterations: 1,
    permission: 'advanced', status: 'active', cdk_key: null, cdk_code_hash: null, cdk_order_hash: null, email_verified_at: now, created_at: now, updated_at: now })
})
afterAll(async () => { await closePool(); await container.stop() })

it('keeps new grant content unread after a stale confirmation, even when grants use the same timestamp', async () => {
  const now = new Date(Date.now() - 1000).toISOString()
  const sourceId = randomUUID()
  const grant = (itemCode: string) => withTransaction((client) => grantItemInTransaction(client, { userId, itemCode, quantity: 1,
    expiry: { mode: 'never' }, sourceType: 'test', sourceId, recipientRole: 'test', now }))
  await grant('priority_compute_coupon')
  const first = (await listUserNotifications(userId)).notifications[0]
  await grant('training_diagnosis_coupon')
  const latest = (await listUserNotifications(userId)).notifications[0]
  expect(latest.id).toBe(first.id)
  expect(latest.updated_at).not.toBe(first.updated_at)
  await expect(markUserNotificationRead(userId, first.id, first.updated_at)).rejects.toMatchObject({ code: 'notification_version_conflict' })
  expect((await listUserNotifications(userId)).unread_count).toBe(1)
  expect(await markUserNotificationRead(userId, latest.id, latest.updated_at)).toBe(0)
})

it('does not let an older announcement acknowledgement replace an already read newer version', async () => {
  const id = randomUUID()
  const older = '2026-07-30T00:00:00.000Z'
  const newer = '2026-07-31T00:00:00.000Z'
  await markAnnouncementsRead(userId, [{ id, updated_at: newer }])
  expect(await markAnnouncementsRead(userId, [{ id, updated_at: older }])).toBe(0)
  const version = (await getAnnouncementReads(userId)).find((item) => item.announcement_id === id)!.announcement_version
  expect(new Date(version!).toISOString()).toBe(newer)
})
