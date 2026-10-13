import { describe, expect, it } from 'vitest'
import {
  MAX_BODY_LENGTH,
  normalizeAnnouncementSummary,
  normalizeAnnouncementData,
  validateAnnouncementBanner,
  validateAnnouncementList,
} from './announcement'

describe('announcement validation', () => {
  it('bounds Unicode summaries to 500 UTF-16 units without splitting a character', () => {
    expect(normalizeAnnouncementSummary('😀'.repeat(250))).toBe('😀'.repeat(250))
    expect(normalizeAnnouncementSummary('😀'.repeat(251))).toBe('😀'.repeat(250))
    expect(normalizeAnnouncementSummary('a' + '😀'.repeat(250))).toBe('a' + '😀'.repeat(249))
  })

  it('normalizes Markdown into a bounded plain-text notification summary', () => {
    const summary = normalizeAnnouncementSummary(`# 标题\n\n[详情](https://example.test) **加粗**\n${'文'.repeat(600)}`)

    expect(summary).toMatch(/^标题 详情 加粗/)
    expect(Array.from(summary ?? '')).toHaveLength(500)
  })

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

  it('preserves reminder deadlines and versions enabling, extending and clearing a reminder', () => {
    const current = createAnnouncement('reminder', 'popup', '2026-07-01T00:00:00.000Z')
    const deadline = '2026-10-20T18:00:00.000Z'
    const enabled = validateAnnouncementList([{ ...current, popup_until: deadline }], [current])
    expect(enabled.ok).toBe(true)
    if (!enabled.ok) throw new Error(enabled.message)
    const saved = enabled.announcements[0]
    expect(saved.popup_until).toBe(deadline)
    expect(saved.updated_at).not.toBe(current.updated_at)
    expect(normalizeAnnouncementData({ announcements: [saved] }).announcements[0]).toEqual(saved)
    const unchanged = validateAnnouncementList([saved], [saved])
    expect(unchanged.ok && unchanged.announcements[0].updated_at).toBe(saved.updated_at)
    for (const popup_until of ['2026-10-21T18:00:00.000Z', null]) {
      const changed = validateAnnouncementList([{ ...saved, popup_until }], [saved])
      expect(changed.ok).toBe(true)
      if (!changed.ok) throw new Error(changed.message)
      expect(changed.announcements[0].updated_at).not.toBe(saved.updated_at)
      expect(changed.announcements[0].popup_until ?? null).toBe(popup_until)
    }
  })

  it.each(['', 'not-a-date', 42, true, {}])('rejects an invalid reminder deadline %s', (popup_until) => {
    const result = validateAnnouncementList([{ ...createAnnouncement('invalid-reminder', 'popup', '2026-07-01T00:00:00.000Z'), popup_until }], [])
    expect(result).toEqual({ ok: false, message: '第 1 条公告提醒截止时间不正确。' })
  })

  it('keeps legacy announcements published without implicitly enabling visit reminders', () => {
    const input = createAnnouncement('legacy', 'popup', '2026-07-01T00:00:00.000Z')
    expect(normalizeAnnouncementData({ announcements: [input] }).announcements).toEqual([input])
    const result = validateAnnouncementList([input], [input])
    expect(result.ok && result.announcements).toEqual([input])
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
