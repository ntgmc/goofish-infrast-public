import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { closePool, getPool, query, withTransaction } from './postgres'

let container: StartedPostgreSqlContainer | undefined
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  vi.stubEnv('DATABASE_URL', container.getConnectionUri())
  await query('create table drizzle_execution_check (id integer primary key, value text)')
})
afterAll(async () => {
  await closePool()
  await container?.stop()
  vi.unstubAllEnvs()
})

describe('shared Drizzle execution', () => {
  it('keeps positional parameters, literal dollar signs, JSON and binary values intact', async () => {
    const bytes = Buffer.from([0, 127, 255])
    const result = await query(
      `select '$1' as literal, $2::jsonb as document, $1::text as value,
      $1::text as repeated, $3::bytea as bytes, $4::text as empty`,
      ["quote'; --", '{"nested":[1,true]}', bytes, null],
    )
    expect(result.rows).toEqual([
      {
        literal: '$1',
        document: { nested: [1, true] },
        value: "quote'; --",
        repeated: "quote'; --",
        bytes,
        empty: null,
      },
    ])
    expect(result.rowCount).toBe(1)
    expect(result.command).toBe('SELECT')
  })

  it('preserves pg date, interval, array and numeric decoding for existing consumers', async () => {
    const text = `select '2026-11-08T12:34:56Z'::timestamptz as instant,
      '2026-11-08 12:34:56'::timestamp as local_time, '2026-11-08'::date as day,
      array['2026-11-08T12:34:56Z'::timestamptz] as instants,
      '2 days 3 hours'::interval as duration, 123.456::numeric as amount, 1234567890123::bigint as counter`
    const native = await getPool().query(text)
    const actual = await query(text)
    expect(actual.rows).toEqual(native.rows)
    expect(actual.rows[0].instant).toBeInstanceOf(Date)
    expect(actual.rows[0].instants[0]).toBeInstanceOf(Date)
    expect(actual.rows[0].amount).toBe('123.456')
    expect(actual.rows[0].counter).toBe('1234567890123')
  })

  it('commits and rolls back statements on the same borrowed connection', async () => {
    await withTransaction(async (client) => {
      await client.query('insert into drizzle_execution_check values ($1, $2)', [1, 'saved'])
      expect((await client.query('select value from drizzle_execution_check where id = $1', [1])).rows).toEqual([
        { value: 'saved' },
      ])
    })
    const failure = new Error('rollback this change')
    await expect(
      withTransaction(async (client) => {
        await client.query('update drizzle_execution_check set value = $1 where id = $2', ['rolled back', 1])
        throw failure
      }),
    ).rejects.toBe(failure)
    expect((await query('select value from drizzle_execution_check where id = $1', [1])).rows).toEqual([
      { value: 'saved' },
    ])
  })

  it('returns the original PostgreSQL error and releases failed transactions', async () => {
    await expect(
      withTransaction(async (client) => {
        await client.query('insert into drizzle_execution_check values ($1, $2)', [2, 'rollback'])
        await client.query('insert into drizzle_execution_check values ($1, $2)', [2, 'duplicate'])
      }),
    ).rejects.toMatchObject({ code: '23505' })
    expect((await query('select * from drizzle_execution_check where id = $1', [2])).rows).toEqual([])
    expect((await query('select 1 as healthy')).rows).toEqual([{ healthy: 1 }])
    expect(getPool().waitingCount).toBe(0)
  })
})
