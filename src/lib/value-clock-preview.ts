import { VALUE_CLOCK_METRICS, zeroValueClockVector, type GainClockSnapshot, type ValueClockSnapshot, type ValueClockVector } from './value-clock'

const totals = { ...zeroValueClockVector(), sanity: 28_825_564.50, lmd_received: 3_860_948_640, lmd_net: 3_860_948_640, experience_points: 1_720_085_846, orundum: 10_535_076 }
const today = { ...zeroValueClockVector(), sanity: 217_300 }
const rates = { ...zeroValueClockVector(), sanity: 206.4 / 60, lmd_received: 460.8, lmd_net: 460.8, experience_points: 205.3, orundum: 1.26 }

export function createValueClockPreview(elapsedMs: number, now = Date.now()): ValueClockSnapshot {
  const dayStart = Math.floor((now + 28_800_000) / 86_400_000) * 86_400_000 - 28_800_000
  const advance = (base: ValueClockVector) => Object.fromEntries(VALUE_CLOCK_METRICS.map((key) => [key, base[key] + rates[key] * elapsedMs / 1000])) as ValueClockVector
  return {
    schema_version: 1, view: 'production', series_id: 'local-preview', metric_version: 'production-sanity-v1', revision: 0,
    server_now: new Date(now).toISOString(), as_of: new Date(now).toISOString(), valid_until: new Date(Math.min(now + 120_000, dayStart + 86_400_000)).toISOString(),
    day_started_at: new Date(dayStart).toISOString(), day_ends_at: new Date(dayStart + 86_400_000).toISOString(), tracking_started_at: new Date(now - 7 * 86_400_000).toISOString(),
    totals: advance(totals), today_totals: advance(today), rates_per_second: rates, active_accounts: 905, status: 'ready',
  }
}

export function createGainClockPreview(elapsedMs: number, now = Date.now()): GainClockSnapshot {
  const base = createValueClockPreview(elapsedMs, now)
  return { ...base, view: 'gain', series_id: 'local-gain-preview',
    totals: { ...zeroValueClockVector(), sanity: 123_456.78 + elapsedMs / 10_000 },
    today_totals: { ...zeroValueClockVector(), sanity: 120.5 + elapsedMs / 10_000 },
    rates_per_second: { ...zeroValueClockVector(), sanity: .1 }, active_accounts: 714,
    comparison: { baseline_kind: 'previous_plan', has_recorded_comparison: true, active_comparable_accounts: 714,
      active_production_accounts: 905, current_daily_sanity: 162_912, baseline_daily_sanity: 154_272,
      daily_gain_sanity: 8640, gain_ratio: 8640 / 154_272 },
  }
}
