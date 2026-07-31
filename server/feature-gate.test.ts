import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SITE_FEATURE_SETTINGS } from '../src/lib/site-features'

const { getSiteFeatureSettings } = vi.hoisted(() => ({ getSiteFeatureSettings: vi.fn() }))
vi.mock('./storage/feature-settings-store', () => ({ getSiteFeatureSettings }))

import { enforceFeatureGate, requireMeteredBillingFeature, requireSiteFeatures } from './feature-gate'

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

  it('applies the metered billing switch only to metered profile admissions', async () => {
    getSiteFeatureSettings.mockResolvedValue(settingsWith({ metered_billing: false }))

    const personal = await requireMeteredBillingFeature('metered_personal')
    await expect(personal?.json()).resolves.toMatchObject({
      code: 'feature_disabled',
      feature: 'metered_billing',
    })
    expect((await requireMeteredBillingFeature('metered_commercial'))?.status).toBe(503)
    await expect(requireMeteredBillingFeature('cdk')).resolves.toBeNull()

    getSiteFeatureSettings.mockResolvedValue(settingsWith({ metered_billing: true }))
    await expect(requireMeteredBillingFeature('metered_personal')).resolves.toBeNull()
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

  it('uses the existing CDK and inventory feature switches for voucher flows', async () => {
    getSiteFeatureSettings.mockResolvedValue(settingsWith({ cdk_redemption: false }))
    const redeem = await enforceFeatureGate(new Request('http://localhost/api/user/cdk/redeem', { method: 'POST' }))
    await expect(redeem?.json()).resolves.toMatchObject({ feature: 'cdk_redemption' })

    getSiteFeatureSettings.mockResolvedValue(settingsWith({ inventory: false }))
    const bind = await enforceFeatureGate(new Request('http://localhost/api/user/skland/lifetime-voucher/login/start', { method: 'POST' }))
    await expect(bind?.json()).resolves.toMatchObject({ feature: 'inventory' })
  })

  it('keeps personal notifications independent from announcements and inventory', async () => {
    getSiteFeatureSettings.mockResolvedValue(settingsWith({ announcements: false, inventory: false }))
    await expect(enforceFeatureGate(new Request('http://localhost/api/user/notifications'))).resolves.toBeNull()
    expect((await enforceFeatureGate(new Request('http://localhost/api/user/announcements')))?.status).toBe(503)

    getSiteFeatureSettings.mockResolvedValue(settingsWith({ login: false }))
    const gated = await enforceFeatureGate(new Request('http://localhost/api/user/notifications'))
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
