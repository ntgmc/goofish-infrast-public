import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  transactionQuery: vi.fn(),
  withTransaction: vi.fn(),
}))

vi.mock('./postgres', () => ({ query: mocks.query, withTransaction: mocks.withTransaction }))

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

  it('rejects a stale revision without deleting read rows', async () => {
    mocks.transactionQuery.mockResolvedValueOnce({ rows: [] })
    await expect(createPostgresAnnouncementStore().set({ announcements: [] }, 2, ['removed-1']))
      .rejects.toBeInstanceOf(AnnouncementConflictError)
    expect(mocks.transactionQuery).toHaveBeenCalledOnce()
  })
})
