import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg'
import { describeServerError } from '../security/error-reporting'

let pool: Pool | null = null
const DEADLOCK_DETECTED = '40P01'
const SERIALIZATION_FAILURE = '40001'
const RETRIABLE_POSTGRES_CODES = new Set([DEADLOCK_DETECTED, SERIALIZATION_FAILURE])
const MAX_QUERY_RETRIES = 3
const DEFAULT_POOL_MAX = 10
const MIN_POOL_MAX = 1
const MAX_POOL_MAX = 100
const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000
const MIN_CONNECTION_TIMEOUT_MS = 1_000
const MAX_CONNECTION_TIMEOUT_MS = 60_000
const DEFAULT_STATEMENT_TIMEOUT_MS = 25_000
const DEFAULT_QUERY_TIMEOUT_MS = 30_000
const DEFAULT_LOCK_TIMEOUT_MS = 5_000
const DEFAULT_IDLE_TRANSACTION_TIMEOUT_MS = 15_000
const DEFAULT_HEALTH_QUERY_TIMEOUT_MS = 3_000

export function hasDatabaseUrl(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim())
}

export function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    throw new Error('DATABASE_URL not configured')
  }

  if (!pool) {
    const nextPool = new Pool({
      connectionString,
      max: resolvePostgresPoolMax(),
      connectionTimeoutMillis: resolvePostgresConnectionTimeoutMs(),
      statement_timeout: resolvePostgresStatementTimeoutMs(),
      query_timeout: resolvePostgresQueryTimeoutMs(),
      lock_timeout: resolvePostgresLockTimeoutMs(),
      idle_in_transaction_session_timeout: resolvePostgresIdleTransactionTimeoutMs(),
      application_name: 'goofish-infrast-v1',
    })
    nextPool.on('error', (error) => {
      if (pool === nextPool) {
        console.error('[postgres] unexpected error on idle client', describeServerError(error))
      }
    })
    pool = nextPool
  }

  return pool
}

export function resolvePostgresPoolMax(
  environment: Pick<NodeJS.ProcessEnv, 'POSTGRES_POOL_MAX'> = process.env,
): number {
  return resolveIntegerEnvironmentValue(
    'POSTGRES_POOL_MAX',
    environment.POSTGRES_POOL_MAX,
    DEFAULT_POOL_MAX,
    MIN_POOL_MAX,
    MAX_POOL_MAX,
  )
}

export function resolvePostgresConnectionTimeoutMs(
  environment: Pick<NodeJS.ProcessEnv, 'POSTGRES_CONNECTION_TIMEOUT_MS'> = process.env,
): number {
  return resolveIntegerEnvironmentValue(
    'POSTGRES_CONNECTION_TIMEOUT_MS',
    environment.POSTGRES_CONNECTION_TIMEOUT_MS,
    DEFAULT_CONNECTION_TIMEOUT_MS,
    MIN_CONNECTION_TIMEOUT_MS,
    MAX_CONNECTION_TIMEOUT_MS,
  )
}

export function resolvePostgresStatementTimeoutMs(
  environment: Pick<NodeJS.ProcessEnv, 'POSTGRES_STATEMENT_TIMEOUT_MS'> = process.env,
): number {
  return resolveIntegerEnvironmentValue(
    'POSTGRES_STATEMENT_TIMEOUT_MS',
    environment.POSTGRES_STATEMENT_TIMEOUT_MS,
    DEFAULT_STATEMENT_TIMEOUT_MS,
    1_000,
    120_000,
  )
}

export function resolvePostgresQueryTimeoutMs(
  environment: Pick<NodeJS.ProcessEnv, 'POSTGRES_QUERY_TIMEOUT_MS'> = process.env,
): number {
  return resolveIntegerEnvironmentValue(
    'POSTGRES_QUERY_TIMEOUT_MS',
    environment.POSTGRES_QUERY_TIMEOUT_MS,
    DEFAULT_QUERY_TIMEOUT_MS,
    1_000,
    120_000,
  )
}

export function resolvePostgresLockTimeoutMs(
  environment: Pick<NodeJS.ProcessEnv, 'POSTGRES_LOCK_TIMEOUT_MS'> = process.env,
): number {
  return resolveIntegerEnvironmentValue(
    'POSTGRES_LOCK_TIMEOUT_MS',
    environment.POSTGRES_LOCK_TIMEOUT_MS,
    DEFAULT_LOCK_TIMEOUT_MS,
    100,
    60_000,
  )
}

export function resolvePostgresIdleTransactionTimeoutMs(
  environment: Pick<NodeJS.ProcessEnv, 'POSTGRES_IDLE_TRANSACTION_TIMEOUT_MS'> = process.env,
): number {
  return resolveIntegerEnvironmentValue(
    'POSTGRES_IDLE_TRANSACTION_TIMEOUT_MS',
    environment.POSTGRES_IDLE_TRANSACTION_TIMEOUT_MS,
    DEFAULT_IDLE_TRANSACTION_TIMEOUT_MS,
    1_000,
    120_000,
  )
}

export function resolvePostgresHealthQueryTimeoutMs(
  environment: Pick<NodeJS.ProcessEnv, 'POSTGRES_HEALTH_QUERY_TIMEOUT_MS'> = process.env,
): number {
  return resolveIntegerEnvironmentValue(
    'POSTGRES_HEALTH_QUERY_TIMEOUT_MS',
    environment.POSTGRES_HEALTH_QUERY_TIMEOUT_MS,
    DEFAULT_HEALTH_QUERY_TIMEOUT_MS,
    250,
    10_000,
  )
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<QueryResult<T>> {
  let attempt = 0
  while (true) {
    try {
      return await getPool().query<T>({
        text,
        values,
        query_timeout: resolvePostgresQueryTimeoutMs(),
      })
    } catch (error) {
      attempt += 1
      if (!isRetriablePostgresError(error) || attempt > MAX_QUERY_RETRIES) {
        throw error
      }
      await sleep(retryDelayMs(attempt))
    }
  }
}

export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('begin')
    const result = await work(client)
    await client.query('commit')
    return result
  } catch (error) {
    try {
      await client.query('rollback')
    } catch {
      // Preserve the original transaction failure.
    }
    throw error
  } finally {
    client.release()
  }
}

function isRetriablePostgresError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && RETRIABLE_POSTGRES_CODES.has(code)
}

function retryDelayMs(attempt: number): number {
  return 25 * 2 ** (attempt - 1) + Math.floor(Math.random() * 25)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function checkPostgresHealth(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!hasDatabaseUrl()) return { ok: false, error: 'DATABASE_URL not configured' }
  try {
    await getPool().query({
      text: 'select 1',
      query_timeout: resolvePostgresHealthQueryTimeoutMs(),
    })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: describeServerError(error).message }
  }
}

export async function closePool(): Promise<void> {
  if (!pool) return
  const current = pool
  pool = null
  await current.end()
}

function resolveIntegerEnvironmentValue(
  name: string,
  rawValue: string | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const trimmed = rawValue?.trim()
  if (!trimmed) return defaultValue
  const configured = Number(trimmed)
  if (!Number.isFinite(configured)
    || !Number.isInteger(configured)
    || configured < minimum
    || configured > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  return configured
}
