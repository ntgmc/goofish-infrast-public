import { describe, expect, it } from 'vitest'
import {
  MAX_BODY_LENGTH,
  normalizeAnnouncementData,
  validateAnnouncementBanner,
  validateAnnouncementList,
} from './announcement'

describe('announcement validation', () => {
  it('accepts a 5,000-character Markdown body without changing it', () => {
    const prefix = '# 更新\n\n'
    const body = `${prefix}${'a'.repeat(MAX_BODY_LENGTH - prefix.length)}`

    const result = validateAnnouncementBanner({
      id: 'announcement-banner',
      kind: 'banner',
      active: true,
      title: '更新公告',
      body,
      created_at: '2026-07-14T00:00:00.000Z',
      updated_at: '2026-07-14T00:00:00.000Z',
    }, null)

    expect(result).toEqual(expect.objectContaining({ ok: true }))
    if (!result.ok) throw new Error(result.message)
    expect(result.banner?.body).toBe(body)
    expect(result.banner?.body).toHaveLength(MAX_BODY_LENGTH)
  })

  it('rejects a body that exceeds 5,000 characters', () => {
    const result = validateAnnouncementList([{
      kind: 'popup',
      active: false,
      title: '超长公告',
      body: 'a'.repeat(MAX_BODY_LENGTH + 1),
    }], [])

    expect(result).toEqual({ ok: false, message: '第 1 条公告正文不能超过 5000 字。' })
  })

  it('preserves Markdown whitespace needed by code blocks', () => {
    const body = '\n```text\n  保留缩进\n```\n'
    const result = validateAnnouncementList([{
      kind: 'popup',
      active: true,
      title: '代码公告',
      body,
    }], [])

    expect(result).toEqual(expect.objectContaining({ ok: true }))
    if (!result.ok) throw new Error(result.message)
    expect(result.announcements[0].body).toBe(body)
  })

  it('rejects a banner inside the ordinary announcement list', () => {
    const result = validateAnnouncementList([{
      kind: 'banner',
      active: false,
      title: '',
      body: '',
    }], [])

    expect(result).toEqual({ ok: false, message: '第 1 条公告类型不正确。' })
  })

  it('migrates the newest legacy banner into the singleton field', () => {
    const data = normalizeAnnouncementData({
      announcements: [
        createAnnouncement('old-banner', 'banner', '2026-07-13T00:00:00.000Z'),
        createAnnouncement('popup-one', 'popup', '2026-07-15T00:00:00.000Z'),
        createAnnouncement('new-banner', 'banner', '2026-07-14T00:00:00.000Z'),
      ],
    })

    expect(data.banner?.id).toBe('new-banner')
    expect(data.announcements.map((item) => item.id)).toEqual(['popup-one'])
  })

  it('preserves the manually configured popup order regardless of update time', () => {
    const data = normalizeAnnouncementData({
      banner: null,
      announcements: [
        createAnnouncement('manual-first', 'popup', '2026-01-01T00:00:00.000Z'),
        createAnnouncement('newer-second', 'popup', '2026-07-01T00:00:00.000Z'),
      ],
    })

    expect(data.announcements.map((item) => item.id)).toEqual(['manual-first', 'newer-second'])
  })

  it('preserves popup order while validating the complete save payload', () => {
    const input = [
      createAnnouncement('manual-first', 'popup', '2026-01-01T00:00:00.000Z'),
      createAnnouncement('newer-second', 'popup', '2026-07-01T00:00:00.000Z'),
    ]
    const result = validateAnnouncementList(input, input)

    expect(result).toEqual(expect.objectContaining({ ok: true }))
    if (!result.ok) throw new Error(result.message)
    expect(result.announcements.map((item) => item.id)).toEqual(['manual-first', 'newer-second'])
  })
})

function createAnnouncement(id: string, kind: 'banner' | 'popup', updatedAt: string) {
  return {
    id,
    kind,
    active: true,
    title: id,
    body: `${id} body`,
    created_at: updatedAt,
    updated_at: updatedAt,
  }
}
