import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computeEffectiveSiteFeatures } from '../../src/lib/site-features'

const queryMock = vi.hoisted(() => vi.fn())
const ensureDatabaseSchema = vi.hoisted(() => vi.fn())

vi.mock('./postgres', () => ({ query: queryMock }))
vi.mock('./schema', () => ({ ensureDatabaseSchema }))

import {
  DEFAULT_SITE_FEATURE_SETTINGS,
  getSiteFeatureSettings,
  normalizeSiteFeatureSettings,
  saveSiteFeatureSettings,
  validateSiteFeatures,
} from './feature-settings-store'
import { SettingsConflictError } from './settings-conflict'

describe('feature settings', () => {
  beforeEach(() => {
    queryMock.mockReset()
    ensureDatabaseSchema.mockReset().mockResolvedValue(undefined)
  })

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

  it('returns revision zero for the built-in snapshot', async () => {
    queryMock.mockResolvedValue({ rows: [] })
    await expect(getSiteFeatureSettings()).resolves.toMatchObject({ revision: 0, updated_at: null })
  })

  it('atomically creates and updates a matching revision', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ revision: 1 }] })
      .mockResolvedValueOnce({ rows: [{ revision: 2 }] })
    const saved = await saveSiteFeatureSettings(DEFAULT_SITE_FEATURE_SETTINGS.features, 0)
    expect(saved.revision).toBe(1)
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('revision = revision + 1'), [
      'global',
      expect.stringContaining('"version":1'),
      expect.any(String),
      0,
    ])

    const updated = await saveSiteFeatureSettings(DEFAULT_SITE_FEATURE_SETTINGS.features, 1)
    expect(updated.revision).toBe(2)
    expect(queryMock).toHaveBeenLastCalledWith(expect.stringContaining('revision = revision + 1'), [
      'global',
      expect.stringContaining('"version":1'),
      expect.any(String),
      1,
    ])
  })

  it('rejects a stale revision without returning saved settings', async () => {
    queryMock.mockResolvedValue({ rows: [] })
    await expect(saveSiteFeatureSettings(DEFAULT_SITE_FEATURE_SETTINGS.features, 3)).rejects.toBeInstanceOf(SettingsConflictError)
  })
})
