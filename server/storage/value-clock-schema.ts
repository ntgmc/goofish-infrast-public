import { VALUE_CLOCK_METRICS as metrics } from '../../src/lib/value-clock'

const columns = metrics.map((key) => `${key} NUMERIC NOT NULL`).join(',\n')
export const VALUE_CLOCK_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS value_clock_series (
  id TEXT PRIMARY KEY CHECK (id = 'production-v1'), revision BIGINT NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ
);
INSERT INTO value_clock_series(id) VALUES ('production-v1') ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION value_clock_identity(profile_id TEXT, profile JSONB) RETURNS TEXT
  LANGUAGE SQL IMMUTABLE AS $$ SELECT CASE WHEN nullif(profile->'skland_binding'->>'uid', '') IS NOT NULL
    THEN 'uid:' || (profile->'skland_binding'->>'uid') ELSE 'profile:' || profile_id END $$;
CREATE TABLE IF NOT EXISTS value_clock_pending (identity TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS value_clock_intervals (
  id TEXT PRIMARY KEY, identity TEXT NOT NULL,
  profile_id TEXT NOT NULL REFERENCES user_game_accounts(id) ON DELETE CASCADE,
  result_id TEXT NOT NULL, started_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ,
  ${columns}, CHECK (ends_at IS NULL OR ends_at >= started_at)
);
CREATE INDEX IF NOT EXISTS idx_value_clock_intervals_identity ON value_clock_intervals(identity);
CREATE INDEX IF NOT EXISTS idx_value_clock_intervals_open ON value_clock_intervals(started_at) WHERE ends_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_value_clock_intervals_ends_at ON value_clock_intervals(ends_at);
CREATE TABLE IF NOT EXISTS value_clock_days (
  interval_id TEXT NOT NULL REFERENCES value_clock_intervals(id) ON DELETE CASCADE,
  day DATE NOT NULL, started_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ NOT NULL,
  ${columns}, PRIMARY KEY(interval_id, day)
);
CREATE INDEX IF NOT EXISTS idx_value_clock_days_day ON value_clock_days(day);
CREATE TABLE IF NOT EXISTS value_clock_daily_totals (day DATE PRIMARY KEY, ${columns});
CREATE OR REPLACE FUNCTION value_clock_day_rollup() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE value_clock_daily_totals SET ${metrics.map((key) => `${key} = ${key} - OLD.${key} * EXTRACT(EPOCH FROM (OLD.ends_at - OLD.started_at)) / 86400`).join(', ')} WHERE day = OLD.day;
    RETURN OLD;
  END IF;
  INSERT INTO value_clock_daily_totals(day, ${metrics.join(', ')})
    VALUES (NEW.day, ${metrics.map((key) => `NEW.${key} * EXTRACT(EPOCH FROM (NEW.ends_at - NEW.started_at)) / 86400`).join(', ')})
    ON CONFLICT(day) DO UPDATE SET ${metrics.map((key) => `${key} = value_clock_daily_totals.${key} + EXCLUDED.${key}`).join(', ')};
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS value_clock_day_rollup ON value_clock_days;
CREATE TRIGGER value_clock_day_rollup AFTER INSERT OR DELETE ON value_clock_days FOR EACH ROW EXECUTE FUNCTION value_clock_day_rollup();
CREATE OR REPLACE FUNCTION value_clock_interval_days() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'DELETE' AND NEW.ends_at IS NOT NULL THEN
    INSERT INTO value_clock_days(interval_id, day, started_at, ends_at, ${metrics.join(', ')})
      SELECT NEW.id, d::date, greatest(NEW.started_at, d::date::timestamp AT TIME ZONE 'Asia/Shanghai'),
        least(NEW.ends_at, (d::date + 1)::timestamp AT TIME ZONE 'Asia/Shanghai'), ${metrics.map((key) => `NEW.${key}`).join(', ')}
      FROM generate_series((NEW.started_at AT TIME ZONE 'Asia/Shanghai')::date,
        (NEW.ends_at AT TIME ZONE 'Asia/Shanghai')::date, interval '1 day') AS d
      WHERE NEW.ends_at > NEW.started_at AND (d::date::timestamp AT TIME ZONE 'Asia/Shanghai') < NEW.ends_at;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS value_clock_interval_days ON value_clock_intervals;
CREATE TRIGGER value_clock_interval_days AFTER INSERT ON value_clock_intervals FOR EACH ROW EXECUTE FUNCTION value_clock_interval_days();
CREATE OR REPLACE FUNCTION value_clock_queue_source() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE old_identity TEXT; new_identity TEXT;
BEGIN
  IF TG_TABLE_NAME = 'user_game_accounts' THEN
    IF TG_OP <> 'INSERT' THEN old_identity := value_clock_identity(OLD.id, OLD.record_json); END IF;
    IF TG_OP <> 'DELETE' THEN new_identity := value_clock_identity(NEW.id, NEW.record_json); END IF;
    IF TG_OP = 'UPDATE' AND old_identity IS NOT DISTINCT FROM new_identity
      AND OLD.record_json->'skland_binding'->>'last_imported_at' IS NOT DISTINCT FROM NEW.record_json->'skland_binding'->>'last_imported_at' THEN RETURN NULL; END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN SELECT value_clock_identity(id, record_json) INTO old_identity FROM user_game_accounts WHERE id = OLD.profile_id; END IF;
    IF TG_OP <> 'DELETE' THEN SELECT value_clock_identity(id, record_json) INTO new_identity FROM user_game_accounts WHERE id = NEW.profile_id; END IF;
  END IF;
  INSERT INTO value_clock_pending(identity) SELECT identity FROM unnest(ARRAY[old_identity, new_identity]) identity WHERE identity IS NOT NULL ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS value_clock_queue_result ON optimization_result_history;
CREATE TRIGGER value_clock_queue_result AFTER INSERT OR UPDATE OR DELETE ON optimization_result_history FOR EACH ROW EXECUTE FUNCTION value_clock_queue_source();
DROP TRIGGER IF EXISTS value_clock_queue_profile ON user_game_accounts;
CREATE TRIGGER value_clock_queue_profile AFTER UPDATE OR DELETE ON user_game_accounts FOR EACH ROW EXECUTE FUNCTION value_clock_queue_source();
INSERT INTO value_clock_pending(identity)
  SELECT DISTINCT value_clock_identity(g.id, g.record_json) FROM user_game_accounts g
  JOIN optimization_result_history h ON h.profile_id = g.id ON CONFLICT DO NOTHING;
`
