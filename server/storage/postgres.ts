import { Pool, type QueryResult, type QueryResultRow } from 'pg'

let pool: Pool | null = null

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
  return getPool().query<T>(text, values)
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
