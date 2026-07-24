export const SITE_FEATURE_KEYS = [
  'site',
  'registration',
  'login',
  'profiles',
  'tools',
  'cdk_redemption',
  'free_preview',
  'schedule_generation',
  'depot_value',
  'skland',
  'invitations',
  'inventory',
  'onboarding_tasks',
  'announcements',
] as const

export type SiteFeatureKey = typeof SITE_FEATURE_KEYS[number]
export type SiteFeatures = Record<SiteFeatureKey, boolean>

export interface SiteFeatureSettingsV1 {
  version: 1
  features: SiteFeatures
  updated_at: string | null
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
  depot_value: true,
  skland: true,
  invitations: true,
  inventory: true,
  onboarding_tasks: true,
  announcements: true,
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
    typeof storedFeatures[key] === 'boolean' ? storedFeatures[key] : true,
  ])) as unknown as SiteFeatures
  return {
    version: 1,
    features,
    updated_at: typeof source.updated_at === 'string' ? source.updated_at : null,
  }
}

export function computeEffectiveSiteFeatures(settings: SiteFeatureSettingsV1): SiteFeatures {
  const raw = settings.features
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
    depot_value: tools && raw.depot_value,
    skland: profiles && raw.skland,
    invitations: login && raw.invitations,
    inventory: login && raw.inventory,
    onboarding_tasks: login && raw.inventory && raw.onboarding_tasks,
    announcements: site && raw.announcements,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
