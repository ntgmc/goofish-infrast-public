import { z } from 'zod'

export const VALUE_CLOCK_METRICS = ['sanity', 'lmd_received', 'lmd_spent', 'lmd_net', 'experience_points', 'orundum', 'gold_produced', 'gold_consumed', 'shards_produced', 'shards_consumed'] as const
export type ValueClockMetric = typeof VALUE_CLOCK_METRICS[number]
const finite = z.number().finite()
export const valueClockVectorSchema = z.object({
  sanity: finite, lmd_received: finite, lmd_spent: finite, lmd_net: finite,
  experience_points: finite, orundum: finite, gold_produced: finite, gold_consumed: finite,
  shards_produced: finite, shards_consumed: finite,
})
export type ValueClockVector = z.infer<typeof valueClockVectorSchema>
const date = z.iso.datetime({ offset: true })
export const valueClockSnapshotSchema = z.object({
  schema_version: z.literal(1), view: z.literal('production'), series_id: z.string(), metric_version: z.string(),
  revision: z.number().int().nonnegative(), tracking_started_at: date.nullable(), server_now: date, as_of: date,
  valid_until: date.nullable(), day_started_at: date, day_ends_at: date,
  totals: valueClockVectorSchema.nullable(), today_totals: valueClockVectorSchema.nullable(), rates_per_second: valueClockVectorSchema.nullable(),
  active_accounts: z.number().int().nonnegative(), status: z.enum(['not_started', 'ready', 'empty', 'paused', 'rebuilding']),
}).superRefine((value, ctx) => {
  const asOf = Date.parse(value.as_of), until = value.valid_until && Date.parse(value.valid_until)
  if ((value.status === 'ready' || value.status === 'empty') && (!value.totals || !value.today_totals || !value.rates_per_second || !until)) ctx.addIssue({ code: 'custom', message: 'Incomplete clock snapshot' })
  if (until && (until < asOf || until > asOf + 120_000 || until > Date.parse(value.day_ends_at))) ctx.addIssue({ code: 'custom', message: 'Invalid clock validity' })
})
export type ValueClockSnapshot = z.infer<typeof valueClockSnapshotSchema>
export function zeroValueClockVector(): ValueClockVector {
  return Object.fromEntries(VALUE_CLOCK_METRICS.map((key) => [key, 0])) as ValueClockVector
}

// Elapsed time comes from performance.now(); wall-clock changes cannot advance the counter.
export function projectValueClock(snapshot: ValueClockSnapshot, elapsedMs: number) {
  const seconds = snapshot.status === 'ready' || snapshot.status === 'empty'
    ? Math.max(0, Math.min(elapsedMs, Date.parse(snapshot.valid_until ?? snapshot.as_of) - Date.parse(snapshot.as_of))) / 1000 : 0
  const project = (base: ValueClockVector | null) => base && Object.fromEntries(VALUE_CLOCK_METRICS.map((key) => [key, base[key] + (snapshot.rates_per_second?.[key] ?? 0) * seconds])) as ValueClockVector | null
  return { totals: project(snapshot.totals), today: project(snapshot.today_totals) }
}
