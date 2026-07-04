import { query } from './postgres'

export const CREATE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS cdk_records (
  key TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  permission TEXT NOT NULL,
  license_order_hash TEXT,
  record_json JSONB NOT NULL,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_cdk_records_status ON cdk_records(status);
CREATE INDEX IF NOT EXISTS idx_cdk_records_license_order_hash ON cdk_records(license_order_hash);

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

CREATE TABLE IF NOT EXISTS user_accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  permission TEXT NOT NULL,
  status TEXT NOT NULL,
  cdk_key TEXT NOT NULL,
  cdk_code_hash TEXT NOT NULL,
  cdk_order_hash TEXT,
  record_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_accounts_email ON user_accounts(email);
CREATE INDEX IF NOT EXISTS idx_user_accounts_cdk_code_hash ON user_accounts(cdk_code_hash);

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  record_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token_hash ON user_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);

CREATE TABLE IF NOT EXISTS user_workspaces (
  user_id TEXT PRIMARY KEY REFERENCES user_accounts(id) ON DELETE CASCADE,
  operators_json JSONB,
  config_json JSONB,
  elite_overrides_json JSONB NOT NULL,
  last_result_json JSONB,
  record_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
`

export async function ensureDatabaseSchema(): Promise<void> {
  await query(CREATE_SCHEMA_SQL)
}
