import { beforeEach, describe, expect, it, vi } from 'vitest'

const queryMock = vi.hoisted(() => vi.fn())
vi.mock('./postgres', () => ({ query: queryMock }))

import {
  buildUsageStats,
  createPostgresUsageEventStore,
  getAnnouncementEventCounts,
  type UsageEventRecord,
} from './usage-store'

beforeEach(() => vi.clearAllMocks())

describe('announcement usage aggregation', () => {
  it('aggregates only requested announcement versions in SQL', async () => {
    queryMock.mockResolvedValue({
      rows: [{ announcement_id: 'popup-1', impressions: 5, visitor_reads: 3 }],
    })
    const announcements = [{ id: 'popup-1', updated_at: '2026-07-31T01:00:00.000Z' }]

    await expect(getAnnouncementEventCounts(announcements)).resolves.toEqual({
      'popup-1': { impressions: 5, visitor_reads: 3 },
    })
    expect(queryMock.mock.calls[0]?.[0]).toContain('count(distinct events.visitor_id)')
    expect(queryMock.mock.calls[0]?.[0]).toContain("active.announcement_version = events.record_json->>'announcement_version'")
    expect(queryMock.mock.calls[0]?.[1]).toEqual([['popup-1'], ['2026-07-31T01:00:00.000Z']])
  })
})

describe('usage statistics data quality and resource bounds', () => {
  it('keeps unknown historical status separate from success and exposes metric metadata', () => {
    const date = '2026-08-03'
    const base = {
      visitor_id: 'visitor-1',
      created_at: `${date}T00:00:00.000Z`,
      date,
    }
    const stats = buildUsageStats([
      { ...base, id: 'unknown', event: 'schedule_generate' },
      { ...base, id: 'success', event: 'schedule_generate', status: 'success' },
      { ...base, id: 'failure', event: 'schedule_generate', status: 'failure', reason_code: 'optimizer_runtime_error' },
    ], [date])

    expect(stats.metrics_version).toMatch(/^2026-08-03\./)
    expect(stats.source).toBe('raw_events_and_authoritative_account_additions')
    expect(stats.completeness).toMatchObject({
      complete: false,
      unknown_status_events: 1,
      retention_days: 180,
      raw_events_truncated: false,
      raw_event_limit: 100_000,
    })
    expect(stats.totals.schedule_generates).toBe(1)
    expect(stats.totals.schedule_failures).toBe(1)
    expect(stats.funnel.every((step) => step.conversion_rate === 0 && step.dropoff === 0)).toBe(true)
  })

  it('caps raw event aggregation and marks the response incomplete instead of reading without bounds', async () => {
    const record: UsageEventRecord = {
      id: 'visit',
      event: 'tool_visit',
      visitor_id: 'visitor-1',
      created_at: '2026-08-03T00:00:00.000Z',
      date: '2026-08-03',
      status: 'success',
    }
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('from usage_events')) {
        return { rows: Array.from({ length: 100_001 }, () => ({ record_json: record })) }
      }
      return { rows: [] }
    })

    const stats = await createPostgresUsageEventStore().getStats(['2026-08-03'])

    expect(stats.totals.visits).toBe(100_000)
    expect(stats.completeness).toMatchObject({
      complete: false,
      raw_events_truncated: true,
      raw_event_limit: 100_000,
    })
    const usageQuery = queryMock.mock.calls.find(([sql]) => String(sql).includes('from usage_events'))
    expect(usageQuery?.[0]).toContain('limit $4')
    expect(usageQuery?.[1]).toEqual(['events/%', '2026-08-03', '2026-08-03', 100_001])
  })

  it('persists an immutable first event with a 180-day expiry', async () => {
    queryMock.mockResolvedValue({ rows: [], rowCount: 1 })
    const record: UsageEventRecord = {
      id: 'visit-1',
      event: 'tool_visit',
      visitor_id: 'visitor-1',
      created_at: '2026-08-03T00:00:00.000Z',
      date: '2026-08-03',
      status: 'success',
    }

    await createPostgresUsageEventStore().set('events/visit-1.json', record)

    const insert = queryMock.mock.calls.find(([sql]) => String(sql).includes('insert into usage_events'))
    expect(insert?.[0]).toContain('on conflict (key) do nothing')
    expect(insert?.[1]?.[5]).toBe('2027-01-30T00:00:00.000Z')
  })
})
