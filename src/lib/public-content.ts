import { z } from 'zod'
import { copy } from '../copy/index'
import { getSku, productPolicies } from './product-catalog'

export const PUBLIC_CONTENT_VERSION = 1 as const
export const PUBLIC_PRICING_PLAN_IDS = ['free_preview', 'single_account_lifetime'] as const

const identifier = z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/)
const text = (max: number) => z.string().trim().min(1).max(max)
const optionalHttpsUrl = z.string().trim().max(2048).refine((value) => value === '' || isHttpsUrl(value), {
  message: copy.publicContent.validation_invalid,
}).optional().default('')
const defaultDeveloper = {
  id: 'ntgmc',
  name: copy.publicContent.thanks_developer_name,
  url: 'https://github.com/ntgmc',
  avatarUrl: 'https://avatars.githubusercontent.com/u/74061867?v=4',
} as const

const faqItemSchema = z.strictObject({
  id: identifier,
  question: text(160),
  answer: text(4000),
  action: z.enum(['none', 'qq_group']),
})

const pricingPlanSchema = z.strictObject({
  label: text(80),
  badge: text(40),
  display_price: text(40),
  summary: text(1000),
  account_scope: text(500),
})

const comparisonRowSchema = z.strictObject({
  id: identifier,
  feature: text(120),
  free_preview: text(1000),
  single_account_lifetime: text(1000),
})

const thanksEntrySchema = z.strictObject({
  id: identifier,
  name: text(120),
  description: z.string().trim().max(1000),
  url: optionalHttpsUrl,
  avatar_url: optionalHttpsUrl,
})

const thanksSectionSchema = z.strictObject({
  id: identifier,
  heading: text(120),
  intro: text(1000),
  entries: z.array(thanksEntrySchema).max(50).superRefine((entries, context) => addDuplicateIdIssues(entries, context)),
})

export const publicContentDraftSchema = z.strictObject({
  qq_group: z.strictObject({
    name: text(80),
    number: z.string().trim().regex(/^[1-9]\d{4,11}$/),
    join_url: z.string().trim().max(2048).refine(isHttpsUrl, { message: copy.publicContent.validation_invalid }),
    link_label: text(80),
  }),
  faq: z.strictObject({
    eyebrow: text(80),
    title: text(80),
    intro: text(1000),
    cta_heading: text(120),
    cta_body: text(1000),
    items: z.array(faqItemSchema).max(50).superRefine((items, context) => addDuplicateIdIssues(items, context)),
  }),
  pricing: z.strictObject({
    eyebrow: text(80),
    title: text(80),
    intro: text(1000),
    plans: z.strictObject({
      free_preview: pricingPlanSchema,
      single_account_lifetime: pricingPlanSchema,
    }),
    policy_heading: text(120),
    disclosures: z.array(text(500)).max(30),
    comparison_heading: text(120),
    comparison_rows: z.array(comparisonRowSchema).max(50).superRefine((items, context) => addDuplicateIdIssues(items, context)),
    support_heading: text(120),
    support_body: text(1000),
  }),
  thanks: z.strictObject({
    eyebrow: text(80),
    title: text(80),
    intro: text(1000),
    sections: z.array(thanksSectionSchema).max(12).superRefine((items, context) => addDuplicateIdIssues(items, context)),
  }),
})

export type PublicContentDraftV1 = z.infer<typeof publicContentDraftSchema>
export type PublicContentSettingsV1 = PublicContentDraftV1 & {
  version: typeof PUBLIC_CONTENT_VERSION
  updated_at: string | null
}
const freePreview = getSku('free_preview')
const singleAccountLifetime = getSku('single_account_lifetime')

export const DEFAULT_PUBLIC_CONTENT_DRAFT: PublicContentDraftV1 = {
  qq_group: {
    name: copy.publicContent.default_qq_name,
    number: '891655477',
    join_url: 'https://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=Hx_aCfNq_KOuGJ2w0KiRdvzIo33PlkQ6',
    link_label: copy.publicContent.default_qq_link_label,
  },
  faq: {
    eyebrow: copy.public.pages_PublicInfoPage_044,
    title: copy.public.pages_PublicInfoPage_043,
    intro: copy.public.pages_PublicInfoPage_045,
    cta_heading: copy.public.pages_PublicInfoPage_065,
    cta_body: copy.public.pages_PublicInfoPage_066,
    items: [
      faq('requirements', copy.public.pages_PublicInfoPage_002, copy.public.pages_PublicInfoPage_003),
      faq('account-concepts', copy.public.pages_PublicInfoPage_081, copy.public.pages_PublicInfoPage_082),
      faq('game-password', copy.public.pages_PublicInfoPage_083, copy.public.pages_PublicInfoPage_084),
      faq('free-versus-lifetime', copy.public.pages_PublicInfoPage_085, copy.public.pages_PublicInfoPage_086),
      faq('cdk-account', copy.public.pages_PublicInfoPage_004, copy.public.pages_PublicInfoPage_005),
      faq('skland-data', copy.public.pages_PublicInfoPage_006, copy.public.pages_PublicInfoPage_007),
      faq('skland-save', copy.public.pages_PublicInfoPage_087, copy.public.pages_PublicInfoPage_088),
      faq('skland-refresh', copy.public.pages_PublicInfoPage_089, copy.public.pages_PublicInfoPage_090),
      faq('use-json', copy.public.pages_PublicInfoPage_008, copy.public.pages_PublicInfoPage_009),
      faq('json-unavailable', copy.public.pages_PublicInfoPage_091, copy.public.pages_PublicInfoPage_092),
      faq('schedule-modes', copy.public.pages_PublicInfoPage_093, copy.public.pages_PublicInfoPage_094),
      faq('result-differences', copy.public.pages_PublicInfoPage_010, copy.public.pages_PublicInfoPage_011),
      faq('depot-versus-schedule', copy.public.pages_PublicInfoPage_012, copy.public.pages_PublicInfoPage_013),
      faq('import-failure', copy.public.pages_PublicInfoPage_014, copy.public.pages_PublicInfoPage_015),
      faq('change-bound-account', copy.public.pages_PublicInfoPage_095, copy.public.pages_PublicInfoPage_096),
      faq('data-security', copy.public.pages_PublicInfoPage_097, copy.public.pages_PublicInfoPage_098),
      faq('delete-account', copy.public.pages_PublicInfoPage_016, copy.public.pages_PublicInfoPage_017),
      faq('support-info', copy.public.pages_PublicInfoPage_099, copy.public.pages_PublicInfoPage_100),
      faq('qq-group', copy.publicContent.faq_join_question, copy.publicContent.faq_join_answer, 'qq_group'),
    ],
  },
  pricing: {
    eyebrow: copy.public.pages_PricingPage_002,
    title: copy.public.pages_PricingPage_001,
    intro: copy.public.pages_PricingPage_003,
    plans: {
      free_preview: {
        label: freePreview.label,
        badge: copy.public.pages_PricingPage_005,
        display_price: freePreview.display_price!,
        summary: freePreview.summary,
        account_scope: freePreview.account_scope,
      },
      single_account_lifetime: {
        label: singleAccountLifetime.label,
        badge: copy.public.pages_PricingPage_004,
        display_price: singleAccountLifetime.display_price!,
        summary: singleAccountLifetime.summary,
        account_scope: singleAccountLifetime.account_scope,
      },
    },
    policy_heading: copy.public.pages_PricingPage_006,
    disclosures: [...productPolicies.public_disclosures],
    comparison_heading: copy.public.pages_PricingPage_007,
    comparison_rows: productPolicies.public_feature_comparison.map((row, index) => ({
      id: `comparison-${index + 1}`,
      ...row,
    })),
    support_heading: copy.public.pages_PricingPage_009,
    support_body: productPolicies.support.sla_statement,
  },
  thanks: {
    eyebrow: copy.publicContent.thanks_eyebrow,
    title: copy.publicContent.thanks_title,
    intro: copy.publicContent.thanks_intro,
    sections: [
      {
        id: 'data-community',
        heading: copy.publicContent.thanks_data_heading,
        intro: copy.publicContent.thanks_data_intro,
        entries: [
          thanksEntry('yituliu', copy.publicContent.thanks_yituliu_name, copy.publicContent.thanks_yituliu_description),
          thanksEntry('penguin-statistics', copy.publicContent.thanks_penguin_name, copy.publicContent.thanks_penguin_description),
          thanksEntry('prts-wiki', copy.publicContent.thanks_prts_name, copy.publicContent.thanks_prts_description),
          thanksEntry('maa', copy.publicContent.thanks_maa_name, copy.publicContent.thanks_maa_description),
        ],
      },
      {
        id: 'developers',
        heading: copy.publicContent.thanks_developer_heading,
        intro: copy.publicContent.thanks_developer_intro,
        entries: [thanksEntry(
          defaultDeveloper.id,
          defaultDeveloper.name,
          copy.publicContent.thanks_developer_description,
          defaultDeveloper.url,
          defaultDeveloper.avatarUrl,
        )],
      },
      {
        id: 'helpers',
        heading: copy.publicContent.thanks_helpers_heading,
        intro: copy.publicContent.thanks_helpers_intro,
        entries: [thanksEntry('dake', copy.publicContent.thanks_helpers_name, '')],
      },
    ],
  },
}

export const DEFAULT_PUBLIC_CONTENT_SETTINGS: PublicContentSettingsV1 = {
  version: PUBLIC_CONTENT_VERSION,
  ...DEFAULT_PUBLIC_CONTENT_DRAFT,
  updated_at: null,
}

export function parsePublicContentDraft(value: unknown): PublicContentDraftV1 {
  return publicContentDraftSchema.parse(value)
}

export function normalizePublicContentSettings(value: unknown): PublicContentSettingsV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return cloneDefaultPublicContentSettings()
  const source = value as Record<string, unknown>
  const parsed = publicContentDraftSchema.safeParse({
    qq_group: source.qq_group,
    faq: source.faq,
    pricing: source.pricing,
    thanks: source.thanks,
  })
  if (!parsed.success || source.version !== PUBLIC_CONTENT_VERSION) return cloneDefaultPublicContentSettings()
  return {
    version: PUBLIC_CONTENT_VERSION,
    ...migrateLegacyDefaultCredits(parsed.data),
    updated_at: typeof source.updated_at === 'string' ? source.updated_at : null,
  }
}

export function cloneDefaultPublicContentSettings(): PublicContentSettingsV1 {
  return structuredClone(DEFAULT_PUBLIC_CONTENT_SETTINGS)
}

function faq(id: string, question: string, answer: string, action: 'none' | 'qq_group' = 'none') {
  return { id, question, answer, action }
}

function thanksEntry(id: string, name: string, description: string, url = '', avatarUrl = '') {
  return { id, name, description, url, avatar_url: avatarUrl }
}

function migrateLegacyDefaultCredits(draft: PublicContentDraftV1): PublicContentDraftV1 {
  const developerSection = draft.thanks.sections.find((item) => item.id === 'developers')
  const developer = developerSection?.entries.find((item) => item.id === 'lingyu')
  if (developer
    && developer.name === copy.publicContent.thanks_legacy_developer_name
    && developer.description === copy.publicContent.thanks_developer_description
    && developer.url === ''
    && developer.avatar_url === ''
    && !developerSection?.entries.some((item) => item !== developer && item.id === defaultDeveloper.id)) {
    developer.id = defaultDeveloper.id
    developer.name = defaultDeveloper.name
    developer.url = defaultDeveloper.url
    developer.avatar_url = defaultDeveloper.avatarUrl
  }

  const helperSection = draft.thanks.sections.find((item) => item.id === 'helpers')
  const helper = helperSection?.entries.find((item) => item.id === 'all-helpers')
  if (helper
    && helper.name === copy.publicContent.thanks_legacy_helpers_name
    && helper.description === copy.publicContent.thanks_legacy_helpers_description
    && helper.url === ''
    && helper.avatar_url === ''
    && !helperSection?.entries.some((item) => item !== helper && item.id === 'dake')) {
    helper.id = 'dake'
    helper.name = copy.publicContent.thanks_helpers_name
    helper.description = ''
  }
  return draft
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function addDuplicateIdIssues(items: Array<{ id: string }>, context: z.RefinementCtx): void {
  const seen = new Set<string>()
  items.forEach((item, index) => {
    if (seen.has(item.id)) {
      context.addIssue({ code: 'custom', path: [index, 'id'], message: copy.publicContent.validation_invalid })
    }
    seen.add(item.id)
  })
}
