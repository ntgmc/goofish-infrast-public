import { randomUUID } from 'node:crypto'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createPostgresOptimizeJobStore } from './optimize-job-store'
import { closePool, query } from './postgres'
import { ensureDatabaseSchema } from './schema'

let container: StartedPostgreSqlContainer

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  process.env.DATABASE_URL = container.getConnectionUri()
  await ensureDatabaseSchema()
})

afterAll(async () => {
  await closePool()
  if (container) await container.stop()
})

it('retains every dead-letter reference while cleaning expired terminal jobs', async () => {
  const store = createPostgresOptimizeJobStore()
  const old = '2020-01-01T00:00:00.000Z'
  const cutoff = '2021-01-01T00:00:00.000Z'
  const retainedIds: string[] = []
  const terminalStatuses = ['succeeded', 'failed', 'cancelled', 'dead_lettered']

  for (const status of terminalStatuses) {
    for (const letterStatus of [null, 'pending_review', 'replayed', 'resolved']) {
      const job = await store.createJob({
        id: randomUUID(),
        priority: 10,
        owner_key: `license:${randomUUID()}`,
        permission: 'growth',
        source: 'account_profile',
        payload_json: { test: true },
        created_at: old,
      })
      await query(
        'update optimize_jobs set status = $2, finished_at = $3, updated_at = $3 where id = $1',
        [job.id, status, old],
      )
      if (letterStatus === null) continue
      retainedIds.push(job.id)
      await query(
        `insert into optimization_dead_letters
         (id, job_id, owner_key, source, failure_kind, public_error_code,
          internal_error_message, attempt_count, status, created_at, updated_at)
         values ($1, $2, $3, $4, 'application_error', 'application_error',
                 'retention regression', 3, $5, $6, $6)`,
        [randomUUID(), job.id, job.owner_key, job.source, letterStatus, old],
      )
    }
  }

  await expect(store.cleanupOldJobs(cutoff)).resolves.toBeUndefined()
  await expect(store.cleanupOldJobs(cutoff)).resolves.toBeUndefined()
  const remaining = await query<{ id: string }>('select id from optimize_jobs')
  expect(remaining.rows.map(({ id }) => id).sort()).toEqual([...retainedIds].sort())
  const letters = await query<{ job_id: string }>('select job_id from optimization_dead_letters')
  expect(letters.rows.map(({ job_id }) => job_id).sort()).toEqual([...retainedIds].sort())

  await query('delete from optimization_dead_letters')
  await store.cleanupOldJobs(cutoff)
  expect((await query('select id from optimize_jobs')).rows).toEqual([])
})
