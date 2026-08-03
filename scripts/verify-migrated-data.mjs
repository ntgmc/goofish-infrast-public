import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import pg from 'pg'
import databaseSchemaContract from '../server/database-schema-contract.json' with { type: 'json' }
import {
  MIGRATION_STORES,
  checksumKeys,
  checksumRows,
  validateMigrationExport,
} from './migration-verifier-lib.mjs'

const { Pool } = pg
const databaseUrl = String(process.env.DATABASE_URL ?? '').trim()
if (!databaseUrl) throw new Error('[verify-migrated-data] DATABASE_URL is required')

const argumentsMap = parseArguments(process.argv.slice(2))
const exportPath = argumentsMap.export || process.env.MIGRATION_EXPORT_PATH || ''
const expected = exportPath
  ? validateMigrationExport(JSON.parse(await readFile(resolve(exportPath), 'utf8')))
  : null
const allowAdditionalRows = process.env.MIGRATION_ALLOW_ADDITIONAL_ROWS === 'true'
const connectionTimeoutMs = readPositiveInteger('MIGRATION_VERIFY_CONNECTION_TIMEOUT_MS', 10_000)
const statementTimeoutMs = readPositiveInteger('MIGRATION_VERIFY_STATEMENT_TIMEOUT_MS', 30_000)
const overallTimeoutMs = readPositiveInteger('MIGRATION_VERIFY_OVERALL_TIMEOUT_MS', 120_000)
const deadline = Date.now() + overallTimeoutMs
const pool = new Pool({
  connectionString: databaseUrl,
  application_name: 'goofish-infrast-v1-verify',
  connectionTimeoutMillis: connectionTimeoutMs,
  statement_timeout: statementTimeoutMs,
  query_timeout: statementTimeoutMs + 5_000,
  max: 2,
})

const report = {
  ok: false,
  schema_version: databaseSchemaContract.version,
  counts: {},
  key_sha256: {},
  content_sha256: {},
  invalid_credential_formats: 0,
  unvalidated_constraints: 0,
  sequences: 0,
}

try {
  await assertSchemaIdentity()
  await assertCriticalTablesAndPrimaryKeys()
  for (const [storeName, definition] of Object.entries(MIGRATION_STORES)) {
    const rows = await readStoreRows(storeName, definition, expected?.[storeName] ?? null)
    report.counts[storeName] = rows.totalCount
    report.key_sha256[storeName] = checksumKeys(rows.allKeys)
    if (expected) assertExpectedKeys(storeName, rows.allKeys, expected[storeName].map((entry) => entry.primaryKey))
    if (storeName !== 'cdk_records') {
      report.content_sha256[storeName] = checksumRows(rows.selectedRows)
      if (expected) {
        const expectedChecksum = checksumRows(expected[storeName])
        if (report.content_sha256[storeName] !== expectedChecksum) throw new Error(`${storeName} content checksum does not match the migration export`)
      }
    }
  }
  report.unvalidated_constraints = await assertIndexesAndConstraints()
  report.invalid_credential_formats = await countInvalidCredentialFormats()
  if (report.invalid_credential_formats > 0) throw new Error('stored Skland credentials contain an invalid encrypted format')
  report.sequences = await countSequences()
  report.ok = true
  console.log(JSON.stringify({ type: 'migration_verification', ...report }))
} finally {
  await pool.end()
}

async function assertSchemaIdentity() {
  const result = await query(
    `select checksum, minimum_app_version, status
       from goofish_schema_migrations
      where version = $1`,
    [databaseSchemaContract.version],
  )
  const migration = result.rows[0]
  if (!migration || migration.status !== 'completed' || !/^[0-9a-f]{64}$/.test(migration.checksum)
    || migration.minimum_app_version !== databaseSchemaContract.minimum_app_version) {
    throw new Error(`database schema ${databaseSchemaContract.version} is not fully applied`)
  }
}

async function assertCriticalTablesAndPrimaryKeys() {
  const tables = [
    'admin_users', 'announcements', 'cdk_records', 'cdk_redemption_idempotency',
    'goofish_schema_migrations', 'usage_events', 'user_accounts', 'user_game_accounts',
  ]
  const result = await query(
    `select required.name, to_regclass('public.' || required.name) is not null as exists,
            exists (
              select 1 from pg_constraint item_constraint
               where item_constraint.conrelid = to_regclass('public.' || required.name)
                 and item_constraint.contype = 'p'
            ) as has_primary_key
       from unnest($1::text[]) as required(name)`,
    [tables],
  )
  const invalid = result.rows.filter((row) => !row.exists || !row.has_primary_key)
  if (invalid.length > 0) throw new Error(`missing critical table or primary key: ${invalid.map((row) => row.name).join(', ')}`)
}

async function readStoreRows(storeName, definition, expectedRows) {
  const primaryKey = quoteIdentifier(definition.primaryKey)
  const jsonColumn = quoteIdentifier(definition.jsonColumn)
  const table = quoteIdentifier(storeName)
  const all = await query(`select ${primaryKey} as primary_key from ${table} order by ${primaryKey}`)
  const allKeys = all.rows.map((row) => String(row.primary_key))
  const selectedKeys = expectedRows?.map((row) => row.primaryKey) ?? allKeys
  let selectedRows = []
  if (selectedKeys.length > 0) {
    const selected = await query(
      `select ${primaryKey} as primary_key, ${jsonColumn} as value
         from ${table}
        where ${primaryKey} = any($1::text[])
        order by ${primaryKey}`,
      [selectedKeys],
    )
    selectedRows = selected.rows.map((row) => ({ primaryKey: String(row.primary_key), value: row.value }))
  }
  return { totalCount: allKeys.length, allKeys, selectedRows }
}

function assertExpectedKeys(storeName, actualKeys, expectedKeys) {
  const actual = new Set(actualKeys)
  const missing = expectedKeys.filter((key) => !actual.has(key))
  if (missing.length > 0) throw new Error(`${storeName} is missing exported primary keys: ${missing.join(', ')}`)
  if (!allowAdditionalRows && actualKeys.length !== expectedKeys.length) {
    throw new Error(`${storeName} row count ${actualKeys.length} does not equal exported count ${expectedKeys.length}`)
  }
}

async function assertIndexesAndConstraints() {
  const requiredIndexes = [
    'idx_cdk_records_status',
    'idx_cdk_records_license_order_hash',
    'uq_cdk_records_license_order_hash',
    'idx_usage_events_date',
    'idx_usage_events_event',
    'uq_user_game_accounts_cdk_code_hash',
  ]
  const indexes = await query(
    `select indexname from pg_indexes where schemaname = 'public' and indexname = any($1::text[])`,
    [requiredIndexes],
  )
  const found = new Set(indexes.rows.map((row) => row.indexname))
  const missing = requiredIndexes.filter((name) => !found.has(name))
  if (missing.length > 0) throw new Error(`missing required migration indexes: ${missing.join(', ')}`)

  const requiredConstraints = [
    'cdk_records_permission_check',
    'cdk_records_status_check',
    'cdk_records_type_payload_check',
    'user_game_accounts_permission_check',
    'user_game_accounts_status_check',
    'user_game_accounts_kind_check',
  ]
  const constraints = await query(
    `select item_constraint.conname, item_constraint.convalidated
       from pg_constraint item_constraint
       join pg_namespace namespace on namespace.oid = item_constraint.connamespace
      where namespace.nspname = 'public' and item_constraint.conname = any($1::text[])`,
    [requiredConstraints],
  )
  const validConstraints = new Set(constraints.rows.filter((row) => row.convalidated).map((row) => row.conname))
  const missingConstraints = requiredConstraints.filter((name) => !validConstraints.has(name))
  if (missingConstraints.length > 0) throw new Error(`missing or unvalidated critical constraints: ${missingConstraints.join(', ')}`)

  const unvalidated = await query(
    `select count(*)::int as count
       from pg_constraint item_constraint
       join pg_namespace namespace on namespace.oid = item_constraint.connamespace
      where namespace.nspname = 'public' and not item_constraint.convalidated`,
  )
  return unvalidated.rows[0].count
}

async function countInvalidCredentialFormats() {
  const result = await query(
    `select count(*)::int as count
       from user_game_accounts
      where record_json #>> '{skland_binding,encrypted_cred}' is not null
        and record_json #>> '{skland_binding,encrypted_cred}' !~ '^SKLAND-V(1:|2:[A-Za-z0-9_-]{1,64}:)[A-Za-z0-9+/=]+$'`,
  )
  return result.rows[0].count
}

async function countSequences() {
  const result = await query("select count(*)::int as count from pg_sequences where schemaname = 'public'")
  return result.rows[0].count
}

async function query(text, values = []) {
  const remaining = deadline - Date.now()
  if (remaining <= 0) throw new Error('migration verification exceeded its overall deadline')
  let timer
  try {
    return await Promise.race([
      pool.query({ text, values, query_timeout: Math.min(statementTimeoutMs + 5_000, remaining) }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('migration verification exceeded its overall deadline')), remaining)
        timer.unref?.()
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

function parseArguments(values) {
  const parsed = {}
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value === '--require-database') continue
    if (value === '--export' && values[index + 1]) {
      parsed.export = values[index + 1]
      index += 1
      continue
    }
    if (!value.startsWith('--') && !parsed.export) {
      parsed.export = value
      continue
    }
    throw new Error(`unknown migration verifier argument: ${value}`)
  }
  return parsed
}

function readPositiveInteger(name, fallback) {
  const value = String(process.env[name] ?? '').trim()
  if (!value) return fallback
  if (!/^\d+$/.test(value) || Number(value) <= 0) throw new Error(`${name} must be a positive integer`)
  return Number(value)
}

function quoteIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error(`unsafe SQL identifier: ${value}`)
  return `"${value}"`
}
