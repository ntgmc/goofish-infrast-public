// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Announcement } from '../../../lib/types'
import {
  announcementDraftStorageKey,
  announcementSnapshotsEqual,
  buildAnnouncementRevision,
  clearAnnouncementDraft,
  readAnnouncementDraft,
  writeAnnouncementDraft,
  type AnnouncementSnapshot,
} from './announcement-draft'

const banner = announcement('banner', 'banner', '2026-07-24T10:00:00.000Z')
const first = announcement('first', 'popup', '2026-07-24T11:00:00.000Z')
const second = announcement('second', 'popup', '2026-07-24T12:00:00.000Z')
const snapshot: AnnouncementSnapshot = { banner, announcements: [first, second] }

describe('announcement draft storage', () => {
  beforeEach(() => window.localStorage.clear())

  it('isolates versioned drafts by administrator and preserves popup order', () => {
    const savedAt = '2026-07-24T13:00:00.000Z'
    const baseRevision = buildAnnouncementRevision(banner, [first, second])

    expect(writeAnnouncementDraft('admin one', baseRevision, snapshot, window.localStorage, savedAt)).toEqual({
      savedAt,
      error: null,
    })
    expect(announcementDraftStorageKey('admin one')).toBe('goofish:admin-announcement-draft:v1:admin%20one')
    expect(readAnnouncementDraft('another-admin', window.localStorage).draft).toBeNull()
    expect(readAnnouncementDraft('admin one', window.localStorage).draft).toEqual({
      version: 1,
      owner: 'admin one',
      saved_at: savedAt,
      base_revision: baseRevision,
      banner,
      announcements: [first, second],
    })
  })

  it.each([
    '{broken',
    JSON.stringify({ version: 2, owner: 'admin' }),
    JSON.stringify({ version: 1, owner: 'other', saved_at: '2026-07-24T13:00:00.000Z', base_revision: '', banner, announcements: [] }),
    JSON.stringify({ version: 1, owner: 'admin', saved_at: 'invalid', base_revision: '', banner, announcements: [] }),
    JSON.stringify({ version: 1, owner: 'admin', saved_at: '2026-07-24T13:00:00.000Z', base_revision: '', banner: first, announcements: [] }),
  ])('rejects and removes an invalid stored draft', (raw) => {
    const key = announcementDraftStorageKey('admin')
    window.localStorage.setItem(key, raw)

    expect(readAnnouncementDraft('admin', window.localStorage)).toEqual({ draft: null, error: null })
    expect(window.localStorage.getItem(key)).toBeNull()
  })

  it('detects content, deletion, and order changes independently from the base revision', () => {
    expect(announcementSnapshotsEqual(snapshot, { ...snapshot })).toBe(true)
    expect(announcementSnapshotsEqual(snapshot, {
      banner: { ...banner, body: 'changed' },
      announcements: [first, second],
    })).toBe(false)
    expect(announcementSnapshotsEqual(snapshot, { banner, announcements: [first] })).toBe(false)
    expect(buildAnnouncementRevision(banner, [first, second])).not.toBe(buildAnnouncementRevision(banner, [second, first]))
    expect(buildAnnouncementRevision(null, [first])).not.toBe(buildAnnouncementRevision(banner, [first]))
  })

  it('reports storage write and removal failures without throwing', () => {
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => { throw new DOMException('quota') }),
      removeItem: vi.fn(() => { throw new DOMException('denied') }),
    }

    expect(writeAnnouncementDraft('admin', 'revision', snapshot, storage).error).toContain('保存失败')
    expect(clearAnnouncementDraft('admin', storage)).toContain('清除')
  })

  it('reports storage read failures without throwing', () => {
    const storage = {
      getItem: vi.fn(() => { throw new DOMException('denied') }),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    }

    expect(readAnnouncementDraft('admin', storage)).toEqual({
      draft: null,
      error: '读取本机公告草稿失败。',
    })
  })
})

function announcement(id: string, kind: Announcement['kind'], updatedAt: string): Announcement {
  return {
    id,
    kind,
    active: true,
    title: `${id} title`,
    body: `${id} body`,
    created_at: updatedAt,
    updated_at: updatedAt,
  }
}
