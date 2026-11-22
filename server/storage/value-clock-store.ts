import { VALUE_CLOCK_METRICS as metrics, type ValueClockSnapshot, type ValueClockVector } from '../../src/lib/value-clock'
import { query, withTransaction } from './postgres'
import { ensureDatabaseSchema } from './schema'
import { syncValueClockHistory } from './value-clock-sync'

let publicRead: Promise<ValueClockSnapshot> | null = null
export function getPublicValueClock(): Promise<ValueClockSnapshot> {
  publicRead ??= readSnapshot().finally(() => { publicRead = null })
  return publicRead
}

async function readSnapshot(): Promise<ValueClockSnapshot> {
  await ensureDatabaseSchema()
  if ((await query('select 1 from value_clock_pending limit 1')).rowCount) await withTransaction(syncValueClockHistory)
  const result = await query<{
    started_at: Date | null; revision: string; as_of: Date; day_start: Date; day_end: Date;
    totals: ValueClockVector; today: ValueClockVector; rates: ValueClockVector; accounts: number; next_end: Date | null;
  }>(`with clock as (
      select now() as at, (now() at time zone 'Asia/Shanghai')::date as day,
        (now() at time zone 'Asia/Shanghai')::date::timestamp at time zone 'Asia/Shanghai' as day_start
    ), today as (
      select ${metrics.map((key) => `coalesce(sum(${key} * greatest(0, extract(epoch from (least(d.ends_at, c.at) - d.started_at)))) / 86400, 0)::float8 as ${key}`).join(', ')}
      from value_clock_days d cross join clock c where d.day = c.day
    ), past as (
      select ${metrics.map((key) => `coalesce(sum(${key}), 0)::float8 as ${key}`).join(', ')}
      from value_clock_daily_totals d cross join clock c where d.day < c.day
    ), open_totals as (
      select ${metrics.map((key) => `coalesce(sum(${key} * greatest(0, extract(epoch from (c.at - i.started_at)))) / 86400, 0)::float8 as ${key},
        coalesce(sum(${key} * greatest(0, extract(epoch from (c.at - greatest(i.started_at, c.day_start))))) / 86400, 0)::float8 as today_${key}`).join(', ')}
      from value_clock_intervals i cross join clock c where ends_at is null
    ), current_rates as (
      select ${metrics.map((key) => `coalesce(sum(${key}), 0)::float8 / 86400 as ${key}`).join(', ')},
        count(distinct identity)::integer as accounts, min(ends_at) as next_end
      from value_clock_intervals cross join clock c where started_at <= c.at and (ends_at is null or ends_at > c.at)
    ) select s.started_at, s.revision, c.at as as_of,
      c.day_start, (c.day + 1)::timestamp at time zone 'Asia/Shanghai' as day_end,
      jsonb_build_object(${metrics.map((key) => `'${key}', p.${key} + t.${key} + o.${key}`).join(', ')}) as totals,
      jsonb_build_object(${metrics.map((key) => `'${key}', t.${key} + o.today_${key}`).join(', ')}) as today,
      to_jsonb(r) - 'accounts' - 'next_end' as rates, r.accounts, r.next_end
      from value_clock_series s cross join clock c cross join today t cross join past p cross join open_totals o cross join current_rates r where s.id = 'production-v1'`)
  const row = result.rows[0], asOf = row.as_of.getTime()
  const started = row.started_at !== null
  return {
    schema_version: 1, view: 'production', series_id: 'production-v1', metric_version: 'production-sanity-v1', revision: Number(row.revision),
    tracking_started_at: row.started_at?.toISOString() ?? null, server_now: row.as_of.toISOString(), as_of: row.as_of.toISOString(),
    valid_until: started ? new Date(Math.min(asOf + 120_000, row.day_end.getTime(), row.next_end?.getTime() ?? Infinity)).toISOString() : null,
    day_started_at: row.day_start.toISOString(), day_ends_at: row.day_end.toISOString(),
    totals: started ? row.totals : null, today_totals: started ? row.today : null, rates_per_second: started ? row.rates : null,
    active_accounts: row.accounts, status: !started ? 'not_started' : row.accounts ? 'ready' : 'empty',
  }
}
