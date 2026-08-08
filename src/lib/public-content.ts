import { z } from 'zod'
import { copy } from '../copy/index'
import { getSku, productPolicies } from './product-catalog'

export const PUBLIC_CONTENT_VERSION = 1 as const
export const PUBLIC_CONTENT_DEFAULTS_REVISION = 6 as const
export const PUBLIC_PRICING_PLAN_IDS = [
  'free_preview',
  'single_account_monthly',
  'single_account_half_year',
  'single_account_annual',
  'single_account_lifetime',
] as const
type PublicPricingPlanId = typeof PUBLIC_PRICING_PLAN_IDS[number]
const LEGACY_PRICING_EYEBROW = '公开 SKU'
const LEGACY_PRICING_INTRO = '先了解完整权益与限制，再选择适合自己的版本。现在提供月卡、半年卡、年卡、终身卡，以及个人和商用积分单次排班。'
export const PUBLIC_CONTENT_LIMITS = Object.freeze({
  faqItems: 50,
  pricingDisclosures: 30,
  pricingComparisonRows: 50,
  thanksSections: 12,
  thanksEntries: 50,
})

const identifier = z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/)
const text = (max: number) => z.string().trim().min(1).max(max)
const httpsUrlOrEmpty = z.string().trim().max(2048).refine((value) => value === '' || isHttpsUrl(value), {
  message: copy.publicContent.validation_invalid,
})
const optionalHttpsUrl = httpsUrlOrEmpty.optional().default('')
const optionalAvatarUrl = z.string().trim().max(2048).refine((value) => value === '' || isHttpsUrl(value) || isSafeSiteAssetUrl(value), {
  message: copy.publicContent.validation_invalid,
}).optional().default('')
const defaultDeveloper = {
  id: 'ntgmc',
  name: copy.publicContent.thanks_developer_name,
  url: 'https://github.com/ntgmc',
  avatarUrl: '/assets/credits/ntgmc.jpg',
} as const

const faqItemSchema = z.strictObject({
  id: identifier,
  question: text(160),
  answer: text(4000),
  action: z.enum(['none', 'qq_group']),
})

const pricingPriceLabel = z.string().trim().max(40).regex(/^\d+(?:\.\d{1,2})?\s*元(?:\s*\/\s*\S.*)?$/, {
  message: '原价必须使用“数字 元 / 有效期”的格式。',
})
const pricingDiscountFold = z.number().int().min(1).max(10)

const pricingPlanSchema = z.strictObject({
  label: text(80),
  badge: text(40),
  display_price: text(40),
  original_price: pricingPriceLabel,
  discount_fold: pricingDiscountFold,
  summary: text(1000),
  account_scope: text(500),
})

const pricingPlanInputSchema = z.strictObject({
  label: text(80),
  badge: text(40),
  display_price: text(40).optional(),
  original_price: pricingPriceLabel.optional(),
  discount_fold: pricingDiscountFold.optional(),
  summary: text(1000),
  account_scope: text(500),
})

type PublicPricingSku = ReturnType<typeof getSku> & {
  display_price: string
  original_display_price: string
  default_discount_fold: number
}

const freePreview = getSku('free_preview') as PublicPricingSku
const singleAccountMonthly = getSku('single_account_monthly') as PublicPricingSku
const singleAccountHalfYear = getSku('single_account_half_year') as PublicPricingSku
const singleAccountAnnual = getSku('single_account_annual') as PublicPricingSku
const singleAccountLifetime = getSku('single_account_lifetime') as PublicPricingSku

const defaultPricingPlans = {
  free_preview: {
    label: freePreview.label,
    badge: copy.public.pages_PricingPage_005,
    display_price: freePreview.display_price!,
    original_price: freePreview.original_display_price!,
    discount_fold: freePreview.default_discount_fold,
    summary: freePreview.summary,
    account_scope: freePreview.account_scope,
  },
  single_account_monthly: {
    label: singleAccountMonthly.label,
    badge: '低门槛',
    display_price: singleAccountMonthly.display_price!,
    original_price: singleAccountMonthly.original_display_price!,
    discount_fold: singleAccountMonthly.default_discount_fold,
    summary: singleAccountMonthly.summary,
    account_scope: singleAccountMonthly.account_scope,
  },
  single_account_half_year: {
    label: singleAccountHalfYear.label,
    badge: '高性价比',
    display_price: singleAccountHalfYear.display_price!,
    original_price: singleAccountHalfYear.original_display_price!,
    discount_fold: singleAccountHalfYear.default_discount_fold,
    summary: singleAccountHalfYear.summary,
    account_scope: singleAccountHalfYear.account_scope,
  },
  single_account_annual: {
    label: singleAccountAnnual.label,
    badge: '年度推荐',
    display_price: singleAccountAnnual.display_price!,
    original_price: singleAccountAnnual.original_display_price!,
    discount_fold: singleAccountAnnual.default_discount_fold,
    summary: singleAccountAnnual.summary,
    account_scope: singleAccountAnnual.account_scope,
  },
  single_account_lifetime: {
    label: singleAccountLifetime.label,
    badge: '长期方案',
    display_price: singleAccountLifetime.display_price!,
    original_price: singleAccountLifetime.original_display_price!,
    discount_fold: singleAccountLifetime.default_discount_fold,
    summary: singleAccountLifetime.summary,
    account_scope: singleAccountLifetime.account_scope,
  },
} satisfies Record<PublicPricingPlanId, z.infer<typeof pricingPlanSchema>>

const pricingPlansSchema = z.strictObject({
  free_preview: pricingPlanInputSchema,
  single_account_monthly: pricingPlanInputSchema.optional(),
  single_account_half_year: pricingPlanInputSchema.optional(),
  single_account_annual: pricingPlanInputSchema.optional(),
  single_account_lifetime: pricingPlanInputSchema,
}).transform((plans) => ({
  free_preview: normalizePricingPlan(plans.free_preview, defaultPricingPlans.free_preview, freePreview.display_price!),
  single_account_monthly: normalizePricingPlan(plans.single_account_monthly, defaultPricingPlans.single_account_monthly, singleAccountMonthly.display_price!),
  single_account_half_year: normalizePricingPlan(plans.single_account_half_year, defaultPricingPlans.single_account_half_year, singleAccountHalfYear.display_price!),
  single_account_annual: normalizePricingPlan(plans.single_account_annual, defaultPricingPlans.single_account_annual, singleAccountAnnual.display_price!),
  single_account_lifetime: normalizePricingPlan(plans.single_account_lifetime, defaultPricingPlans.single_account_lifetime, singleAccountLifetime.display_price!),
}))

const comparisonRowSchema = z.strictObject({
  id: identifier,
  feature: text(120),
  free_preview: text(1000),
  single_account_monthly: text(1000).optional(),
  single_account_half_year: text(1000).optional(),
  single_account_annual: text(1000).optional(),
  single_account_lifetime: text(1000),
})

const thanksEntrySchema = z.strictObject({
  id: identifier,
  name: text(120),
  description: z.string().trim().max(1000),
  url: optionalHttpsUrl,
  avatar_url: optionalAvatarUrl,
})

const thanksSectionSchema = z.strictObject({
  id: identifier,
  heading: text(120),
  intro: text(1000),
  entries: z.array(thanksEntrySchema).max(PUBLIC_CONTENT_LIMITS.thanksEntries).superRefine((entries, context) => addDuplicateIdIssues(entries, context)),
})

export const publicContentDraftSchema = z.strictObject({
  cdk_purchase: z.strictObject({
    xianyu_url: httpsUrlOrEmpty,
  }),
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
    items: z.array(faqItemSchema).max(PUBLIC_CONTENT_LIMITS.faqItems).superRefine((items, context) => addDuplicateIdIssues(items, context)),
  }),
  pricing: z.strictObject({
    eyebrow: text(80),
    title: text(80),
    intro: text(1000),
    plans: pricingPlansSchema,
    policy_heading: text(120),
    disclosures: z.array(text(500)).max(PUBLIC_CONTENT_LIMITS.pricingDisclosures),
    comparison_heading: text(120),
    comparison_rows: z.array(comparisonRowSchema).max(PUBLIC_CONTENT_LIMITS.pricingComparisonRows).superRefine((items, context) => addDuplicateIdIssues(items, context)),
    support_heading: text(120),
    support_body: text(1000),
  }),
  thanks: z.strictObject({
    eyebrow: text(80),
    title: text(80),
    intro: text(1000),
    sections: z.array(thanksSectionSchema).max(PUBLIC_CONTENT_LIMITS.thanksSections).superRefine((items, context) => addDuplicateIdIssues(items, context)),
  }),
})

export type PublicContentDraftV1 = z.infer<typeof publicContentDraftSchema>
export type PublicContentSettingsV1 = PublicContentDraftV1 & {
  version: typeof PUBLIC_CONTENT_VERSION
  defaults_revision: typeof PUBLIC_CONTENT_DEFAULTS_REVISION
  updated_at: string | null
}
export type AdminPublicContentSettingsV1 = PublicContentSettingsV1 & {
  revision: number
}

export const DEFAULT_PUBLIC_CONTENT_DRAFT: PublicContentDraftV1 = {
  cdk_purchase: {
    xianyu_url: 'https://m.tb.cn/h.RGCWZHH?tk=X063g9yLZxZ%20MF287',
  },
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
      free_preview: { ...defaultPricingPlans.free_preview },
      single_account_monthly: { ...defaultPricingPlans.single_account_monthly },
      single_account_half_year: { ...defaultPricingPlans.single_account_half_year },
      single_account_annual: { ...defaultPricingPlans.single_account_annual },
      single_account_lifetime: { ...defaultPricingPlans.single_account_lifetime },
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
  defaults_revision: PUBLIC_CONTENT_DEFAULTS_REVISION,
  ...DEFAULT_PUBLIC_CONTENT_DRAFT,
  updated_at: null,
}

export function parsePublicContentDraft(value: unknown): PublicContentDraftV1 {
  return publicContentDraftSchema.parse(value)
}

export function normalizePublicContentSettings(value: unknown): PublicContentSettingsV1 {
  return resolvePublicContentSettings(value).content
}

export function resolvePublicContentSettings(value: unknown): { content: PublicContentSettingsV1; isFallback: boolean } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { content: cloneDefaultPublicContentSettings(), isFallback: true }
  }
  const source = value as Record<string, unknown>
  const parsed = publicContentDraftSchema.safeParse({
    cdk_purchase: Object.prototype.hasOwnProperty.call(source, 'cdk_purchase')
      ? source.cdk_purchase
      : DEFAULT_PUBLIC_CONTENT_DRAFT.cdk_purchase,
    qq_group: source.qq_group,
    faq: source.faq,
    pricing: source.pricing,
    thanks: source.thanks,
  })
  if (!parsed.success || source.version !== PUBLIC_CONTENT_VERSION) {
    return { content: cloneDefaultPublicContentSettings(), isFallback: true }
  }
  const storedDefaultsRevision = normalizeDefaultsRevision(source.defaults_revision)
  const normalizedDraft = normalizePricingComparisonDefaults(parsed.data)
  const migratedDraft = storedDefaultsRevision < PUBLIC_CONTENT_DEFAULTS_REVISION
    ? migrateLegacyPricingCopy(migrateLegacyDefaultCredits(normalizedDraft))
    : normalizedDraft
  return {
    content: {
      version: PUBLIC_CONTENT_VERSION,
      defaults_revision: PUBLIC_CONTENT_DEFAULTS_REVISION,
      ...migratedDraft,
      updated_at: typeof source.updated_at === 'string' ? source.updated_at : null,
    },
    isFallback: false,
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

export function formatPricingDiscountedPrice(originalPrice: string, discountFold: number): string {
  const match = /^(\d+(?:\.\d{1,2})?)(\s*元(?:\s*\/\s*\S.*)?)$/u.exec(originalPrice.trim())
  if (!match || !Number.isInteger(discountFold) || discountFold < 1 || discountFold > 10) return originalPrice
  const discountedAmount = Math.round((Number(match[1]) * discountFold / 10) * 100) / 100
  const formattedAmount = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(discountedAmount)
  return `${formattedAmount}${match[2]}`
}

function normalizePricingPlan(
  plan: z.infer<typeof pricingPlanInputSchema> | undefined,
  defaultPlan: z.infer<typeof pricingPlanSchema>,
  legacyDisplayPrice: string,
): z.infer<typeof pricingPlanSchema> {
  const next: Partial<z.infer<typeof pricingPlanInputSchema>> = plan ?? {}
  const originalPrice = next.original_price ?? defaultPlan.original_price
  const discountFold = next.discount_fold ?? defaultPlan.discount_fold
  const pricingWasConfigured = next.original_price !== undefined || next.discount_fold !== undefined
  const displayPrice = pricingWasConfigured || !next.display_price || next.display_price === legacyDisplayPrice || next.display_price === defaultPlan.original_price
    ? formatPricingDiscountedPrice(originalPrice, discountFold)
    : next.display_price
  return {
    ...defaultPlan,
    ...next,
    display_price: displayPrice,
    original_price: originalPrice,
    discount_fold: discountFold,
  }
}

function normalizePricingComparisonDefaults(draft: PublicContentDraftV1): PublicContentDraftV1 {
  const defaults = productPolicies.public_feature_comparison as readonly Record<string, string>[]
  return {
    ...draft,
    pricing: {
      ...draft.pricing,
      comparison_rows: draft.pricing.comparison_rows.map((row, index) => {
        const defaultRow = defaults[index]
        if (!defaultRow) return row
        const next = { ...row } as Record<string, string | undefined>
        for (const planId of PUBLIC_PRICING_PLAN_IDS) {
          if (next[planId] === undefined && typeof defaultRow[planId] === 'string') next[planId] = defaultRow[planId]
        }
        return next as typeof row
      }),
    },
  }
}

function migrateLegacyPricingCopy(draft: PublicContentDraftV1): PublicContentDraftV1 {
  if (draft.pricing.eyebrow === LEGACY_PRICING_EYEBROW) draft.pricing.eyebrow = copy.public.pages_PricingPage_002
  if (draft.pricing.intro === LEGACY_PRICING_INTRO) draft.pricing.intro = copy.public.pages_PricingPage_003
  return draft
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

  const intermediateDeveloper = developerSection?.entries.find((item) => item.id === defaultDeveloper.id)
  if (intermediateDeveloper
    && intermediateDeveloper.name === defaultDeveloper.name
    && intermediateDeveloper.description === copy.publicContent.thanks_developer_description
    && intermediateDeveloper.url === defaultDeveloper.url
    && (intermediateDeveloper.avatar_url === '' || intermediateDeveloper.avatar_url === 'https://avatars.githubusercontent.com/u/74061867?v=4')) {
    intermediateDeveloper.avatar_url = defaultDeveloper.avatarUrl
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

function normalizeDefaultsRevision(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function isSafeSiteAssetUrl(value: string): boolean {
  if (!value.startsWith('/assets/') || value.startsWith('//') || value.includes('\\')) return false
  try {
    const base = new URL('https://maatool.invalid')
    const parsed = new URL(value, base)
    return parsed.origin === base.origin && parsed.pathname.startsWith('/assets/') && !parsed.search && !parsed.hash
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
