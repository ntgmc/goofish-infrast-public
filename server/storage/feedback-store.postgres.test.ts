import { randomUUID } from 'node:crypto'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createFeedback, getFeedbackImage, listAdminFeedback } from './feedback-store'
import { closePool, query } from './postgres'
import { migrateDatabaseSchema } from './schema'

let container: PostgreSqlContainer
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
