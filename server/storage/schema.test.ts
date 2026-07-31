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
  vi.useRealTimers()
  queryMock.mockReset()
  restoreEnvironment('APP_ROLE', originalAppRole)
  restoreEnvironment('NODE_ENV', originalNodeEnv)
})

describe('database schema ownership', () => {
  it('runs schema DDL only through the explicit migration operation', async () => {
    queryMock.mockResolvedValue({ rows: [] })

    await migrateDatabaseSchema()

    const statements = queryMock.mock.calls.map(([statement]) => String(statement))
    const schemaStatements = statements.slice(0, -1)
    const combinedSchema = schemaStatements.join('\n')
    expect(schemaStatements.length).toBeGreaterThan(10)
    expect(schemaStatements.every((statement) => !statement.includes('goofish:migration-phase'))).toBe(true)
    expect(combinedSchema).toMatch(/CREATE TABLE IF NOT EXISTS security_rate_limit_buckets/)
    expect(combinedSchema).toMatch(/CREATE TABLE IF NOT EXISTS personal_use_declaration_acceptances/)
    expect(combinedSchema).toMatch(/CREATE TABLE IF NOT EXISTS user_balance_accounts/)
    expect(combinedSchema).toMatch(/CREATE TABLE IF NOT EXISTS user_balance_transactions/)
    expect(combinedSchema).toMatch(/CREATE TABLE IF NOT EXISTS user_balance_qualification_ledger/)
    expect(combinedSchema).toMatch(/CREATE TABLE IF NOT EXISTS user_balance_reservations/)
    expect(combinedSchema).toMatch(/CREATE TABLE IF NOT EXISTS commercial_account_limits/)
    expect(combinedSchema).toMatch(/CREATE TABLE IF NOT EXISTS metered_personal_claims/)
    expect(combinedSchema).toMatch(/ADD COLUMN IF NOT EXISTS billing_user_id/)
    expect(combinedSchema).toMatch(/ADD COLUMN IF NOT EXISTS billing_json/)
    expect(combinedSchema).toMatch(/ADD COLUMN IF NOT EXISTS reserved/)
    expect(combinedSchema).toMatch(/CREATE TABLE IF NOT EXISTS user_notifications/)
    expect(combinedSchema).toMatch(/cdk_records_type_payload_check/)
    expect(combinedSchema).toMatch(/cdk_type = 'balance'/)
    expect(combinedSchema).toMatch(/ADD COLUMN IF NOT EXISTS item_code/)
    expect(combinedSchema).toMatch(/ADD COLUMN IF NOT EXISTS item_expires_at/)
    expect(combinedSchema).toMatch(/lifetime_profile_voucher/)
    expect(combinedSchema).toMatch(/limited_profile_voucher/)
    expect(combinedSchema).toMatch(/CREATE TABLE IF NOT EXISTS lifetime_voucher_pending_bindings/)
    expect(combinedSchema).toMatch(/free-preview-limited-cdk-2026/)
    expect(combinedSchema).toMatch(/uq_user_balance_transactions_reference/)
    expect(combinedSchema).toMatch(/WHERE kind <> 'admin_credit_reversal'/)
    expect(combinedSchema.indexOf('ADD COLUMN IF NOT EXISTS cdk_type')).toBeLessThan(
      combinedSchema.indexOf('idx_cdk_records_admin_type_created'),
    )
    expect(combinedSchema).toMatch(/WITH workspace_retention AS/)
    expect(combinedSchema).toMatch(/trimmed_workspace_history AS/)
    expect(combinedSchema).toMatch(/jsonb_array_elements\(record_json->'saved_configs'\) WITH ORDINALITY/)
    expect(combinedSchema).toMatch(/jsonb_array_elements\(record_json->'result_history'\) WITH ORDINALITY/)
    expect(combinedSchema).toMatch(/select 1 from optimize_jobs job/)
    expect(combinedSchema).not.toMatch(/\boptimization_jobs\b/)
    expect(statements.at(-1)).toMatch(/insert into personal_use_declaration_versions/i)
  })

  it('retries only the migration phase that deadlocked', async () => {
    vi.useFakeTimers()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const deadlock = Object.assign(new Error('deadlock detected'), { code: '40P01' })
    let rewardPhaseAttempts = 0
    queryMock.mockImplementation(async (statement: string) => {
      if (statement.includes('ALTER TABLE reward_grants ADD COLUMN')) {
        rewardPhaseAttempts += 1
        if (rewardPhaseAttempts === 1) throw deadlock
      }
      return { rows: [] }
    })

    const migration = migrateDatabaseSchema()
    await vi.runAllTimersAsync()
    await migration

    const statements = queryMock.mock.calls.map(([statement]) => String(statement))
    expect(statements.filter((statement) => statement.includes('CREATE TABLE IF NOT EXISTS cdk_records'))).toHaveLength(1)
    expect(statements.filter((statement) => statement.includes('ALTER TABLE reward_grants ADD COLUMN'))).toHaveLength(2)
    expect(statements.filter((statement) => statement.includes('CREATE TABLE IF NOT EXISTS inventory_ledger'))).toHaveLength(1)
    expect(warning).toHaveBeenCalledWith(expect.stringMatching(/phase \d+\/\d+ failed with 40P01; retrying in 1000ms/))
  })

  it('does not retry a non-transient migration failure', async () => {
    const constraintError = Object.assign(new Error('duplicate data'), { code: '23505' })
    queryMock.mockImplementation(async (statement: string) => {
      if (statement.includes('ALTER TABLE reward_grants ADD COLUMN')) throw constraintError
      return { rows: [] }
    })

    await expect(migrateDatabaseSchema()).rejects.toBe(constraintError)

    const statements = queryMock.mock.calls.map(([statement]) => String(statement))
    expect(statements.filter((statement) => statement.includes('ALTER TABLE reward_grants ADD COLUMN'))).toHaveLength(1)
    expect(statements.some((statement) => statement.includes('CREATE TABLE IF NOT EXISTS inventory_ledger'))).toBe(false)
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
      { table_name: 'feature_settings', column_name: 'revision' },
      { table_name: 'public_content_settings', column_name: 'key' },
      { table_name: 'public_content_settings', column_name: 'revision' },
      { table_name: 'user_notifications', column_name: 'payload_json' },
    ]))

    queryMock.mockClear()
    process.env.APP_ROLE = 'api'
    await validateRuntimeDatabaseSchema()

    const apiRequirements = JSON.parse(queryMock.mock.calls[0][1][0])
    expect(apiRequirements).toEqual(expect.arrayContaining([
      { table_name: 'feature_settings', column_name: 'key' },
      { table_name: 'feature_settings', column_name: 'record_json' },
      { table_name: 'feature_settings', column_name: 'revision' },
      { table_name: 'public_content_settings', column_name: 'key' },
      { table_name: 'public_content_settings', column_name: 'record_json' },
      { table_name: 'public_content_settings', column_name: 'revision' },
      { table_name: 'user_notifications', column_name: 'payload_json' },
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
