import type { OperationsOverview } from '../../src/lib/operations-overview'
import { query } from './postgres'
import { USAGE_RETENTION_DAYS } from './usage-store'

export async function getOperationsOverview(from: string, to: string, now = new Date()): Promise<OperationsOverview> {
  const result = await query<{ overview: OperationsOverview }>(OVERVIEW_SQL, [from, to, now.toISOString(), USAGE_RETENTION_DAYS])
  if (!result.rows[0]) throw new Error('运营数据未返回，请重新刷新。')
  return result.rows[0].overview
}

// Aggregate in PostgreSQL so traffic volume cannot truncate a user cohort.
const OVERVIEW_SQL = `
with bounds as (
  select $1::date as from_day, $2::date as to_day,
         $1::date::timestamp at time zone 'Asia/Shanghai' as start_at,
         least(($2::date + 1)::timestamp at time zone 'Asia/Shanghai', $3::timestamptz) as end_at,
         $3::timestamptz as observed_at,
         $3::timestamptz - ($4::integer * interval '24 hours') as retained_from
), periods as (
  select 'current' as name, from_day, to_day, start_at, end_at from bounds
  union all
  select 'previous', from_day - (to_day - from_day + 1), from_day - 1,
         (from_day - (to_day - from_day + 1))::timestamp at time zone 'Asia/Shanghai',
         end_at - ((to_day - from_day + 1) * interval '24 hours') from bounds
), tracking as (
  select min(created_at) as started_at from usage_events, bounds
  where event = 'business_metrics_started' and expires_at > observed_at
), events as materialized (
  select e.event, e.created_at, e.record_json->>'id' as id,
         coalesce(e.user_id, profile.user_id) as user_id,
         e.record_json->>'status' as outcome,
         coalesce(e.record_json->>'reason_code', 'unknown_failure') as reason_code,
         coalesce(e.record_json->>'schedule_mode', 'maa') as schedule_mode,
         e.record_json->>'generation_id' as generation_id,
         case when e.record_json->>'duration_ms' ~ '^[0-9]{1,15}(\\.[0-9]{1,3})?$'
              then (e.record_json->>'duration_ms')::double precision end as wait_ms
  from usage_events e
  left join user_game_accounts profile on profile.id = e.profile_id
  cross join bounds
  where e.event in ('schedule_generate', 'maa_export', 'skland_import')
    and e.created_at >= (select min(start_at) from periods)
    and e.created_at <= observed_at and e.expires_at > observed_at
), successes as materialized (
  select * from events where event = 'schedule_generate' and outcome = 'success'
), activity as (
  select p.name,
         count(distinct e.user_id) filter (where e.event = 'schedule_generate' and e.outcome = 'success')::integer as successful_users,
         count(*) filter (where e.event = 'schedule_generate' and e.outcome = 'success')::integer as successful_generations,
         count(*) filter (where e.event = 'schedule_generate' and e.outcome = 'failure')::integer as failed_requests,
         count(*) filter (where e.event = 'schedule_generate' and e.outcome = 'success' and e.user_id is null)::integer as unattributed_successes,
         count(*) filter (where e.event in ('schedule_generate', 'skland_import') and (e.outcome is null or e.outcome not in ('success', 'failure')))::integer as unknown_outcomes,
         count(e.wait_ms) filter (where e.event = 'schedule_generate' and e.outcome = 'success')::integer as latency_samples,
         percentile_cont(0.5) within group (order by e.wait_ms) filter (where e.event = 'schedule_generate' and e.outcome = 'success') as p50_wait_ms,
         percentile_cont(0.95) within group (order by e.wait_ms) filter (where e.event = 'schedule_generate' and e.outcome = 'success') as p95_wait_ms
  from periods p left join events e on e.created_at >= p.start_at and e.created_at < p.end_at
  group by p.name
), new_users as (
  select p.name, a.id,
         a.created_at + interval '168 hours' <= b.observed_at as eligible,
         exists(select 1 from user_game_accounts profile where profile.user_id = a.id
                and profile.created_at >= a.created_at and profile.created_at < a.created_at + interval '168 hours')
           or count(s.created_at) > 0 as with_profile,
         count(s.created_at) > 0 as generated
  from periods p join user_accounts a on a.created_at >= p.start_at and a.created_at < p.end_at
  cross join bounds b
  left join successes s on s.user_id = a.id and s.created_at >= a.created_at and s.created_at < a.created_at + interval '168 hours'
  group by p.name, a.id, b.observed_at
), activation as (
  select p.name, count(n.id)::integer as registered_users,
         count(n.id) filter (where n.eligible)::integer as eligible,
         count(n.id) filter (where not n.eligible)::integer as pending,
         count(n.id) filter (where n.eligible and n.with_profile)::integer as with_profile,
         count(n.id) filter (where n.eligible and n.generated)::integer as activated
  from periods p left join new_users n on n.name = p.name group by p.name
), usage_cohort as (
  select p.name, s.user_id,
         (min(s.created_at) at time zone 'Asia/Shanghai')::date as first_day
  from periods p join successes s on s.created_at >= p.start_at and s.created_at < p.end_at
  where s.user_id is not null group by p.name, s.user_id
), reuse as (
  select p.name,
         count(distinct c.user_id) filter (where (c.first_day + 8)::timestamp at time zone 'Asia/Shanghai' <= b.observed_at)::integer as eligible,
         count(distinct c.user_id) filter (where (c.first_day + 8)::timestamp at time zone 'Asia/Shanghai' > b.observed_at)::integer as pending,
         count(distinct s.user_id) filter (where (c.first_day + 8)::timestamp at time zone 'Asia/Shanghai' <= b.observed_at)::integer as reused
  from periods p cross join bounds b left join usage_cohort c on c.name = p.name
  left join successes s on s.user_id = c.user_id
    and s.created_at >= (c.first_day + 1)::timestamp at time zone 'Asia/Shanghai'
    and s.created_at < (c.first_day + 8)::timestamp at time zone 'Asia/Shanghai'
  group by p.name
), exports as (
  select generation_id, max(created_at) as exported_at from events
  where event = 'maa_export' and outcome = 'success' group by generation_id
), maa as (
  select p.name,
         count(s.id)::integer as eligible,
         count(e.generation_id)::integer as exported,
         coalesce(t.started_at <= p.start_at, false) as complete
  from periods p cross join tracking t
  left join successes s on s.created_at >= greatest(p.start_at, t.started_at)
    and t.started_at is not null and s.created_at < p.end_at and s.schedule_mode = 'maa'
  left join exports e on e.generation_id = s.id and e.exported_at >= s.created_at
  group by p.name, p.start_at, t.started_at
), cost as (
  select p.name,
         count(h.bucket_start)::integer as recorded_hours,
         greatest(0, extract(epoch from (date_trunc('hour', p.end_at, 'UTC') - p.start_at)) / 3600)::integer as expected_hours,
         coalesce(sum(h.worker_instances_sum / nullif(h.sample_count, 0)), 0) as worker_hours,
         cfg.resident_hourly_price_cny is not null and cfg.hourly_price_cny is not null as prices_configured,
         cfg.resident_hourly_price_cny, cfg.hourly_price_cny,
         date_trunc('hour', p.end_at, 'UTC') as through,
         (select count(*)::integer from successes s where s.created_at >= p.start_at
            and s.created_at < date_trunc('hour', p.end_at, 'UTC')) as successful_generations
  from periods p
  left join service_status_hourly h on h.component_id = 'optimization' and h.sample_count > 0
    and h.bucket_start >= p.start_at and h.bucket_start < date_trunc('hour', p.end_at, 'UTC')
  left join service_status_cost_config cfg on cfg.component_id = 'optimization'
  group by p.name, p.start_at, p.end_at, cfg.resident_hourly_price_cny, cfg.hourly_price_cny
), costs as (
  select c.*, case when prices_configured and expected_hours > 0 and recorded_hours = expected_hours
                    then expected_hours * resident_hourly_price_cny + worker_hours * hourly_price_cny end as estimated_cny
  from cost c
), summaries as (
  select p.name, jsonb_build_object(
    'from', p.from_day, 'to', p.to_day, 'observed_until', p.end_at,
    'complete', p.start_at >= b.retained_from and a.unattributed_successes = 0 and a.unknown_outcomes = 0,
    'successful_users', a.successful_users, 'registered_users', n.registered_users,
    'successful_generations', a.successful_generations, 'failed_requests', a.failed_requests,
    'success_rate', case when p.start_at >= b.retained_from and a.unknown_outcomes = 0 then round(100.0 * a.successful_generations / nullif(a.successful_generations + a.failed_requests, 0), 1) end,
    'latency_samples', a.latency_samples, 'p50_wait_ms', a.p50_wait_ms, 'p95_wait_ms', a.p95_wait_ms,
    'activation', jsonb_build_object('eligible', n.eligible, 'activated', n.activated, 'pending', n.pending,
      'with_profile', n.with_profile,
      'rate', case when p.start_at >= b.retained_from and a.unattributed_successes = 0 and a.unknown_outcomes = 0 then round(100.0 * n.activated / nullif(n.eligible, 0), 1) end),
    'reuse', jsonb_build_object('eligible', r.eligible, 'reused', r.reused, 'pending', r.pending,
      'rate', case when p.start_at >= b.retained_from and a.unattributed_successes = 0 and a.unknown_outcomes = 0 then round(100.0 * r.reused / nullif(r.eligible, 0), 1) end),
    'maa', jsonb_build_object('eligible', m.eligible, 'exported', m.exported, 'complete', m.complete,
      'rate', case when m.complete and p.start_at >= b.retained_from and a.unknown_outcomes = 0 then round(100.0 * m.exported / nullif(m.eligible, 0), 1) end),
    'cost', jsonb_build_object('estimated_cny', round(c.estimated_cny, 4),
      'per_success_cny', case when p.start_at >= b.retained_from and a.unknown_outcomes = 0 then round(c.estimated_cny / nullif(c.successful_generations, 0), 4) end,
      'recorded_hours', c.recorded_hours, 'expected_hours', c.expected_hours,
      'successful_generations', c.successful_generations, 'prices_configured', c.prices_configured, 'through', c.through)
  ) as summary
  from periods p cross join bounds b
  join activity a using (name) join activation n using (name) join reuse r using (name)
  join maa m using (name) join costs c using (name)
), daily_activity as (
  select (e.created_at at time zone 'Asia/Shanghai')::date as date,
         count(distinct user_id) filter (where outcome = 'success')::integer as successful_users,
         count(*) filter (where outcome = 'success')::integer as successful_generations,
         count(*) filter (where outcome = 'failure')::integer as failed_requests
  from events e cross join bounds b where event = 'schedule_generate' and e.created_at >= b.start_at and e.created_at < b.end_at
  group by date
), daily_registrations as (
  select (a.created_at at time zone 'Asia/Shanghai')::date as date, count(*)::integer as registered_users
  from user_accounts a cross join bounds b where a.created_at >= b.start_at and a.created_at < b.end_at group by date
), days as (
  select day::date as date, coalesce(a.successful_users, 0) as successful_users,
         coalesce(r.registered_users, 0) as registered_users, coalesce(a.successful_generations, 0) as successful_generations,
         coalesce(a.failed_requests, 0) as failed_requests
  from bounds b cross join lateral generate_series(b.from_day::timestamp, b.to_day::timestamp, interval '1 day') day
  left join daily_activity a on a.date = day::date left join daily_registrations r on r.date = day::date
), failures as (
  select reason_code, count(*)::integer as count from events, bounds b
  where event = 'schedule_generate' and outcome = 'failure' and created_at >= b.start_at and created_at < b.end_at
  group by reason_code order by count desc, reason_code limit 5
), skland as (
  select count(*) filter (where outcome = 'success')::integer as successful,
         count(*) filter (where outcome = 'failure')::integer as failed
  from events, bounds b where event = 'skland_import' and created_at >= b.start_at and created_at < b.end_at
), coverage as (
  select unattributed_successes, unknown_outcomes from activity where name = 'current'
)
select jsonb_build_object(
  'metrics_version', 'business.v1', 'generated_at', b.observed_at, 'timezone', 'Asia/Shanghai',
  'current', (select summary from summaries where name = 'current'),
  'previous', (select summary from summaries where name = 'previous'),
  'days', (select jsonb_agg(to_jsonb(days) order by date) from days),
  'failure_reasons', coalesce((select jsonb_agg(to_jsonb(failures) order by count desc, reason_code) from failures), '[]'::jsonb),
  'skland', jsonb_build_object('successful', k.successful, 'failed', k.failed,
    'success_rate', round(100.0 * k.successful / nullif(k.successful + k.failed, 0), 1)),
  'coverage', jsonb_build_object('retained_from', b.retained_from,
    'complete', b.start_at >= b.retained_from and c.unattributed_successes = 0 and c.unknown_outcomes = 0,
    'unattributed_successes', c.unattributed_successes, 'unknown_outcomes', c.unknown_outcomes,
    'maa_tracking_started_at', t.started_at)
) as overview from bounds b cross join skland k cross join coverage c cross join tracking t
`
