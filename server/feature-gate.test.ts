import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SITE_FEATURE_SETTINGS } from '../src/lib/site-features'

const { getSiteFeatureSettings } = vi.hoisted(() => ({ getSiteFeatureSettings: vi.fn() }))
vi.mock('./storage/feature-settings-store', () => ({ getSiteFeatureSettings }))

import { enforceFeatureGate, requireSiteFeatures } from './feature-gate'

describe('feature gate', () => {
  beforeEach(() => {
    getSiteFeatureSettings.mockResolvedValue(settingsWith({}))
  })

  it('blocks new schedule admissions but keeps history and cancellation routes available', async () => {
    getSiteFeatureSettings.mockResolvedValue(settingsWith({ schedule_generation: false }))
    const admission = await enforceFeatureGate(new Request('http://localhost/api/optimization/jobs', { method: 'POST' }))
    expect(admission?.status).toBe(503)
    await expect(admission?.json()).resolves.toMatchObject({ code: 'feature_disabled', feature: 'schedule_generation' })

    await expect(enforceFeatureGate(new Request('http://localhost/api/optimization/jobs'))).resolves.toBeNull()
    await expect(enforceFeatureGate(new Request('http://localhost/api/optimization/jobs/job-1/cancel', { method: 'POST' }))).resolves.toBeNull()
  })

  it('blocks ordinary sessions while keeping recovery, logout, privacy and admin routes open', async () => {
    getSiteFeatureSettings.mockResolvedValue(settingsWith({ login: false }))
    expect((await enforceFeatureGate(new Request('http://localhost/api/auth/me')))?.status).toBe(503)
    expect((await enforceFeatureGate(new Request('http://localhost/api/user/profiles')))?.status).toBe(503)
    for (const [path, method] of [
      ['/api/auth/logout', 'POST'],
      ['/api/auth/forgot-password', 'POST'],
      ['/api/user/data/export', 'GET'],
      ['/api/user/data/delete-request', 'POST'],
      ['/api/admin/feature-settings', 'GET'],
    ]) {
      await expect(enforceFeatureGate(new Request(`http://localhost${path}`, { method }))).resolves.toBeNull()
    }
  })

  it('keeps anonymous depot upload independent while requiring session features for skland mode', async () => {
    getSiteFeatureSettings.mockResolvedValue(settingsWith({ login: false }))
    await expect(enforceFeatureGate(new Request('http://localhost/api/depot-value', { method: 'POST' }))).resolves.toBeNull()
    const gated = await requireSiteFeatures(['login', 'profiles', 'skland'])
    await expect(gated?.json()).resolves.toMatchObject({ feature: 'login' })
  })

  it('fails closed when settings cannot be read and lets preflight pass', async () => {
    getSiteFeatureSettings.mockRejectedValue(new Error('database unavailable'))
    const response = await enforceFeatureGate(new Request('http://localhost/api/auth/login', { method: 'POST' }))
    expect(response?.status).toBe(503)
    await expect(response?.json()).resolves.toMatchObject({ code: 'feature_settings_unavailable' })
    await expect(enforceFeatureGate(new Request('http://localhost/api/auth/login', { method: 'OPTIONS' }))).resolves.toBeNull()
  })
})

function settingsWith(patch: Partial<typeof DEFAULT_SITE_FEATURE_SETTINGS.features>) {
  return {
    ...DEFAULT_SITE_FEATURE_SETTINGS,
    features: { ...DEFAULT_SITE_FEATURE_SETTINGS.features, ...patch },
  }
}
