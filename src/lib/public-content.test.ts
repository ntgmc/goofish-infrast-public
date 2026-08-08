import { describe, expect, it } from 'vitest'
import {
  cloneDefaultPublicContentSettings,
  DEFAULT_PUBLIC_CONTENT_DRAFT,
  normalizePublicContentSettings,
  parsePublicContentDraft,
  resolvePublicContentSettings,
} from './public-content'

describe('public content settings', () => {
  it('provides a valid editable default with the CDK purchase link, QQ group, and nineteen FAQ items', () => {
    const parsed = parsePublicContentDraft(DEFAULT_PUBLIC_CONTENT_DRAFT)
    expect(parsed.cdk_purchase.xianyu_url).toMatch(/^https:\/\//)
    expect(parsed.qq_group).toMatchObject({ number: '891655477', join_url: expect.stringMatching(/^https:\/\//) })
    expect(parsed.faq.items).toHaveLength(19)
    expect(parsed.faq.items[parsed.faq.items.length - 1]).toMatchObject({ id: 'qq-group', action: 'qq_group' })
    expect(parsed.thanks.sections.map((section) => section.id)).toEqual(['data-community', 'developers', 'helpers'])
    expect(parsed.thanks.sections[1].entries[0]).toMatchObject({
      id: 'ntgmc',
      name: 'ntgmc',
      url: 'https://github.com/ntgmc',
      avatar_url: '/assets/credits/ntgmc.jpg',
    })
    expect(parsed.thanks.sections[2].entries[0]).toEqual({
      id: 'dake',
      name: 'DaKe.',
      description: '',
      url: '',
      avatar_url: '',
    })
    expect(parsed.pricing.plans).toMatchObject({
      single_account_monthly: { original_price: '15 元 / 31 天', discount_fold: 4, display_price: '6 元 / 31 天' },
      single_account_lifetime: { original_price: '129 元 / 长期', discount_fold: 4, display_price: '51.6 元 / 长期' },
    })
  })

  it('validates discount fields and migrates the old lifetime display price to the default sale price', () => {
    const invalid = structuredClone(DEFAULT_PUBLIC_CONTENT_DRAFT)
    invalid.pricing.plans.single_account_lifetime.original_price = '129'
    expect(() => parsePublicContentDraft(invalid)).toThrow()
    const invalidFold = structuredClone(DEFAULT_PUBLIC_CONTENT_DRAFT)
    invalidFold.pricing.plans.single_account_lifetime.discount_fold = 0
    expect(() => parsePublicContentDraft(invalidFold)).toThrow()

    const legacy = cloneDefaultPublicContentSettings()
    const lifetime = legacy.pricing.plans.single_account_lifetime as unknown as Record<string, unknown>
    delete lifetime.original_price
    delete lifetime.discount_fold
    lifetime.display_price = '129 元 / 长期'
    const migrated = normalizePublicContentSettings(legacy)
    expect(migrated.pricing.plans.single_account_lifetime).toMatchObject({
      original_price: '129 元 / 长期',
      discount_fold: 4,
      display_price: '51.6 元 / 长期',
    })
  })

  it('rejects unsafe links, invalid group numbers, duplicate ids, and unknown fields', () => {
    const unsafePurchase = structuredClone(DEFAULT_PUBLIC_CONTENT_DRAFT)
    unsafePurchase.cdk_purchase.xianyu_url = 'javascript:alert(1)'
    expect(() => parsePublicContentDraft(unsafePurchase)).toThrow()

    const unsafe = structuredClone(DEFAULT_PUBLIC_CONTENT_DRAFT)
    unsafe.qq_group.join_url = 'javascript:alert(1)'
    expect(() => parsePublicContentDraft(unsafe)).toThrow()

    const badNumber = structuredClone(DEFAULT_PUBLIC_CONTENT_DRAFT)
    badNumber.qq_group.number = '1234'
    expect(() => parsePublicContentDraft(badNumber)).toThrow()

    const duplicate = structuredClone(DEFAULT_PUBLIC_CONTENT_DRAFT)
    duplicate.faq.items[1].id = duplicate.faq.items[0].id
    expect(() => parsePublicContentDraft(duplicate)).toThrow()

    const unsafeAvatar = structuredClone(DEFAULT_PUBLIC_CONTENT_DRAFT)
    unsafeAvatar.thanks.sections[1].entries[0].avatar_url = 'data:image/png;base64,unsafe'
    expect(() => parsePublicContentDraft(unsafeAvatar)).toThrow()

    const protocolRelativeAvatar = structuredClone(DEFAULT_PUBLIC_CONTENT_DRAFT)
    protocolRelativeAvatar.thanks.sections[1].entries[0].avatar_url = '//evil.example/avatar.jpg'
    expect(() => parsePublicContentDraft(protocolRelativeAvatar)).toThrow()

    expect(() => parsePublicContentDraft({ ...DEFAULT_PUBLIC_CONTENT_DRAFT, unknown: true })).toThrow()
  })

  it('trims the configured CDK purchase URL, allows an empty value, and enforces the length limit', () => {
    const configured = structuredClone(DEFAULT_PUBLIC_CONTENT_DRAFT)
    configured.cdk_purchase.xianyu_url = '  https://example.com/xianyu-listing  '
    expect(parsePublicContentDraft(configured).cdk_purchase.xianyu_url).toBe('https://example.com/xianyu-listing')

    configured.cdk_purchase.xianyu_url = ''
    expect(parsePublicContentDraft(configured).cdk_purchase.xianyu_url).toBe('')

    configured.cdk_purchase.xianyu_url = `https://example.com/${'a'.repeat(2049)}`
    expect(() => parsePublicContentDraft(configured)).toThrow()
  })

  it('normalizes omitted optional credit links and avatars to empty values', () => {
    const draft = structuredClone(DEFAULT_PUBLIC_CONTENT_DRAFT)
    const entry = draft.thanks.sections[0].entries[0] as { url?: string; avatar_url?: string }
    delete entry.url
    delete entry.avatar_url
    expect(parsePublicContentDraft(draft).thanks.sections[0].entries[0]).toMatchObject({ url: '', avatar_url: '' })
  })

  it('migrates only the untouched legacy default developer credit', () => {
    const legacy = cloneDefaultPublicContentSettings()
    delete (legacy as unknown as { defaults_revision?: number }).defaults_revision
    legacy.thanks.sections[1].entries[0] = {
      id: 'lingyu',
      name: '铃语',
      description: 'MaaTool 开发与维护。',
      url: '',
      avatar_url: '',
    }
    expect(normalizePublicContentSettings(legacy).thanks.sections[1].entries[0]).toMatchObject({
      id: 'ntgmc',
      name: 'ntgmc',
      url: 'https://github.com/ntgmc',
      avatar_url: '/assets/credits/ntgmc.jpg',
    })

    legacy.thanks.sections[1].entries[0].description = '管理员自定义说明'
    expect(normalizePublicContentSettings(legacy).thanks.sections[1].entries[0]).toMatchObject({
      id: 'lingyu',
      name: '铃语',
      description: '管理员自定义说明',
    })
  })

  it('upgrades the intermediate GitHub-hosted default avatar once', () => {
    const intermediate = cloneDefaultPublicContentSettings()
    delete (intermediate as unknown as { defaults_revision?: number }).defaults_revision
    intermediate.thanks.sections[1].entries[0].avatar_url = 'https://avatars.githubusercontent.com/u/74061867?v=4'
    expect(normalizePublicContentSettings(intermediate)).toMatchObject({
      defaults_revision: 6,
      thanks: {
        sections: expect.arrayContaining([
          expect.objectContaining({
            id: 'developers',
            entries: [expect.objectContaining({ avatar_url: '/assets/credits/ntgmc.jpg' })],
          }),
        ]),
      },
    })
  })

  it('migrates untouched pricing copy to the grouped Pricing presentation', () => {
    const legacy = cloneDefaultPublicContentSettings()
    const legacyRecord = legacy as unknown as { defaults_revision: number }
    legacyRecord.defaults_revision = 5
    legacy.pricing.eyebrow = '公开 SKU'
    legacy.pricing.intro = '先了解完整权益与限制，再选择适合自己的版本。现在提供月卡、半年卡、年卡、终身卡，以及个人和商用积分单次排班。'

    expect(normalizePublicContentSettings(legacy)).toMatchObject({
      defaults_revision: 6,
      pricing: {
        eyebrow: 'Pricing',
        intro: '完整高级权益统一为单账号 CDK，月卡、半年卡、年卡和终身卡只在有效期与价格上不同；另有个人和商用积分单次排班。',
      },
    })

    legacy.pricing.eyebrow = '管理员自定义页眉'
    legacy.pricing.intro = '管理员自定义介绍'
    expect(normalizePublicContentSettings(legacy).pricing).toMatchObject({
      eyebrow: '管理员自定义页眉',
      intro: '管理员自定义介绍',
    })
  })

  it('migrates only the untouched generic helper credit to DaKe.', () => {
    const legacy = cloneDefaultPublicContentSettings()
    delete (legacy as unknown as { defaults_revision?: number }).defaults_revision
    legacy.thanks.sections[2].entries[0] = {
      id: 'all-helpers',
      name: '所有参与开发、测试、反馈与验证的协助者',
      description: '每一次复现、建议、测试和反馈都让 MaaTool 更可靠。',
      url: '',
      avatar_url: '',
    }
    expect(normalizePublicContentSettings(legacy).thanks.sections[2].entries[0]).toEqual({
      id: 'dake',
      name: 'DaKe.',
      description: '',
      url: '',
      avatar_url: '',
    })

    legacy.thanks.sections[2].entries[0].description = '管理员自定义说明'
    expect(normalizePublicContentSettings(legacy).thanks.sections[2].entries[0]).toMatchObject({
      id: 'all-helpers',
      name: '所有参与开发、测试、反馈与验证的协助者',
      description: '管理员自定义说明',
    })
  })

  it('adds the current CDK purchase URL to legacy records without overwriting custom content or explicit empty values', () => {
    const legacy = cloneDefaultPublicContentSettings()
    const legacyRecord = legacy as unknown as { defaults_revision: number }
    legacyRecord.defaults_revision = 2
    legacy.qq_group.name = '管理员自定义群名'
    delete (legacy as unknown as { cdk_purchase?: unknown }).cdk_purchase

    const migrated = normalizePublicContentSettings(legacy)
    expect(migrated.defaults_revision).toBe(6)
    expect(migrated.qq_group.name).toBe('管理员自定义群名')
    expect(migrated.cdk_purchase.xianyu_url).toBe(DEFAULT_PUBLIC_CONTENT_DRAFT.cdk_purchase.xianyu_url)

    const disabled = cloneDefaultPublicContentSettings()
    const disabledRecord = disabled as unknown as { defaults_revision: number }
    disabledRecord.defaults_revision = 2
    disabled.cdk_purchase.xianyu_url = ''
    expect(normalizePublicContentSettings(disabled).cdk_purchase.xianyu_url).toBe('')

    expect(resolvePublicContentSettings({ ...legacy, cdk_purchase: null }).isFallback).toBe(true)
  })

  it('falls back to a fresh default for invalid stored records', () => {
    const fallback = normalizePublicContentSettings({ version: 0 })
    fallback.faq.items.splice(0, 1)
    expect(cloneDefaultPublicContentSettings().faq.items).toHaveLength(19)
  })
})
