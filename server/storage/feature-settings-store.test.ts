import { describe, expect, it } from 'vitest'
import { computeEffectiveSiteFeatures } from '../../src/lib/site-features'
import {
  DEFAULT_SITE_FEATURE_SETTINGS,
  normalizeSiteFeatureSettings,
  validateSiteFeatures,
} from './feature-settings-store'

describe('feature settings', () => {
  it('defaults missing and legacy values to all enabled', () => {
    expect(normalizeSiteFeatureSettings(null)).toEqual(DEFAULT_SITE_FEATURE_SETTINGS)
    expect(normalizeSiteFeatureSettings({ version: 0, features: { login: false } })).toMatchObject({
      version: 1,
      features: { login: false, site: true, profiles: true, tools: true },
    })
  })

  it('keeps raw child values while computing parent dependencies', () => {
    const settings = normalizeSiteFeatureSettings({ features: { tools: false, depot_value: true } })
    expect(settings.features.depot_value).toBe(true)
    expect(computeEffectiveSiteFeatures(settings)).toMatchObject({ tools: false, depot_value: false })

    const loginClosed = normalizeSiteFeatureSettings({ features: { login: false, profiles: true, schedule_generation: true } })
    expect(computeEffectiveSiteFeatures(loginClosed)).toMatchObject({
      registration: true,
      login: false,
      profiles: false,
      schedule_generation: false,
      schedule_analysis: true,
    })
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
