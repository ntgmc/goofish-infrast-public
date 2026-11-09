export const OPERATIONS_TOOLS_SQL = `tool_tracking as (
  select min(created_at) as started_at from usage_events cross join bounds
  where event = 'tool_metrics_started' and expires_at > observed_at
), tool_events as materialized (
  select e.event, e.created_at, e.user_id, e.visitor_id,
    e.record_json->>'page' as page, e.record_json->>'tool' as tool,
    e.record_json->>'tool_outcome' as outcome,
    case when e.record_json->>'duration_ms' ~ '^[0-9]{1,15}(\\.[0-9]{1,6})?$'
      then (e.record_json->>'duration_ms')::double precision end as duration_ms
  from usage_events e cross join bounds
  where e.event in ('page_view', 'tool_run') and e.expires_at > observed_at
    and e.created_at >= (select min(start_at) from periods) and e.created_at < observed_at
), tool_stats as (
  select p.name, e.tool,
    count(distinct e.user_id)::integer as users,
    count(distinct e.visitor_id) filter (where e.user_id is null)::integer as anonymous_visitors,
    count(*)::integer as attempts,
    count(*) filter (where e.outcome = 'success')::integer as successful,
    count(*) filter (where e.outcome = 'failure')::integer as failed,
    count(*) filter (where e.outcome = 'cancelled')::integer as cancelled,
    round(100.0 * count(*) filter (where e.outcome = 'success') /
      nullif(count(*) filter (where e.outcome in ('success', 'failure')), 0), 1) as success_rate,
    count(e.duration_ms) filter (where e.outcome = 'success')::integer as latency_samples,
    percentile_cont(0.5) within group (order by e.duration_ms) filter (where e.outcome = 'success') as p50_ms,
    percentile_cont(0.95) within group (order by e.duration_ms) filter (where e.outcome = 'success') as p95_ms
  from periods p join tool_events e on e.event = 'tool_run' and e.created_at >= p.start_at and e.created_at < p.end_at
  where e.tool is not null group by p.name, e.tool
), page_stats as (
  select e.page, count(distinct e.visitor_id)::integer as visitors, count(*)::integer as views
  from tool_events e cross join bounds b
  where e.event = 'page_view' and e.created_at >= b.start_at and e.created_at < b.end_at and e.page is not null
  group by e.page
), tool_overview as (
  select jsonb_build_object('tracking_started_at', t.started_at,
    'pages', coalesce((select jsonb_agg(to_jsonb(s) order by s.visitors desc, s.page) from page_stats s), '[]'::jsonb),
    'current', coalesce((select jsonb_agg(to_jsonb(s) - 'name' order by s.users desc, s.attempts desc, s.tool) from tool_stats s where name = 'current'), '[]'::jsonb),
    'previous', coalesce((select jsonb_agg(to_jsonb(s) - 'name' order by s.users desc, s.attempts desc, s.tool) from tool_stats s where name = 'previous'), '[]'::jsonb)
  ) as summary from tool_tracking t
)`
