export const SITE_FEATURE_KEYS = [
  'site',
  'registration',
  'login',
  'profiles',
  'tools',
  'building_rating_radar',
  'base_value_dashboard',
  'cdk_redemption',
  'free_preview',
  'schedule_generation',
  'one_shift_per_day',
  'metered_billing',
  'ai_credits',
  'depot_value',
  'skland',
  'invitations',
  'inventory',
  'onboarding_tasks',
  'announcements',
  'v1',
  'v2',
  'faq',
  'support',
  'pricing',
  'changelog',
  'thanks',
  'service_status',
  'cultivation_plan',
  'cultivation_projects',
  'training_ratio',
  'material_demand',
  'manual_schedule',
  'schedule_comparison',
  'scenario_comparison',
  'ai_schedule_explanation',
  'schedule_explanation_avatar',
  'ai_goal_comparison',
  'ai_cultivation_advisor',
  'workspace_page_help',
  'ai_change_summary',
  'notifications',
  'website_events',
  'qqbot',
  'maa_export',
  'full_result_export',
  'thanks_recruitment',
] as const

export type SiteFeatureKey = typeof SITE_FEATURE_KEYS[number]
export type SiteFeatures = Record<SiteFeatureKey, boolean>

export const WORKSPACE_ASSISTANT_FEATURES = {
  comparison: 'ai_goal_comparison',
  cultivation: 'ai_cultivation_advisor',
  changes: 'ai_change_summary',
} as const

export const MODEL_FEATURES = ['ai_schedule_explanation', ...Object.values(WORKSPACE_ASSISTANT_FEATURES)] as const
export type ModelFeature = typeof MODEL_FEATURES[number]

export const PAUSABLE_SITE_FEATURES = [
  'manual_schedule', 'schedule_comparison', 'scenario_comparison', 'cultivation_plan', 'cultivation_projects',
  'training_ratio', 'thanks_recruitment', 'material_demand', 'depot_value', ...MODEL_FEATURES,
] as const
export type PausableSiteFeature = typeof PAUSABLE_SITE_FEATURES[number]
export type FeaturePauseNotices = Partial<Record<PausableSiteFeature, string>>
export const FEATURE_PAUSE_NOTICE_LIMIT = 280

export function isPausableSiteFeature(feature: SiteFeatureKey): feature is PausableSiteFeature {
  return (PAUSABLE_SITE_FEATURES as readonly SiteFeatureKey[]).includes(feature)
}

// Legacy schedule billing stays closed; AI credits have their own switch.
export const METERED_BILLING_AVAILABLE = false

export interface SiteFeatureSettingsV1 {
  version: 1
  features: SiteFeatures
  pause_notices?: FeaturePauseNotices
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
  building_rating_radar: false,
  base_value_dashboard: false,
  cdk_redemption: true,
  free_preview: true,
  schedule_generation: true,
  one_shift_per_day: false,
  metered_billing: false,
  ai_credits: false,
  depot_value: true,
  skland: true,
  invitations: true,
  inventory: true,
  onboarding_tasks: true,
  announcements: true,
  v1: true,
  v2: true,
  faq: true,
  support: true,
  pricing: true,
  changelog: true,
  thanks: true,
  service_status: true,
  cultivation_plan: true,
  cultivation_projects: true,
  training_ratio: true,
  material_demand: true,
  manual_schedule: true,
  schedule_comparison: true,
  scenario_comparison: true,
  ai_schedule_explanation: false,
  schedule_explanation_avatar: true,
  ai_goal_comparison: false,
  ai_cultivation_advisor: false,
  workspace_page_help: true,
  ai_change_summary: false,
  notifications: true,
  website_events: true,
  qqbot: true,
  maa_export: true,
  full_result_export: true,
  thanks_recruitment: true,
})

export const DEFAULT_SITE_FEATURE_SETTINGS: SiteFeatureSettingsV1 = Object.freeze({
  version: 1,
  features: DEFAULT_SITE_FEATURES,
  updated_at: null,
})

export function normalizeSiteFeatureSettings(value: unknown): SiteFeatureSettingsV1 {
  const source = isRecord(value) ? value : {}
  const storedFeatures = isRecord(source.features) ? source.features : {}
  const defaults = {
    ...DEFAULT_SITE_FEATURES,
    cultivation_projects: storedFeatures.cultivation_plan !== false,
    schedule_comparison: storedFeatures.manual_schedule !== false,
  }
  // Older records used the explanation switch for all model-backed assistants.
  if (storedFeatures.ai_schedule_explanation === true) {
    for (const feature of Object.values(WORKSPACE_ASSISTANT_FEATURES)) defaults[feature] = true
  }
  const features = Object.fromEntries(SITE_FEATURE_KEYS.map((key) => [
    key,
    typeof storedFeatures[key] === 'boolean' ? storedFeatures[key] : defaults[key],
  ])) as unknown as SiteFeatures
  const storedNotices = isRecord(source.pause_notices) ? source.pause_notices : {}
  const pauseNotices: FeaturePauseNotices = {}
  for (const feature of PAUSABLE_SITE_FEATURES) {
    const value = storedNotices[feature]
    if (features[feature] || typeof value !== 'string') continue
    const notice = value.trim()
    if (notice && notice.length <= FEATURE_PAUSE_NOTICE_LIMIT) pauseNotices[feature] = notice
  }
  return {
    version: 1,
    features,
    ...(Object.keys(pauseNotices).length > 0 && { pause_notices: pauseNotices }),
    updated_at: typeof source.updated_at === 'string' ? source.updated_at : null,
  }
}

export function computeEffectiveSiteFeatures(settings: SiteFeatureSettingsV1): SiteFeatures {
  return effectiveSiteFeatures(normalizeSiteFeatureSettings(settings).features)
}

function effectiveSiteFeatures(raw: SiteFeatures): SiteFeatures {
  const site = raw.site
  const login = site && raw.login
  const profiles = login && raw.profiles
  const tools = site && raw.tools
  const v2 = site && raw.v2
  const scenarioComparison = profiles && raw.schedule_generation && raw.scenario_comparison
  return {
    site,
    registration: site && raw.registration,
    login,
    profiles,
    tools,
    building_rating_radar: tools && v2 && raw.building_rating_radar,
    base_value_dashboard: tools && v2 && raw.base_value_dashboard,
    cdk_redemption: profiles && raw.cdk_redemption,
    free_preview: profiles && raw.free_preview,
    schedule_generation: profiles && raw.schedule_generation,
    one_shift_per_day: profiles && raw.schedule_generation && raw.one_shift_per_day,
    metered_billing: METERED_BILLING_AVAILABLE && profiles && raw.schedule_generation && raw.metered_billing,
    ai_credits: login && v2 && raw.ai_credits,
    depot_value: tools && raw.depot_value,
    skland: profiles && raw.skland,
    invitations: login && raw.invitations,
    inventory: login && raw.inventory,
    onboarding_tasks: login && raw.inventory && raw.onboarding_tasks,
    announcements: site && raw.announcements,
    v1: raw.v1,
    v2,
    faq: raw.faq,
    support: raw.support,
    pricing: raw.pricing,
    changelog: raw.changelog,
    thanks: raw.thanks,
    service_status: raw.service_status,
    cultivation_plan: tools && raw.cultivation_plan,
    cultivation_projects: tools && v2 && raw.cultivation_projects,
    training_ratio: tools && raw.training_ratio,
    material_demand: tools && v2 && raw.material_demand,
    manual_schedule: tools && profiles && raw.schedule_generation && raw.manual_schedule,
    schedule_comparison: tools && v2 && profiles && raw.schedule_generation && raw.schedule_comparison,
    scenario_comparison: scenarioComparison,
    ai_schedule_explanation: v2 && profiles && raw.ai_schedule_explanation,
    schedule_explanation_avatar: v2 && raw.schedule_explanation_avatar,
    ai_goal_comparison: v2 && scenarioComparison && raw.ai_goal_comparison,
    ai_cultivation_advisor: v2 && profiles && raw.ai_cultivation_advisor,
    workspace_page_help: v2 && raw.workspace_page_help,
    ai_change_summary: v2 && profiles && raw.ai_change_summary,
    notifications: login && raw.notifications,
    website_events: raw.website_events,
    qqbot: login && raw.qqbot,
    maa_export: profiles && raw.inventory && raw.maa_export,
    full_result_export: profiles && raw.full_result_export,
    thanks_recruitment: tools && raw.cultivation_plan && raw.thanks_recruitment,
  }
}

export function computeVisiblePauseNotices(settings: SiteFeatureSettingsV1): FeaturePauseNotices {
  const { features, pause_notices } = normalizeSiteFeatureSettings(settings)
  const visible: FeaturePauseNotices = {}
  for (const feature of PAUSABLE_SITE_FEATURES) {
    const notice = pause_notices?.[feature]
    if (notice && effectiveSiteFeatures({ ...features, [feature]: true })[feature]) visible[feature] = notice
  }
  return visible
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
