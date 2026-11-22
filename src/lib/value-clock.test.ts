import { expect, it } from 'vitest'
import { projectValueClock, valueClockSnapshotSchema, zeroValueClockVector, type ValueClockSnapshot } from './value-clock'

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
it('rejects incomplete or overlong ready snapshots at the request boundary', () => {
  expect(valueClockSnapshotSchema.safeParse(snapshot).success).toBe(true)
  expect(valueClockSnapshotSchema.safeParse({ ...snapshot, totals: null }).success).toBe(false)
  expect(valueClockSnapshotSchema.safeParse({ ...snapshot, valid_until: '2026-11-22T00:03:00Z' }).success).toBe(false)
  expect(valueClockSnapshotSchema.safeParse({ ...snapshot, totals: { ...snapshot.totals, sanity: Infinity } }).success).toBe(false)
})
