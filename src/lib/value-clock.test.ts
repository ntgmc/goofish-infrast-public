import { expect, it } from 'vitest'
import { createGainClockPreview, createValueClockPreview } from './value-clock-preview'
import { gainClockSnapshotSchema, projectValueClock, valueClockSnapshotSchema, zeroValueClockVector, type ValueClockSnapshot } from './value-clock'

const snapshot: ValueClockSnapshot = {
  schema_version: 1, view: 'production', series_id: 'production-v1', metric_version: 'production-sanity-v1', revision: 1,
  server_now: '2026-11-22T00:00:00Z', as_of: '2026-11-22T00:00:00Z', valid_until: '2026-11-22T00:02:00Z',
  day_started_at: '2026-11-21T16:00:00Z', day_ends_at: '2026-11-22T16:00:00Z', tracking_started_at: '2026-11-22T00:00:00Z',
  totals: zeroValueClockVector(), today_totals: zeroValueClockVector(), rates_per_second: { ...zeroValueClockVector(), sanity: .01, lmd_net: -1 }, active_accounts: 1, status: 'ready',
}
it('integrates only valid elapsed time and preserves signed values', () => {
  expect(projectValueClock(snapshot, 100_000).totals?.sanity).toBe(1)
  expect(projectValueClock(snapshot, 500_000).totals?.sanity).toBe(1.2)
  expect(projectValueClock(snapshot, 500_000).today?.lmd_net).toBe(-120)
  expect(projectValueClock(snapshot, -10_000).totals?.sanity).toBe(0)
  expect(projectValueClock({ ...snapshot, status: 'rebuilding' }, 100_000).totals?.sanity).toBe(0)
})
it('keeps the large local preview continuous when its snapshot refreshes', () => {
  const now = Date.parse('2026-11-22T00:00:00Z')
  const initial = createValueClockPreview(0, now)
  const refreshed = createValueClockPreview(60_000, now + 60_000)
  expect(valueClockSnapshotSchema.safeParse(initial).success).toBe(true)
  expect(initial.active_accounts).toBe(905)
  expect(initial.totals?.sanity).toBe(28_825_564.5)
  expect(refreshed.totals?.sanity).toBeCloseTo(28_825_770.9)
  expect(refreshed.totals).toEqual(projectValueClock(initial, 60_000).totals)
  expect(refreshed.today_totals).toEqual(projectValueClock(initial, 60_000).today)
})

it('rejects incomplete or overlong ready snapshots at the request boundary', () => {
  expect(valueClockSnapshotSchema.safeParse(snapshot).success).toBe(true)
  expect(valueClockSnapshotSchema.safeParse({ ...snapshot, totals: null }).success).toBe(false)
  expect(valueClockSnapshotSchema.safeParse({ ...snapshot, valid_until: '2026-11-22T00:03:00Z' }).success).toBe(false)
  expect(valueClockSnapshotSchema.safeParse({ ...snapshot, totals: { ...snapshot.totals, sanity: Infinity } }).success).toBe(false)
})

it('keeps negative and zero gains as data while missing evidence remains unknown', () => {
  const gain = createGainClockPreview(0)
  expect(gainClockSnapshotSchema.safeParse(gain).success).toBe(true)
  const negative = { ...gain, totals: { ...gain.totals!, sanity: -12 }, rates_per_second: { ...gain.rates_per_second!, sanity: -1 } }
  expect(gainClockSnapshotSchema.safeParse(negative).success).toBe(true)
  expect(projectValueClock(negative, 1000).totals?.sanity).toBe(-13)
  expect(gainClockSnapshotSchema.safeParse({ ...gain, totals: zeroValueClockVector() }).success).toBe(true)
  const unknown = { ...gain, status: 'empty', active_accounts: 0, totals: null, today_totals: null, rates_per_second: null,
    comparison: { ...gain.comparison, has_recorded_comparison: false, active_comparable_accounts: 0 } }
  expect(gainClockSnapshotSchema.safeParse(unknown).success).toBe(true)
  expect(gainClockSnapshotSchema.safeParse({ ...unknown, today_totals: zeroValueClockVector() }).success).toBe(false)
  expect(gainClockSnapshotSchema.safeParse({ ...gain, active_accounts: 0 }).success).toBe(false)
})
