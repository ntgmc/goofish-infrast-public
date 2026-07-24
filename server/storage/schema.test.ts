import { afterEach, describe, expect, it, vi } from 'vitest'

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}))

vi.mock('./postgres', () => ({
  query: queryMock,
}))

import {
  ensureDatabaseSchema,
  migrateDatabaseSchema,
  resolveDatabaseSchemaMode,
  validateRuntimeDatabaseSchema,
} from './schema'

const originalAppRole = process.env.APP_ROLE
const originalNodeEnv = process.env.NODE_ENV

afterEach(() => {
  queryMock.mockReset()
  restoreEnvironment('APP_ROLE', originalAppRole)
  restoreEnvironment('NODE_ENV', originalNodeEnv)
})

describe('database schema ownership', () => {
  it('runs schema DDL only through the explicit migration operation', async () => {
    queryMock.mockResolvedValue({ rows: [] })

    await migrateDatabaseSchema()

    expect(queryMock).toHaveBeenCalledTimes(2)
    expect(queryMock.mock.calls[0][0]).toMatch(/CREATE TABLE IF NOT EXISTS security_rate_limit_buckets/)
    expect(queryMock.mock.calls[0][0]).toMatch(/CREATE TABLE IF NOT EXISTS personal_use_declaration_acceptances/)
    expect(queryMock.mock.calls[0][0]).toMatch(/WITH workspace_retention AS/)
    expect(queryMock.mock.calls[0][0]).toMatch(/trimmed_workspace_history AS/)
    expect(queryMock.mock.calls[0][0]).toMatch(/jsonb_array_elements\(record_json->'saved_configs'\) WITH ORDINALITY/)
    expect(queryMock.mock.calls[0][0]).toMatch(/jsonb_array_elements\(record_json->'result_history'\) WITH ORDINALITY/)
    expect(queryMock.mock.calls[0][0]).toMatch(/select 1 from optimize_jobs job/)
    expect(queryMock.mock.calls[0][0]).not.toMatch(/\boptimization_jobs\b/)
    expect(queryMock.mock.calls[1][0]).toMatch(/insert into personal_use_declaration_versions/i)
  })

  it('retries a transient runtime validation error and then caches success without executing DDL', async () => {
    process.env.APP_ROLE = 'api'
    process.env.NODE_ENV = 'production'
    queryMock.mockRejectedValueOnce(new Error('transient database error'))
    queryMock.mockResolvedValue({ rows: [] })

    await expect(ensureDatabaseSchema()).rejects.toThrow('transient database error')
    await ensureDatabaseSchema()
    await ensureDatabaseSchema()

    expect(queryMock).toHaveBeenCalledTimes(2)
    const [statement, values] = queryMock.mock.calls[1]
    expect(statement).toContain('information_schema.columns')
    expect(statement).not.toMatch(/\b(?:alter|create|drop|truncate)\b/i)
    expect(JSON.parse(values[0])).toEqual(expect.arrayContaining([
      { table_name: 'optimize_jobs', column_name: 'cancel_requested_at' },
      { table_name: 'optimize_jobs', column_name: 'execution_stage' },
      { table_name: 'optimize_jobs', column_name: 'stage_updated_at' },
      { table_name: 'optimize_job_attempts', column_name: 'heartbeat_at' },
      { table_name: 'user_profile_workspaces', column_name: 'record_json' },
      { table_name: 'admin_sessions', column_name: 'token_hash' },
      { table_name: 'security_rate_limit_buckets', column_name: 'expires_at' },
    ]))
  })

  it('reports an actionable error when the worker schema is incompatible', async () => {
    process.env.APP_ROLE = 'worker'
    queryMock.mockResolvedValue({
      rows: [
        { table_name: 'optimize_job_attempts', column_name: 'heartbeat_at' },
        { table_name: 'optimize_jobs', column_name: 'cancel_requested_at' },
      ],
    })

    await expect(validateRuntimeDatabaseSchema()).rejects.toThrow(
      'Runtime database schema is incompatible; missing required columns: ' +
      'optimize_job_attempts.heartbeat_at, optimize_jobs.cancel_requested_at',
    )
  })

  it('does not make dedicated workers depend on API-only tables', async () => {
    process.env.APP_ROLE = 'worker'
    queryMock.mockResolvedValue({ rows: [] })

    await validateRuntimeDatabaseSchema()

    const workerRequirements = JSON.parse(queryMock.mock.calls[0][1][0])
    expect(workerRequirements).toEqual(expect.arrayContaining([
      { table_name: 'optimize_jobs', column_name: 'execution_stage' },
      { table_name: 'optimize_job_attempts', column_name: 'heartbeat_at' },
    ]))
    expect(workerRequirements).not.toEqual(expect.arrayContaining([
      { table_name: 'feature_settings', column_name: 'key' },
      { table_name: 'public_content_settings', column_name: 'key' },
    ]))

    queryMock.mockClear()
    process.env.APP_ROLE = 'api'
    await validateRuntimeDatabaseSchema()

    const apiRequirements = JSON.parse(queryMock.mock.calls[0][1][0])
    expect(apiRequirements).toEqual(expect.arrayContaining([
      { table_name: 'feature_settings', column_name: 'key' },
      { table_name: 'feature_settings', column_name: 'record_json' },
      { table_name: 'public_content_settings', column_name: 'key' },
      { table_name: 'public_content_settings', column_name: 'record_json' },
    ]))
  })

  it('keeps DDL out of production roles and dedicated workers', () => {
    expect(resolveDatabaseSchemaMode({ APP_ROLE: 'api', NODE_ENV: 'production' })).toBe('validate')
    expect(resolveDatabaseSchemaMode({ APP_ROLE: 'worker', NODE_ENV: 'production' })).toBe('validate')
    expect(resolveDatabaseSchemaMode({ APP_ROLE: 'worker', NODE_ENV: 'development' })).toBe('validate')
    expect(resolveDatabaseSchemaMode({ APP_ROLE: 'api', NODE_ENV: 'development' })).toBe('migrate')
    expect(resolveDatabaseSchemaMode({ APP_ROLE: 'all', NODE_ENV: 'test' })).toBe('migrate')
  })
})

function restoreEnvironment(name: 'APP_ROLE' | 'NODE_ENV', value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
