import { describe, expect, it } from 'vitest'
import { MAX_BODY_LENGTH, validateAnnouncementList } from './announcement'

describe('announcement validation', () => {
  it('accepts a 5,000-character Markdown body without changing it', () => {
    const prefix = '# 更新\n\n'
    const body = `${prefix}${'a'.repeat(MAX_BODY_LENGTH - prefix.length)}`

    const result = validateAnnouncementList([{
      id: 'announcement-one',
      kind: 'banner',
      active: true,
      title: '更新公告',
      body,
      created_at: '2026-07-14T00:00:00.000Z',
      updated_at: '2026-07-14T00:00:00.000Z',
    }], [])

    expect(result).toEqual(expect.objectContaining({ ok: true }))
    if (!result.ok) throw new Error(result.message)
    expect(result.announcements[0].body).toBe(body)
    expect(result.announcements[0].body).toHaveLength(MAX_BODY_LENGTH)
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
})
