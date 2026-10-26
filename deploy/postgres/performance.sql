-- Run against the application database after enabling pg_stat_statements.
-- Read-only diagnostics; never reset counters during an investigation.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';

SELECT stats_reset, dealloc FROM pg_stat_statements_info;

SELECT queryid::text, calls, rows,
       round(total_exec_time::numeric, 2) AS total_exec_ms,
       round(mean_exec_time::numeric, 2) AS mean_exec_ms,
       round(max_exec_time::numeric, 2) AS max_exec_ms,
       shared_blks_hit, shared_blks_read, temp_blks_written,
       round(blk_read_time::numeric, 2) AS block_read_ms,
       round(blk_write_time::numeric, 2) AS block_write_ms
FROM pg_stat_statements
WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
  AND userid = (SELECT usesysid FROM pg_user WHERE usename = current_user)
ORDER BY total_exec_time DESC
LIMIT 20;

SELECT state, wait_event_type, wait_event, count(*) AS connections,
       max(clock_timestamp() - xact_start) AS oldest_transaction,
       count(*) FILTER (WHERE cardinality(pg_blocking_pids(pid)) > 0) AS blocked_connections
FROM pg_stat_activity
WHERE datname = current_database() AND usename = current_user AND pid <> pg_backend_pid()
GROUP BY state, wait_event_type, wait_event
ORDER BY connections DESC;

COMMIT;
