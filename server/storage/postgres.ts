import { Pool, type QueryResult, type QueryResultRow } from 'pg'

let pool: Pool | null = null
const DEADLOCK_DETECTED = '40P01'
const SERIALIZATION_FAILURE = '40001'
const RETRIABLE_POSTGRES_CODES = new Set([DEADLOCK_DETECTED, SERIALIZATION_FAILURE])
const MAX_QUERY_RETRIES = 3

export function hasDatabaseUrl(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim())
}

export function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    throw new Error('DATABASE_URL not configured')
  }

  if (!pool) {
    pool = new Pool({
      connectionString,
      max: Number(process.env.POSTGRES_POOL_MAX || 10),
      application_name: 'goofish-infrast-v1',
    })
  }

  return pool
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
