import { describe, expect, it } from 'vitest'
import { computeEffectiveSiteFeatures } from '../../src/lib/site-features'
import {
  DEFAULT_SITE_FEATURE_SETTINGS,
  normalizeSiteFeatureSettings,
  validateSiteFeatures,
} from './feature-settings-store'

describe('feature settings', () => {
  it('fills missing and legacy values with the current defaults', () => {
    expect(normalizeSiteFeatureSettings(null)).toEqual(DEFAULT_SITE_FEATURE_SETTINGS)
    expect(normalizeSiteFeatureSettings({ version: 0, features: { login: false, qqbot: false } })).toMatchObject({
      version: 1,
      features: { login: false, site: true, profiles: true, tools: true, qqbot: false, website_events: true, building_rating_radar: false },
    })
  })

  it('keeps raw child values while computing parent dependencies', () => {
    const settings = normalizeSiteFeatureSettings({ features: { tools: false, depot_value: true } })
    expect(settings.features.depot_value).toBe(true)
    expect(computeEffectiveSiteFeatures(settings)).toMatchObject({ tools: false, depot_value: false })

    const radar = normalizeSiteFeatureSettings({ features: { building_rating_radar: true } })
    expect(computeEffectiveSiteFeatures(radar).building_rating_radar).toBe(true)
    for (const parent of ['site', 'tools', 'v2']) {
      expect(computeEffectiveSiteFeatures({ ...radar, features: { ...radar.features, [parent]: false } }).building_rating_radar).toBe(false)
    }

    const loginClosed = normalizeSiteFeatureSettings({ features: { login: false, profiles: true, schedule_generation: true } })
    expect(computeEffectiveSiteFeatures(loginClosed)).toMatchObject({
      registration: true,
      login: false,
      profiles: false,
      schedule_generation: false,
      qqbot: false,
      website_events: true,
    })
  })

  it('preserves legacy closures for projects and schedule comparison until those tools are configured', () => {
    const legacy = normalizeSiteFeatureSettings({ features: { cultivation_plan: false, manual_schedule: false } })
    expect(legacy.features).toMatchObject({ cultivation_projects: false, schedule_comparison: false, training_ratio: true, material_demand: true })
    const features = { ...legacy.features, cultivation_projects: true, schedule_comparison: true, material_demand: false, training_ratio: false }
    expect(computeEffectiveSiteFeatures({ ...legacy, features })).toMatchObject({ cultivation_plan: false, cultivation_projects: true,
      manual_schedule: false, schedule_comparison: true, material_demand: false, training_ratio: false })
    expect(computeEffectiveSiteFeatures({ ...legacy, features: { ...features, tools: false } })).toMatchObject({ cultivation_projects: false, schedule_comparison: false })
  })

  it('preserves the behavior of legacy AI settings and keeps explicit choices independent', () => {
    const legacy = normalizeSiteFeatureSettings({ features: { ai_schedule_explanation: true } })
    expect(legacy.features).toMatchObject({ ai_goal_comparison: true, ai_cultivation_advisor: true, ai_change_summary: true, workspace_page_help: true, schedule_explanation_avatar: true })
    const features = { ...legacy.features, ai_schedule_explanation: false, ai_cultivation_advisor: false, schedule_explanation_avatar: false }
    expect(computeEffectiveSiteFeatures({ ...legacy, features })).toMatchObject({ ai_schedule_explanation: false,
      ai_goal_comparison: true, ai_cultivation_advisor: false, ai_change_summary: true, workspace_page_help: true, schedule_explanation_avatar: false })
    expect(computeEffectiveSiteFeatures({ ...legacy, features: { ...features, scenario_comparison: false } })).toMatchObject({ ai_goal_comparison: false, ai_change_summary: true })
    expect(computeEffectiveSiteFeatures({ ...legacy, features: { ...features, v2: false } })).toMatchObject({ ai_goal_comparison: false, ai_change_summary: false, workspace_page_help: false })
  })

  it('requires a complete strict boolean map', () => {
    expect(validateSiteFeatures(DEFAULT_SITE_FEATURE_SETTINGS.features)).toEqual(DEFAULT_SITE_FEATURE_SETTINGS.features)
    expect(() => validateSiteFeatures({ ...DEFAULT_SITE_FEATURE_SETTINGS.features, login: 'yes' })).toThrow(/login/)
    expect(() => validateSiteFeatures({ ...DEFAULT_SITE_FEATURE_SETTINGS.features, unknown: true })).toThrow(/未知/)
    const missing = { ...DEFAULT_SITE_FEATURE_SETTINGS.features } as Partial<typeof DEFAULT_SITE_FEATURE_SETTINGS.features>
    delete missing.site
    expect(() => validateSiteFeatures(missing)).toThrow(/site/)
  })
})
