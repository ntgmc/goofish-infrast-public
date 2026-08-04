import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  transactionQuery: vi.fn(),
  withTransaction: vi.fn(),
  insertWebsiteNotificationEventsInTransaction: vi.fn(),
}))

vi.mock('./postgres', () => ({ query: mocks.query, withTransaction: mocks.withTransaction }))
vi.mock('./website-notification-event-store', () => ({
  insertWebsiteNotificationEventsInTransaction: mocks.insertWebsiteNotificationEventsInTransaction,
}))

import { AnnouncementConflictError, createPostgresAnnouncementStore } from './announcement-store'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.withTransaction.mockImplementation(async (work: (client: { query: typeof mocks.transactionQuery }) => Promise<unknown>) => (
    work({ query: mocks.transactionQuery })
  ))
})

describe('announcement store', () => {
  it('returns the persisted document revision', async () => {
    mocks.query.mockResolvedValue({ rows: [{ data_json: { announcements: [] }, revision: 4 }] })
    await expect(createPostgresAnnouncementStore().get()).resolves.toEqual({
      data: { announcements: [] },
      revision: 4,
    })
  })

  it('conditionally saves and cleans deleted reads in the same transaction', async () => {
    mocks.transactionQuery
      .mockResolvedValueOnce({ rows: [{ revision: 5 }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 2 })

    await expect(createPostgresAnnouncementStore().set({ announcements: [] }, 4, ['retained-1']))
      .resolves.toBe(5)
    expect(mocks.transactionQuery.mock.calls[0]?.[0]).toContain('where key = $1 and revision = $3')
    expect(mocks.transactionQuery.mock.calls[1]).toEqual([
      'delete from user_announcement_reads where not (announcement_id = any($1::text[]))',
      [['retained-1']],
    ])
  })

  it('persists publication events before completing the announcement transaction', async () => {
    mocks.transactionQuery
      .mockResolvedValueOnce({ rows: [{ revision: 1 }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
    const event = {
      id: 'announcement:new',
      type: 'announcement.published' as const,
      title: '新公告',
      summary: '摘要',
      url: 'https://example.test/#announcement-new',
      published_at: '2026-08-04T08:00:00.000Z',
      version: null,
    }

    await createPostgresAnnouncementStore().set({ announcements: [] }, 0, [], [event])

    expect(mocks.insertWebsiteNotificationEventsInTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ query: mocks.transactionQuery }),
      [event],
    )
  })

  it('rejects a stale revision without deleting read rows', async () => {
    mocks.transactionQuery.mockResolvedValueOnce({ rows: [] })
    await expect(createPostgresAnnouncementStore().set({ announcements: [] }, 2, ['removed-1']))
      .rejects.toBeInstanceOf(AnnouncementConflictError)
    expect(mocks.transactionQuery).toHaveBeenCalledOnce()
  })
})
