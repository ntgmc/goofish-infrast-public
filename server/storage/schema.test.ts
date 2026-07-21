import { afterEach, describe, expect, it, vi } from 'vitest'

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}))

vi.mock('./postgres', () => ({
  query: queryMock,
}))

import { ensureDatabaseSchema, validateWorkerDatabaseSchema } from './schema'

const originalAppRole = process.env.APP_ROLE
const originalNodeEnv = process.env.NODE_ENV

afterEach(() => {
  queryMock.mockReset()
  restoreEnvironment('APP_ROLE', originalAppRole)
  restoreEnvironment('NODE_ENV', originalNodeEnv)
})

describe('database schema ownership', () => {
  it('validates the dedicated worker schema once without executing DDL', async () => {
    process.env.APP_ROLE = 'worker'
    process.env.NODE_ENV = 'production'
    queryMock.mockResolvedValue({ rows: [] })

    await ensureDatabaseSchema()
    await ensureDatabaseSchema()

    expect(queryMock).toHaveBeenCalledTimes(1)
    const [statement, values] = queryMock.mock.calls[0]
    expect(statement).toContain('information_schema.columns')
    expect(statement).not.toMatch(/\b(?:alter|create|drop|truncate)\b/i)
    expect(JSON.parse(values[0])).toEqual(expect.arrayContaining([
      { table_name: 'optimize_jobs', column_name: 'cancel_requested_at' },
      { table_name: 'optimize_job_attempts', column_name: 'heartbeat_at' },
      { table_name: 'user_profile_workspaces', column_name: 'record_json' },
    ]))
  })

  it('reports an actionable error when the worker schema is incompatible', async () => {
    queryMock.mockResolvedValue({
      rows: [
        { table_name: 'optimize_job_attempts', column_name: 'heartbeat_at' },
        { table_name: 'optimize_jobs', column_name: 'cancel_requested_at' },
      ],
    })

    await expect(validateWorkerDatabaseSchema()).rejects.toThrow(
      'Worker database schema is incompatible; missing required columns: ' +
      'optimize_job_attempts.heartbeat_at, optimize_jobs.cancel_requested_at',
    )
  })

  it('keeps schema migration ownership on the API role', async () => {
    process.env.APP_ROLE = 'api'
    process.env.NODE_ENV = 'production'
    queryMock.mockResolvedValue({ rows: [] })

    await ensureDatabaseSchema()

    expect(queryMock).toHaveBeenCalledTimes(1)
    expect(queryMock.mock.calls[0][0]).toContain('CREATE TABLE IF NOT EXISTS optimize_jobs')
  })
})

function restoreEnvironment(name: 'APP_ROLE' | 'NODE_ENV', value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
