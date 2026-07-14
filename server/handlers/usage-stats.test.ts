import { afterEach, describe, expect, it } from 'vitest'
import usageStatsHandler, { setUsageEventStoreForTesting } from './usage-stats'
import {
  buildUsageStats,
  type UsageEventRecord,
  type UsageEventStore,
} from '../storage/usage-store'

afterEach(() => {
  setUsageEventStoreForTesting(null)
})

describe('usage stats handler', () => {
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
})
