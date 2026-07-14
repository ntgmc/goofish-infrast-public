import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import pg from 'pg'

const { Pool } = pg
const inputPath = process.argv[2]
if (!inputPath) {
  console.error('Usage: node scripts/import-postgres.mjs <migration-export.json>')
  process.exit(1)
}

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error('DATABASE_URL not configured')
  process.exit(1)
}

const payload = JSON.parse(await readFile(resolve(inputPath), 'utf8'))
const pool = new Pool({ connectionString: databaseUrl, application_name: 'goofish-infrast-v1-import' })

try {
  await pool.query(createSchemaSql())

  const counts = {
    cdk_records: 0,
    announcements: 0,
    usage_events: 0,
    admin_users: 0,
  }

  for (const entry of payload.stores?.cdk_records ?? []) {
    const record = entry.value
    await pool.query(
      `insert into cdk_records
        (key, code_hash, status, permission, license_order_hash, record_json, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7, now())
       on conflict (key) do update set
        code_hash = excluded.code_hash,
        status = excluded.status,
        permission = excluded.permission,
        license_order_hash = excluded.license_order_hash,
        record_json = excluded.record_json,
        created_at = excluded.created_at,
        updated_at = now()`,
      [
        entry.key,
        record.code_hash,
        record.status,
        record.permission,
        record.license_order_hash ?? null,
        JSON.stringify(record),
        record.created_at ?? null,
      ],
    )
    counts.cdk_records += 1
  }

  for (const entry of payload.stores?.announcements ?? []) {
    await pool.query(
      `insert into announcements (key, data_json, updated_at)
       values ($1, $2::jsonb, now())
       on conflict (key) do update set data_json = excluded.data_json, updated_at = excluded.updated_at`,
      [entry.key, JSON.stringify(entry.value)],
    )
    counts.announcements += 1
  }

  for (const entry of payload.stores?.usage_events ?? []) {
    const record = entry.value
    await pool.query(
      `insert into usage_events (key, event, visitor_id, date, created_at, record_json)
       values ($1, $2, $3, $4, $5, $6::jsonb)
       on conflict (key) do update set
        event = excluded.event,
        visitor_id = excluded.visitor_id,
        date = excluded.date,
        created_at = excluded.created_at,
        record_json = excluded.record_json`,
      [
        entry.key,
        record.event,
        record.visitor_id ?? null,
        record.date,
        record.created_at,
        JSON.stringify(record),
      ],
    )
    counts.usage_events += 1
  }

  for (const entry of payload.stores?.admin_users ?? []) {
    const record = entry.value
    const username = record.username || entry.key.replace(/^users\//, '').replace(/\.json$/, '')
    await pool.query(
      `insert into admin_users
        (username, password_hash, salt, iterations, record_json, created_at, updated_at)
       values ($1, $2, $3, $4, $5::jsonb, $6, $7)
       on conflict (username) do update set
        password_hash = excluded.password_hash,
        salt = excluded.salt,
        iterations = excluded.iterations,
        record_json = excluded.record_json,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at`,
      [
        username,
        record.password_hash,
        record.salt,
        record.iterations,
        JSON.stringify({ ...record, username }),
        record.created_at,
        record.updated_at,
      ],
    )
    counts.admin_users += 1
  }

  console.log(`[import-postgres] imported ${JSON.stringify(counts)}`)
} finally {
  await pool.end()
}

function createSchemaSql() {
  return `
CREATE TABLE IF NOT EXISTS cdk_records (
  key TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  permission TEXT NOT NULL,
  license_order_hash TEXT,
  record_json JSONB NOT NULL,
  record_revision INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_cdk_records_status ON cdk_records(status);
CREATE INDEX IF NOT EXISTS idx_cdk_records_license_order_hash ON cdk_records(license_order_hash);
DO $$
DECLARE conflict_details TEXT;
BEGIN
  SELECT string_agg(format('%s [%s]', license_order_hash, record_keys), '; ') INTO conflict_details
  FROM (SELECT license_order_hash, string_agg(key, ', ' ORDER BY key) AS record_keys FROM cdk_records WHERE license_order_hash IS NOT NULL GROUP BY license_order_hash HAVING COUNT(*) > 1) duplicates;
  IF conflict_details IS NOT NULL THEN RAISE EXCEPTION 'duplicate cdk license_order_hash values must be resolved before migration: %', conflict_details; END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cdk_records_license_order_hash
  ON cdk_records(license_order_hash) WHERE license_order_hash IS NOT NULL;
CREATE TABLE IF NOT EXISTS cdk_redemption_idempotency (
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  response_json JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scope, idempotency_key)
);
CREATE TABLE IF NOT EXISTS announcements (
  key TEXT PRIMARY KEY,
  data_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS usage_events (
  key TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  visitor_id TEXT,
  date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  record_json JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_events_date ON usage_events(date);
CREATE INDEX IF NOT EXISTS idx_usage_events_event ON usage_events(event);
CREATE TABLE IF NOT EXISTS admin_users (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  record_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
`
}
