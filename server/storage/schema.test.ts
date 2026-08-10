import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CURRENT_PERSONAL_USE_DECLARATION } from '../personal-use-declaration'

const { queryMock, clientQueryMock, connectMock, releaseMock } = vi.hoisted(() => {
  const queryMock = vi.fn()
  return {
    queryMock,
    clientQueryMock: vi.fn((statement: string | { text: string; values?: unknown[] }, values?: unknown[]) => (
      typeof statement === 'string'
        ? queryMock(statement, values)
        : queryMock(statement.text, statement.values)
    )),
    connectMock: vi.fn(),
    releaseMock: vi.fn(),
  }
})

vi.mock('./postgres', () => ({
  getPool: () => ({ connect: connectMock }),
  query: queryMock,
}))

import {
  DATABASE_SCHEMA_CHECKSUM,
  DATABASE_SCHEMA_MINIMUM_APP_VERSION,
  DATABASE_SCHEMA_VERSION,
  ensureDatabaseSchema,
  getRuntimeDatabaseSchemaStatus,
  migrateDatabaseSchema,
  resetRuntimeDatabaseSchemaStateForTesting,
  resolveDatabaseSchemaMode,
  validateRuntimeDatabaseSchema,
} from './schema'

const originalAppRole = process.env.APP_ROLE
const originalNodeEnv = process.env.NODE_ENV

beforeEach(() => {
  queryMock.mockImplementation(successfulSchemaQuery)
  releaseMock.mockReset()
  clientQueryMock.mockClear()
  connectMock.mockReset()
  connectMock.mockResolvedValue({ query: clientQueryMock, release: releaseMock })
  resetRuntimeDatabaseSchemaStateForTesting()
})

afterEach(() => {
  vi.useRealTimers()
  queryMock.mockReset()
  resetRuntimeDatabaseSchemaStateForTesting()
  restoreEnvironment('APP_ROLE', originalAppRole)
  restoreEnvironment('NODE_ENV', originalNodeEnv)
})

describe('database schema ownership', () => {
  it('runs schema DDL only through the explicit migration operation', async () => {
    await migrateDatabaseSchema()

    const statements = queryMock.mock.calls.map(([statement]) => String(statement))
    const schemaStatements = statements.filter((statement) => (
      !statement.includes('goofish_schema_migrations')
      && !statement.includes('pg_advisory_')
      && !statement.includes("set_config('statement_timeout'")
      && !statement.includes('from personal_use_declaration_versions')
    ))
    const combinedSchema = schemaStatements.join('\n')
    expect(schemaStatements.length).toBeGreaterThan(10)
    expect(schemaStatements.every((statement) => !statement.includes('goofish:migration-phase'))).toBe(true)
    expect(combinedSchema).toMatch(/CREATE TABLE IF NOT EXISTS security_rate_limit_buckets/)
    expect(combinedSchema).toMatch(/CREATE TABLE IF NOT EXISTS personal_use_declaration_acceptances/)
    expect(combinedSchema).toMatch(/CREATE TABLE IF NOT EXISTS personal_use_declaration_usage_events/)
    expect(combinedSchema).toMatch(/personal_use_declaration_acceptances_action_check/)
    expect(combinedSchema).toMatch(/metered_personal_create/)
    expect(combinedSchema).toMatch(/optimization_generate/)
    expect(combinedSchema).toMatch(/reorder_check/)
    expect(combinedSchema).toMatch(/ADD COLUMN IF NOT EXISTS acceptance_accepted_at/)
    expect(combinedSchema).toMatch(/CREATE TABLE IF NOT EXISTS user_balance_accounts/)
    expect(combinedSchema).toMatch(/CREATE TABLE IF NOT EXISTS user_balance_transactions/)
    expect(combinedSchema).toMatch(/CREATE TABLE IF NOT EXISTS user_balance_qualification_ledger/)
    expect(combinedSchema).toMatch(/CREATE TABLE IF NOT EXISTS user_balance_reservations/)
    expect(combinedSchema).toMatch(/ADD COLUMN IF NOT EXISTS operation TEXT NOT NULL DEFAULT 'main_schedule'/)
    expect(combinedSchema).toMatch(/metered_billing_quotes_operation_check/)
    expect(combinedSchema).toMatch(/CREATE TABLE IF NOT EXISTS commercial_account_limits/)
    expect(combinedSchema).toMatch(/CREATE TABLE IF NOT EXISTS metered_personal_claims/)
    expect(combinedSchema).toMatch(/ADD COLUMN IF NOT EXISTS billing_user_id/)
    expect(combinedSchema).toMatch(/ADD COLUMN IF NOT EXISTS billing_json/)
    expect(combinedSchema).toMatch(/ADD COLUMN IF NOT EXISTS reserved/)
    expect(combinedSchema).toMatch(/CREATE TABLE IF NOT EXISTS user_notifications/)
    expect(combinedSchema).toMatch(/CREATE TABLE IF NOT EXISTS website_notification_events/)
    expect(combinedSchema).toMatch(/CREATE TABLE IF NOT EXISTS optimization_result_history/)
    expect(combinedSchema).toMatch(/record_json = record_json - 'last_result' - 'result_history' - 'archived_results'/)
    expect(combinedSchema).toMatch(/website_notification_events_version_check/)
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
    expect(combinedSchema).not.toMatch(/WITH workspace_retention AS/)
    expect(combinedSchema).not.toMatch(/trimmed_workspace_history AS/)
    expect(combinedSchema).toMatch(/select 1 from optimize_jobs job/)
    expect(combinedSchema).not.toMatch(/\boptimization_jobs\b/)
    expect(combinedSchema).toMatch(/scaling_samples INTEGER NOT NULL DEFAULT 0/)
    expect(combinedSchema).toMatch(/status IN \('available', 'scaling', 'busy', 'congested', 'overloaded', 'unavailable'\)/)
    expect(statements).toEqual(expect.arrayContaining([
      expect.stringMatching(/select set_config\('statement_timeout', \$1, false\)/i),
      expect.stringMatching(/select pg_advisory_lock/i),
      expect.stringMatching(/create table if not exists goofish_schema_migrations/i),
      expect.stringMatching(/insert into goofish_schema_migrations/i),
      expect.stringMatching(/insert into personal_use_declaration_versions/i),
      expect.stringMatching(/select display_version, effective_date::text, content_text, content_hash/i),
      expect.stringMatching(/status = 'completed'/i),
      expect.stringMatching(/select pg_advisory_unlock/i),
    ]))
    expect(queryMock).toHaveBeenCalledWith(
      "select set_config('statement_timeout', $1, false)",
      ['300000ms'],
    )
    expect(queryMock.mock.calls.some(([, values]) => (
      Array.isArray(values)
      && values.includes(DATABASE_SCHEMA_VERSION)
      && values.includes(DATABASE_SCHEMA_CHECKSUM)
      && values.includes(DATABASE_SCHEMA_MINIMUM_APP_VERSION)
    ))).toBe(true)
    expect(releaseMock).toHaveBeenCalledOnce()
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
      return successfulSchemaQuery(statement)
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
    await expect(ensureDatabaseSchema()).rejects.toThrow('transient database error')
    await ensureDatabaseSchema()
    await ensureDatabaseSchema()

    const [statement, values] = queryMock.mock.calls.find(([candidate]) => (
      String(candidate).includes('information_schema.columns')
      && String(candidate).includes('actual.column_name is null')
    ))!
    expect(statement).toContain('information_schema.columns')
    expect(statement).not.toMatch(/\b(?:alter|create|drop|truncate)\b/i)
    expect(JSON.parse(values[0])).toEqual(expect.arrayContaining([
      { table_name: 'optimize_jobs', column_name: 'cancel_requested_at' },
      { table_name: 'optimize_jobs', column_name: 'execution_stage' },
      { table_name: 'optimize_jobs', column_name: 'stage_updated_at' },
      { table_name: 'optimize_job_attempts', column_name: 'heartbeat_at' },
      { table_name: 'user_profile_workspaces', column_name: 'record_json' },
      { table_name: 'optimization_result_history', column_name: 'result_json' },
      { table_name: 'optimization_result_history', column_name: 'position' },
      { table_name: 'admin_sessions', column_name: 'token_hash' },
      { table_name: 'security_rate_limit_buckets', column_name: 'expires_at' },
    ]))
  })

  it('reports an actionable error when the worker schema is incompatible', async () => {
    process.env.APP_ROLE = 'worker'
    queryMock.mockImplementation(async (statement: string) => {
      if (statement.includes('actual.column_name is null')) {
        return {
          rows: [
            { table_name: 'optimize_job_attempts', column_name: 'heartbeat_at' },
            { table_name: 'optimize_jobs', column_name: 'cancel_requested_at' },
          ],
        }
      }
      return successfulSchemaQuery(statement)
    })

    await expect(validateRuntimeDatabaseSchema()).rejects.toThrow(
      'Runtime database schema is incompatible; missing required columns: ' +
      'optimize_job_attempts.heartbeat_at, optimize_jobs.cancel_requested_at',
    )
  })

  it('does not make dedicated workers depend on API-only tables', async () => {
    process.env.APP_ROLE = 'worker'
    await validateRuntimeDatabaseSchema()

    const workerRequirementsCall = queryMock.mock.calls.find(([statement]) => (
      String(statement).includes('actual.column_name is null')
    ))!
    const workerRequirements = JSON.parse(workerRequirementsCall[1][0])
    expect(workerRequirements).toEqual(expect.arrayContaining([
      { table_name: 'optimize_jobs', column_name: 'execution_stage' },
      { table_name: 'optimize_job_attempts', column_name: 'heartbeat_at' },
      { table_name: 'optimization_result_history', column_name: 'result_json' },
    ]))
    expect(workerRequirements).not.toEqual(expect.arrayContaining([
      { table_name: 'feature_settings', column_name: 'key' },
      { table_name: 'feature_settings', column_name: 'revision' },
      { table_name: 'public_content_settings', column_name: 'key' },
      { table_name: 'public_content_settings', column_name: 'revision' },
      { table_name: 'user_notifications', column_name: 'payload_json' },
      { table_name: 'website_notification_events', column_name: 'event_id' },
    ]))

    queryMock.mockClear()
    process.env.APP_ROLE = 'api'
    await validateRuntimeDatabaseSchema()

    const apiRequirementsCall = queryMock.mock.calls.find(([statement]) => (
      String(statement).includes('actual.column_name is null')
    ))!
    const apiRequirements = JSON.parse(apiRequirementsCall[1][0])
    expect(apiRequirements).toEqual(expect.arrayContaining([
      { table_name: 'feature_settings', column_name: 'key' },
      { table_name: 'feature_settings', column_name: 'record_json' },
      { table_name: 'feature_settings', column_name: 'revision' },
      { table_name: 'public_content_settings', column_name: 'key' },
      { table_name: 'public_content_settings', column_name: 'record_json' },
      { table_name: 'public_content_settings', column_name: 'revision' },
      { table_name: 'user_notifications', column_name: 'payload_json' },
      { table_name: 'website_notification_events', column_name: 'event_id' },
      { table_name: 'website_notification_events', column_name: 'published_at' },
    ]))
    expect(apiRequirements).not.toContainEqual({
      table_name: 'website_notification_events',
      column_name: 'and',
    })
    expect(apiRequirements).not.toContainEqual({
      table_name: 'website_notification_events',
      column_name: 'or',
    })
  })

  it('keeps DDL out of production roles and dedicated workers', () => {
    expect(resolveDatabaseSchemaMode({ APP_ROLE: 'api', NODE_ENV: 'production' })).toBe('validate')
    expect(resolveDatabaseSchemaMode({ APP_ROLE: 'worker', NODE_ENV: 'production' })).toBe('validate')
    expect(resolveDatabaseSchemaMode({ APP_ROLE: 'worker', NODE_ENV: 'development' })).toBe('validate')
    expect(resolveDatabaseSchemaMode({ APP_ROLE: 'api', NODE_ENV: 'development' })).toBe('migrate')
    expect(resolveDatabaseSchemaMode({ APP_ROLE: 'all', NODE_ENV: 'test' })).toBe('migrate')
  })

  it('caches development migration and validation in one process', async () => {
    process.env.APP_ROLE = 'api'
    process.env.NODE_ENV = 'development'

    await ensureDatabaseSchema()
    await ensureDatabaseSchema()

    const statements = queryMock.mock.calls.map(([statement]) => String(statement))
    expect(statements.filter((statement) => statement.includes('CREATE TABLE IF NOT EXISTS cdk_records'))).toHaveLength(1)
    expect(getRuntimeDatabaseSchemaStatus()).toMatchObject({
      version: DATABASE_SCHEMA_VERSION,
      checksum: DATABASE_SCHEMA_CHECKSUM,
      minimumAppVersion: DATABASE_SCHEMA_MINIMUM_APP_VERSION,
    })
  })
})

function restoreEnvironment(name: 'APP_ROLE' | 'NODE_ENV', value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

function successfulSchemaQuery(statement: string): { rows: unknown[] } {
  if (statement.includes('from goofish_schema_migrations')) {
    if (!statement.includes('minimum_app_version')) return { rows: [] }
    return {
      rows: [{
        checksum: DATABASE_SCHEMA_CHECKSUM,
        minimum_app_version: DATABASE_SCHEMA_MINIMUM_APP_VERSION,
        status: 'completed',
      }],
    }
  }
  if (statement.includes('from personal_use_declaration_versions')) {
    return {
      rows: [{
        display_version: CURRENT_PERSONAL_USE_DECLARATION.version,
        effective_date: CURRENT_PERSONAL_USE_DECLARATION.effectiveDate,
        content_text: CURRENT_PERSONAL_USE_DECLARATION.content,
        content_hash: CURRENT_PERSONAL_USE_DECLARATION.contentHash,
      }],
    }
  }
  return { rows: [] }
}
