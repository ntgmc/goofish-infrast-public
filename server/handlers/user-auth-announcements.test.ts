import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
}))

vi.mock('../storage/announcement-store', () => ({
  createPostgresAnnouncementStore: () => ({ get: mocks.get }),
}))

import { getActiveAnnouncements } from './user-auth'

const activePopup = {
  id: 'active-popup',
  kind: 'popup' as const,
  active: true,
  title: '新公告',
  body: '公告正文',
  created_at: '2026-08-03T01:00:00.000Z',
  updated_at: '2026-08-03T02:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('active user announcements', () => {
  it('reads active popup announcements from the stored document data', async () => {
    mocks.get.mockResolvedValue({
      data: {
        banner: { ...activePopup, id: 'banner', kind: 'banner' },
        announcements: [
          activePopup,
          { ...activePopup, id: 'inactive-popup', active: false },
        ],
      },
      revision: 3,
    })

    await expect(getActiveAnnouncements()).resolves.toEqual([activePopup])
  })
})
