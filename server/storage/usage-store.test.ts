import { beforeEach, describe, expect, it, vi } from 'vitest'

const queryMock = vi.hoisted(() => vi.fn())
vi.mock('./postgres', () => ({ query: queryMock }))

import { getAnnouncementEventCounts } from './usage-store'

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
