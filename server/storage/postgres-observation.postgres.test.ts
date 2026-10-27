import { setTimeout as delay } from 'node:timers/promises'
import { readFile } from 'node:fs/promises'
import type { QueryResult } from 'pg'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { flushPerformanceDurations, withPerformanceContext } from '../performance-observation'
import { closePool, getPool, getPostgresPoolSnapshot, query, withTransaction } from './postgres'

let container: StartedPostgreSqlContainer
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withCommand(['postgres', '-c', 'shared_preload_libraries=pg_stat_statements'])
    .start()
  vi.stubEnv('DATABASE_URL', container.getConnectionUri())
  vi.stubEnv('POSTGRES_POOL_MAX', '1')
})
afterEach(() => {
  flushPerformanceDurations()
  vi.restoreAllMocks()
})
afterAll(async () => {
  await closePool()
  vi.unstubAllEnvs()
  await container?.stop()
})

describe('PostgreSQL observations with the real driver', () => {
  it('executes the read-only pg_stat_statements diagnostic against PostgreSQL 16', async () => {
    await query('create extension pg_stat_statements')
    await query('select $1::integer as fixture', [42])
    const sql = await readFile(new URL('../../deploy/postgres/performance.sql', import.meta.url), 'utf8')
    const results = await getPool().query(sql) as unknown as QueryResult[]
    expect(results[2].rows[0]).toMatchObject({ stats_reset: expect.any(Date) })
    expect(results[3].rows).toContainEqual(expect.objectContaining({ queryid: expect.any(String), calls: expect.any(String) }))
    expect(results[3].fields.map((field) => field.name)).not.toContain('query')
  })

  it('separates connection acquisition from SQL and preserves callback and transaction behavior', async () => {
    const events: Array<Record<string, unknown>> = []
    vi.spyOn(console, 'info').mockImplementation((line: string) => { events.push(JSON.parse(line)) })
    const pool = getPool()
    const held = await pool.connect()
    const waiting = withPerformanceContext({ request_id: 'waiting-request' }, () => query('select pg_sleep(0.3), $1::text as value', ['secret-marker']))
    await delay(120)
    expect(getPostgresPoolSnapshot()).toEqual({ total: 1, idle: 0, waiting: 1 })
    withPerformanceContext({ request_id: 'unrelated-release' }, () => held.release())
    await expect(waiting).resolves.toMatchObject({ rows: [{ value: 'secret-marker' }] })
    expect(events).toContainEqual(expect.objectContaining({ event: 'postgres.acquire', request_id: 'waiting-request', outcome: 'success' }))
    expect(events).toContainEqual(expect.objectContaining({ event: 'postgres.query', request_id: 'waiting-request', outcome: 'success' }))
    expect(JSON.stringify(events)).not.toContain('unrelated-release')

    await withPerformanceContext({ request_id: 'slow-request' }, () => withTransaction(async (client) => {
      const result = await client.query('select pg_sleep(0.3), $1::text as value', ['secret-marker'])
      expect(result.rows[0].value).toBe('secret-marker')
    }))
    const slow = events.find((event) => event.event === 'postgres.query' && event.request_id === 'slow-request')
    expect(slow).toMatchObject({ operation: 'SELECT', outcome: 'success', query_fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(Number(slow?.duration_ms)).toBeGreaterThanOrEqual(250)

    await new Promise<void>((resolve, reject) => pool.connect((error, client, release) => {
      if (error || !client) return reject(error ?? new Error('no client'))
      client.query('select $1::integer as value', [7], (queryError, result) => {
        release()
        if (queryError) return reject(queryError)
        expect(result.rows).toEqual([{ value: 7 }])
        resolve()
      })
    }))
    await new Promise<void>((resolve, reject) => pool.query('select 8 as value', (error, result) => {
      if (error) return reject(error)
      expect(result.rows).toEqual([{ value: 8 }])
      resolve()
    }))
    await expect(query('select broken secret-marker')).rejects.toMatchObject({ code: '42601' })
    await query('create temporary table observation_rollback (value integer)')
    const failure = new Error('application failure')
    await expect(withTransaction(async (client) => {
      await client.query('insert into observation_rollback values (1)')
      throw failure
    })).rejects.toBe(failure)
    expect((await query('select * from observation_rollback')).rows).toEqual([])
    flushPerformanceDurations()
    const acquisition = events.find((event) => event.event === 'performance.duration' && event.metric === 'postgres.acquire')
    expect(Number(acquisition?.max_ms)).toBeGreaterThanOrEqual(100)
    expect(JSON.stringify(events)).not.toContain('secret-marker')
    expect(JSON.stringify(events)).not.toContain('pg_sleep')
  })
})
