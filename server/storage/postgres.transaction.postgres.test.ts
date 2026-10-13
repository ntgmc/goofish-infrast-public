import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { closePool, query, withTransaction } from './postgres'
import { migrateDatabaseSchema } from './schema'

let container: StartedPostgreSqlContainer
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withPassword("fixture 'quote\\slash#= space")
    .withHealthCheck({ test: ['CMD', 'pg_isready', '--host', 'localhost', '--username', 'test', '--dbname', 'test'],
      interval: 250, timeout: 1000, retries: 1000 })
    .start()
  vi.stubEnv('DATABASE_URL', container.getConnectionUri())
  await migrateDatabaseSchema()
})
afterAll(async () => {
  await closePool()
  vi.unstubAllEnvs()
  await container?.stop()
})

describe('PostgreSQL transaction and migration safety', () => {
  it('does not let a later transaction commit a timed-out operation after rollback also times out', async () => {
    await query('create table transaction_cleanup_fixture (id text primary key)')
    await closePool()
    vi.stubEnv('POSTGRES_POOL_MAX', '1')
    vi.stubEnv('POSTGRES_QUERY_TIMEOUT_MS', '1000')
    vi.stubEnv('POSTGRES_STATEMENT_TIMEOUT_MS', '10000')
    try {
      const pid = (await query('select pg_backend_pid() as pid')).rows[0].pid
      await expect(withTransaction(async (client) => {
        await client.query("insert into transaction_cleanup_fixture values ('failed')")
        await client.query('select pg_sleep(3)')
      })).rejects.toThrow('Query read timeout')
      await withTransaction((client) => client.query("insert into transaction_cleanup_fixture values ('successful')"))
      expect((await query('select pg_backend_pid() as pid')).rows[0].pid).not.toBe(pid)
      expect((await query('select id from transaction_cleanup_fixture order by id')).rows).toEqual([{ id: 'successful' }])
    } finally {
      await closePool()
      delete process.env.POSTGRES_POOL_MAX
      delete process.env.POSTGRES_QUERY_TIMEOUT_MS
      delete process.env.POSTGRES_STATEMENT_TIMEOUT_MS
    }
  })

  it('connects real libpq through the generated service file with literal special characters', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pg-service-regression-'))
    try {
      const output = join(directory, 'pg_service.conf')
      const url = new URL(container.getConnectionUri())
      url.hostname = '127.0.0.1'
      url.port = '5432'
      url.searchParams.set('sslmode', 'disable')
      const generated = spawnSync(process.execPath, ['scripts/write-pg-service.mjs', '--url-env', 'SERVICE_TEST_URL',
        '--output', output, '--service', 'fixture'], {
        env: { ...process.env, SERVICE_TEST_URL: url.toString() }, encoding: 'utf8',
      })
      expect(generated.status).toBe(0)
      expect(spawnSync('docker', ['cp', output, `${container.getId()}:/tmp/pg_service.conf`]).status).toBe(0)
      const result = await container.exec(['env', 'PGSERVICEFILE=/tmp/pg_service.conf',
        'psql', '--no-psqlrc', '--tuples-only', '--no-align', '--dbname=service=fixture', '--command=select 1'])
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toBe('1')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects lost CDK content and mismatched typed columns while accepting explicit legacy normalization', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'migration-content-regression-'))
    const key = 'cdk/migration-fixture.json'
    const legacy = { code_hash: 'migration-fixture', permission: 'premium', status: 'used',
      license_order_hash: 'migration-order', profile_expires_at: '2020-01-31T00:00:00.000Z', order_note: 'keep' }
    const record = { ...legacy, permission: 'advanced', status: 'used' }
    try {
      await query(`insert into cdk_records (key, code_hash, permission, status, license_order_hash, record_json)
        values ($1, $2, $3, $4, $5, $6::jsonb)`, [key, record.code_hash, record.permission, record.status,
        record.license_order_hash, JSON.stringify(record)])
      const exported = join(directory, 'export.json')
      await writeFile(exported, JSON.stringify({ stores: { cdk_records: [{ key, value: legacy }] } }))
      const verify = () => spawnSync(process.execPath, ['scripts/verify-migrated-data.mjs', '--export', exported], {
        env: process.env, encoding: 'utf8', timeout: 30_000,
      })
      const valid = verify()
      expect(valid.status).toBe(0)
      expect(JSON.parse(valid.stdout).content_sha256.cdk_records).toMatch(/^[a-f0-9]{64}$/)
      await query("update cdk_records set record_json = record_json - 'profile_expires_at' where key = $1", [key])
      const damaged = verify()
      expect(damaged.status).not.toBe(0)
      expect(damaged.stderr).toContain('cdk_records content checksum does not match')
      await query('update cdk_records set record_json = $2::jsonb, permission = $3 where key = $1',
        [key, JSON.stringify(record), 'ultimate'])
      const mismatch = verify()
      expect(mismatch.status).not.toBe(0)
      expect(mismatch.stderr).toContain('CDK typed columns do not match')
    } finally {
      await query('delete from cdk_records where key = $1', [key])
      await rm(directory, { recursive: true, force: true })
    }
  })
})
