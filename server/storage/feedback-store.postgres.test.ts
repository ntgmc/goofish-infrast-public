import { randomUUID } from 'node:crypto'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createFeedback, getFeedbackImage, listAdminFeedback, listUserFeedback, getFeedbackDetail, updateFeedback } from './feedback-store'
import { listUserNotifications, markUserNotificationRead } from './notification-store'
import { closePool, query } from './postgres'
import { migrateDatabaseSchema } from './schema'

let container: StartedPostgreSqlContainer
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  process.env.DATABASE_URL = container.getConnectionUri()
  await migrateDatabaseSchema()
})
afterAll(async () => { await closePool(); if (container) await container.stop() })

it('persists account, content and image; paginates without image bytes; deletes feedback with its account', async () => {
  const userId = randomUUID()
  await query(`insert into user_accounts (id, email, password_hash, salt, iterations, permission, status, record_json, created_at, updated_at)
    values ($1, 'feedback@example.com', 'hash', 'salt', 1, 'recommended', 'active', '{}'::jsonb, now(), now())`, [userId])
  const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const id = await createFeedback(userId, { category: 'schedule', message: '排班结果异常', image: { type: 'image/png', base64: image.toString('base64') } }, image)
  const page = await listAdminFeedback(1, 25)
  expect(page.pagination.total).toBe(1)
  expect(page.items[0]).toMatchObject({ id, user_id: userId, email: 'feedback@example.com', category: 'schedule', message: '排班结果异常', has_image: true })
  expect(page.items[0]).not.toHaveProperty('image_data')
  expect(await getFeedbackImage(id)).toEqual({ image_type: 'image/png', image_data: image })
  await expect(query(`insert into user_feedback (id, user_id, category, message, image_type, image_data)
    values ($1, $2, 'other', '问题', 'image/png', $3)`, [randomUUID(), userId, Buffer.alloc(1024 * 1024 + 1)])).rejects.toMatchObject({ code: '23514' })
  await query('delete from user_accounts where id = $1', [userId])
  expect(await getFeedbackImage(id)).toBeNull()
  expect((await listAdminFeedback(1, 25)).pagination.total).toBe(0)
})

it('keeps private notes private, requires a public outcome, reopens on user follow-up and atomically updates notifications and audit', async () => {
  const userId = randomUUID()
  const otherId = randomUUID()
  for (const [index, accountId] of [userId, otherId].entries()) await query(`insert into user_accounts (id, email, password_hash, salt, iterations, permission, status, record_json, created_at, updated_at)
    values ($1, $2, 'hash', 'salt', 1, 'recommended', 'active', '{}'::jsonb, now(), now())`, [accountId, `follow-${index}@example.com`])
  const image = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const id = await createFeedback(userId, { category: 'schedule', message: '排班异常', image: { type: 'image/png', base64: image.toString('base64') } }, image)
  const actor = { username: 'operator', audit: { actorUsername: 'operator', action: 'feedback.follow_up', targetType: 'feedback', targetId: id, reason: '跟进排查', requestId: randomUUID() } }
  const draft = { feedback_id: id, expected_revision: 0, request_key: randomUUID(), status: 'open' as const, assignment: 'mine' as const, message: '', internal_note: '私密任务编号 42', reason: '跟进排查' }
  const before = await getFeedbackDetail(id, userId)
  await updateFeedback(draft, actor)
  await updateFeedback(draft, actor)
  const userView = await getFeedbackDetail(id, userId)
  expect(userView.entries).toEqual([])
  expect(userView.feedback.updated_at).toBe(before.feedback.updated_at)
  expect(JSON.stringify(userView)).not.toMatch(/operator|私密|assignee|actor_username|user_id|email|request_key/)
  expect((await getFeedbackDetail(id, null)).entries[0]).toMatchObject({ internal_note: '私密任务编号 42', assignee: 'operator' })
  expect((await listUserNotifications(userId)).notifications).toEqual([])
  expect(await getFeedbackImage(id, otherId)).toBeNull()
  expect((await listUserFeedback(otherId, 1, 25)).items).toEqual([])
  await expect(getFeedbackDetail(id, otherId)).rejects.toMatchObject({ status: 404 })
  await expect(updateFeedback({ feedback_id: id, expected_revision: 1, request_key: randomUUID(), message: '越权' }, { userId: otherId })).rejects.toMatchObject({ status: 404 })
  await expect(updateFeedback({ ...draft, expected_revision: 1, request_key: randomUUID(), status: 'resolved' }, actor)).rejects.toMatchObject({ status: 400, code: 'public_reply_required' })
  const resolve = { ...draft, expected_revision: 1, request_key: randomUUID(), status: 'resolved' as const, message: '已修复排班数据，请重新生成。', internal_note: '' }
  await updateFeedback(resolve, actor)
  await updateFeedback({ ...resolve, expected_revision: 2 }, actor)
  expect((await getFeedbackDetail(id, userId)).feedback).toMatchObject({ status: 'resolved', revision: 2, result: resolve.message })
  let notifications = await listUserNotifications(userId)
  expect(notifications.notifications).toHaveLength(1)
  expect(notifications.notifications[0]).toMatchObject({ type: 'feedback_update', action: { kind: 'feedback', feedback_id: id } })
  const notification = notifications.notifications[0]!
  await markUserNotificationRead(userId, notification.id, notification.updated_at)
  expect((await listUserNotifications(userId)).unread_count).toBe(0)
  await updateFeedback({ feedback_id: id, expected_revision: 2, request_key: randomUUID(), message: '仍然异常，步骤如下' }, { userId })
  expect((await getFeedbackDetail(id, userId)).feedback).toMatchObject({ status: 'processing', revision: 3, result: null })
  await updateFeedback({ ...draft, expected_revision: 3, request_key: randomUUID(), status: 'waiting_user', message: '请提供账号版本。', internal_note: '' }, actor)
  notifications = await listUserNotifications(userId)
  expect(notifications.unread_count).toBe(1)
  expect(notifications.notifications).toHaveLength(1)
  expect(notifications.notifications[0]!.updated_at).not.toBe(notification.updated_at)
  expect((await query('select * from admin_operation_audit where target_id = $1', [id])).rows).toHaveLength(3)
  await query('delete from user_accounts where id = any($1::text[])', [[userId, otherId]])
  expect((await query('select * from user_feedback_entries where feedback_id = $1', [id])).rows).toEqual([])
})

it('rejects stale parallel writes, rolls back audit failures, and paginates complete follow-up records', async () => {
  const userId = randomUUID()
  await query(`insert into user_accounts (id, email, password_hash, salt, iterations, permission, status, record_json, created_at, updated_at)
    values ($1, 'concurrent-feedback@example.com', 'hash', 'salt', 1, 'recommended', 'active', '{}'::jsonb, now(), now())`, [userId])
  const id = await createFeedback(userId, { category: 'other', message: '并发处理' }, null)
  const actor = { username: 'operator', audit: { actorUsername: 'operator', action: 'feedback.follow_up', targetType: 'feedback', targetId: id, reason: '跟进处理', requestId: randomUUID() } }
  const draft = { feedback_id: id, expected_revision: 0, request_key: randomUUID(), status: 'processing' as const, assignment: 'mine' as const, message: '开始排查', internal_note: '', reason: '跟进处理' }
  await expect(updateFeedback(draft, { ...actor, audit: { ...actor.audit, reason: '' } })).rejects.toThrow()
  expect((await getFeedbackDetail(id, null)).feedback.revision).toBe(0)
  expect((await listUserNotifications(userId)).unread_count).toBe(0)
  const race = await Promise.allSettled([updateFeedback(draft, actor), updateFeedback({ ...draft, request_key: randomUUID(), message: '另一位管理员排查' }, { ...actor, username: 'another' })])
  expect(race.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  expect(race.find((result) => result.status === 'rejected')).toMatchObject({ reason: { status: 409 } })
  await expect(updateFeedback({ ...draft, message: '改写已提交内容' }, actor)).rejects.toMatchObject({ status: 409 })
  for (let revision = 1; revision <= 27; revision++) await updateFeedback({ feedback_id: id, expected_revision: revision, request_key: randomUUID(), message: `补充 ${revision}` }, { userId })
  const recent = await getFeedbackDetail(id, userId)
  expect(recent.entries).toHaveLength(25)
  expect(recent.next_before_revision).toBe(4)
  const older = await getFeedbackDetail(id, userId, recent.next_before_revision!)
  expect(older.entries.map((entry) => entry.revision)).toEqual([1, 2, 3])
  expect(older.next_before_revision).toBeNull()
  await query('delete from user_accounts where id = $1', [userId])
})
