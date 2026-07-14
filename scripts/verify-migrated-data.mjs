import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import pg from 'pg'

const { Pool } = pg
const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  console.log('[verify-migrated-data] DATABASE_URL not configured; skipping database verification')
  process.exit(0)
}

const exportPath = process.argv[2] || process.env.MIGRATION_EXPORT_PATH || ''
const expected = exportPath ? JSON.parse(await readFile(resolve(exportPath), 'utf8')) : null
const pool = new Pool({ connectionString: databaseUrl, application_name: 'goofish-infrast-v1-verify' })

try {
  const counts = {
    cdk_records: await countRows('cdk_records'),
    announcements: await countRows('announcements'),
    usage_events: await countRows('usage_events'),
    admin_users: await countRows('admin_users'),
  }
  console.log(`[verify-migrated-data] database counts ${JSON.stringify(counts)}`)

  if (expected) {
    assertAtLeast(counts.cdk_records, expected.stores?.cdk_records?.length ?? 0, 'cdk_records')
    assertAtLeast(counts.announcements, expected.stores?.announcements?.length ?? 0, 'announcements')
    assertAtLeast(counts.usage_events, expected.stores?.usage_events?.length ?? 0, 'usage_events')
    assertAtLeast(counts.admin_users, expected.stores?.admin_users?.length ?? 0, 'admin_users')
  }

  await assertIndexes()
  await verifyLicenseStatusIfConfigured()
  console.log('[verify-migrated-data] ok')
} finally {
  await pool.end()
}

async function countRows(table) {
  const result = await pool.query(`select count(*)::int as count from ${table}`)
  return result.rows[0].count
}

function assertAtLeast(actual, expectedCount, label) {
  if (actual < expectedCount) {
    throw new Error(`${label} count ${actual} is less than exported count ${expectedCount}`)
  }
}

async function assertIndexes() {
  const result = await pool.query(
    `select indexname from pg_indexes
     where tablename in ('cdk_records', 'usage_events', 'user_game_accounts')
     and indexname = any($1::text[])`,
    [
      [
        'idx_cdk_records_status',
        'idx_cdk_records_license_order_hash',
        'uq_cdk_records_license_order_hash',
        'idx_usage_events_date',
        'idx_usage_events_event',
        'uq_user_game_accounts_cdk_code_hash',
      ],
    ],
  )
  if (result.rows.length !== 6) {
    throw new Error('missing required migration indexes')
  }
  const idempotencyTable = await pool.query("select to_regclass('public.cdk_redemption_idempotency') as name")
  if (!idempotencyTable.rows[0]?.name) throw new Error('missing cdk_redemption_idempotency table')
}

async function verifyLicenseStatusIfConfigured() {
  const licensePath = process.env.VERIFY_LICENSE_FILE
  const apiBaseUrl = process.env.API_BASE_URL
  if (!licensePath || !apiBaseUrl) return

  const license = JSON.parse(await readFile(resolve(licensePath), 'utf8'))
  const response = await fetch(new URL('/api/license-status', apiBaseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ license }),
  })
  if (!response.ok) {
    throw new Error(`/api/license-status verification failed with ${response.status}: ${await response.text()}`)
  }
}
