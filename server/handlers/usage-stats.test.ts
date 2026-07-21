import { afterEach, describe, expect, it } from 'vitest'
import usageStatsHandler, { getScheduleGenerateDurationStatsByBucket, recordUsageEvent, setUsageEventStoreForTesting } from './usage-stats'
import {
  buildUsageStats,
  type UsageEventRecord,
  type UsageEventStore,
} from '../storage/usage-store'

afterEach(() => {
  setUsageEventStoreForTesting(null)
})

describe('usage stats handler', () => {
  it('upserts queue effects by a deterministic idempotency key', async () => {
    const records = new Map<string, UsageEventRecord>()
    const store: UsageEventStore = {
      set: async (key, record) => {
        records.set(key, record)
      },
      list: async () => [...records.values()],
      getStats: async (dates) => buildUsageStats([...records.values()], dates),
    }
    setUsageEventStoreForTesting(store)

    await recordUsageEvent('schedule_generate', { status: 'success' }, 'optimize-job/job-1/schedule-generate')
    await recordUsageEvent('schedule_generate', { status: 'success' }, 'optimize-job/job-1/schedule-generate')

    expect(records.size).toBe(1)
    expect([...records.values()][0]).toMatchObject({ event: 'schedule_generate', status: 'success' })
  })

  it('records public tool visits for the dashboard aggregates', async () => {
    const records: UsageEventRecord[] = []
    const store: UsageEventStore = {
      set: async (_key, record) => {
        records.push(record)
      },
      list: async () => records,
      getStats: async (dates) => buildUsageStats(records, dates),
    }
    setUsageEventStoreForTesting(store)

    const response = await usageStatsHandler(new Request('http://localhost/api/usage-stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'tool_visit', visitor_id: 'tool-visitor_12345' }),
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(records).toHaveLength(1)

    const [record] = records
    if (!record) throw new Error('Expected tool visit to be stored.')
    expect(record).toMatchObject({
      event: 'tool_visit',
      visitor_id: 'tool-visitor_12345',
      status: 'success',
    })

    const stats = await store.getStats([record.date])
    expect(stats.totals.visits).toBe(1)
    expect(stats.totals.unique_visitors).toBe(1)
    expect(stats.days).toHaveLength(1)
    expect(stats.days[0]).toMatchObject({ visits: 1, unique_visitors: 1 })
  })

  it('uses authoritative CDK redemptions and free preview account additions for dashboard trends', () => {
    const dates = ['2026-03-10', '2026-03-11']
    const legacyEvents: UsageEventRecord[] = [
      {
        id: 'legacy-free-preview-run',
        event: 'free_preview',
        visitor_id: null,
        created_at: '2026-03-10T08:00:00.000Z',
        date: '2026-03-10',
        status: 'success',
      },
      {
        id: 'legacy-cdk-event',
        event: 'cdk_redeem',
        visitor_id: null,
        created_at: '2026-03-10T09:00:00.000Z',
        date: '2026-03-10',
        status: 'success',
      },
    ]

    const stats = buildUsageStats(legacyEvents, dates, [
      { date: '2026-03-10', free_previews: 2, cdk_redeems: 3 },
      { date: '2026-03-11', free_previews: 1, cdk_redeems: 4 },
    ])

    expect(stats.totals).toMatchObject({
      free_previews: 3,
      cdk_redeems: 7,
      account_additions: 10,
    })
    expect(stats.days).toEqual([
      expect.objectContaining({ date: '2026-03-10', free_previews: 2, cdk_redeems: 3, account_additions: 5 }),
      expect.objectContaining({ date: '2026-03-11', free_previews: 1, cdk_redeems: 4, account_additions: 5 }),
    ])
  })

  it('builds latency metrics only from successful compute-attempt durations', () => {
    const date = '2026-03-10'
    const base = { visitor_id: null, created_at: `${date}T08:00:00.000Z`, date, event: 'schedule_generate' as const }
    const stats = buildUsageStats([
      { ...base, id: 'legacy', status: 'success', duration_ms: 1_472_700 },
      { ...base, id: 'fast', status: 'success', duration_ms: 600_000, compute_duration_ms: 2_000 },
      { ...base, id: 'slow', status: 'success', duration_ms: 900_000, compute_duration_ms: 4_000 },
      { ...base, id: 'failed', status: 'failure', duration_ms: 5_000, compute_duration_ms: 5_000 },
    ], [date])

    expect(stats.latency.schedule_generate).toMatchObject({
      average_ms: 3_000,
      p50_ms: 2_000,
      p95_ms: 4_000,
      max_ms: 4_000,
      sample_count: 2,
    })
  })

  it('uses compute-attempt duration for bucketed ETA history', async () => {
    const records: UsageEventRecord[] = [{
      id: 'job-1',
      event: 'schedule_generate',
      visitor_id: null,
      created_at: '2026-03-10T08:00:00.000Z',
      date: '2026-03-10',
      status: 'success',
      duration_ms: 600_000,
      compute_duration_ms: 3_000,
      estimate_bucket: 'maa_plain',
    }]
    setUsageEventStoreForTesting({
      set: async () => undefined,
      list: async () => records,
      getStats: async (dates) => buildUsageStats(records, dates),
    })

    await expect(getScheduleGenerateDurationStatsByBucket(
      'maa_plain',
      '2026-03-10T00:00:00.000Z',
      '2026-03-11T00:00:00.000Z',
    )).resolves.toEqual({ p95_ms: 3_000, sample_count: 1 })
  })
})
