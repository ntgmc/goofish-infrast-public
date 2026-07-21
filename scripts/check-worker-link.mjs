import pg from 'pg'

const expectedRole = process.env.APP_ROLE?.trim().toLowerCase()
if (expectedRole !== 'worker') throw new Error('APP_ROLE=worker is required')
const connectionString = process.env.DATABASE_URL?.trim()
if (!connectionString) throw new Error('DATABASE_URL is required')

const pool = new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 })
const startedAt = Date.now()
try {
  await pool.query('select 1')
  process.stdout.write(`Worker link ready (${Date.now() - startedAt} ms)\n`)
} catch {
  throw new Error('PostgreSQL worker link health check failed')
} finally {
  await pool.end()
}
