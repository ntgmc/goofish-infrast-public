import { createHash } from 'node:crypto'
import type { PoolClient, QueryResult, QueryResultRow } from 'pg'
import { resolveAppRole, type AppRole } from '../process-role'
import { getPool, query } from './postgres'
import { CURRENT_PERSONAL_USE_DECLARATION } from '../personal-use-declaration'
import { PERSONAL_USE_DECLARATION_ACTIONS } from '../../src/lib/personal-use-declaration'
import databaseSchemaContract from '../database-schema-contract.json'

const MIGRATION_PHASE_SEPARATOR = '-- goofish:migration-phase'
const RETRIABLE_MIGRATION_CODES = new Set(['40P01', '40001', '55P03'])
const MIGRATION_PHASE_MAX_ATTEMPTS = 5
const MIGRATION_RETRY_BASE_MS = 1_000
const MIGRATION_ADVISORY_LOCK_KEY = 774_006_153
const MIGRATION_STATEMENT_TIMEOUT_MS = 300_000
export const DATABASE_SCHEMA_VERSION = databaseSchemaContract.version
export const DATABASE_SCHEMA_MINIMUM_APP_VERSION = databaseSchemaContract.minimum_app_version
const PERSONAL_USE_DECLARATION_ACTION_SQL = PERSONAL_USE_DECLARATION_ACTIONS
  .map((action) => `'${action}'`)
  .join(', ')

const CREATE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS cdk_records (
  key TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  cdk_type TEXT NOT NULL DEFAULT 'profile',
  status TEXT NOT NULL,
  permission TEXT,
  balance_amount NUMERIC(20,2),
  item_code TEXT,
  item_expires_at TIMESTAMPTZ,
  license_order_hash TEXT,
  record_json JSONB NOT NULL,
  record_revision INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_cdk_records_status ON cdk_records(status);
CREATE INDEX IF NOT EXISTS idx_cdk_records_admin_created ON cdk_records(created_at DESC, key ASC);
CREATE INDEX IF NOT EXISTS idx_cdk_records_admin_status_created ON cdk_records(status, created_at DESC, key ASC);
CREATE INDEX IF NOT EXISTS idx_cdk_records_admin_permission_created ON cdk_records(permission, created_at DESC, key ASC);
CREATE INDEX IF NOT EXISTS idx_cdk_records_license_order_hash ON cdk_records(license_order_hash);
ALTER TABLE cdk_records ADD COLUMN IF NOT EXISTS record_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cdk_records ADD COLUMN IF NOT EXISTS cdk_type TEXT NOT NULL DEFAULT 'profile';
ALTER TABLE cdk_records ADD COLUMN IF NOT EXISTS balance_amount NUMERIC(20,2);
ALTER TABLE cdk_records ADD COLUMN IF NOT EXISTS item_code TEXT;
ALTER TABLE cdk_records ADD COLUMN IF NOT EXISTS item_expires_at TIMESTAMPTZ;
ALTER TABLE cdk_records ALTER COLUMN permission DROP NOT NULL;
UPDATE cdk_records SET cdk_type = 'profile' WHERE cdk_type IS NULL;
UPDATE cdk_records
   SET permission = CASE permission WHEN 'basic' THEN 'growth' WHEN 'premium' THEN 'advanced' ELSE 'recommended' END,
       record_json = record_json || jsonb_build_object(
         'permission', CASE permission WHEN 'basic' THEN 'growth' WHEN 'premium' THEN 'advanced' ELSE 'recommended' END
       )
 WHERE cdk_type = 'profile'
   AND (permission IS NULL OR permission NOT IN ('recommended', 'growth', 'advanced', 'ultimate'));
UPDATE cdk_records
   SET status = 'revoked',
       record_json = record_json || jsonb_build_object('status', 'revoked')
 WHERE status NOT IN ('unused', 'claiming', 'used', 'frozen', 'revoked');
UPDATE cdk_records
   SET record_json = record_json || jsonb_build_object('permission', permission, 'status', status);
CREATE INDEX IF NOT EXISTS idx_cdk_records_admin_type_created ON cdk_records(cdk_type, created_at DESC, key ASC);
ALTER TABLE cdk_records DROP CONSTRAINT IF EXISTS cdk_records_permission_check;
ALTER TABLE cdk_records ADD CONSTRAINT cdk_records_permission_check CHECK (
  (cdk_type = 'profile' AND permission IN ('recommended', 'growth', 'advanced', 'ultimate'))
  OR (cdk_type IN ('balance', 'item') AND permission IS NULL)
);
ALTER TABLE cdk_records DROP CONSTRAINT IF EXISTS cdk_records_status_check;
ALTER TABLE cdk_records ADD CONSTRAINT cdk_records_status_check
  CHECK (status IN ('unused', 'claiming', 'used', 'frozen', 'revoked'));
ALTER TABLE cdk_records DROP CONSTRAINT IF EXISTS cdk_records_type_payload_check;
ALTER TABLE cdk_records ADD CONSTRAINT cdk_records_type_payload_check CHECK (
  (cdk_type = 'profile' AND permission IS NOT NULL AND balance_amount IS NULL AND item_code IS NULL AND item_expires_at IS NULL)
  OR (cdk_type = 'balance' AND permission IS NULL AND balance_amount BETWEEN 0.01 AND 1000000.00 AND item_code IS NULL AND item_expires_at IS NULL)
  OR (cdk_type = 'item' AND permission IS NULL AND balance_amount IS NULL AND (
      (item_code IS NULL AND item_expires_at IS NULL)
      OR (item_code = 'lifetime_profile_voucher' AND item_expires_at IS NULL)
      OR (item_code = 'limited_profile_voucher' AND item_expires_at IS NOT NULL)
  ))
);
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

-- goofish:migration-phase
CREATE TABLE IF NOT EXISTS announcements (
  key TEXT PRIMARY KEY,
  data_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 0;

-- goofish:migration-phase
CREATE TABLE IF NOT EXISTS website_notification_events (
  sequence BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id VARCHAR(128) NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  title VARCHAR(120) NOT NULL,
  summary VARCHAR(500),
  url TEXT NOT NULL,
  version VARCHAR(128),
  published_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT website_notification_events_type_check
    CHECK (event_type IN ('announcement.published', 'release.published')),
  CONSTRAINT website_notification_events_title_check
    CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  CONSTRAINT website_notification_events_summary_check
    CHECK (summary IS NULL OR char_length(summary) <= 500),
  CONSTRAINT website_notification_events_url_check
    CHECK (url ~ '^https://[^[:space:]]+$'),
  CONSTRAINT website_notification_events_version_check
    CHECK (
      (event_type = 'announcement.published' AND version IS NULL)
      OR (event_type = 'release.published' AND char_length(btrim(version)) BETWEEN 1 AND 128)
    )
);

CREATE TABLE IF NOT EXISTS risk_settings (
  key TEXT PRIMARY KEY,
  record_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
ALTER TABLE risk_settings ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0);

CREATE TABLE IF NOT EXISTS risk_settings_audit (
  id TEXT PRIMARY KEY,
  admin_username TEXT NOT NULL,
  settings_key TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) >= 2),
  request_id TEXT NOT NULL,
  before_json JSONB NOT NULL,
  after_json JSONB NOT NULL,
  previous_hash TEXT,
  entry_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_risk_settings_audit_created ON risk_settings_audit(created_at DESC);

CREATE TABLE IF NOT EXISTS invitation_settings (
  key TEXT PRIMARY KEY,
  record_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)
);
ALTER TABLE invitation_settings ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1);

CREATE TABLE IF NOT EXISTS registration_settings (
  key TEXT PRIMARY KEY,
  record_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS feature_settings (
  key TEXT PRIMARY KEY,
  record_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)
);

CREATE TABLE IF NOT EXISTS public_content_settings (
  key TEXT PRIMARY KEY,
  record_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)
);

ALTER TABLE feature_settings ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1);
ALTER TABLE public_content_settings ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1);

-- goofish:migration-phase
CREATE TABLE IF NOT EXISTS brevo_email_deliveries (
  id TEXT PRIMARY KEY,
  quota_date DATE NOT NULL,
  provider TEXT NOT NULL DEFAULT 'brevo' CHECK (provider IN ('brevo', 'ses')),
  purpose TEXT NOT NULL CHECK (purpose IN (
    'email_verification',
    'admin_invite_verification',
    'password_reset',
    'account_deletion_cancellation',
    'account_deletion_receipt'
  )),
  status TEXT NOT NULL CHECK (status IN ('reserved', 'sent', 'failed', 'uncertain')),
  reserved_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ
);
ALTER TABLE brevo_email_deliveries
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'brevo';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'brevo_email_deliveries_provider_check'
       AND conrelid = 'brevo_email_deliveries'::regclass
  ) THEN
    ALTER TABLE brevo_email_deliveries
      ADD CONSTRAINT brevo_email_deliveries_provider_check
      CHECK (provider IN ('brevo', 'ses'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_brevo_email_deliveries_quota_date
  ON brevo_email_deliveries(quota_date);
CREATE INDEX IF NOT EXISTS idx_brevo_email_deliveries_provider_quota_date
  ON brevo_email_deliveries(provider, quota_date);
CREATE INDEX IF NOT EXISTS idx_brevo_email_deliveries_daily_breakdown
  ON brevo_email_deliveries(quota_date, purpose, status);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'brevo_email_deliveries_purpose_check'
       AND conrelid = 'brevo_email_deliveries'::regclass
       AND pg_get_constraintdef(oid) LIKE '%admin_invite_verification%'
  ) THEN
    ALTER TABLE brevo_email_deliveries DROP CONSTRAINT IF EXISTS brevo_email_deliveries_purpose_check;
    ALTER TABLE brevo_email_deliveries ADD CONSTRAINT brevo_email_deliveries_purpose_check CHECK (purpose IN (
      'email_verification',
      'admin_invite_verification',
      'password_reset',
      'account_deletion_cancellation',
      'account_deletion_receipt'
    ));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS brevo_email_quota_snapshots (
  quota_date DATE PRIMARY KEY,
  reported_remaining_count INTEGER CHECK (reported_remaining_count BETWEEN 0 AND 300),
  reported_used_count INTEGER CHECK (reported_used_count BETWEEN 0 AND 300),
  local_used_at_sync INTEGER NOT NULL DEFAULT 0 CHECK (local_used_at_sync >= 0),
  external_used_offset INTEGER NOT NULL DEFAULT 0 CHECK (external_used_offset BETWEEN 0 AND 300),
  sync_status TEXT NOT NULL CHECK (sync_status IN ('success', 'error')),
  last_attempt_at TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ
);

-- goofish:migration-phase
CREATE TABLE IF NOT EXISTS usage_events (
  key TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  visitor_id TEXT,
  date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '180 days'),
  record_json JSONB NOT NULL
);
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
UPDATE usage_events SET expires_at = created_at + interval '180 days' WHERE expires_at IS NULL;
ALTER TABLE usage_events ALTER COLUMN expires_at SET DEFAULT (now() + interval '180 days');
ALTER TABLE usage_events ALTER COLUMN expires_at SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_usage_events_date ON usage_events(date);
CREATE INDEX IF NOT EXISTS idx_usage_events_event ON usage_events(event);
CREATE INDEX IF NOT EXISTS idx_usage_events_expires_at ON usage_events(expires_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_announcement_version
  ON usage_events ((record_json->>'announcement_id'), (record_json->>'announcement_version'), event)
  WHERE record_json ? 'announcement_id';

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
  failure_kind TEXT,
  public_error_code TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  worker_id TEXT,
  heartbeat_at TIMESTAMPTZ,
  lock_token TEXT,
  lock_expires_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  cancel_requested_at TIMESTAMPTZ,
  execution_stage TEXT,
  stage_updated_at TIMESTAMPTZ,
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
  billing_user_id TEXT,
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

CREATE TABLE IF NOT EXISTS optimize_job_attempts (
  job_id TEXT NOT NULL REFERENCES optimize_jobs(id) ON DELETE CASCADE,
  attempt_no INTEGER NOT NULL,
  worker_id TEXT NOT NULL,
  lock_token TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  heartbeat_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  failure_kind TEXT,
  error_message TEXT,
  PRIMARY KEY (job_id, attempt_no),
  UNIQUE (lock_token)
);
CREATE INDEX IF NOT EXISTS idx_optimize_job_attempts_worker_status
  ON optimize_job_attempts(worker_id, status);
CREATE INDEX IF NOT EXISTS idx_optimize_job_attempts_heartbeat
  ON optimize_job_attempts(heartbeat_at) WHERE status = 'running';

CREATE TABLE IF NOT EXISTS optimize_worker_registry (
  worker_id TEXT PRIMARY KEY,
  concurrency INTEGER NOT NULL CHECK (concurrency BETWEEN 1 AND 32),
  heartbeat_interval_ms INTEGER NOT NULL CHECK (heartbeat_interval_ms BETWEEN 1000 AND 60000),
  stale_after_ms INTEGER NOT NULL CHECK (stale_after_ms BETWEEN heartbeat_interval_ms AND 300000),
  capabilities TEXT[] NOT NULL DEFAULT '{}',
  build_sha TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  heartbeat_at TIMESTAMPTZ NOT NULL,
  draining BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_optimize_worker_registry_active
  ON optimize_worker_registry(draining, heartbeat_at DESC);

-- goofish:migration-phase
CREATE TABLE IF NOT EXISTS service_status_hourly (
  component_id TEXT NOT NULL,
  bucket_start TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0 CHECK (sample_count >= 0),
  available_samples INTEGER NOT NULL DEFAULT 0 CHECK (available_samples >= 0),
  busy_samples INTEGER NOT NULL DEFAULT 0 CHECK (busy_samples >= 0),
  scaling_samples INTEGER NOT NULL DEFAULT 0 CHECK (scaling_samples >= 0),
  congested_samples INTEGER NOT NULL DEFAULT 0 CHECK (congested_samples >= 0),
  overloaded_samples INTEGER NOT NULL DEFAULT 0 CHECK (overloaded_samples >= 0),
  unavailable_samples INTEGER NOT NULL DEFAULT 0 CHECK (unavailable_samples >= 0),
  running_sum NUMERIC(20,4) NOT NULL DEFAULT 0 CHECK (running_sum >= 0),
  provisioned_sum NUMERIC(20,4) NOT NULL DEFAULT 0 CHECK (provisioned_sum >= 0),
  utilization_sum NUMERIC(20,4) NOT NULL DEFAULT 0 CHECK (utilization_sum >= 0 AND utilization_sum <= sample_count * 100),
  worker_instances_sum NUMERIC(20,4) NOT NULL DEFAULT 0 CHECK (worker_instances_sum >= 0),
  peak_queued INTEGER NOT NULL DEFAULT 0 CHECK (peak_queued >= 0),
  peak_running INTEGER NOT NULL DEFAULT 0 CHECK (peak_running >= 0),
  peak_worker_instances INTEGER NOT NULL DEFAULT 0 CHECK (peak_worker_instances >= 0),
  last_sample_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (component_id, bucket_start),
  CONSTRAINT service_status_hourly_component_check CHECK (component_id IN ('optimization')),
  CONSTRAINT service_status_hourly_status_check CHECK (status IN ('available', 'scaling', 'busy', 'congested', 'overloaded', 'unavailable')),
  CONSTRAINT service_status_hourly_sample_balance_check CHECK (available_samples + busy_samples + congested_samples + overloaded_samples + unavailable_samples = sample_count)
);
CREATE INDEX IF NOT EXISTS idx_service_status_hourly_bucket
  ON service_status_hourly(bucket_start DESC, component_id);
ALTER TABLE service_status_hourly ADD COLUMN IF NOT EXISTS busy_samples INTEGER NOT NULL DEFAULT 0 CHECK (busy_samples >= 0);
ALTER TABLE service_status_hourly ADD COLUMN IF NOT EXISTS scaling_samples INTEGER NOT NULL DEFAULT 0 CHECK (scaling_samples >= 0);
ALTER TABLE service_status_hourly ADD COLUMN IF NOT EXISTS congested_samples INTEGER NOT NULL DEFAULT 0 CHECK (congested_samples >= 0);
ALTER TABLE service_status_hourly ADD COLUMN IF NOT EXISTS overloaded_samples INTEGER NOT NULL DEFAULT 0 CHECK (overloaded_samples >= 0);
ALTER TABLE service_status_hourly ADD COLUMN IF NOT EXISTS utilization_sum NUMERIC(20,4) NOT NULL DEFAULT 0 CHECK (utilization_sum >= 0);
ALTER TABLE service_status_hourly ADD COLUMN IF NOT EXISTS worker_instances_sum NUMERIC(20,4) NOT NULL DEFAULT 0 CHECK (worker_instances_sum >= 0);
ALTER TABLE service_status_hourly DROP CONSTRAINT IF EXISTS service_status_hourly_status_check;
ALTER TABLE service_status_hourly ADD CONSTRAINT service_status_hourly_status_check CHECK (status IN ('available', 'scaling', 'busy', 'congested', 'overloaded', 'unavailable'));
ALTER TABLE service_status_hourly DROP CONSTRAINT IF EXISTS service_status_hourly_sample_balance_check;
ALTER TABLE service_status_hourly ADD CONSTRAINT service_status_hourly_sample_balance_check CHECK (available_samples + busy_samples + congested_samples + overloaded_samples + unavailable_samples = sample_count);
ALTER TABLE service_status_hourly DROP CONSTRAINT IF EXISTS service_status_hourly_level_balance_check;

CREATE TABLE IF NOT EXISTS service_status_cost_config (
  component_id TEXT PRIMARY KEY,
  billing_model TEXT NOT NULL DEFAULT 'ecs_payg',
  currency TEXT NOT NULL DEFAULT 'CNY',
  hourly_price_cny NUMERIC(12,4),
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  schedule_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  valley_worker_instances INTEGER NOT NULL DEFAULT 0 CHECK (valley_worker_instances BETWEEN 0 AND 100),
  peak_windows_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by TEXT,
  CONSTRAINT service_status_cost_component_check CHECK (component_id IN ('optimization')),
  CONSTRAINT service_status_cost_billing_model_check CHECK (billing_model IN ('ecs_payg')),
  CONSTRAINT service_status_cost_currency_check CHECK (currency = 'CNY'),
  CONSTRAINT service_status_cost_hourly_price_check CHECK (hourly_price_cny IS NULL OR hourly_price_cny >= 0)
);

CREATE TABLE IF NOT EXISTS service_status_incidents (
  id TEXT PRIMARY KEY,
  component_id TEXT NOT NULL,
  title VARCHAR(160) NOT NULL,
  impact TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT service_status_incidents_component_check CHECK (component_id IN ('optimization')),
  CONSTRAINT service_status_incidents_title_check CHECK (char_length(btrim(title)) BETWEEN 2 AND 160),
  CONSTRAINT service_status_incidents_impact_check CHECK (impact IN ('minor', 'major', 'critical')),
  CONSTRAINT service_status_incidents_status_check CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved')),
  CONSTRAINT service_status_incidents_resolution_check CHECK (
    (status = 'resolved' AND resolved_at IS NOT NULL)
    OR (status <> 'resolved' AND resolved_at IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_service_status_incidents_public
  ON service_status_incidents(resolved_at, updated_at DESC);

CREATE TABLE IF NOT EXISTS service_status_incident_updates (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES service_status_incidents(id) ON DELETE RESTRICT,
  status TEXT NOT NULL,
  body VARCHAR(2000) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT service_status_incident_updates_status_check CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved')),
  CONSTRAINT service_status_incident_updates_body_check CHECK (char_length(btrim(body)) BETWEEN 2 AND 2000)
);
CREATE INDEX IF NOT EXISTS idx_service_status_incident_updates_incident
  ON service_status_incident_updates(incident_id, created_at ASC, id ASC);

CREATE TABLE IF NOT EXISTS optimization_dead_letters (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES optimize_jobs(id) ON DELETE RESTRICT,
  owner_key TEXT NOT NULL,
  profile_id TEXT,
  source TEXT NOT NULL,
  failure_kind TEXT NOT NULL,
  public_error_code TEXT NOT NULL,
  internal_error_message TEXT NOT NULL,
  diagnostic_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempt_count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_review',
  replay_count INTEGER NOT NULL DEFAULT 0,
  replayed_job_id TEXT,
  replayed_by TEXT,
  replayed_at TIMESTAMPTZ,
  resolution_reason TEXT,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (job_id)
);
ALTER TABLE optimization_dead_letters ADD COLUMN IF NOT EXISTS resolution_reason TEXT;
ALTER TABLE optimization_dead_letters ADD COLUMN IF NOT EXISTS resolved_by TEXT;
CREATE INDEX IF NOT EXISTS idx_optimization_dead_letters_status_created_at
  ON optimization_dead_letters(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_optimization_dead_letters_profile_created_at
  ON optimization_dead_letters(profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS optimization_job_effects (
  job_id TEXT NOT NULL REFERENCES optimize_jobs(id) ON DELETE CASCADE,
  effect_type TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  applied_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (job_id, effect_type)
);

-- goofish:migration-phase
CREATE TABLE IF NOT EXISTS admin_users (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  disabled BOOLEAN NOT NULL DEFAULT FALSE,
  record_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS admin_operation_audit (
  id TEXT PRIMARY KEY,
  actor_username TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) >= 2),
  request_id TEXT NOT NULL,
  client_ip TEXT,
  before_json JSONB,
  after_json JSONB,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_operation_audit_actor_created
  ON admin_operation_audit(actor_username, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_operation_audit_target_created
  ON admin_operation_audit(target_type, target_id, created_at DESC);
CREATE OR REPLACE FUNCTION reject_admin_operation_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'admin_operation_audit is append-only';
END;
$$;
DROP TRIGGER IF EXISTS admin_operation_audit_append_only ON admin_operation_audit;
CREATE TRIGGER admin_operation_audit_append_only
BEFORE UPDATE OR DELETE ON admin_operation_audit
FOR EACH ROW EXECUTE FUNCTION reject_admin_operation_audit_mutation();

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

-- goofish:migration-phase
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
  email_verified_at TIMESTAMPTZ,
  record_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_accounts_email ON user_accounts(email);
CREATE INDEX IF NOT EXISTS idx_user_accounts_admin_created ON user_accounts(created_at DESC, id ASC);
CREATE INDEX IF NOT EXISTS idx_user_accounts_cdk_code_hash ON user_accounts(cdk_code_hash);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'user_accounts'
      AND column_name = 'email_verified_at'
  ) THEN
    ALTER TABLE user_accounts ADD COLUMN email_verified_at TIMESTAMPTZ;
    UPDATE user_accounts
    SET email_verified_at = created_at,
        record_json = record_json || jsonb_build_object('email_verified_at', created_at),
        updated_at = greatest(updated_at, created_at);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS user_balance_accounts (
  user_id TEXT PRIMARY KEY REFERENCES user_accounts(id) ON DELETE CASCADE,
  available NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (available >= 0),
  reserved NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (reserved >= 0 AND reserved <= available),
  lifetime_credited NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (lifetime_credited >= 0),
  qualification_reversed NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (qualification_reversed >= 0 AND qualification_reversed <= lifetime_credited),
  debt NUMERIC(20,2) NOT NULL DEFAULT 0 CHECK (debt >= 0),
  updated_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE user_balance_accounts ADD COLUMN IF NOT EXISTS reserved NUMERIC(20,2) NOT NULL DEFAULT 0;
ALTER TABLE user_balance_accounts ADD COLUMN IF NOT EXISTS lifetime_credited NUMERIC(20,2) NOT NULL DEFAULT 0;
ALTER TABLE user_balance_accounts ADD COLUMN IF NOT EXISTS qualification_reversed NUMERIC(20,2) NOT NULL DEFAULT 0;
ALTER TABLE user_balance_accounts ADD COLUMN IF NOT EXISTS debt NUMERIC(20,2) NOT NULL DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_balance_accounts_reserved_check') THEN
    ALTER TABLE user_balance_accounts ADD CONSTRAINT user_balance_accounts_reserved_check
      CHECK (reserved >= 0 AND reserved <= available);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_balance_accounts_lifetime_check') THEN
    ALTER TABLE user_balance_accounts ADD CONSTRAINT user_balance_accounts_lifetime_check
      CHECK (lifetime_credited >= 0 AND qualification_reversed >= 0 AND qualification_reversed <= lifetime_credited AND debt >= 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS user_balance_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('cdk_credit', 'admin_credit', 'admin_debit', 'schedule_debit', 'admin_credit_reversal', 'debt_repayment')),
  amount NUMERIC(20,2) NOT NULL CHECK (amount <> 0),
  balance_after NUMERIC(20,2) NOT NULL CHECK (balance_after >= 0),
  reference_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  idempotency_key TEXT,
  admin_username TEXT,
  approved_by TEXT,
  reason TEXT,
  request_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE user_balance_transactions ADD COLUMN IF NOT EXISTS approved_by TEXT;
CREATE INDEX IF NOT EXISTS idx_user_balance_transactions_user_created
  ON user_balance_transactions(user_id, created_at DESC, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_balance_transactions_idempotency
  ON user_balance_transactions(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
ALTER TABLE user_balance_transactions
  DROP CONSTRAINT IF EXISTS user_balance_transactions_reference_type_reference_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_balance_transactions_reference
  ON user_balance_transactions(reference_type, reference_id)
  WHERE kind <> 'admin_credit_reversal';
ALTER TABLE user_balance_transactions DROP CONSTRAINT IF EXISTS user_balance_transactions_kind_check;
ALTER TABLE user_balance_transactions ADD CONSTRAINT user_balance_transactions_kind_check CHECK (
  kind IN ('cdk_credit', 'admin_credit', 'admin_debit', 'schedule_debit', 'admin_credit_reversal', 'debt_repayment')
);

CREATE TABLE IF NOT EXISTS user_balance_operations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('claimed', 'completed')),
  transaction_id TEXT REFERENCES user_balance_transactions(id) ON DELETE SET NULL,
  response_json JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  UNIQUE (user_id, idempotency_key)
);
ALTER TABLE user_balance_operations
  DROP CONSTRAINT IF EXISTS user_balance_operations_transaction_id_fkey;
ALTER TABLE user_balance_operations
  ADD CONSTRAINT user_balance_operations_transaction_id_fkey
  FOREIGN KEY (transaction_id) REFERENCES user_balance_transactions(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS user_balance_qualification_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  balance_transaction_id TEXT NOT NULL REFERENCES user_balance_transactions(id) ON DELETE CASCADE,
  delta NUMERIC(20,2) NOT NULL CHECK (delta <> 0),
  reason TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_user_balance_qualification_user_created
  ON user_balance_qualification_ledger(user_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS user_balance_reservations (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL,
  billing_kind TEXT NOT NULL CHECK (billing_kind IN ('metered_personal', 'metered_commercial')),
  pricing_version TEXT NOT NULL,
  tier INTEGER CHECK (tier BETWEEN 1 AND 4),
  list_price NUMERIC(20,2) NOT NULL CHECK (list_price > 0),
  discount_bps INTEGER NOT NULL CHECK (discount_bps BETWEEN 0 AND 10000),
  amount NUMERIC(20,2) NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL CHECK (status IN ('reserved', 'consumed', 'released')),
  created_at TIMESTAMPTZ NOT NULL,
  settled_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_user_balance_reservations_user_status
  ON user_balance_reservations(user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS commercial_account_limits (
  user_id TEXT PRIMARY KEY REFERENCES user_accounts(id) ON DELETE CASCADE,
  active_profile_limit INTEGER NOT NULL DEFAULT 100 CHECK (active_profile_limit > 0),
  total_profile_limit INTEGER NOT NULL DEFAULT 1000 CHECK (total_profile_limit >= active_profile_limit),
  suspended_at TIMESTAMPTZ,
  suspension_reason TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE commercial_account_limits ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE commercial_account_limits ADD COLUMN IF NOT EXISTS updated_by TEXT;

CREATE TABLE IF NOT EXISTS commercial_account_audit (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  actor_username TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  reason TEXT NOT NULL,
  before_json JSONB NOT NULL,
  after_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_commercial_account_audit_user_created
  ON commercial_account_audit(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS commercial_profile_operations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  UNIQUE (user_id, operation_id)
);

-- goofish:migration-phase
CREATE TABLE IF NOT EXISTS invitation_codes (
  user_id TEXT PRIMARY KEY REFERENCES user_accounts(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  created_at TIMESTAMPTZ NOT NULL,
  rotated_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE invitation_codes ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE invitation_codes ADD COLUMN IF NOT EXISTS rotated_at TIMESTAMPTZ;
ALTER TABLE invitation_codes ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
ALTER TABLE invitation_codes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE invitation_codes DROP CONSTRAINT IF EXISTS invitation_codes_status_check;
ALTER TABLE invitation_codes ADD CONSTRAINT invitation_codes_status_check CHECK (status IN ('active', 'paused'));
CREATE INDEX IF NOT EXISTS idx_invitation_codes_code ON invitation_codes(code);

CREATE TABLE IF NOT EXISTS invitation_code_audit (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('create', 'rotate', 'pause', 'resume')),
  previous_code_hash TEXT,
  next_code_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invitation_code_audit_user_created
  ON invitation_code_audit(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  inviter_user_id TEXT REFERENCES user_accounts(id) ON DELETE SET NULL,
  invitee_user_id TEXT NOT NULL UNIQUE REFERENCES user_accounts(id) ON DELETE CASCADE,
  invitation_code TEXT NOT NULL,
  status TEXT NOT NULL,
  registered_at TIMESTAMPTZ NOT NULL,
  activated_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  settings_snapshot JSONB,
  legacy_snapshot_unavailable BOOLEAN NOT NULL DEFAULT false,
  settlement_json JSONB,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  processing_started_at TIMESTAMPTZ,
  last_error TEXT,
  dead_lettered_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL,
  CHECK (inviter_user_id IS NULL OR inviter_user_id <> invitee_user_id),
  CHECK (status IN ('registered', 'activated', 'processing', 'failed', 'settled', 'dead_letter')),
  CHECK (attempt_count >= 0)
);
CREATE INDEX IF NOT EXISTS idx_invitations_inviter_registered_at ON invitations(inviter_user_id, registered_at DESC);
CREATE INDEX IF NOT EXISTS idx_invitations_inviter_settled_at ON invitations(inviter_user_id, settled_at DESC);
CREATE INDEX IF NOT EXISTS idx_invitations_invitation_code ON invitations(invitation_code);
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS inviter_rewarded_at TIMESTAMPTZ;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ;
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS legacy_snapshot_unavailable BOOLEAN NOT NULL DEFAULT false;
UPDATE invitations
   SET activated_at = coalesce(activated_at, registered_at),
       status = 'failed',
       next_retry_at = coalesce(next_retry_at, now()),
       last_error = coalesce(last_error, 'Legacy invitation status required repair during schema migration')
 WHERE status NOT IN ('registered', 'activated', 'processing', 'failed', 'settled', 'dead_letter');
UPDATE invitations
   SET activated_at = coalesce(activated_at, registered_at),
       status = 'dead_letter',
       next_retry_at = null,
       processing_started_at = null,
       dead_lettered_at = coalesce(dead_lettered_at, now()),
       last_error = coalesce(last_error, 'Legacy invitation snapshot is unavailable; settlement cannot be replayed'),
       legacy_snapshot_unavailable = true
 WHERE status IN ('activated', 'processing', 'failed', 'dead_letter')
   AND (settings_snapshot IS NULL
     OR jsonb_typeof(settings_snapshot) IS DISTINCT FROM 'object'
     OR settings_snapshot->>'version' IS DISTINCT FROM '2');
UPDATE invitations
   SET activated_at = coalesce(activated_at, registered_at),
       legacy_snapshot_unavailable = true
 WHERE status = 'settled'
   AND (settings_snapshot IS NULL
     OR jsonb_typeof(settings_snapshot) IS DISTINCT FROM 'object'
     OR settings_snapshot->>'version' IS DISTINCT FROM '2');
UPDATE invitations SET activated_at = coalesce(activated_at, registered_at) WHERE status = 'settled';
ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_status_check;
ALTER TABLE invitations ADD CONSTRAINT invitations_status_check
  CHECK (status IN ('registered', 'activated', 'processing', 'failed', 'settled', 'dead_letter'));
ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_attempt_count_check;
ALTER TABLE invitations ADD CONSTRAINT invitations_attempt_count_check CHECK (attempt_count >= 0);
ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_state_timestamps_check;
ALTER TABLE invitations ADD CONSTRAINT invitations_state_timestamps_check CHECK (
  (status = 'registered' AND activated_at IS NULL AND settled_at IS NULL AND dead_lettered_at IS NULL)
  OR (status IN ('activated', 'failed') AND activated_at IS NOT NULL AND settled_at IS NULL AND dead_lettered_at IS NULL)
  OR (status = 'processing' AND activated_at IS NOT NULL AND settled_at IS NULL AND processing_started_at IS NOT NULL AND dead_lettered_at IS NULL)
  OR (status = 'settled' AND activated_at IS NOT NULL AND settled_at IS NOT NULL AND dead_lettered_at IS NULL)
  OR (status = 'dead_letter' AND activated_at IS NOT NULL AND settled_at IS NULL AND dead_lettered_at IS NOT NULL)
);
ALTER TABLE invitations DROP CONSTRAINT IF EXISTS invitations_snapshot_shape_check;
ALTER TABLE invitations ADD CONSTRAINT invitations_snapshot_shape_check CHECK (
  status = 'registered'
  OR (settings_snapshot IS NOT NULL
    AND jsonb_typeof(settings_snapshot) = 'object'
    AND settings_snapshot->>'version' = '2')
  OR (
    legacy_snapshot_unavailable
    AND status IN ('settled', 'dead_letter')
    AND (settings_snapshot IS NULL
      OR jsonb_typeof(settings_snapshot) IS DISTINCT FROM 'object'
      OR settings_snapshot->>'version' IS DISTINCT FROM '2')
  )
) NOT VALID;
ALTER TABLE invitations VALIDATE CONSTRAINT invitations_snapshot_shape_check;
CREATE INDEX IF NOT EXISTS idx_invitations_inviter_registered_cursor
  ON invitations(inviter_user_id, registered_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_invitations_inviter_rewarded
  ON invitations(inviter_user_id, inviter_rewarded_at)
  WHERE inviter_rewarded_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invitations_pending_settlement
  ON invitations(next_retry_at ASC, activated_at ASC, id ASC)
  WHERE status IN ('activated', 'failed', 'processing');
UPDATE invitations
   SET inviter_rewarded_at = settled_at
 WHERE inviter_rewarded_at IS NULL
   AND settled_at IS NOT NULL
   AND coalesce(settlement_json->'rewards'->'inviter'->>'applied', '') ~ '^[1-9][0-9]*$';

-- goofish:migration-phase
CREATE TABLE IF NOT EXISTS admin_registration_invitations (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL DEFAULT 'legacy',
  create_reason TEXT NOT NULL DEFAULT 'Legacy invitation',
  idempotency_key TEXT,
  request_hash TEXT,
  code_ciphertext TEXT,
  code_iv TEXT,
  code_auth_tag TEXT,
  code_recoverable_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  consumed_by_user_id TEXT REFERENCES user_accounts(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  revoked_by TEXT,
  revoke_reason TEXT,
  CHECK (consumed_at IS NULL OR revoked_at IS NULL)
);
ALTER TABLE admin_registration_invitations ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE admin_registration_invitations ADD COLUMN IF NOT EXISTS create_reason TEXT NOT NULL DEFAULT 'Legacy invitation';
ALTER TABLE admin_registration_invitations ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE admin_registration_invitations ADD COLUMN IF NOT EXISTS request_hash TEXT;
ALTER TABLE admin_registration_invitations ADD COLUMN IF NOT EXISTS code_ciphertext TEXT;
ALTER TABLE admin_registration_invitations ADD COLUMN IF NOT EXISTS code_iv TEXT;
ALTER TABLE admin_registration_invitations ADD COLUMN IF NOT EXISTS code_auth_tag TEXT;
ALTER TABLE admin_registration_invitations ADD COLUMN IF NOT EXISTS code_recoverable_until TIMESTAMPTZ;
ALTER TABLE admin_registration_invitations ADD COLUMN IF NOT EXISTS revoked_by TEXT;
ALTER TABLE admin_registration_invitations ADD COLUMN IF NOT EXISTS revoke_reason TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_registration_invitations_idempotency
  ON admin_registration_invitations(created_by, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_admin_registration_invitations_created
  ON admin_registration_invitations(created_at DESC, id ASC);
CREATE INDEX IF NOT EXISTS idx_admin_registration_invitations_status
  ON admin_registration_invitations(consumed_at, revoked_at, expires_at, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_registration_invitation_audit (
  id TEXT PRIMARY KEY,
  invitation_id TEXT NOT NULL,
  admin_username TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'revoke', 'resend_verification', 'replay_settlement')),
  reason TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  before_json JSONB,
  after_json JSONB,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_registration_invitation_audit_invitation
  ON admin_registration_invitation_audit(invitation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_invitation_verification_outbox (
  id TEXT PRIMARY KEY,
  invitation_id TEXT NOT NULL UNIQUE REFERENCES admin_registration_invitations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'dead_letter')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL,
  lease_token TEXT,
  lease_expires_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_invitation_verification_outbox_due
  ON admin_invitation_verification_outbox(status, next_attempt_at, created_at);

CREATE TABLE IF NOT EXISTS reward_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  reward_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  recipient_role TEXT NOT NULL,
  original_quantity INTEGER NOT NULL CHECK (original_quantity > 0),
  remaining_quantity INTEGER NOT NULL CHECK (remaining_quantity >= 0),
  validity_days INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (user_id, reward_type, source_type, source_id, recipient_role)
);
CREATE INDEX IF NOT EXISTS idx_reward_grants_available
  ON reward_grants(user_id, reward_type, expires_at, created_at)
  WHERE remaining_quantity > 0;
CREATE INDEX IF NOT EXISTS idx_reward_grants_source ON reward_grants(source_type, source_id);

CREATE TABLE IF NOT EXISTS reward_consumptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  reward_type TEXT NOT NULL,
  grant_id TEXT NOT NULL REFERENCES reward_grants(id) ON DELETE CASCADE,
  optimization_job_id TEXT NOT NULL,
  status TEXT NOT NULL,
  validity_days INTEGER NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ NOT NULL,
  refunded_at TIMESTAMPTZ,
  UNIQUE (optimization_job_id, reward_type)
);
CREATE INDEX IF NOT EXISTS idx_reward_consumptions_user ON reward_consumptions(user_id, consumed_at DESC);

-- goofish:migration-phase
CREATE TABLE IF NOT EXISTS account_deletion_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES user_accounts(id) ON DELETE CASCADE,
  cancel_token_hash TEXT NOT NULL UNIQUE,
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_token TEXT,
  lease_expires_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE account_deletion_requests ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE account_deletion_requests ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE account_deletion_requests ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE account_deletion_requests ADD COLUMN IF NOT EXISTS lease_token TEXT;
ALTER TABLE account_deletion_requests ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;
ALTER TABLE account_deletion_requests ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE account_deletion_requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'account_deletion_requests_status_check'
       AND conrelid = 'account_deletion_requests'::regclass
  ) THEN
    ALTER TABLE account_deletion_requests
      ADD CONSTRAINT account_deletion_requests_status_check
      CHECK (status IN ('pending', 'processing', 'failed'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'account_deletion_requests_attempts_check'
       AND conrelid = 'account_deletion_requests'::regclass
  ) THEN
    ALTER TABLE account_deletion_requests
      ADD CONSTRAINT account_deletion_requests_attempts_check CHECK (attempts >= 0);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_account_deletion_requests_due
  ON account_deletion_requests(status, next_attempt_at, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_account_deletion_requests_lease
  ON account_deletion_requests(lease_expires_at) WHERE status = 'processing';

CREATE TABLE IF NOT EXISTS account_deletion_email_outbox (
  id TEXT PRIMARY KEY,
  deletion_request_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('cancellation', 'receipt')),
  recipient_email TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'dead_letter')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL,
  lease_token TEXT,
  lease_expires_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  delete_after TIMESTAMPTZ NOT NULL,
  UNIQUE (deletion_request_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_account_deletion_email_outbox_due
  ON account_deletion_email_outbox(status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS idx_account_deletion_email_outbox_cleanup
  ON account_deletion_email_outbox(delete_after);

CREATE TABLE IF NOT EXISTS personal_use_declaration_versions (
  declaration_id TEXT PRIMARY KEY,
  display_version TEXT NOT NULL,
  effective_date DATE NOT NULL,
  content_text TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS personal_use_declaration_acceptances (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  profile_id TEXT,
  declaration_id TEXT NOT NULL REFERENCES personal_use_declaration_versions(declaration_id),
  declaration_version TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  action TEXT NOT NULL CONSTRAINT personal_use_declaration_acceptances_action_check
    CHECK (action IN (${PERSONAL_USE_DECLARATION_ACTION_SQL})),
  client_ip TEXT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL,
  account_deleted_at TIMESTAMPTZ,
  retain_until TIMESTAMPTZ,
  UNIQUE (user_id, declaration_id)
);
ALTER TABLE personal_use_declaration_acceptances
  DROP CONSTRAINT IF EXISTS personal_use_declaration_acceptances_action_check;
ALTER TABLE personal_use_declaration_acceptances
  ADD CONSTRAINT personal_use_declaration_acceptances_action_check
  CHECK (action IN (${PERSONAL_USE_DECLARATION_ACTION_SQL}));
CREATE INDEX IF NOT EXISTS idx_personal_use_declaration_acceptances_user ON personal_use_declaration_acceptances(user_id, accepted_at DESC);
CREATE INDEX IF NOT EXISTS idx_personal_use_declaration_acceptances_profile ON personal_use_declaration_acceptances(profile_id, accepted_at DESC);
CREATE INDEX IF NOT EXISTS idx_personal_use_declaration_acceptances_retention ON personal_use_declaration_acceptances(retain_until) WHERE retain_until IS NOT NULL;

CREATE TABLE IF NOT EXISTS personal_use_declaration_usage_events (
  id TEXT PRIMARY KEY,
  acceptance_id TEXT NOT NULL REFERENCES personal_use_declaration_acceptances(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  profile_id TEXT,
  declaration_id TEXT NOT NULL,
  declaration_version TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  action TEXT NOT NULL CONSTRAINT personal_use_declaration_usage_events_action_check
    CHECK (action IN (${PERSONAL_USE_DECLARATION_ACTION_SQL})),
  client_ip TEXT NOT NULL,
  acceptance_accepted_at TIMESTAMPTZ NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  account_deleted_at TIMESTAMPTZ,
  retain_until TIMESTAMPTZ
);
ALTER TABLE personal_use_declaration_usage_events ADD COLUMN IF NOT EXISTS acceptance_accepted_at TIMESTAMPTZ;
UPDATE personal_use_declaration_usage_events event
   SET acceptance_accepted_at = acceptance.accepted_at
  FROM personal_use_declaration_acceptances acceptance
 WHERE event.acceptance_id = acceptance.id
   AND event.acceptance_accepted_at IS NULL;
ALTER TABLE personal_use_declaration_usage_events ALTER COLUMN acceptance_accepted_at SET NOT NULL;
ALTER TABLE personal_use_declaration_usage_events
  DROP CONSTRAINT IF EXISTS personal_use_declaration_usage_events_action_check;
ALTER TABLE personal_use_declaration_usage_events
  ADD CONSTRAINT personal_use_declaration_usage_events_action_check
  CHECK (action IN (${PERSONAL_USE_DECLARATION_ACTION_SQL}));
CREATE INDEX IF NOT EXISTS idx_personal_use_declaration_usage_user
  ON personal_use_declaration_usage_events(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_personal_use_declaration_usage_profile
  ON personal_use_declaration_usage_events(profile_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_personal_use_declaration_usage_retention
  ON personal_use_declaration_usage_events(retain_until) WHERE retain_until IS NOT NULL;

-- goofish:migration-phase
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
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  delivery_id TEXT REFERENCES brevo_email_deliveries(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS delivery_id TEXT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'password_reset_tokens_delivery_id_fkey'
       AND conrelid = 'password_reset_tokens'::regclass
  ) THEN
    ALTER TABLE password_reset_tokens
      ADD CONSTRAINT password_reset_tokens_delivery_id_fkey
      FOREIGN KEY (delivery_id) REFERENCES brevo_email_deliveries(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token_hash ON password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at ON password_reset_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_created_at ON password_reset_tokens(created_at);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_delivery_id ON password_reset_tokens(delivery_id);

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  delivery_id TEXT REFERENCES brevo_email_deliveries(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE email_verification_tokens ADD COLUMN IF NOT EXISTS delivery_id TEXT;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'email_verification_tokens_delivery_id_fkey'
       AND conrelid = 'email_verification_tokens'::regclass
  ) THEN
    ALTER TABLE email_verification_tokens
      ADD CONSTRAINT email_verification_tokens_delivery_id_fkey
      FOREIGN KEY (delivery_id) REFERENCES brevo_email_deliveries(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user_id ON email_verification_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_token_hash ON email_verification_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_expires_at ON email_verification_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_created_at ON email_verification_tokens(created_at);
CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_delivery_id ON email_verification_tokens(delivery_id);

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
ALTER TABLE user_game_accounts ADD COLUMN IF NOT EXISTS kind TEXT;
ALTER TABLE user_game_accounts ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
UPDATE user_game_accounts
   SET permission = CASE permission WHEN 'basic' THEN 'growth' WHEN 'premium' THEN 'advanced' ELSE 'recommended' END,
       record_json = record_json || jsonb_build_object(
         'permission', CASE permission WHEN 'basic' THEN 'growth' WHEN 'premium' THEN 'advanced' ELSE 'recommended' END
       )
 WHERE permission NOT IN ('recommended', 'growth', 'advanced', 'metered_advanced', 'ultimate', 'admin');
UPDATE user_game_accounts
   SET status = 'revoked',
       record_json = record_json || jsonb_build_object('status', 'revoked')
 WHERE status NOT IN ('active', 'frozen', 'revoked');
UPDATE user_game_accounts
   SET record_json = record_json || jsonb_build_object('permission', permission, 'status', status);
ALTER TABLE user_game_accounts DROP CONSTRAINT IF EXISTS user_game_accounts_permission_check;
ALTER TABLE user_game_accounts ADD CONSTRAINT user_game_accounts_permission_check
  CHECK (permission IN ('recommended', 'growth', 'advanced', 'metered_advanced', 'ultimate', 'admin'));
ALTER TABLE user_game_accounts DROP CONSTRAINT IF EXISTS user_game_accounts_status_check;
ALTER TABLE user_game_accounts ADD CONSTRAINT user_game_accounts_status_check
  CHECK (status IN ('active', 'frozen', 'revoked'));
UPDATE user_game_accounts
   SET kind = CASE
     WHEN record_json->>'kind' IN ('cdk', 'free_preview', 'depot_value', 'metered_personal', 'metered_commercial')
       THEN record_json->>'kind'
     ELSE 'cdk'
   END
 WHERE kind IS NULL;
ALTER TABLE user_game_accounts ALTER COLUMN kind SET DEFAULT 'cdk';
ALTER TABLE user_game_accounts ALTER COLUMN kind SET NOT NULL;
ALTER TABLE user_game_accounts DROP CONSTRAINT IF EXISTS user_game_accounts_kind_check;
ALTER TABLE user_game_accounts ADD CONSTRAINT user_game_accounts_kind_check
  CHECK (kind IN ('cdk', 'free_preview', 'depot_value', 'metered_personal', 'metered_commercial'));
CREATE INDEX IF NOT EXISTS idx_user_game_accounts_commercial_page
  ON user_game_accounts(user_id, archived_at, created_at DESC, id DESC)
  WHERE kind = 'metered_commercial';

CREATE TABLE IF NOT EXISTS metered_billing_quotes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES user_game_accounts(id) ON DELETE CASCADE,
  billing_kind TEXT NOT NULL CHECK (billing_kind IN ('metered_personal', 'metered_commercial')),
  operation TEXT NOT NULL DEFAULT 'main_schedule' CHECK (operation IN ('main_schedule', 'incremental_recompute', 'scenario_comparison')),
  pricing_version TEXT NOT NULL,
  tier INTEGER CHECK (tier BETWEEN 1 AND 4),
  list_price NUMERIC(20,2) NOT NULL CHECK (list_price > 0),
  discount_bps INTEGER NOT NULL CHECK (discount_bps BETWEEN 0 AND 10000),
  charge NUMERIC(20,2) NOT NULL CHECK (charge > 0),
  expires_at TIMESTAMPTZ NOT NULL,
  admitted_job_id TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ
);
ALTER TABLE metered_billing_quotes ADD COLUMN IF NOT EXISTS operation TEXT NOT NULL DEFAULT 'main_schedule';
ALTER TABLE metered_billing_quotes DROP CONSTRAINT IF EXISTS metered_billing_quotes_operation_check;
ALTER TABLE metered_billing_quotes ADD CONSTRAINT metered_billing_quotes_operation_check
  CHECK (operation IN ('main_schedule', 'incremental_recompute', 'scenario_comparison'));
CREATE INDEX IF NOT EXISTS idx_metered_billing_quotes_expiry
  ON metered_billing_quotes(expires_at) WHERE admitted_job_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_metered_billing_quotes_admitted_job
  ON metered_billing_quotes(admitted_job_id) WHERE admitted_job_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS billing_reconciliation_cases (
  id TEXT PRIMARY KEY,
  anomaly_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('orphan_reservation', 'reservation_job_mismatch', 'account_projection_mismatch')),
  status TEXT NOT NULL CHECK (status IN ('pending_review', 'resolved')),
  user_id TEXT REFERENCES user_accounts(id) ON DELETE SET NULL,
  job_id TEXT,
  reservation_id TEXT,
  detail_json JSONB NOT NULL,
  resolution_json JSONB,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_billing_reconciliation_cases_status_seen
  ON billing_reconciliation_cases(status, last_seen_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_balance_reservations_job') THEN
    ALTER TABLE user_balance_reservations ADD CONSTRAINT fk_balance_reservations_job
      FOREIGN KEY (job_id) REFERENCES optimize_jobs(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_balance_reservations_profile') THEN
    ALTER TABLE user_balance_reservations ADD CONSTRAINT fk_balance_reservations_profile
      FOREIGN KEY (profile_id) REFERENCES user_game_accounts(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS metered_personal_claims (
  user_id TEXT PRIMARY KEY REFERENCES user_accounts(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL
);

-- goofish:migration-phase
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

CREATE TABLE IF NOT EXISTS lifetime_voucher_pending_bindings (
  confirmation_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  record_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lifetime_voucher_pending_user_id ON lifetime_voucher_pending_bindings(user_id);
CREATE INDEX IF NOT EXISTS idx_lifetime_voucher_pending_expires_at ON lifetime_voucher_pending_bindings(expires_at);

-- goofish:migration-phase
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

-- goofish:migration-phase
CREATE SEQUENCE IF NOT EXISTS optimization_result_history_position_seq;

CREATE TABLE IF NOT EXISTS optimization_result_history (
  profile_id TEXT NOT NULL REFERENCES user_game_accounts(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  job_id TEXT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  config_json JSONB,
  result_json JSONB NOT NULL,
  operator_count INTEGER NOT NULL DEFAULT 0 CHECK (operator_count >= 0),
  source TEXT NOT NULL CHECK (source IN ('generated', 'applied_suggestions', 'legacy')),
  archived_at TIMESTAMPTZ,
  position BIGINT NOT NULL DEFAULT nextval('optimization_result_history_position_seq'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, id),
  UNIQUE (position)
);
CREATE INDEX IF NOT EXISTS idx_optimization_result_history_profile_active_position
  ON optimization_result_history(profile_id, position DESC) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_optimization_result_history_profile_archived_position
  ON optimization_result_history(profile_id, position DESC) WHERE archived_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_optimization_result_history_job
  ON optimization_result_history(job_id) WHERE job_id IS NOT NULL;

-- Backfill every structurally valid legacy result before removing the embedded
-- copies.  Arrays are stored newest-first, so reverse ordinality preserves the
-- same ordering when the sequence-backed cursor positions are assigned.
WITH legacy_results AS (
  SELECT workspace.profile_id, item.value, item.ordinality, FALSE AS archived,
         workspace.updated_at
    FROM user_profile_workspaces workspace
   CROSS JOIN LATERAL jsonb_array_elements(
     CASE
       WHEN jsonb_typeof(workspace.record_json->'result_history') = 'array'
         THEN workspace.record_json->'result_history'
       ELSE '[]'::jsonb
     END
   ) WITH ORDINALITY AS item(value, ordinality)
  UNION ALL
  SELECT workspace.profile_id, item.value, item.ordinality, TRUE AS archived,
         workspace.updated_at
    FROM user_profile_workspaces workspace
   CROSS JOIN LATERAL jsonb_array_elements(
     CASE
       WHEN jsonb_typeof(workspace.record_json->'archived_results') = 'array'
         THEN workspace.record_json->'archived_results'
       ELSE '[]'::jsonb
     END
   ) WITH ORDINALITY AS item(value, ordinality)
), valid_results AS (
  SELECT *
    FROM legacy_results
   WHERE jsonb_typeof(value) = 'object'
     AND jsonb_typeof(value->'result') = 'object'
     AND nullif(value->>'id', '') IS NOT NULL
     AND nullif(value->>'name', '') IS NOT NULL
     AND nullif(value->>'created_at', '') IS NOT NULL
), sequence_base AS (
  SELECT greatest(
    coalesce(max(position), 0),
    (SELECT last_value FROM optimization_result_history_position_seq)
  ) AS value
  FROM optimization_result_history
), positioned_results AS (
  SELECT valid_results.*,
         sequence_base.value + row_number() OVER (
           ORDER BY profile_id, archived, ordinality DESC
         ) AS migration_position
    FROM valid_results
   CROSS JOIN sequence_base
)
INSERT INTO optimization_result_history (
  profile_id, id, job_id, name, created_at, config_json, result_json,
  operator_count, source, archived_at, position, updated_at
)
SELECT profile_id,
       value->>'id',
       nullif(value->>'job_id', ''),
       value->>'name',
       value->>'created_at',
       CASE WHEN jsonb_typeof(value->'config') = 'object' THEN value->'config' ELSE NULL END,
       value->'result',
       CASE
         WHEN coalesce(value->>'operator_count', '') ~ '^[0-9]+$'
           THEN LEAST((value->>'operator_count')::numeric, 2147483647)::integer
         ELSE 0
       END,
       CASE value->>'source'
         WHEN 'applied_suggestions' THEN 'applied_suggestions'
         WHEN 'legacy' THEN 'legacy'
         ELSE 'generated'
       END,
       CASE WHEN archived THEN updated_at ELSE NULL END,
       migration_position,
       updated_at
  FROM positioned_results
ON CONFLICT (profile_id, id) DO NOTHING;

SELECT setval(
  'optimization_result_history_position_seq',
  greatest(
    coalesce((SELECT max(position) FROM optimization_result_history), 1),
    (SELECT last_value FROM optimization_result_history_position_seq)
  ),
  true
);

-- Very old workspaces only carried last_result.  Give that snapshot a stable,
-- profile-scoped identifier when no active history item could be recovered.
INSERT INTO optimization_result_history (
  profile_id, id, name, created_at, config_json, result_json,
  operator_count, source, updated_at
)
SELECT workspace.profile_id,
       'legacy-last-result',
       '上次排班结果',
       workspace.updated_at::text,
       CASE WHEN jsonb_typeof(workspace.record_json->'config') = 'object'
         THEN workspace.record_json->'config'
         ELSE workspace.config_json
       END,
       CASE WHEN jsonb_typeof(workspace.record_json->'last_result') = 'object'
         THEN workspace.record_json->'last_result'
         ELSE workspace.last_result_json
       END,
       CASE WHEN jsonb_typeof(workspace.record_json->'operators') = 'array'
         THEN jsonb_array_length(workspace.record_json->'operators')
         WHEN jsonb_typeof(workspace.operators_json) = 'array'
         THEN jsonb_array_length(workspace.operators_json)
         ELSE 0
       END,
       'legacy',
       workspace.updated_at
  FROM user_profile_workspaces workspace
 WHERE (
   jsonb_typeof(workspace.record_json->'last_result') = 'object'
   OR jsonb_typeof(workspace.last_result_json) = 'object'
 )
   AND NOT EXISTS (
     SELECT 1
       FROM optimization_result_history history
      WHERE history.profile_id = workspace.profile_id
        AND history.archived_at IS NULL
   )
ON CONFLICT (profile_id, id) DO NOTHING;

UPDATE user_profile_workspaces
   SET last_result_json = NULL,
       record_json = record_json - 'last_result' - 'result_history' - 'archived_results'
 WHERE last_result_json IS NOT NULL
    OR record_json ? 'last_result'
    OR record_json ? 'result_history'
    OR record_json ? 'archived_results';

-- goofish:migration-phase
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

-- goofish:migration-phase
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

-- goofish:migration-phase
CREATE TABLE IF NOT EXISTS user_announcement_reads (
  user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  announcement_id TEXT NOT NULL,
  announcement_version TIMESTAMPTZ,
  read_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, announcement_id)
);
ALTER TABLE user_announcement_reads ADD COLUMN IF NOT EXISTS announcement_version TIMESTAMPTZ;

-- goofish:migration-phase
CREATE TABLE IF NOT EXISTS user_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  action_kind TEXT,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (user_id, type, source_type, source_id)
);
ALTER TABLE user_notifications DROP CONSTRAINT IF EXISTS user_notifications_type_check;
ALTER TABLE user_notifications ADD CONSTRAINT user_notifications_type_check
  CHECK (type = 'item_grant') NOT VALID;
ALTER TABLE user_notifications DROP CONSTRAINT IF EXISTS user_notifications_action_kind_check;
ALTER TABLE user_notifications ADD CONSTRAINT user_notifications_action_kind_check
  CHECK (action_kind = 'inventory') NOT VALID;
ALTER TABLE user_notifications DROP CONSTRAINT IF EXISTS user_notifications_payload_kind_check;
ALTER TABLE user_notifications ADD CONSTRAINT user_notifications_payload_kind_check
  CHECK (payload_json->>'kind' = type AND jsonb_typeof(payload_json->'items') = 'array') NOT VALID;
CREATE INDEX IF NOT EXISTS idx_user_notifications_user_updated
  ON user_notifications(user_id, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_user_notifications_user_unread
  ON user_notifications(user_id, updated_at DESC, id DESC) WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS depot_value_samples (
  uid_hash TEXT PRIMARY KEY,
  uid_hash_key_version TEXT NOT NULL DEFAULT 'legacy',
  version INTEGER NOT NULL DEFAULT 1,
  valuation_version TEXT,
  pricing_snapshot_id TEXT,
  pricing_fetched_at TIMESTAMPTZ,
  pricing_status TEXT,
  pricing_coverage NUMERIC,
  complete BOOLEAN NOT NULL DEFAULT FALSE,
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

CREATE TABLE IF NOT EXISTS security_rate_limit_buckets (
  key_hash TEXT PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_security_rate_limit_buckets_expires_at
  ON security_rate_limit_buckets(expires_at);

-- goofish:migration-phase
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS profile_id TEXT;
CREATE INDEX IF NOT EXISTS idx_usage_events_user_id ON usage_events(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_events_profile_id ON usage_events(profile_id);
UPDATE usage_events SET profile_id = record_json->>'profile_id' WHERE profile_id IS NULL AND record_json ? 'profile_id';

-- goofish:migration-phase
ALTER TABLE optimize_jobs ADD COLUMN IF NOT EXISTS profile_id TEXT;
ALTER TABLE optimize_jobs ADD COLUMN IF NOT EXISTS billing_user_id TEXT;
ALTER TABLE optimize_jobs ADD COLUMN IF NOT EXISTS billing_json JSONB;
ALTER TABLE optimization_submissions ADD COLUMN IF NOT EXISTS billing_user_id TEXT;
ALTER TABLE optimize_jobs ADD COLUMN IF NOT EXISTS failure_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE optimize_jobs ADD COLUMN IF NOT EXISTS worker_id TEXT;
ALTER TABLE optimize_jobs ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ;
ALTER TABLE optimize_jobs ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;
ALTER TABLE optimize_jobs ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE optimize_jobs ADD COLUMN IF NOT EXISTS failure_kind TEXT;
ALTER TABLE optimize_jobs ADD COLUMN IF NOT EXISTS public_error_code TEXT;
ALTER TABLE optimize_jobs ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ;
ALTER TABLE optimize_jobs ADD COLUMN IF NOT EXISTS execution_stage TEXT;
ALTER TABLE optimize_jobs ADD COLUMN IF NOT EXISTS stage_updated_at TIMESTAMPTZ;
UPDATE optimize_jobs SET next_attempt_at = created_at WHERE status = 'queued' AND next_attempt_at IS NULL;
UPDATE optimize_jobs
SET expires_at = created_at + interval '24 hours'
WHERE status = 'queued' AND attempt_count = 0
  AND (expires_at IS NULL OR expires_at = created_at + interval '30 minutes');
CREATE INDEX IF NOT EXISTS idx_optimize_jobs_dispatch_ready ON optimize_jobs(status, next_attempt_at, priority DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_optimize_jobs_queue_expires_at ON optimize_jobs(expires_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_optimize_jobs_profile_id ON optimize_jobs(profile_id);
CREATE INDEX IF NOT EXISTS idx_optimize_jobs_billing_user_status ON optimize_jobs(billing_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_optimization_submissions_billing_user_created
  ON optimization_submissions(billing_user_id, created_at DESC) WHERE billing_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_optimize_jobs_worker_status ON optimize_jobs(worker_id, status);
INSERT INTO optimize_job_attempts
  (job_id, attempt_no, worker_id, lock_token, status, started_at, heartbeat_at)
SELECT
  id,
  attempt_count,
  coalesce(worker_id, 'legacy'),
  coalesce(lock_token, 'legacy:' || id),
  'running',
  coalesce(started_at, updated_at),
  coalesce(heartbeat_at, updated_at)
FROM optimize_jobs
WHERE status = 'running'
ON CONFLICT (job_id, attempt_no) DO NOTHING;
UPDATE optimize_jobs SET profile_id = substring(owner_key from '^profile:(.*)$') WHERE profile_id IS NULL AND owner_key LIKE 'profile:%';
UPDATE optimize_jobs
SET payload_json = payload_json - 'activeProfile' - 'previewWorkspaceForGeneration'
WHERE payload_json ? 'activeProfile' OR payload_json ? 'previewWorkspaceForGeneration';
ALTER TABLE depot_value_samples ADD COLUMN IF NOT EXISTS contributor_profile_id TEXT;
ALTER TABLE depot_value_samples ADD COLUMN IF NOT EXISTS uid_hash_key_version TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE depot_value_samples ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE depot_value_samples ADD COLUMN IF NOT EXISTS valuation_version TEXT;
ALTER TABLE depot_value_samples ADD COLUMN IF NOT EXISTS pricing_snapshot_id TEXT;
ALTER TABLE depot_value_samples ADD COLUMN IF NOT EXISTS pricing_fetched_at TIMESTAMPTZ;
ALTER TABLE depot_value_samples ADD COLUMN IF NOT EXISTS pricing_status TEXT;
ALTER TABLE depot_value_samples ADD COLUMN IF NOT EXISTS pricing_coverage NUMERIC;
ALTER TABLE depot_value_samples ADD COLUMN IF NOT EXISTS complete BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_depot_value_samples_contributor_profile_id ON depot_value_samples(contributor_profile_id);
CREATE INDEX IF NOT EXISTS idx_depot_value_samples_valuation_total
  ON depot_value_samples(valuation_version, total_equivalent_sanity) WHERE complete = true;
UPDATE depot_value_samples SET contributor_profile_id = NULL
 WHERE contributor_profile_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM user_game_accounts WHERE id = depot_value_samples.contributor_profile_id);
WITH migratable_v1_samples AS (
  SELECT uid_hash, round(priced_count::numeric / inventory_item_count, 4) AS pricing_coverage
    FROM depot_value_samples
   WHERE version = 1
     AND complete = false
     AND jsonb_typeof(sample_json) = 'object'
     AND total_equivalent_sanity BETWEEN 0 AND 9007199254740991
     AND operator_power_score BETWEEN 0 AND 9007199254740991
     AND (account_level IS NULL OR account_level >= 0)
     AND operator_count >= 0 AND elite2_count >= 0 AND six_star_count >= 0
     AND six_star_e2_count >= 0 AND e2_90_count >= 0
     AND inventory_item_count > 0 AND priced_count >= 0 AND unpriced_count >= 0
     AND priced_count + unpriced_count = inventory_item_count
     AND priced_count::numeric / inventory_item_count >= 0.8
)
UPDATE depot_value_samples AS sample
   SET uid_hash_key_version = coalesce(nullif(btrim(sample.uid_hash_key_version), ''), 'legacy'),
       version = 2,
       valuation_version = 'depot-v2:migrated:v1',
       pricing_snapshot_id = 'legacy-v1',
       pricing_fetched_at = sample.sampled_at,
       pricing_status = 'stale',
       pricing_coverage = migrated.pricing_coverage,
       complete = true,
       sample_json = sample.sample_json || jsonb_build_object(
         'version', 2,
         'valuation_version', 'depot-v2:migrated:v1',
         'pricing_snapshot_id', 'legacy-v1',
         'pricing_fetched_at', sample.sampled_at,
         'pricing_status', 'stale',
         'pricing_coverage', migrated.pricing_coverage,
         'complete', true,
         'migration_source', 'depot-v1'
       )
  FROM migratable_v1_samples AS migrated
 WHERE sample.uid_hash = migrated.uid_hash;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_usage_events_user') THEN
    ALTER TABLE usage_events ADD CONSTRAINT fk_usage_events_user FOREIGN KEY (user_id) REFERENCES user_accounts(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_usage_events_profile') THEN
    ALTER TABLE usage_events ADD CONSTRAINT fk_usage_events_profile FOREIGN KEY (profile_id) REFERENCES user_game_accounts(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_optimize_jobs_profile') THEN
    ALTER TABLE optimize_jobs ADD CONSTRAINT fk_optimize_jobs_profile FOREIGN KEY (profile_id) REFERENCES user_game_accounts(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_depot_samples_profile') THEN
    ALTER TABLE depot_value_samples ADD CONSTRAINT fk_depot_samples_profile FOREIGN KEY (contributor_profile_id) REFERENCES user_game_accounts(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'depot_samples_nonnegative_check') THEN
    ALTER TABLE depot_value_samples ADD CONSTRAINT depot_samples_nonnegative_check CHECK (
      total_equivalent_sanity >= 0 AND operator_power_score >= 0
      AND operator_count >= 0 AND elite2_count >= 0 AND six_star_count >= 0
      AND six_star_e2_count >= 0 AND e2_90_count >= 0
      AND inventory_item_count >= 0 AND priced_count >= 0 AND unpriced_count >= 0
    ) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'depot_samples_count_consistency_check') THEN
    ALTER TABLE depot_value_samples ADD CONSTRAINT depot_samples_count_consistency_check
      CHECK (priced_count + unpriced_count = inventory_item_count) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'depot_samples_version_check') THEN
    ALTER TABLE depot_value_samples ADD CONSTRAINT depot_samples_version_check CHECK (
      version IN (1, 2)
      AND (pricing_coverage IS NULL OR pricing_coverage BETWEEN 0 AND 1)
      AND (complete = false OR (
        version = 2 AND valuation_version IS NOT NULL AND pricing_snapshot_id IS NOT NULL
        AND pricing_fetched_at IS NOT NULL AND pricing_status IN ('fresh', 'stale')
      ))
    ) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'depot_samples_account_level_check') THEN
    ALTER TABLE depot_value_samples ADD CONSTRAINT depot_samples_account_level_check
      CHECK (account_level IS NULL OR account_level >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'depot_samples_safe_numeric_check') THEN
    ALTER TABLE depot_value_samples ADD CONSTRAINT depot_samples_safe_numeric_check CHECK (
      total_equivalent_sanity <= 9007199254740991
      AND operator_power_score <= 9007199254740991
    ) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'depot_samples_complete_metadata_check') THEN
    ALTER TABLE depot_value_samples ADD CONSTRAINT depot_samples_complete_metadata_check CHECK (
      complete = false OR ((
        version = 2
        AND nullif(btrim(uid_hash_key_version), '') IS NOT NULL
        AND nullif(btrim(valuation_version), '') IS NOT NULL
        AND nullif(btrim(pricing_snapshot_id), '') IS NOT NULL
        AND pricing_fetched_at IS NOT NULL
        AND pricing_status IN ('fresh', 'stale')
        AND pricing_coverage BETWEEN 0.8 AND 1
      ) IS TRUE)
    ) NOT VALID;
  END IF;
END $$;
DO $$
DECLARE invalid_sample_count BIGINT;
BEGIN
  SELECT count(*) INTO invalid_sample_count
    FROM depot_value_samples
   WHERE total_equivalent_sanity < 0
      OR total_equivalent_sanity > 9007199254740991
      OR operator_power_score < 0
      OR operator_power_score > 9007199254740991
      OR account_level < 0
      OR operator_count < 0 OR elite2_count < 0 OR six_star_count < 0
      OR six_star_e2_count < 0 OR e2_90_count < 0
      OR inventory_item_count < 0 OR priced_count < 0 OR unpriced_count < 0
      OR priced_count + unpriced_count <> inventory_item_count
      OR version NOT IN (1, 2)
      OR pricing_coverage < 0 OR pricing_coverage > 1
      OR (complete = true AND ((
        version = 2
        AND nullif(btrim(uid_hash_key_version), '') IS NOT NULL
        AND nullif(btrim(valuation_version), '') IS NOT NULL
        AND nullif(btrim(pricing_snapshot_id), '') IS NOT NULL
        AND pricing_fetched_at IS NOT NULL
        AND pricing_status IN ('fresh', 'stale')
        AND pricing_coverage BETWEEN 0.8 AND 1
      ) IS NOT TRUE));
  IF invalid_sample_count > 0 THEN
    RAISE EXCEPTION 'invalid depot value samples must be repaired before constraint validation: % row(s)', invalid_sample_count;
  END IF;
END $$;
ALTER TABLE depot_value_samples VALIDATE CONSTRAINT fk_depot_samples_profile;
ALTER TABLE depot_value_samples VALIDATE CONSTRAINT depot_samples_nonnegative_check;
ALTER TABLE depot_value_samples VALIDATE CONSTRAINT depot_samples_count_consistency_check;
ALTER TABLE depot_value_samples VALIDATE CONSTRAINT depot_samples_version_check;
ALTER TABLE depot_value_samples VALIDATE CONSTRAINT depot_samples_account_level_check;
ALTER TABLE depot_value_samples VALIDATE CONSTRAINT depot_samples_safe_numeric_check;
ALTER TABLE depot_value_samples VALIDATE CONSTRAINT depot_samples_complete_metadata_check;

-- goofish:migration-phase
ALTER TABLE user_accounts ALTER COLUMN cdk_key DROP NOT NULL;
ALTER TABLE user_accounts ALTER COLUMN cdk_code_hash DROP NOT NULL;
ALTER TABLE user_accounts ALTER COLUMN cdk_order_hash DROP NOT NULL;
ALTER TABLE user_game_accounts ALTER COLUMN cdk_key DROP NOT NULL;
ALTER TABLE user_game_accounts ALTER COLUMN cdk_code_hash DROP NOT NULL;
ALTER TABLE user_game_accounts ALTER COLUMN cdk_order_hash DROP NOT NULL;

-- goofish:migration-phase
CREATE TABLE IF NOT EXISTS item_definitions (
  code TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  effect_code TEXT,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  icon_key TEXT NOT NULL DEFAULT 'placeholder',
  system_owned BOOLEAN NOT NULL DEFAULT FALSE,
  issuance_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CHECK (kind IN ('consumable', 'capacity_upgrade', 'gift_pack', 'cosmetic', 'badge', 'license_voucher'))
);
ALTER TABLE item_definitions DROP CONSTRAINT IF EXISTS item_definitions_kind_check;
ALTER TABLE item_definitions ADD CONSTRAINT item_definitions_kind_check
  CHECK (kind IN ('consumable', 'capacity_upgrade', 'gift_pack', 'cosmetic', 'badge', 'license_voucher'));
ALTER TABLE item_definitions DROP CONSTRAINT IF EXISTS item_definitions_effect_kind_check;
ALTER TABLE item_definitions ADD CONSTRAINT item_definitions_effect_kind_check CHECK (
  (kind = 'consumable' AND effect_code IN (
    'priority_compute', 'reorder_check', 'scenario_simulation', 'training_diagnosis',
    'additional_recompute', 'maa_export_trial'
  ))
  OR (kind = 'capacity_upgrade' AND effect_code IN ('plan_capacity', 'history_capacity', 'result_archive_capacity'))
  OR (kind = 'gift_pack' AND effect_code = 'open_gift_pack')
  OR (kind = 'license_voucher' AND effect_code IN ('bind_lifetime_profile', 'activate_limited_profile'))
  OR (kind IN ('cosmetic', 'badge') AND effect_code IS NULL)
);

CREATE TABLE IF NOT EXISTS gift_pack_versions (
  id TEXT PRIMARY KEY,
  item_code TEXT NOT NULL REFERENCES item_definitions(code) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'retired')),
  created_at TIMESTAMPTZ NOT NULL,
  published_at TIMESTAMPTZ,
  UNIQUE (item_code, version)
);

CREATE TABLE IF NOT EXISTS gift_pack_version_contents (
  gift_pack_version_id TEXT NOT NULL REFERENCES gift_pack_versions(id) ON DELETE CASCADE,
  item_code TEXT NOT NULL REFERENCES item_definitions(code) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 10000),
  validity_days INTEGER NOT NULL CHECK (validity_days >= 0 AND validity_days <= 3650),
  PRIMARY KEY (gift_pack_version_id, item_code)
);

-- goofish:migration-phase
ALTER TABLE reward_grants ADD COLUMN IF NOT EXISTS gift_pack_version_id TEXT;
ALTER TABLE reward_grants ADD COLUMN IF NOT EXISTS revoked_quantity INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reward_consumptions ADD COLUMN IF NOT EXISTS reference_type TEXT;
ALTER TABLE reward_consumptions ADD COLUMN IF NOT EXISTS reference_id TEXT;
ALTER TABLE reward_consumptions ADD COLUMN IF NOT EXISTS profile_id TEXT;
ALTER TABLE reward_consumptions ADD COLUMN IF NOT EXISTS committed_at TIMESTAMPTZ;
ALTER TABLE reward_consumptions ADD COLUMN IF NOT EXISTS refunded_grant_id TEXT;
ALTER TABLE reward_consumptions ADD COLUMN IF NOT EXISTS original_expires_at TIMESTAMPTZ;
ALTER TABLE reward_consumptions ALTER COLUMN optimization_job_id DROP NOT NULL;
UPDATE reward_consumptions consumption
   SET original_expires_at = source_grant.expires_at
  FROM reward_grants source_grant
 WHERE source_grant.id = consumption.grant_id
   AND consumption.original_expires_at IS NULL
   AND source_grant.expires_at IS NOT NULL;
UPDATE reward_consumptions
SET reference_type = coalesce(reference_type, 'optimization_job'),
    reference_id = coalesce(reference_id, optimization_job_id),
    status = case
      when status = 'consumed' and exists (
        select 1 from optimize_jobs job
        where job.id = reward_consumptions.optimization_job_id
          and job.status in ('queued', 'running')
      ) then 'reserved'
      when status = 'consumed' then 'committed'
      else status
    end,
    committed_at = case
      when status = 'consumed' and not exists (
        select 1 from optimize_jobs job
        where job.id = reward_consumptions.optimization_job_id
          and job.status in ('queued', 'running')
      ) then coalesce(committed_at, consumed_at)
      else committed_at
    end
WHERE reference_type IS NULL OR reference_id IS NULL OR status = 'consumed';
CREATE UNIQUE INDEX IF NOT EXISTS idx_reward_consumptions_reference
  ON reward_consumptions(reference_type, reference_id, reward_type)
  WHERE reference_type IS NOT NULL AND reference_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reward_grants_gift_pack_version_fk') THEN
    ALTER TABLE reward_grants ADD CONSTRAINT reward_grants_gift_pack_version_fk
      FOREIGN KEY (gift_pack_version_id) REFERENCES gift_pack_versions(id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reward_consumptions_profile_fk') THEN
    ALTER TABLE reward_consumptions ADD CONSTRAINT reward_consumptions_profile_fk
      FOREIGN KEY (profile_id) REFERENCES user_game_accounts(id) ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reward_consumptions_refunded_grant_fk') THEN
    ALTER TABLE reward_consumptions ADD CONSTRAINT reward_consumptions_refunded_grant_fk
      FOREIGN KEY (refunded_grant_id) REFERENCES reward_grants(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

-- goofish:migration-phase
CREATE TABLE IF NOT EXISTS inventory_ledger (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  item_code TEXT NOT NULL REFERENCES item_definitions(code) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  grant_id TEXT REFERENCES reward_grants(id) ON DELETE SET NULL,
  reference_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (user_id, item_code, event_type, reference_type, reference_id)
);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_user_created ON inventory_ledger(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS inventory_operations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  UNIQUE (user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS inventory_admin_operations (
  id TEXT PRIMARY KEY,
  admin_username TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json JSONB,
  created_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  UNIQUE (admin_username, idempotency_key)
);

-- goofish:migration-phase
WITH lifetime_profile_operations AS (
  SELECT operation.id,
         operation.user_id,
         operation.response_json->>'profile_id' AS profile_id,
         'inventory-lifetime-' || operation.id AS code_hash,
         'inventory-lifetime-order-' || operation.id AS order_hash,
         coalesce(operation.completed_at, operation.created_at) AS authorized_at
  FROM inventory_operations operation
  JOIN user_game_accounts profile
    ON profile.id = operation.response_json->>'profile_id'
   AND profile.user_id = operation.user_id
  WHERE operation.operation_type IN ('create_lifetime_profile', 'bind_lifetime_profile')
    AND operation.response_json IS NOT NULL
    AND operation.completed_at IS NOT NULL
    AND profile.kind = 'cdk'
    AND profile.cdk_key IS NULL
)
INSERT INTO cdk_records
  (key, code_hash, cdk_type, status, permission, balance_amount, item_code, item_expires_at,
   license_order_hash, record_json, created_at, updated_at)
SELECT 'cdk/' || code_hash || '.json',
       code_hash,
       'profile',
       'used',
       'advanced',
       null,
       null,
       null,
       order_hash,
       jsonb_build_object(
         'version', 2,
         'cdk_type', 'profile',
         'code_hash', code_hash,
         'permission', 'advanced',
         'balance_amount', null,
         'status', 'used',
         'created_at', authorized_at,
         'used_at', authorized_at,
         'order_note', 'inventory:lifetime_profile_voucher',
         'license_order_hash', order_hash,
         'operator_count', null,
         'config_desc', null,
         'account_id', user_id,
         'profile_id', profile_id,
         'authorization_source', 'lifetime_profile_voucher',
         'inventory_operation_id', id
       ),
       authorized_at,
       authorized_at
FROM lifetime_profile_operations
ON CONFLICT (key) DO NOTHING;

WITH lifetime_profile_operations AS (
  SELECT operation.id,
         operation.user_id,
         operation.response_json->>'profile_id' AS profile_id,
         'inventory-lifetime-' || operation.id AS code_hash,
         'inventory-lifetime-order-' || operation.id AS order_hash
  FROM inventory_operations operation
  WHERE operation.operation_type IN ('create_lifetime_profile', 'bind_lifetime_profile')
    AND operation.response_json IS NOT NULL
    AND operation.completed_at IS NOT NULL
)
UPDATE user_game_accounts profile
SET cdk_key = 'cdk/' || operation.code_hash || '.json',
    cdk_code_hash = operation.code_hash,
    cdk_order_hash = operation.order_hash,
    record_json = profile.record_json || jsonb_build_object(
      'cdk_key', 'cdk/' || operation.code_hash || '.json',
      'cdk_code_hash', operation.code_hash,
      'cdk_order_hash', operation.order_hash
    )
FROM lifetime_profile_operations operation
WHERE profile.id = operation.profile_id
  AND profile.user_id = operation.user_id
  AND profile.kind = 'cdk'
  AND profile.cdk_key IS NULL
  AND EXISTS (
    SELECT 1 FROM cdk_records cdk_record
    WHERE cdk_record.key = 'cdk/' || operation.code_hash || '.json'
      AND cdk_record.record_json->>'account_id' = operation.user_id
      AND cdk_record.record_json->>'profile_id' = operation.profile_id
  );

CREATE TABLE IF NOT EXISTS profile_entitlement_balances (
  profile_id TEXT NOT NULL REFERENCES user_game_accounts(id) ON DELETE CASCADE,
  entitlement_type TEXT NOT NULL,
  units INTEGER NOT NULL DEFAULT 0 CHECK (units >= 0),
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (profile_id, entitlement_type)
);

CREATE TABLE IF NOT EXISTS onboarding_task_versions (
  id TEXT PRIMARY KEY,
  task_code TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  rewards_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (task_code, version)
);

CREATE TABLE IF NOT EXISTS onboarding_task_current (
  task_code TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES onboarding_task_versions(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS user_onboarding_tasks (
  user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  task_code TEXT NOT NULL,
  version_id TEXT NOT NULL REFERENCES onboarding_task_versions(id) ON DELETE RESTRICT,
  completed_at TIMESTAMPTZ NOT NULL,
  claimed_at TIMESTAMPTZ,
  claim_operation_id TEXT,
  PRIMARY KEY (user_id, task_code)
);

CREATE TABLE IF NOT EXISTS inventory_admin_audit (
  id TEXT PRIMARY KEY,
  admin_username TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  before_json JSONB,
  after_json JSONB,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inventory_admin_audit_created ON inventory_admin_audit(created_at DESC);

CREATE TABLE IF NOT EXISTS inventory_distribution_campaigns (
  id TEXT PRIMARY KEY,
  item_code TEXT NOT NULL REFERENCES item_definitions(code) ON DELETE RESTRICT,
  gift_pack_version_id TEXT REFERENCES gift_pack_versions(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  validity_days INTEGER NOT NULL CHECK (validity_days >= 0 AND validity_days <= 3650),
  target_mode TEXT NOT NULL CHECK (target_mode IN ('user_ids', 'all_users')),
  status TEXT NOT NULL CHECK (status IN ('draft', 'queued', 'running', 'paused', 'completed', 'completed_with_failures', 'cancelled', 'reversing', 'reversed')),
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_distribution_recipients (
  campaign_id TEXT NOT NULL REFERENCES inventory_distribution_campaigns(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'granted', 'failed', 'revoked', 'skipped')),
  grant_id TEXT REFERENCES reward_grants(id) ON DELETE SET NULL,
  error_message TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  PRIMARY KEY (campaign_id, user_id)
);
ALTER TABLE inventory_distribution_recipients
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inventory_distribution_recipients
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE inventory_distribution_recipients
  DROP CONSTRAINT IF EXISTS inventory_distribution_recipients_attempt_count_check;
ALTER TABLE inventory_distribution_recipients
  ADD CONSTRAINT inventory_distribution_recipients_attempt_count_check CHECK (attempt_count >= 0);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'inventory_distribution_recipients_status_check'
       AND conrelid = 'inventory_distribution_recipients'::regclass
       AND pg_get_constraintdef(oid) LIKE '%processing%'
  ) THEN
    ALTER TABLE inventory_distribution_recipients
      DROP CONSTRAINT IF EXISTS inventory_distribution_recipients_status_check;
    ALTER TABLE inventory_distribution_recipients
      ADD CONSTRAINT inventory_distribution_recipients_status_check
      CHECK (status IN ('pending', 'processing', 'granted', 'failed', 'revoked', 'skipped'));
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'inventory_distribution_campaigns_status_check'
       AND conrelid = 'inventory_distribution_campaigns'::regclass
       AND pg_get_constraintdef(oid) LIKE '%completed_with_failures%'
  ) THEN
    ALTER TABLE inventory_distribution_campaigns
      DROP CONSTRAINT IF EXISTS inventory_distribution_campaigns_status_check;
    ALTER TABLE inventory_distribution_campaigns
      ADD CONSTRAINT inventory_distribution_campaigns_status_check
      CHECK (status IN ('draft', 'queued', 'running', 'paused', 'completed', 'completed_with_failures', 'cancelled', 'reversing', 'reversed'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_inventory_distribution_ready
  ON inventory_distribution_recipients(campaign_id, status, next_attempt_at, user_id);

CREATE TABLE IF NOT EXISTS behavior_risk_events (
  id TEXT PRIMARY KEY,
  event_key TEXT UNIQUE,
  event_type TEXT NOT NULL CHECK (event_type IN ('register', 'activation', 'login', 'bind', 'job_submit', 'generate', 'export', 'workspace_save', 'page_view', 'skland_uid_mismatch', 'operator_data_anomaly', 'account_deleted')),
  user_id TEXT,
  profile_id TEXT,
  job_id TEXT,
  browser_hmac TEXT,
  session_hmac TEXT,
  network_hmac TEXT,
  ua_hmac TEXT,
  uid_hmac TEXT,
  signal_aliases_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_hash TEXT,
  page_category TEXT,
  key_version TEXT NOT NULL,
  model_version TEXT NOT NULL,
  optimizer_version TEXT,
  structure_summary JSONB,
  activity_claimed_at TIMESTAMPTZ,
  declaration_version TEXT,
  declaration_accepted_at TIMESTAMPTZ,
  occurred_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE behavior_risk_events ADD COLUMN IF NOT EXISTS signal_aliases_json JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE behavior_risk_events DROP CONSTRAINT IF EXISTS behavior_risk_events_event_type_check;
ALTER TABLE behavior_risk_events
  ADD CONSTRAINT behavior_risk_events_event_type_check
  CHECK (event_type IN ('register', 'activation', 'login', 'bind', 'job_submit', 'generate', 'export', 'workspace_save', 'page_view', 'skland_uid_mismatch', 'operator_data_anomaly', 'account_deleted'));
ALTER TABLE behavior_risk_events DROP CONSTRAINT IF EXISTS behavior_risk_events_page_category_check;
ALTER TABLE behavior_risk_events ADD CONSTRAINT behavior_risk_events_page_category_check
  CHECK (page_category IS NULL OR page_category IN ('landing', 'auth', 'profiles', 'workspace', 'optimizer', 'result', 'account', 'public_info', 'other')) NOT VALID;
ALTER TABLE behavior_risk_events DROP CONSTRAINT IF EXISTS behavior_risk_events_signal_shape_check;
ALTER TABLE behavior_risk_events ADD CONSTRAINT behavior_risk_events_signal_shape_check CHECK (
  (browser_hmac IS NULL OR browser_hmac ~ '^[0-9a-f]{64}$')
  AND (session_hmac IS NULL OR session_hmac ~ '^[0-9a-f]{64}$')
  AND (network_hmac IS NULL OR network_hmac ~ '^[0-9a-f]{64}$')
  AND (ua_hmac IS NULL OR ua_hmac ~ '^[0-9a-f]{64}$')
  AND (uid_hmac IS NULL OR uid_hmac ~ '^[0-9a-f]{64}$')
  AND (output_hash IS NULL OR output_hash ~ '^[0-9a-f]{64}$')
  AND jsonb_typeof(signal_aliases_json) = 'object'
) NOT VALID;
ALTER TABLE behavior_risk_events DROP CONSTRAINT IF EXISTS behavior_risk_events_length_check;
ALTER TABLE behavior_risk_events ADD CONSTRAINT behavior_risk_events_length_check CHECK (
  (event_key IS NULL OR length(event_key) <= 256)
  AND length(key_version) BETWEEN 1 AND 32
  AND length(model_version) BETWEEN 1 AND 64
  AND (optimizer_version IS NULL OR length(optimizer_version) <= 256)
  AND (declaration_version IS NULL OR length(declaration_version) <= 128)
) NOT VALID;
ALTER TABLE behavior_risk_events DROP CONSTRAINT IF EXISTS behavior_risk_events_retention_check;
ALTER TABLE behavior_risk_events ADD CONSTRAINT behavior_risk_events_retention_check
  CHECK (expires_at > occurred_at AND expires_at <= occurred_at + interval '91 days') NOT VALID;
CREATE INDEX IF NOT EXISTS idx_behavior_risk_events_user_time ON behavior_risk_events(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_behavior_risk_events_browser_time ON behavior_risk_events(browser_hmac, occurred_at DESC) WHERE browser_hmac IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_behavior_risk_events_network_ua_time ON behavior_risk_events(network_hmac, ua_hmac, occurred_at DESC) WHERE network_hmac IS NOT NULL AND ua_hmac IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_behavior_risk_events_uid_time ON behavior_risk_events(uid_hmac, occurred_at DESC) WHERE uid_hmac IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_behavior_risk_events_job ON behavior_risk_events(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_behavior_risk_events_expiry ON behavior_risk_events(expires_at);

CREATE TABLE IF NOT EXISTS behavior_risk_dirty_users (
  user_id TEXT PRIMARY KEY,
  first_event_at TIMESTAMPTZ NOT NULL,
  last_event_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_behavior_risk_dirty_users_updated ON behavior_risk_dirty_users(updated_at, user_id);

CREATE TABLE IF NOT EXISTS behavior_risk_health (
  key TEXT PRIMARY KEY,
  last_collection_at TIMESTAMPTZ,
  last_collection_status TEXT CHECK (last_collection_status IN ('success', 'disabled', 'failed')),
  last_evaluation_at TIMESTAMPTZ,
  last_evaluation_status TEXT CHECK (last_evaluation_status IN ('success', 'lock_busy', 'failed')),
  last_failure_at TIMESTAMPTZ,
  last_failure_stage TEXT,
  events_processed INTEGER NOT NULL DEFAULT 0 CHECK (events_processed >= 0),
  duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  purged_events INTEGER NOT NULL DEFAULT 0 CHECK (purged_events >= 0),
  updated_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE behavior_risk_health ADD COLUMN IF NOT EXISTS last_collection_at TIMESTAMPTZ;
ALTER TABLE behavior_risk_health ADD COLUMN IF NOT EXISTS last_collection_status TEXT;
ALTER TABLE behavior_risk_health DROP CONSTRAINT IF EXISTS behavior_risk_health_last_collection_status_check;
ALTER TABLE behavior_risk_health ADD CONSTRAINT behavior_risk_health_last_collection_status_check
  CHECK (last_collection_status IS NULL OR last_collection_status IN ('success', 'disabled', 'failed')) NOT VALID;

CREATE TABLE IF NOT EXISTS behavior_risk_cases (
  id TEXT PRIMARY KEY,
  group_key TEXT NOT NULL,
  evidence_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'dismissed', 'actioned')),
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  categories_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  rules_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  model_version TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT
);
ALTER TABLE behavior_risk_cases ADD COLUMN IF NOT EXISTS evidence_key TEXT;
UPDATE behavior_risk_cases
  SET evidence_key = group_key || ':legacy:' || id
  WHERE evidence_key IS NULL;
ALTER TABLE behavior_risk_cases ALTER COLUMN evidence_key SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_behavior_risk_open_group ON behavior_risk_cases(group_key) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_behavior_risk_reviewed_evidence ON behavior_risk_cases(group_key, evidence_key, status);
CREATE INDEX IF NOT EXISTS idx_behavior_risk_cases_status_time ON behavior_risk_cases(status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_behavior_risk_cases_expiry ON behavior_risk_cases(expires_at);

CREATE TABLE IF NOT EXISTS behavior_risk_case_members (
  case_id TEXT NOT NULL REFERENCES behavior_risk_cases(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (case_id, user_id)
);

CREATE TABLE IF NOT EXISTS behavior_risk_review_audit (
  id TEXT PRIMARY KEY,
  case_id TEXT REFERENCES behavior_risk_cases(id) ON DELETE SET NULL,
  admin_username TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('dismiss', 'restrict')),
  note TEXT NOT NULL CHECK (length(trim(note)) > 0),
  actions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  case_snapshot_json JSONB NOT NULL,
  previous_hash TEXT,
  entry_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE behavior_risk_review_audit ADD COLUMN IF NOT EXISTS previous_hash TEXT;
ALTER TABLE behavior_risk_review_audit ADD COLUMN IF NOT EXISTS entry_hash TEXT;
ALTER TABLE behavior_risk_review_audit DROP CONSTRAINT IF EXISTS behavior_risk_review_audit_case_id_fkey;
ALTER TABLE behavior_risk_review_audit ALTER COLUMN case_id DROP NOT NULL;
ALTER TABLE behavior_risk_review_audit ADD CONSTRAINT behavior_risk_review_audit_case_id_fkey
  FOREIGN KEY (case_id) REFERENCES behavior_risk_cases(id) ON DELETE SET NULL NOT VALID;
CREATE INDEX IF NOT EXISTS idx_behavior_risk_review_case ON behavior_risk_review_audit(case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_behavior_risk_review_created ON behavior_risk_review_audit(created_at DESC);

CREATE TABLE IF NOT EXISTS behavior_risk_admin_audit (
  id TEXT PRIMARY KEY,
  admin_username TEXT,
  capability TEXT NOT NULL CHECK (capability IN ('risk_view', 'risk_review', 'risk_config')),
  action TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('allow', 'deny')),
  reason TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_behavior_risk_admin_audit_created ON behavior_risk_admin_audit(created_at DESC);

-- goofish:migration-phase
INSERT INTO item_definitions
  (code, kind, effect_code, name, description, icon_key, system_owned, issuance_enabled, created_at, updated_at)
VALUES
  ('priority_compute_coupon', 'consumable', 'priority_compute', '优先计算券', '让一次主排班进入最高优先队列。', 'priority_compute_coupon', true, true, now(), now()),
  ('reorder_check_coupon', 'consumable', 'reorder_check', '调序检查券', '免费调序检查配额用尽后增加一次检查。', 'reorder_check_coupon', true, true, now(), now()),
  ('scenario_simulation_coupon', 'consumable', 'scenario_simulation', '情景推演券', '运行一次情景比较实验。', 'scenario_simulation_coupon', true, true, now(), now()),
  ('training_diagnosis_coupon', 'consumable', 'training_diagnosis', '练度诊断券', '为一次主排班启用练度与升级诊断。', 'training_diagnosis_coupon', true, true, now(), now()),
  ('additional_recompute_coupon', 'consumable', 'additional_recompute', '追加重算券', '在有效修订窗口内增加一次免费档案重算。', 'additional_recompute_coupon', true, true, now(), now()),
  ('plan_capacity_certificate', 'capacity_upgrade', 'plan_capacity', '方案扩容证', '指定档案的保存方案槽位永久增加 1。', 'plan_capacity_certificate', true, true, now(), now()),
  ('history_capacity_certificate', 'capacity_upgrade', 'history_capacity', '历史档案扩容证', '指定档案的滚动结果历史槽位永久增加 1。', 'history_capacity_certificate', true, true, now(), now()),
  ('result_archive_folder', 'capacity_upgrade', 'result_archive_capacity', '结果封存夹', '指定档案的结果封存区永久增加 1 个槽位。', 'result_archive_folder', true, true, now(), now()),
  ('maa_export_trial_coupon', 'consumable', 'maa_export_trial', 'MAA 导出体验券', '导出一次指定排班结果。', 'maa_export_trial_coupon', true, true, now(), now()),
  ('newcomer_supply_pack', 'gift_pack', 'open_gift_pack', '新人补给包', '内容由后台配置的新人礼包。', 'newcomer_supply_pack', true, true, now(), now()),
  ('lifetime_profile_voucher', 'license_voucher', 'bind_lifetime_profile', '终身版兑换 CDK', '可通过 JSON 创建终身高级档案，或绑定森空岛账号后创建或升级；最终成功时才消耗。', 'lifetime_profile_voucher', true, true, now(), now()),
  ('limited_profile_voucher', 'license_voucher', 'activate_limited_profile', '限时 CDK', '用于已绑定森空岛的免费预览档案，高级权限持续至 2026 年 8 月 20 日 00:00。', 'limited_profile_voucher', true, true, now(), now())
ON CONFLICT (code) DO NOTHING;

UPDATE item_definitions
SET description = '可通过 JSON 创建终身高级档案，或绑定森空岛账号后创建或升级；最终成功时才消耗。',
    updated_at = now()
WHERE code = 'lifetime_profile_voucher'
  AND description IS DISTINCT FROM '可通过 JSON 创建终身高级档案，或绑定森空岛账号后创建或升级；最终成功时才消耗。';

-- goofish:migration-phase
INSERT INTO reward_grants
  (id, user_id, reward_type, source_type, source_id, recipient_role, original_quantity, remaining_quantity,
   validity_days, expires_at, metadata_json, created_at)
SELECT 'free-preview-limited-cdk-2026:' || profile.user_id,
       profile.user_id,
       'limited_profile_voucher',
       'free_preview_activity',
       'free-preview-limited-cdk-2026',
       'participant',
       1, 1, 0, '2026-08-19T16:00:00.000Z'::timestamptz,
       jsonb_build_object('activity_id', 'free-preview-limited-cdk-2026'),
       now()
FROM (
  SELECT DISTINCT ON (user_id) user_id
  FROM user_game_accounts
  WHERE status = 'active'
    AND record_json->>'kind' = 'free_preview'
    AND record_json->'skland_binding' IS NOT NULL
  ORDER BY user_id, created_at ASC
) profile
WHERE now() >= '2026-07-17T04:00:00.000Z'::timestamptz
  AND now() < '2026-08-19T16:00:00.000Z'::timestamptz
ON CONFLICT (user_id, reward_type, source_type, source_id, recipient_role) DO NOTHING;

INSERT INTO inventory_ledger
  (id, user_id, item_code, event_type, quantity, grant_id, reference_type, reference_id, metadata_json, created_at)
SELECT 'free-preview-limited-cdk-2026:ledger:' || reward_grant.user_id,
       reward_grant.user_id, reward_grant.reward_type, 'grant', 1, reward_grant.id,
       reward_grant.source_type, reward_grant.source_id, reward_grant.metadata_json, reward_grant.created_at
FROM reward_grants reward_grant
WHERE reward_grant.reward_type = 'limited_profile_voucher'
  AND reward_grant.source_type = 'free_preview_activity'
  AND reward_grant.source_id = 'free-preview-limited-cdk-2026'
ON CONFLICT (user_id, item_code, event_type, reference_type, reference_id) DO NOTHING;

INSERT INTO onboarding_task_versions (id, task_code, version, enabled, rewards_json, created_at)
VALUES
  ('onboarding:welcome_inventory:v1', 'welcome_inventory', 1, false, '[]'::jsonb, now()),
  ('onboarding:bind_skland:v1', 'bind_skland', 1, false, '[]'::jsonb, now()),
  ('onboarding:first_main_schedule:v1', 'first_main_schedule', 1, false, '[]'::jsonb, now())
ON CONFLICT (task_code, version) DO NOTHING;

INSERT INTO onboarding_task_current (task_code, version_id, updated_at)
VALUES
  ('welcome_inventory', 'onboarding:welcome_inventory:v1', now()),
  ('bind_skland', 'onboarding:bind_skland:v1', now()),
  ('first_main_schedule', 'onboarding:first_main_schedule:v1', now())
ON CONFLICT (task_code) DO NOTHING;
`

export const DATABASE_SCHEMA_CHECKSUM = createHash('sha256')
  .update(CREATE_SCHEMA_SQL)
  .update('\0')
  .update(JSON.stringify(CURRENT_PERSONAL_USE_DECLARATION))
  .update('\0')
  .update(DATABASE_SCHEMA_MINIMUM_APP_VERSION)
  .digest('hex')

const TABLE_CONSTRAINT_KEYWORDS = new Set(['and', 'check', 'constraint', 'foreign', 'or', 'primary', 'unique'])
const API_ONLY_RUNTIME_TABLES = new Set([
  'feature_settings',
  'public_content_settings',
  'website_notification_events',
  'personal_use_declaration_versions',
  'personal_use_declaration_acceptances',
  'personal_use_declaration_usage_events',
  'user_balance_qualification_ledger',
  'commercial_account_limits',
  'user_notifications',
  'inventory_admin_operations',
  'admin_operation_audit',
  'service_status_hourly',
  'service_status_cost_config',
  'service_status_incidents',
  'service_status_incident_updates',
])

export type DatabaseSchemaMode = 'migrate' | 'validate'

export type RuntimeDatabaseSchemaStatus = {
  version: string
  checksum: string
  minimumAppVersion: string
  validatedAt: string
}

let runtimeSchemaReady: Promise<void> | null = null
let runtimeSchemaStatus: RuntimeDatabaseSchemaStatus | null = null

export function resolveDatabaseSchemaMode(environment: NodeJS.ProcessEnv = process.env): DatabaseSchemaMode {
  const role = resolveAppRole(environment)
  return environment.NODE_ENV === 'production' || role === 'worker' ? 'validate' : 'migrate'
}

export async function ensureDatabaseSchema(): Promise<void> {
  runtimeSchemaReady ??= (async () => {
    if (resolveDatabaseSchemaMode() === 'migrate') await migrateDatabaseSchema()
    await validateRuntimeDatabaseSchema()
  })().catch((error) => {
    runtimeSchemaReady = null
    runtimeSchemaStatus = null
    throw error
  })
  await runtimeSchemaReady
}

export function getRuntimeDatabaseSchemaStatus(): RuntimeDatabaseSchemaStatus | null {
  return runtimeSchemaStatus ? { ...runtimeSchemaStatus } : null
}

export function resetRuntimeDatabaseSchemaStateForTesting(): void {
  runtimeSchemaReady = null
  runtimeSchemaStatus = null
}

export async function migrateDatabaseSchema(): Promise<void> {
  const migrationPhases: Array<{ sql: string; values?: unknown[] }> = CREATE_SCHEMA_SQL
    .split(MIGRATION_PHASE_SEPARATOR)
    .map((sql) => sql.trim())
    .filter(Boolean)
    .map((sql) => ({ sql }))

  migrationPhases.push({
    sql: `insert into personal_use_declaration_versions
      (declaration_id, display_version, effective_date, content_text, content_hash, created_at)
     values ($1, $2, $3, $4, $5, now())
     on conflict (declaration_id) do nothing`,
    values: [
      CURRENT_PERSONAL_USE_DECLARATION.id,
      CURRENT_PERSONAL_USE_DECLARATION.version,
      CURRENT_PERSONAL_USE_DECLARATION.effectiveDate,
      CURRENT_PERSONAL_USE_DECLARATION.content,
      CURRENT_PERSONAL_USE_DECLARATION.contentHash,
    ],
  })

  const client = await getPool().connect()
  let migrationStarted = false
  try {
    await client.query(
      "select set_config('statement_timeout', $1, false)",
      [`${MIGRATION_STATEMENT_TIMEOUT_MS}ms`],
    )
    await client.query('select pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK_KEY])
    await ensureMigrationLedger(client)

    const existing = await client.query<{
      checksum: string
      status: string
    }>(
      `select checksum, status
         from goofish_schema_migrations
        where version = $1`,
      [DATABASE_SCHEMA_VERSION],
    )
    const existingMigration = existing.rows[0]
    if (existingMigration && existingMigration.checksum !== DATABASE_SCHEMA_CHECKSUM) {
      throw new Error(
        `Database migration ${DATABASE_SCHEMA_VERSION} checksum does not match the current application. ` +
        'Publish schema changes under a new migration version.',
      )
    }
    if (existingMigration?.status === 'completed') {
      await validateCurrentPersonalUseDeclarationVersion(client)
      return
    }

    await client.query(
      `insert into goofish_schema_migrations
        (version, checksum, minimum_app_version, status, started_at, completed_at, failed_at, failure_code)
       values ($1, $2, $3, 'running', now(), null, null, null)
       on conflict (version) do update
         set checksum = excluded.checksum,
             minimum_app_version = excluded.minimum_app_version,
             status = 'running',
             started_at = now(),
             completed_at = null,
             failed_at = null,
             failure_code = null`,
      [DATABASE_SCHEMA_VERSION, DATABASE_SCHEMA_CHECKSUM, DATABASE_SCHEMA_MINIMUM_APP_VERSION],
    )
    migrationStarted = true

    for (const [index, phase] of migrationPhases.entries()) {
      await runMigrationPhase(client, phase.sql, phase.values ?? [], index + 1, migrationPhases.length)
    }
    await validateCurrentPersonalUseDeclarationVersion(client)
    await client.query(
      `update goofish_schema_migrations
          set status = 'completed', completed_at = now(), failed_at = null, failure_code = null
        where version = $1 and checksum = $2`,
      [DATABASE_SCHEMA_VERSION, DATABASE_SCHEMA_CHECKSUM],
    )
  } catch (error) {
    if (migrationStarted) {
      try {
        await client.query(
          `update goofish_schema_migrations
              set status = 'failed', failed_at = now(), completed_at = null, failure_code = $2
            where version = $1`,
          [DATABASE_SCHEMA_VERSION, postgresErrorCode(error) ?? 'migration_failed'],
        )
      } catch {
        // Preserve the migration failure that caused the ledger update.
      }
    }
    throw error
  } finally {
    try {
      await client.query('select pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK_KEY])
    } catch {
      // Releasing the client also releases a session-level advisory lock.
    }
    client.release()
  }
}

async function ensureMigrationLedger(client: PoolClient): Promise<void> {
  await client.query(`create table if not exists goofish_schema_migrations (
    version TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    minimum_app_version TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
    started_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    failure_code TEXT
  )`)
}

async function runMigrationPhase(
  client: PoolClient,
  sql: string,
  values: unknown[],
  phaseNumber: number,
  totalPhases: number,
): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await client.query({
        text: sql,
        values,
        query_timeout: MIGRATION_STATEMENT_TIMEOUT_MS,
      })
      return
    } catch (error) {
      const code = postgresErrorCode(error)
      if (!code || !RETRIABLE_MIGRATION_CODES.has(code) || attempt >= MIGRATION_PHASE_MAX_ATTEMPTS) {
        throw error
      }
      const delayMs = MIGRATION_RETRY_BASE_MS * 2 ** (attempt - 1)
      console.warn(
        `[database-migration] phase ${phaseNumber}/${totalPhases} failed with ${code}; ` +
        `retrying in ${delayMs}ms (attempt ${attempt + 1}/${MIGRATION_PHASE_MAX_ATTEMPTS})`,
      )
      await sleep(delayMs)
    }
  }
}

function postgresErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function validateRuntimeDatabaseSchema(): Promise<void> {
  runtimeSchemaStatus = null
  const ledger = await query<{
    checksum: string
    minimum_app_version: string
    status: string
  }>(
    `select checksum, minimum_app_version, status
       from goofish_schema_migrations
      where version = $1`,
    [DATABASE_SCHEMA_VERSION],
  )
  const migration = ledger.rows[0]
  if (!migration
    || migration.status !== 'completed'
    || migration.checksum !== DATABASE_SCHEMA_CHECKSUM
    || migration.minimum_app_version !== DATABASE_SCHEMA_MINIMUM_APP_VERSION) {
    throw new Error(
      `Runtime database schema version ${DATABASE_SCHEMA_VERSION} is not fully applied with the expected checksum. ` +
      'Apply database migrations before starting production API or Worker processes.',
    )
  }

  const requiredColumns = runtimeSchemaRequirements(resolveAppRole())
  const missing = await query<{ table_name: string; column_name: string }>(
    `with required as (
       select table_name, column_name
       from jsonb_to_recordset($1::jsonb) as item(table_name text, column_name text)
     )
     select required.table_name, required.column_name
     from required
     left join information_schema.columns actual
       on actual.table_schema = current_schema()
      and actual.table_name = required.table_name
      and actual.column_name = required.column_name
     where actual.column_name is null
     order by required.table_name, required.column_name`,
    [JSON.stringify(requiredColumns)],
  )

  if (missing.rows.length > 0) {
    const missingNames = missing.rows.map((row) => `${row.table_name}.${row.column_name}`).join(', ')
    throw new Error(
      `Runtime database schema is incompatible; missing required columns: ${missingNames}. ` +
      'Apply database migrations before starting production API or Worker processes.',
    )
  }

  await validateCriticalSchemaMetadata(resolveAppRole())
  if (resolveAppRole() !== 'worker') await validateCurrentPersonalUseDeclarationVersion()
  runtimeSchemaStatus = {
    version: DATABASE_SCHEMA_VERSION,
    checksum: DATABASE_SCHEMA_CHECKSUM,
    minimumAppVersion: DATABASE_SCHEMA_MINIMUM_APP_VERSION,
    validatedAt: new Date().toISOString(),
  }
}

async function validateCriticalSchemaMetadata(role: AppRole): Promise<void> {
  const requiredColumns = [
    { table_name: 'optimize_jobs', column_name: 'id', data_type: 'text', is_nullable: 'NO' },
    { table_name: 'optimize_jobs', column_name: 'status', data_type: 'text', is_nullable: 'NO' },
    { table_name: 'optimize_jobs', column_name: 'payload_json', data_type: 'jsonb', is_nullable: 'NO' },
    {
      table_name: 'optimize_jobs',
      column_name: 'attempt_count',
      data_type: 'integer',
      is_nullable: 'NO',
      default_fragment: '0',
    },
    ...(role === 'worker' ? [] : [
      { table_name: 'user_accounts', column_name: 'id', data_type: 'text', is_nullable: 'NO' },
      { table_name: 'user_accounts', column_name: 'email', data_type: 'text', is_nullable: 'NO' },
      { table_name: 'personal_use_declaration_versions', column_name: 'content_hash', data_type: 'text', is_nullable: 'NO' },
    ]),
  ]
  const incompatibleColumns = await query<{
    table_name: string
    column_name: string
  }>(
    `with required as (
       select table_name, column_name, data_type, is_nullable, default_fragment
       from jsonb_to_recordset($1::jsonb)
         as item(table_name text, column_name text, data_type text, is_nullable text, default_fragment text)
     )
     select required.table_name, required.column_name
       from required
       join information_schema.columns actual
         on actual.table_schema = current_schema()
        and actual.table_name = required.table_name
        and actual.column_name = required.column_name
      where actual.data_type <> required.data_type
         or actual.is_nullable <> required.is_nullable
         or (required.default_fragment is not null
             and position(required.default_fragment in coalesce(actual.column_default, '')) = 0)
      order by required.table_name, required.column_name`,
    [JSON.stringify(requiredColumns)],
  )
  if (incompatibleColumns.rows.length > 0) {
    const names = incompatibleColumns.rows.map((row) => `${row.table_name}.${row.column_name}`).join(', ')
    throw new Error(`Runtime database schema has incompatible critical columns: ${names}.`)
  }

  const requiredConstraints = role === 'worker'
    ? ['optimize_jobs_pkey']
    : ['optimize_jobs_pkey', 'user_accounts_pkey', 'personal_use_declaration_versions_pkey']
  const missingConstraints = await query<{ name: string }>(
    `select required.name
       from unnest($1::text[]) required(name)
       left join pg_constraint actual
         on actual.conname = required.name
        and actual.connamespace = current_schema()::regnamespace
      where actual.oid is null
      order by required.name`,
    [requiredConstraints],
  )
  if (missingConstraints.rows.length > 0) {
    throw new Error(
      `Runtime database schema is missing critical constraints: ${missingConstraints.rows.map((row) => row.name).join(', ')}.`,
    )
  }

  const requiredIndexes = role === 'worker'
    ? [
      { name: 'idx_optimize_jobs_dispatch_ready', is_unique: false },
      { name: 'uq_optimize_jobs_owner_running', is_unique: true },
    ]
    : [
      { name: 'idx_optimize_jobs_dispatch_ready', is_unique: false },
      { name: 'uq_optimize_jobs_owner_running', is_unique: true },
      { name: 'idx_user_accounts_email', is_unique: false },
      { name: 'idx_security_rate_limit_buckets_expires_at', is_unique: false },
    ]
  const missingIndexes = await query<{ name: string }>(
    `with required as (
       select name, is_unique
         from jsonb_to_recordset($1::jsonb) as item(name text, is_unique boolean)
     )
     select required.name
       from required
       left join pg_class actual
         on actual.relname = required.name
        and actual.relnamespace = current_schema()::regnamespace
        and actual.relkind = 'i'
       left join pg_index index_metadata on index_metadata.indexrelid = actual.oid
      where actual.oid is null or index_metadata.indisunique <> required.is_unique
      order by required.name`,
    [JSON.stringify(requiredIndexes)],
  )
  if (missingIndexes.rows.length > 0) {
    throw new Error(
      `Runtime database schema is missing critical indexes: ${missingIndexes.rows.map((row) => row.name).join(', ')}.`,
    )
  }
}

type SchemaQueryExecutor = Pick<PoolClient, 'query'>

async function validateCurrentPersonalUseDeclarationVersion(executor?: SchemaQueryExecutor): Promise<void> {
  const result = await schemaQuery<{
    display_version: string
    effective_date: string
    content_text: string
    content_hash: string
  }>(executor,
    `select display_version, effective_date::text, content_text, content_hash
       from personal_use_declaration_versions
      where declaration_id = $1`,
    [CURRENT_PERSONAL_USE_DECLARATION.id],
  )
  const stored = result.rows[0]
  if (!stored
    || stored.display_version !== CURRENT_PERSONAL_USE_DECLARATION.version
    || stored.effective_date !== CURRENT_PERSONAL_USE_DECLARATION.effectiveDate
    || stored.content_text !== CURRENT_PERSONAL_USE_DECLARATION.content
    || stored.content_hash !== CURRENT_PERSONAL_USE_DECLARATION.contentHash) {
    throw new Error(
      `Stored personal-use declaration ${CURRENT_PERSONAL_USE_DECLARATION.id} does not match the immutable runtime document. ` +
      'Publish changed content under a new declaration ID before starting the service.',
    )
  }
}

function schemaQuery<T extends QueryResultRow>(
  executor: SchemaQueryExecutor | undefined,
  text: string,
  values: unknown[] = [],
): Promise<QueryResult<T>> {
  return executor ? executor.query<T>(text, values) : query<T>(text, values)
}

function runtimeSchemaRequirements(role: AppRole): Array<{ table_name: string; column_name: string }> {
  const requirements = new Map<string, Set<string>>()
  const add = (tableName: string, columnName: string): void => {
    const columns = requirements.get(tableName) ?? new Set<string>()
    columns.add(columnName)
    requirements.set(tableName, columns)
  }

  for (const match of CREATE_SCHEMA_SQL.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\);/gi)) {
    const tableName = match[1].toLowerCase()
    for (const line of match[2].split('\n')) {
      const column = /^\s*([a-z_][a-z0-9_]*)\s+/i.exec(line)?.[1]?.toLowerCase()
      if (column && !TABLE_CONSTRAINT_KEYWORDS.has(column)) add(tableName, column)
    }
  }

  for (const match of CREATE_SCHEMA_SQL.matchAll(/ALTER TABLE\s+([a-z_][a-z0-9_]*)\s+ADD COLUMN IF NOT EXISTS\s+([a-z_][a-z0-9_]*)/gi)) {
    add(match[1].toLowerCase(), match[2].toLowerCase())
  }

  return [...requirements.entries()].flatMap(([tableName, columns]) => {
    if (role === 'worker' && API_ONLY_RUNTIME_TABLES.has(tableName)) return []
    return [...columns].map((columnName) => ({ table_name: tableName, column_name: columnName }))
  })
}
