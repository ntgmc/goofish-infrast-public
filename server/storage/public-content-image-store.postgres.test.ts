import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { savePublicContentImage, getPublicContentImage } from './public-content-image-store'
import { closePool, query } from './postgres'
import { migrateDatabaseSchema } from './schema'

let container: StartedPostgreSqlContainer
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  process.env.DATABASE_URL = container.getConnectionUri()
  await migrateDatabaseSchema()
})
afterAll(async () => { await closePool(); if (container) await container.stop() })

it('preserves image bytes across duplicate uploads and keeps image bytes out of public settings', async () => {
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const [first, second] = await Promise.all([savePublicContentImage('image/png', bytes), savePublicContentImage('image/png', bytes)])
  expect(first).toBe(second)
  expect(first).toMatch(/^[a-f0-9]{64}$/)
  expect(await getPublicContentImage(first)).toEqual({ image_type: 'image/png', image_data: bytes })
  expect((await query('select count(*)::int as count from public_content_images')).rows[0].count).toBe(1)
  expect(await getPublicContentImage('0'.repeat(64))).toBeNull()
  for (const [type, data] of [['image/svg+xml', bytes], ['image/png', Buffer.alloc(0)], ['image/png', Buffer.alloc(1024 * 1024 + 1)]] as const) {
    await expect(query('insert into public_content_images (id, image_type, image_data) values ($1, $2, $3)', ['b'.repeat(64), type, data])).rejects.toMatchObject({ code: '23514' })
  }
})
