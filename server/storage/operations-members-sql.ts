// The report and its user list share the same observation windows and event attribution.
export const OPERATIONS_MEMBERS_SQL = `, operations_members as (
  select a.id as user_id,
    jsonb_build_object(
      'stage', case when n.id is null then 'used' when not n.eligible then 'observing'
                    when n.generated then 'activated' when n.with_profile then 'no_generation' else 'no_profile' end,
      'failure_reason', failure.reason_code, 'failure_at', failure.created_at
    ) as progress
  from user_accounts a
  cross join bounds b
  left join new_users n on n.name = 'current' and n.id = a.id
  left join usage_cohort c on c.name = 'current' and c.user_id = a.id
  left join lateral (
    select e.reason_code, e.created_at from events e
    where e.user_id = a.id and e.event = 'schedule_generate' and e.outcome = 'failure'
      and e.created_at >= case when $5::text in ('activation_missing_profile', 'activation_no_generation', 'activated')
                              then a.created_at else b.start_at end
      and e.created_at < case when $5::text in ('activation_missing_profile', 'activation_no_generation', 'activated')
                             then a.created_at + interval '168 hours' else b.end_at end
    order by e.created_at desc, e.id desc limit 1
  ) failure on true
  where case $5::text
    when 'registered' then n.id is not null
    when 'successful' then c.user_id is not null
    when 'activation_missing_profile' then n.eligible and not n.with_profile
    when 'activation_no_generation' then n.eligible and n.with_profile and not n.generated
    when 'activated' then n.eligible and n.generated
    when 'reuse_missing' then c.user_id is not null
      and (c.first_day + 8)::timestamp at time zone 'Asia/Shanghai' <= b.observed_at
      and not exists (select 1 from successes s where s.user_id = a.id
        and s.created_at >= (c.first_day + 1)::timestamp at time zone 'Asia/Shanghai'
        and s.created_at < (c.first_day + 8)::timestamp at time zone 'Asia/Shanghai')
    when 'reused' then c.user_id is not null
      and (c.first_day + 8)::timestamp at time zone 'Asia/Shanghai' <= b.observed_at
      and exists (select 1 from successes s where s.user_id = a.id
        and s.created_at >= (c.first_day + 1)::timestamp at time zone 'Asia/Shanghai'
        and s.created_at < (c.first_day + 8)::timestamp at time zone 'Asia/Shanghai')
    when 'maa_missing' then exists (select 1 from successes s cross join tracking t
      where s.user_id = a.id and s.schedule_mode = 'maa' and t.started_at is not null
        and s.created_at >= greatest(b.start_at, t.started_at) and s.created_at < b.end_at
        and not exists (select 1 from exports e where e.generation_id = s.id and e.exported_at >= s.created_at))
    when 'maa_exported' then exists (select 1 from successes s cross join tracking t
      join exports e on e.generation_id = s.id and e.exported_at >= s.created_at
      where s.user_id = a.id and s.schedule_mode = 'maa' and t.started_at is not null
        and s.created_at >= greatest(b.start_at, t.started_at) and s.created_at < b.end_at)
    when 'failed' then exists (select 1 from events e where e.user_id = a.id
      and e.event = 'schedule_generate' and e.outcome = 'failure'
      and e.created_at >= b.start_at and e.created_at < b.end_at
      and ($6::text is null or e.reason_code = $6))
    else false
  end
)`
