import { VALUE_CLOCK_METRICS as metrics, type GainClockSnapshot, type ValueClockSnapshot, type ValueClockVector } from '../../src/lib/value-clock'
import { query, withTransaction } from './postgres'
import { ensureDatabaseSchema } from './schema'
import { syncValueClockHistory } from './value-clock-sync'

const publicReads = new Map<string, Promise<ValueClockSnapshot | GainClockSnapshot>>()
export function getPublicValueClock(view?: 'production'): Promise<ValueClockSnapshot>
export function getPublicValueClock(view: 'gain'): Promise<GainClockSnapshot>
export function getPublicValueClock(view: 'production' | 'gain' = 'production'): Promise<ValueClockSnapshot | GainClockSnapshot> {
  let read = publicReads.get(view)
  if (!read) { read = readSnapshot(view).finally(() => { publicReads.delete(view) }); publicReads.set(view, read) }
  return read
}

async function readSnapshot(view: 'production' | 'gain'): Promise<ValueClockSnapshot | GainClockSnapshot> {
  await ensureDatabaseSchema()
  if ((await query('select 1 from value_clock_pending limit 1')).rowCount) await withTransaction(syncValueClockHistory)
  const result = await query<{
    started_at: Date | null; revision: string; as_of: Date; day_start: Date; day_end: Date;
    totals: ValueClockVector; today: ValueClockVector; rates: ValueClockVector; accounts: number; next_end: Date | null;
    production_accounts: number; current_daily: number; baseline_daily: number;
  }>(`with clock as (
      select now() as at, (now() at time zone 'Asia/Shanghai')::date as day,
        (now() at time zone 'Asia/Shanghai')::date::timestamp at time zone 'Asia/Shanghai' as day_start
    ), today as (
      select ${metrics.map((key) => `coalesce(sum(${key} * greatest(0, extract(epoch from (least(d.ends_at, c.at) - d.started_at)))) / 86400, 0)::float8 as ${key}`).join(', ')}
      from value_clock_days d cross join clock c where d.day = c.day and d.view = $1
    ), past as (
      select ${metrics.map((key) => `coalesce(sum(${key}), 0)::float8 as ${key}`).join(', ')}
      from value_clock_daily_totals d cross join clock c where d.day < c.day and d.view = $1
    ), open_totals as (
      select ${metrics.map((key) => `coalesce(sum(${key} * greatest(0, extract(epoch from (c.at - i.started_at)))) / 86400, 0)::float8 as ${key},
        coalesce(sum(${key} * greatest(0, extract(epoch from (c.at - greatest(i.started_at, c.day_start))))) / 86400, 0)::float8 as today_${key}`).join(', ')}
      from value_clock_intervals i cross join clock c where ends_at is null and i.view = $1
    ), current_rates as (
      select ${metrics.map((key) => `coalesce(sum(i.${key}), 0)::float8 / 86400 as ${key}`).join(', ')},
        count(distinct i.identity)::integer as accounts, min(i.ends_at) as next_end,
        coalesce(sum(b.current_daily_sanity), 0)::float8 as current_daily,
        coalesce(sum(b.baseline_daily_sanity), 0)::float8 as baseline_daily
      from value_clock_intervals i cross join clock c left join value_clock_comparisons b on b.id = i.comparison_id
      where i.started_at <= c.at and (i.ends_at is null or i.ends_at > c.at) and i.view = $1
    ) select (select min(started_at) from value_clock_intervals where view = $1) as started_at, s.revision, c.at as as_of,
      c.day_start, (c.day + 1)::timestamp at time zone 'Asia/Shanghai' as day_end,
      jsonb_build_object(${metrics.map((key) => `'${key}', p.${key} + t.${key} + o.${key}`).join(', ')}) as totals,
      jsonb_build_object(${metrics.map((key) => `'${key}', t.${key} + o.today_${key}`).join(', ')}) as today,
      to_jsonb(r) - 'accounts' - 'next_end' - 'current_daily' - 'baseline_daily' as rates, r.accounts, r.next_end, r.current_daily, r.baseline_daily,
      (select count(distinct identity)::integer from value_clock_intervals where view = 'production'
        and started_at <= c.at and (ends_at is null or ends_at > c.at)) as production_accounts
      from value_clock_series s cross join clock c cross join today t cross join past p cross join open_totals o cross join current_rates r where s.id = 'production-v1'`, [view])
  const row = result.rows[0], asOf = row.as_of.getTime()
  const started = row.started_at !== null
  const common = {
    schema_version: 1 as const, metric_version: 'production-sanity-v1', revision: Number(row.revision),
    tracking_started_at: row.started_at?.toISOString() ?? null, server_now: row.as_of.toISOString(), as_of: row.as_of.toISOString(),
    valid_until: new Date(Math.min(asOf + 120_000, row.day_end.getTime(), row.next_end?.getTime() ?? Infinity)).toISOString(),
    day_started_at: row.day_start.toISOString(), day_ends_at: row.day_end.toISOString(),
    totals: started ? row.totals : null, today_totals: started ? row.today : null, rates_per_second: started ? row.rates : null,
    active_accounts: row.accounts,
  }
  if (view === 'gain') return { ...common, view, series_id: 'gain-v1', status: row.accounts ? 'ready' : 'empty',
    comparison: { baseline_kind: 'previous_plan', has_recorded_comparison: started,
      active_comparable_accounts: row.accounts, active_production_accounts: row.production_accounts,
      current_daily_sanity: row.current_daily, baseline_daily_sanity: row.baseline_daily,
      daily_gain_sanity: row.current_daily - row.baseline_daily,
      gain_ratio: row.baseline_daily > 0 ? (row.current_daily - row.baseline_daily) / row.baseline_daily : null },
  }
  return { ...common, view, series_id: 'production-v1', valid_until: started ? common.valid_until : null,
    status: !started ? 'not_started' : row.accounts ? 'ready' : 'empty' }
}
