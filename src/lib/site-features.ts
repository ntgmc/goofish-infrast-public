export const SITE_FEATURE_KEYS = [
  'site',
  'registration',
  'login',
  'profiles',
  'tools',
  'cdk_redemption',
  'free_preview',
  'schedule_generation',
  'one_shift_per_day',
  'metered_billing',
  'depot_value',
  'skland',
  'invitations',
  'inventory',
  'onboarding_tasks',
  'announcements',
  'v2',
  'faq',
  'support',
  'pricing',
  'changelog',
  'thanks',
  'service_status',
  'cultivation_plan',
  'manual_schedule',
  'scenario_comparison',
  'notifications',
  'qqbot',
  'maa_export',
  'full_result_export',
] as const

export type SiteFeatureKey = typeof SITE_FEATURE_KEYS[number]
export type SiteFeatures = Record<SiteFeatureKey, boolean>

// Keep the billing implementation and stored settings dormant until it is reimplemented.
export const METERED_BILLING_AVAILABLE = false

export interface SiteFeatureSettingsV1 {
  version: 1
  features: SiteFeatures
  updated_at: string | null
}

export type AdminSiteFeatureSettingsV1 = SiteFeatureSettingsV1 & {
  revision: number
}

export const DEFAULT_SITE_FEATURES: SiteFeatures = Object.freeze({
  site: true,
  registration: true,
  login: true,
  profiles: true,
  tools: true,
  cdk_redemption: true,
  free_preview: true,
  schedule_generation: true,
  one_shift_per_day: false,
  metered_billing: false,
  depot_value: true,
  skland: true,
  invitations: true,
  inventory: true,
  onboarding_tasks: true,
  announcements: true,
  v2: true,
  faq: true,
  support: true,
  pricing: true,
  changelog: true,
  thanks: true,
  service_status: true,
  cultivation_plan: true,
  manual_schedule: true,
  scenario_comparison: true,
  notifications: true,
  qqbot: true,
  maa_export: true,
  full_result_export: true,
})

export const DEFAULT_SITE_FEATURE_SETTINGS: SiteFeatureSettingsV1 = Object.freeze({
  version: 1,
  features: DEFAULT_SITE_FEATURES,
  updated_at: null,
})

export function normalizeSiteFeatureSettings(value: unknown): SiteFeatureSettingsV1 {
  const source = isRecord(value) ? value : {}
  const storedFeatures = isRecord(source.features) ? source.features : {}
  const features = Object.fromEntries(SITE_FEATURE_KEYS.map((key) => [
    key,
    typeof storedFeatures[key] === 'boolean' ? storedFeatures[key] : DEFAULT_SITE_FEATURES[key],
  ])) as unknown as SiteFeatures
  return {
    version: 1,
    features,
    updated_at: typeof source.updated_at === 'string' ? source.updated_at : null,
  }
}

export function computeEffectiveSiteFeatures(settings: SiteFeatureSettingsV1): SiteFeatures {
  const raw = normalizeSiteFeatureSettings(settings).features
  const site = raw.site
  const login = site && raw.login
  const profiles = login && raw.profiles
  const tools = site && raw.tools
  return {
    site,
    registration: site && raw.registration,
    login,
    profiles,
    tools,
    cdk_redemption: profiles && raw.cdk_redemption,
    free_preview: profiles && raw.free_preview,
    schedule_generation: profiles && raw.schedule_generation,
    one_shift_per_day: profiles && raw.schedule_generation && raw.one_shift_per_day,
    metered_billing: METERED_BILLING_AVAILABLE && profiles && raw.schedule_generation && raw.metered_billing,
    depot_value: tools && raw.depot_value,
    skland: profiles && raw.skland,
    invitations: login && raw.invitations,
    inventory: login && raw.inventory,
    onboarding_tasks: login && raw.inventory && raw.onboarding_tasks,
    announcements: site && raw.announcements,
    v2: site && raw.v2,
    faq: raw.faq,
    support: raw.support,
    pricing: raw.pricing,
    changelog: raw.changelog,
    thanks: raw.thanks,
    service_status: raw.service_status,
    cultivation_plan: tools && raw.cultivation_plan,
    manual_schedule: tools && profiles && raw.schedule_generation && raw.manual_schedule,
    scenario_comparison: profiles && raw.schedule_generation && raw.scenario_comparison,
    notifications: login && raw.notifications,
    qqbot: login && raw.qqbot,
    maa_export: profiles && raw.inventory && raw.maa_export,
    full_result_export: profiles && raw.full_result_export,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
