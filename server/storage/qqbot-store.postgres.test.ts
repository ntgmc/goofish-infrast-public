import { randomUUID } from 'node:crypto'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closePool, query, withTransaction } from './postgres'
import { migrateDatabaseSchema } from './schema'
import { saveUserAccount, saveUserProfile } from './user-store'
import {
  acknowledgeQqBotNotification, bindQqBotAccount, createQqBotBindingCode,
  enqueueQqBotScheduleNotificationInTransaction, getQqBotAccount, getUserQqBotBinding,
  listQqBotScheduleNotifications, setQqBotNotifications, unbindQqBotAccount,
} from './qqbot-store'

let container: PostgreSqlContainer
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  process.env.DATABASE_URL = container.getConnectionUri()
  await migrateDatabaseSchema()
})
afterAll(async () => { await closePool(); if (container) await container.stop() })

let qqSequence = 123450000
async function fixture() {
  const id = randomUUID()
  const now = new Date().toISOString()
  const user = {
    version: 1 as const, id, email: `${id}@example.test`, password_hash: 'test-hash', salt: 'test-salt',
    iterations: 1, permission: 'advanced' as const, status: 'active' as const, cdk_key: null,
    cdk_code_hash: null, cdk_order_hash: null, email_verified_at: now, created_at: now, updated_at: now,
  }
  await saveUserAccount(user)
  const profileId = randomUUID()
  await saveUserProfile({
    version: 1, id: profileId, user_id: id, kind: 'cdk', authorization_source: 'admin_grant',
    permission: 'advanced', status: 'active', cdk_key: null, cdk_code_hash: null, cdk_order_hash: null,
    display_name: '测试档案', note: '', created_at: now, updated_at: now,
  })
  const qq = String(++qqSequence)
  const code = await createQqBotBindingCode(id)
  return { user, profileId, qq, code }
}
async function enqueue(profileId: string, resultId = randomUUID()) {
  await withTransaction((client) => enqueueQqBotScheduleNotificationInTransaction(client, {
    profileId, resultId, title: '测试排班', now: new Date().toISOString(),
  }))
  return resultId
}

describe('QQ bot binding and schedule outbox in PostgreSQL', () => {
  it('stores only a hash and rejects expired, regenerated and consumed binding codes', async () => {
    const { user, qq, code } = await fixture()
    const stored = await query<{ code_hash: string }>('select code_hash from qqbot_binding_codes where user_id = $1', [user.id])
    expect(stored.rows[0].code_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(stored.rows[0].code_hash).not.toBe(code.binding_code)
    const replacement = await createQqBotBindingCode(user.id)
    await expect(bindQqBotAccount(qq, code.binding_code)).rejects.toMatchObject({ code: 'binding_code_invalid' })
    await query("update qqbot_binding_codes set expires_at = now() - interval '1 second' where user_id = $1", [user.id])
    await expect(bindQqBotAccount(qq, replacement.binding_code)).rejects.toMatchObject({ code: 'binding_code_invalid' })
    const fresh = await createQqBotBindingCode(user.id)
    await expect(bindQqBotAccount(qq, fresh.binding_code)).resolves.toMatchObject({ user_id: user.id, notifications_enabled: false })
    await expect(bindQqBotAccount(qq, fresh.binding_code)).rejects.toMatchObject({ code: 'binding_code_invalid' })
    await expect(createQqBotBindingCode(user.id)).rejects.toMatchObject({ code: 'already_bound' })
  })

  it('allows exactly one concurrent redemption and keeps conflicting codes reusable after rollback', async () => {
    const first = await fixture()
    const attempts = await Promise.allSettled([
      bindQqBotAccount(first.qq, first.code.binding_code),
      bindQqBotAccount(String(++qqSequence), first.code.binding_code),
    ])
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1)
    const bound = await getUserQqBotBinding(first.user.id)
    const second = await fixture()
    await expect(bindQqBotAccount(bound!.qq_number, second.code.binding_code)).rejects.toMatchObject({ code: 'binding_conflict' })
    await expect(bindQqBotAccount(second.qq, second.code.binding_code)).resolves.toMatchObject({ user_id: second.user.id })
  })

  it('enqueues only opted-in schedules and applies transaction rollback and result deduplication', async () => {
    const { user, qq, code, profileId } = await fixture()
    const binding = await bindQqBotAccount(qq, code.binding_code)
    await enqueue(profileId)
    expect((await listQqBotScheduleNotifications(100)).notifications.filter((row) => row.binding_id === binding.id)).toEqual([])
    await setQqBotNotifications(user.id, true)
    const resultId = await enqueue(profileId)
    await enqueue(profileId, resultId)
    await expect(withTransaction(async (client) => {
      await enqueueQqBotScheduleNotificationInTransaction(client, {
        profileId, resultId: 'rolled-back', title: '回滚', now: new Date().toISOString(),
      })
      throw new Error('rollback')
    })).rejects.toThrow('rollback')
    const pending = (await listQqBotScheduleNotifications(100)).notifications.filter((row) => row.binding_id === binding.id)
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({ profile_id: profileId, result_id: resultId, qq_number: qq })
  })

  it('scopes acknowledgements to the recipient and makes them idempotent', async () => {
    const first = await fixture()
    await bindQqBotAccount(first.qq, first.code.binding_code)
    await setQqBotNotifications(first.user.id, true)
    const resultId = await enqueue(first.profileId)
    const second = await fixture()
    await bindQqBotAccount(second.qq, second.code.binding_code)
    const pending = (await listQqBotScheduleNotifications(100)).notifications.find((row) => row.result_id === resultId)!
    await expect(acknowledgeQqBotNotification(second.qq, pending.id)).rejects.toMatchObject({ code: 'notification_not_found' })
    await acknowledgeQqBotNotification(first.qq, pending.id)
    await acknowledgeQqBotNotification(first.qq, pending.id)
    expect((await listQqBotScheduleNotifications(100)).notifications.some((row) => row.id === pending.id)).toBe(false)
  })

  it('cancels pending notifications when disabled and prevents resurrection after rebinding', async () => {
    const { user, qq, code, profileId } = await fixture()
    const original = await bindQqBotAccount(qq, code.binding_code)
    await setQqBotNotifications(user.id, true)
    const cancelled = await enqueue(profileId)
    await setQqBotNotifications(user.id, false)
    await setQqBotNotifications(user.id, true)
    expect((await listQqBotScheduleNotifications(100)).notifications.some((row) => row.result_id === cancelled)).toBe(false)
    const oldResult = await enqueue(profileId)
    await unbindQqBotAccount(user.id)
    const fresh = await createQqBotBindingCode(user.id)
    const rebound = await bindQqBotAccount(qq, fresh.binding_code)
    expect(rebound.id).not.toBe(original.id)
    expect(rebound.notifications_enabled).toBe(false)
    await expect(setQqBotNotifications(user.id, true, original.id)).rejects.toMatchObject({ code: 'account_not_bound' })
    await expect(unbindQqBotAccount(user.id, original.id)).rejects.toMatchObject({ code: 'binding_changed' })
    expect((await listQqBotScheduleNotifications(100)).notifications.some((row) => row.result_id === oldResult)).toBe(false)
  })

  it('paginates pending failures without requiring earlier notifications to be acknowledged', async () => {
    const { user, qq, code, profileId } = await fixture()
    await bindQqBotAccount(qq, code.binding_code)
    await setQqBotNotifications(user.id, true)
    const ids = [await enqueue(profileId), await enqueue(profileId), await enqueue(profileId)]
    const collected: string[] = []
    let cursor: string | null = null
    do {
      const page = await listQqBotScheduleNotifications(1, cursor)
      collected.push(...page.notifications.map((row) => row.result_id))
      cursor = page.next_cursor
    } while (cursor)
    expect(collected.filter((id) => ids.includes(id))).toHaveLength(3)
    expect(new Set(collected).size).toBe(collected.length)
    await expect(listQqBotScheduleNotifications(1, 'malformed')).rejects.toMatchObject({ code: 'invalid_cursor' })
  })

  it('blocks frozen accounts and cascades binding and notification data on account deletion', async () => {
    const { user, qq, code, profileId } = await fixture()
    await bindQqBotAccount(qq, code.binding_code)
    await setQqBotNotifications(user.id, true)
    const resultId = await enqueue(profileId)
    await saveUserAccount({ ...user, status: 'frozen' })
    await expect(getQqBotAccount(qq)).rejects.toMatchObject({ code: 'account_unavailable' })
    expect((await listQqBotScheduleNotifications(100)).notifications.some((row) => row.result_id === resultId)).toBe(false)
    await query('delete from user_accounts where id = $1', [user.id])
    expect((await query('select id from qqbot_account_bindings where qq_number = $1', [qq])).rows).toEqual([])
    expect((await query('select id from qqbot_schedule_notifications where result_id = $1', [resultId])).rows).toEqual([])
  })
})
