import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg'

let pool: Pool | null = null
const DEADLOCK_DETECTED = '40P01'
const SERIALIZATION_FAILURE = '40001'
const RETRIABLE_POSTGRES_CODES = new Set([DEADLOCK_DETECTED, SERIALIZATION_FAILURE])
const MAX_QUERY_RETRIES = 3
const DEFAULT_CONNECTION_TIMEOUT_MS = 10_000
const MIN_CONNECTION_TIMEOUT_MS = 1_000
const MAX_CONNECTION_TIMEOUT_MS = 60_000

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
      max: Number(process.env.POSTGRES_POOL_MAX || 10),
      connectionTimeoutMillis: resolvePostgresConnectionTimeoutMs(),
      application_name: 'goofish-infrast-v1',
    })
    nextPool.on('error', (error) => {
      if (pool === nextPool) {
        console.error('[postgres] unexpected error on idle client', error)
      }
    })
    pool = nextPool
  }

  return pool
}

export function resolvePostgresConnectionTimeoutMs(
  environment: Pick<NodeJS.ProcessEnv, 'POSTGRES_CONNECTION_TIMEOUT_MS'> = process.env,
): number {
  const rawValue = environment.POSTGRES_CONNECTION_TIMEOUT_MS?.trim()
  if (!rawValue) return DEFAULT_CONNECTION_TIMEOUT_MS

  const configured = Number(rawValue)
  if (!Number.isInteger(configured)
    || configured < MIN_CONNECTION_TIMEOUT_MS
    || configured > MAX_CONNECTION_TIMEOUT_MS) {
    throw new Error(
      `POSTGRES_CONNECTION_TIMEOUT_MS must be an integer between ${MIN_CONNECTION_TIMEOUT_MS} and ${MAX_CONNECTION_TIMEOUT_MS}`,
    )
  }
  return configured
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<QueryResult<T>> {
  let attempt = 0
  while (true) {
    try {
      return await getPool().query<T>(text, values)
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
  let attempt = 0
  while (true) {
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
      attempt += 1
      if (!isRetriablePostgresError(error) || attempt > MAX_QUERY_RETRIES) throw error
      await sleep(retryDelayMs(attempt))
    } finally {
      client.release()
    }
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
    await query('select 1')
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export async function closePool(): Promise<void> {
  if (!pool) return
  const current = pool
  pool = null
  await current.end()
}
