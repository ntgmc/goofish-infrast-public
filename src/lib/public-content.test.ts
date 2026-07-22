import { describe, expect, it } from 'vitest'
import {
  cloneDefaultPublicContentSettings,
  DEFAULT_PUBLIC_CONTENT_DRAFT,
  normalizePublicContentSettings,
  parsePublicContentDraft,
} from './public-content'

describe('public content settings', () => {
  it('provides a valid editable default with the QQ group and nineteen FAQ items', () => {
    const parsed = parsePublicContentDraft(DEFAULT_PUBLIC_CONTENT_DRAFT)
    expect(parsed.qq_group).toMatchObject({ number: '891655477', join_url: expect.stringMatching(/^https:\/\//) })
    expect(parsed.faq.items).toHaveLength(19)
    expect(parsed.faq.items[parsed.faq.items.length - 1]).toMatchObject({ id: 'qq-group', action: 'qq_group' })
    expect(parsed.thanks.sections.map((section) => section.id)).toEqual(['data-community', 'developers', 'helpers'])
  })

  it('rejects unsafe links, invalid group numbers, duplicate ids, and unknown fields', () => {
    const unsafe = structuredClone(DEFAULT_PUBLIC_CONTENT_DRAFT)
    unsafe.qq_group.join_url = 'javascript:alert(1)'
    expect(() => parsePublicContentDraft(unsafe)).toThrow()

    const badNumber = structuredClone(DEFAULT_PUBLIC_CONTENT_DRAFT)
    badNumber.qq_group.number = '1234'
    expect(() => parsePublicContentDraft(badNumber)).toThrow()

    const duplicate = structuredClone(DEFAULT_PUBLIC_CONTENT_DRAFT)
    duplicate.faq.items[1].id = duplicate.faq.items[0].id
    expect(() => parsePublicContentDraft(duplicate)).toThrow()

    expect(() => parsePublicContentDraft({ ...DEFAULT_PUBLIC_CONTENT_DRAFT, unknown: true })).toThrow()
  })

  it('normalizes an omitted optional credit link to an empty value', () => {
    const draft = structuredClone(DEFAULT_PUBLIC_CONTENT_DRAFT)
    delete (draft.thanks.sections[0].entries[0] as { url?: string }).url
    expect(parsePublicContentDraft(draft).thanks.sections[0].entries[0].url).toBe('')
  })

  it('falls back to a fresh default for invalid stored records', () => {
    const fallback = normalizePublicContentSettings({ version: 0 })
    fallback.faq.items.splice(0, 1)
    expect(cloneDefaultPublicContentSettings().faq.items).toHaveLength(19)
  })
})
