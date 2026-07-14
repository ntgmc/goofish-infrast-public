import { query } from './postgres'

export const CREATE_SCHEMA_SQL = `
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
ALTER TABLE cdk_records ADD COLUMN IF NOT EXISTS record_revision INTEGER NOT NULL DEFAULT 0;
DO $$
DECLARE conflict_details TEXT;
BEGIN
  SELECT string_agg(format('%s [%s]', license_order_hash, record_keys), '; ')
    INTO conflict_details
  FROM (
    SELECT license_order_hash, string_agg(key, ', ' ORDER BY key) AS record_keys
    FROM cdk_records WHERE license_order_hash IS NOT NULL
    GROUP BY license_order_hash HAVING COUNT(*) > 1
  ) duplicates;
  IF conflict_details IS NOT NULL THEN RAISE EXCEPTION 'duplicate cdk license_order_hash values must be resolved before migration: %', conflict_details; END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_cdk_records_license_order_hash
  ON cdk_records(license_order_hash) WHERE license_order_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS announcements (
  key TEXT PRIMARY KEY,
  data_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS risk_settings (
  key TEXT PRIMARY KEY,
  record_json JSONB NOT NULL,
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

CREATE TABLE IF NOT EXISTS optimize_jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  priority INTEGER NOT NULL,
  owner_key TEXT NOT NULL,
  permission TEXT,
  source TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  result_json JSONB,
  error_message TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  lock_token TEXT,
  lock_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_optimize_jobs_status_priority_created_at ON optimize_jobs(status, priority DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_optimize_jobs_owner_status_created_at ON optimize_jobs(owner_key, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_optimize_jobs_lock_expires_at ON optimize_jobs(lock_expires_at);

CREATE TABLE IF NOT EXISTS optimization_submissions (
  id TEXT PRIMARY KEY,
  owner_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_optimization_submissions_owner_created_at
  ON optimization_submissions(owner_key, created_at DESC);

CREATE TABLE IF NOT EXISTS optimization_idempotency (
  owner_key TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  job_id TEXT,
  response_json JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (owner_key, idempotency_key)
);

CREATE TABLE IF NOT EXISTS optimize_dispatch_state (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  prioritized_streak INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL
);
INSERT INTO optimize_dispatch_state (id, prioritized_streak, updated_at)
VALUES (TRUE, 0, now()) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS admin_users (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  record_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL REFERENCES admin_users(username) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_token_hash ON admin_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_username ON admin_sessions(username);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON admin_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_last_seen_at ON admin_sessions(last_seen_at);

CREATE TABLE IF NOT EXISTS user_accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  permission TEXT NOT NULL,
  status TEXT NOT NULL,
  cdk_key TEXT,
  cdk_code_hash TEXT,
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

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token_hash ON password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at ON password_reset_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_created_at ON password_reset_tokens(created_at);

CREATE TABLE IF NOT EXISTS user_game_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  cdk_key TEXT,
  cdk_code_hash TEXT,
  cdk_order_hash TEXT,
  permission TEXT NOT NULL,
  status TEXT NOT NULL,
  display_name TEXT NOT NULL,
  note TEXT NOT NULL,
  record_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_game_accounts_user_id ON user_game_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_user_game_accounts_cdk_code_hash ON user_game_accounts(cdk_code_hash);
DO $$
DECLARE conflict_details TEXT;
BEGIN
  SELECT string_agg(format('%s [%s]', cdk_code_hash, profile_ids), '; ')
    INTO conflict_details
  FROM (
    SELECT cdk_code_hash, string_agg(id, ', ' ORDER BY id) AS profile_ids
    FROM user_game_accounts WHERE cdk_code_hash IS NOT NULL
    GROUP BY cdk_code_hash HAVING COUNT(*) > 1
  ) duplicates;
  IF conflict_details IS NOT NULL THEN RAISE EXCEPTION 'duplicate user_game_accounts cdk_code_hash values must be resolved before migration: %', conflict_details; END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_game_accounts_cdk_code_hash
  ON user_game_accounts(cdk_code_hash) WHERE cdk_code_hash IS NOT NULL;

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

CREATE TABLE IF NOT EXISTS free_preview_claims (
  uid_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL,
  record_json JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_free_preview_claims_user_id ON free_preview_claims(user_id);
CREATE INDEX IF NOT EXISTS idx_free_preview_claims_profile_id ON free_preview_claims(profile_id);

CREATE TABLE IF NOT EXISTS free_preview_pending_claims (
  confirmation_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  record_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_free_preview_pending_claims_user_id ON free_preview_pending_claims(user_id);
CREATE INDEX IF NOT EXISTS idx_free_preview_pending_claims_expires_at ON free_preview_pending_claims(expires_at);

CREATE TABLE IF NOT EXISTS user_workspaces (
  user_id TEXT PRIMARY KEY REFERENCES user_accounts(id) ON DELETE CASCADE,
  operators_json JSONB,
  config_json JSONB,
  elite_overrides_json JSONB NOT NULL,
  last_result_json JSONB,
  record_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS user_profile_workspaces (
  profile_id TEXT PRIMARY KEY REFERENCES user_game_accounts(id) ON DELETE CASCADE,
  operators_json JSONB,
  config_json JSONB,
  elite_overrides_json JSONB NOT NULL,
  last_result_json JSONB,
  record_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_entitlements (
  profile_id TEXT PRIMARY KEY REFERENCES user_game_accounts(id) ON DELETE CASCADE,
  first_generated_at TIMESTAMPTZ,
  free_revision_count INTEGER NOT NULL DEFAULT 0,
  confirmed_at TIMESTAMPTZ,
  locked_at TIMESTAMPTZ,
  lock_reason TEXT,
  strong_reorder_bonus_month TEXT,
  strong_reorder_bonus_granted_at TIMESTAMPTZ,
  strong_reorder_bonus_used_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS entitlement_ledger (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES user_game_accounts(id) ON DELETE CASCADE,
  entitlement_type TEXT NOT NULL,
  status TEXT NOT NULL,
  units INTEGER NOT NULL DEFAULT 1,
  reference_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  window_key TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  settled_at TIMESTAMPTZ,
  UNIQUE (profile_id, entitlement_type, reference_type, reference_id)
);
CREATE INDEX IF NOT EXISTS idx_entitlement_ledger_profile_type_window
  ON entitlement_ledger(profile_id, entitlement_type, window_key, created_at DESC);

-- Preserve the current month's pre-ledger reorder usage as immutable balances.
-- New checks write their reservation directly to the ledger and are therefore
-- never double-counted with the telemetry event recorded after completion.
INSERT INTO entitlement_ledger (
  id, profile_id, entitlement_type, status, reference_type, reference_id,
  window_key, created_at, settled_at
)
SELECT
  'migration-reorder:' || usage.key,
  usage.record_json->>'profile_id',
  'reorder_check', 'consumed', 'usage_event', usage.key,
  to_char(usage.created_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM'), usage.created_at, usage.created_at
FROM usage_events usage
JOIN user_game_accounts profile ON profile.id = usage.record_json->>'profile_id'
WHERE usage.event = 'reorder_check'
  AND coalesce(usage.record_json->>'status', 'success') <> 'failure'
  AND usage.created_at >= date_trunc('month', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'
ON CONFLICT (id) DO NOTHING;

-- Backfill the legacy workspace snapshot once.  Subsequent writes use the
-- normalized entitlement tables above and intentionally ignore this JSON copy.
INSERT INTO profile_entitlements (
  profile_id, first_generated_at, free_revision_count, confirmed_at, locked_at,
  lock_reason, strong_reorder_bonus_month, strong_reorder_bonus_granted_at,
  strong_reorder_bonus_used_at, updated_at
)
SELECT
  workspace.profile_id,
  nullif(workspace.record_json->'free_schedule_entitlement'->>'first_generated_at', '')::timestamptz,
  coalesce((workspace.record_json->'free_schedule_entitlement'->>'revision_count')::integer, 0),
  nullif(workspace.record_json->'free_schedule_entitlement'->>'confirmed_at', '')::timestamptz,
  nullif(workspace.record_json->'free_schedule_entitlement'->>'locked_at', '')::timestamptz,
  nullif(workspace.record_json->'free_schedule_entitlement'->>'lock_reason', ''),
  nullif(workspace.record_json->'free_schedule_entitlement'->'strong_reorder_bonus'->>'month', ''),
  nullif(workspace.record_json->'free_schedule_entitlement'->'strong_reorder_bonus'->>'granted_at', '')::timestamptz,
  nullif(workspace.record_json->'free_schedule_entitlement'->'strong_reorder_bonus'->>'used_at', '')::timestamptz,
  now()
FROM user_profile_workspaces workspace
WHERE workspace.record_json->'free_schedule_entitlement' IS NOT NULL
ON CONFLICT (profile_id) DO NOTHING;

-- Existing installations may already contain duplicate active jobs.  Keep the
-- earliest running job (or earliest queued job) for each owner and fail the rest
-- before creating the partial unique indexes below.
WITH ranked_running AS (
  SELECT id, row_number() OVER (PARTITION BY owner_key ORDER BY started_at NULLS LAST, created_at ASC) AS rank
  FROM optimize_jobs WHERE status = 'running'
)
UPDATE optimize_jobs job
SET status = 'failed', error_message = '任务因并发迁移被拒绝，请重试。', lock_token = NULL,
    lock_expires_at = NULL, finished_at = now(), updated_at = now()
FROM ranked_running ranked
WHERE job.id = ranked.id AND ranked.rank > 1;

WITH ranked_free AS (
  SELECT id, row_number() OVER (PARTITION BY owner_key ORDER BY created_at ASC) AS rank
  FROM optimize_jobs WHERE source = 'free_preview' AND status IN ('queued', 'running')
)
UPDATE optimize_jobs job
SET status = 'failed', error_message = '任务因并发迁移被拒绝，请重试。', lock_token = NULL,
    lock_expires_at = NULL, finished_at = now(), updated_at = now()
FROM ranked_free ranked
WHERE job.id = ranked.id AND ranked.rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_optimize_jobs_owner_running
  ON optimize_jobs(owner_key) WHERE status = 'running';
CREATE UNIQUE INDEX IF NOT EXISTS uq_optimize_jobs_free_owner_active
  ON optimize_jobs(owner_key) WHERE source = 'free_preview' AND status IN ('queued', 'running');

CREATE TABLE IF NOT EXISTS user_announcement_reads (
  user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  announcement_id TEXT NOT NULL,
  read_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, announcement_id)
);

CREATE TABLE IF NOT EXISTS depot_value_samples (
  uid_hash TEXT PRIMARY KEY,
  total_equivalent_sanity NUMERIC NOT NULL,
  account_level INTEGER,
  operator_power_score NUMERIC NOT NULL,
  operator_count INTEGER NOT NULL,
  elite2_count INTEGER NOT NULL,
  six_star_count INTEGER NOT NULL,
  six_star_e2_count INTEGER NOT NULL,
  e2_90_count INTEGER NOT NULL,
  inventory_item_count INTEGER NOT NULL,
  priced_count INTEGER NOT NULL,
  unpriced_count INTEGER NOT NULL,
  sample_json JSONB NOT NULL,
  sampled_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_depot_value_samples_total_sanity ON depot_value_samples(total_equivalent_sanity);
CREATE INDEX IF NOT EXISTS idx_depot_value_samples_account_level ON depot_value_samples(account_level);
CREATE INDEX IF NOT EXISTS idx_depot_value_samples_operator_power ON depot_value_samples(operator_power_score);

ALTER TABLE user_accounts ALTER COLUMN cdk_key DROP NOT NULL;
ALTER TABLE user_accounts ALTER COLUMN cdk_code_hash DROP NOT NULL;
ALTER TABLE user_accounts ALTER COLUMN cdk_order_hash DROP NOT NULL;
ALTER TABLE user_game_accounts ALTER COLUMN cdk_key DROP NOT NULL;
ALTER TABLE user_game_accounts ALTER COLUMN cdk_code_hash DROP NOT NULL;
ALTER TABLE user_game_accounts ALTER COLUMN cdk_order_hash DROP NOT NULL;
`

export async function ensureDatabaseSchema(): Promise<void> {
  await query(CREATE_SCHEMA_SQL)
}
