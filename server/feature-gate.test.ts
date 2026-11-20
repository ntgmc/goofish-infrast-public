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

  it('blocks new AI calls while keeping saved explanations and administrator configuration readable', async () => {
    const post = () => enforceFeatureGate(new Request('http://localhost/api/user/schedule-explanation', { method: 'POST' }))
    await expect((await post())?.json()).resolves.toMatchObject({ feature: 'ai_schedule_explanation' })
    await expect(enforceFeatureGate(new Request('http://localhost/api/user/schedule-explanation'))).resolves.toBeNull()
    await expect(enforceFeatureGate(new Request('http://localhost/api/admin/ai-settings'))).resolves.toBeNull()
    getSiteFeatureSettings.mockResolvedValue(settingsWith({ ai_schedule_explanation: true }))
    await expect(post()).resolves.toBeNull()
    getSiteFeatureSettings.mockResolvedValue(settingsWith({ ai_schedule_explanation: true, v2: false }))
    expect((await post())?.status).toBe(503)
  })

  it('rejects retired metered admissions even with a stored enabled switch', async () => {
    getSiteFeatureSettings.mockResolvedValue(settingsWith({ metered_billing: false }))

    const personal = await requireMeteredBillingFeature('metered_personal')
    await expect(personal?.json()).resolves.toMatchObject({
      code: 'feature_disabled',
      feature: 'metered_billing',
    })
    expect((await requireMeteredBillingFeature('metered_commercial'))?.status).toBe(503)
    await expect(requireMeteredBillingFeature('cdk')).resolves.toBeNull()

    getSiteFeatureSettings.mockResolvedValue(settingsWith({ metered_billing: true }))
    expect((await requireMeteredBillingFeature('metered_personal'))?.status).toBe(503)
    await expect(requireMeteredBillingFeature('cdk')).resolves.toBeNull()
    await expect(requireMeteredBillingFeature('free_preview')).resolves.toBeNull()
  })

  it.each([
    ['/api/user/profiles/metered-personal', 'POST'],
    ['/api/user/commercial/profiles', 'GET'],
    ['/api/user/billing/quote', 'POST'],
    ['/api/admin/commercial', 'GET'],
    ['/api/admin/commercial', 'PUT'],
  ])('keeps the retired billing endpoint closed: %s %s', async (path, method) => {
    getSiteFeatureSettings.mockResolvedValue(settingsWith({ metered_billing: true }))
    const response = await enforceFeatureGate(new Request(`http://localhost${path}`, { method }))
    expect(response?.status).toBe(503)
    await expect(response?.json()).resolves.toMatchObject({ code: 'feature_disabled', feature: 'metered_billing' })
  })

  it.each([
    ['/api/user/balance', 'GET'], ['/api/user/balance/redeem', 'POST'],
    ['/api/admin/balance', 'GET'], ['/api/admin/balance', 'POST'],
  ])('gates AI credits independently of scheduling: %s %s', async (path, method) => {
    const request = new Request(`http://localhost${path}`, { method })
    await expect((await enforceFeatureGate(request))?.json()).resolves.toMatchObject({ feature: 'ai_credits' })
    getSiteFeatureSettings.mockResolvedValue(settingsWith({ ai_credits: true, schedule_generation: false, metered_billing: false }))
    await expect(enforceFeatureGate(request)).resolves.toBeNull()
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

  it('keeps announcement and release events available when personal QQ features are closed', async () => {
    getSiteFeatureSettings.mockResolvedValue(settingsWith({
      site: false, login: false, announcements: false, changelog: false, notifications: false, qqbot: false,
    }))
    await expect(enforceFeatureGate(new Request('http://localhost/api/integrations/qqbot/events?cursor=101'))).resolves.toBeNull()

    getSiteFeatureSettings.mockResolvedValue(settingsWith({ qqbot: false }))
    for (const path of [
      '/api/user/qqbot', '/api/user/qqbot/verification', '/api/integrations/qqbot/binding',
      '/api/integrations/qqbot/notifications', '/api/integrations/qqbot/notifications/ack',
    ]) {
      const response = await enforceFeatureGate(new Request(`http://localhost${path}`))
      expect(response?.status).toBe(503)
      await expect(response?.json()).resolves.toMatchObject({ feature: 'qqbot' })
    }
  })

  it('closes the event feed without disabling personal QQ or public content', async () => {
    getSiteFeatureSettings.mockResolvedValue(settingsWith({ website_events: false }))
    const response = await enforceFeatureGate(new Request('http://localhost/api/integrations/qqbot/events?cursor=latest'))
    expect(response?.status).toBe(503)
    await expect(response?.json()).resolves.toMatchObject({ code: 'feature_disabled', feature: 'website_events' })
    for (const path of ['/api/user/qqbot', '/api/integrations/qqbot/notifications', '/api/announcement', '/api/changelog']) {
      await expect(enforceFeatureGate(new Request(`http://localhost${path}`))).resolves.toBeNull()
    }
  })

  it('fails closed when settings cannot be read and lets preflight pass', async () => {
    getSiteFeatureSettings.mockRejectedValue(new Error('database unavailable'))
    const response = await enforceFeatureGate(new Request('http://localhost/api/auth/login', { method: 'POST' }))
    expect(response?.status).toBe(503)
    await expect(response?.json()).resolves.toMatchObject({ code: 'feature_settings_unavailable' })
    expect((await enforceFeatureGate(new Request('http://localhost/api/integrations/qqbot/events?cursor=latest')))?.status).toBe(503)
    await expect(enforceFeatureGate(new Request('http://localhost/api/auth/login', { method: 'OPTIONS' }))).resolves.toBeNull()
    await expect(enforceFeatureGate(new Request('http://localhost/api/integrations/qqbot/events', { method: 'OPTIONS' }))).resolves.toBeNull()
  })

  it.each([
    ['tools', '/api/cultivation-plan', 'POST'],
    ['skland', '/api/cultivation-plan', 'POST'],
    ['service_status', '/api/status', 'GET'],
    ['changelog', '/api/changelog', 'GET'],
    ['notifications', '/api/user/notifications', 'GET'],
    ['qqbot', '/api/user/qqbot', 'POST'],
    ['qqbot', '/api/integrations/qqbot/binding', 'POST'],
    ['maa_export', '/api/user/maa-export', 'POST'],
    ['full_result_export', '/api/user/full-result-export', 'POST'],
    ['inventory', '/api/user/inventory/lifetime-profile', 'POST'],
  ] as const)('blocks %s at its API boundary without closing unrelated features', async (feature, path, method) => {
    getSiteFeatureSettings.mockResolvedValue(settingsWith({ [feature]: false }))
    const response = await enforceFeatureGate(new Request(`http://localhost${path}`, { method }))
    expect(response?.status).toBe(503)
    await expect(response?.json()).resolves.toMatchObject({ code: 'feature_disabled', feature })
    await expect(enforceFeatureGate(new Request('http://localhost/api/user/results'))).resolves.toBeNull()
    await expect(enforceFeatureGate(new Request('http://localhost/api/admin/feature-settings'))).resolves.toBeNull()
  })
})

function settingsWith(patch: Partial<typeof DEFAULT_SITE_FEATURE_SETTINGS.features>) {
  return {
    ...DEFAULT_SITE_FEATURE_SETTINGS,
    features: { ...DEFAULT_SITE_FEATURE_SETTINGS.features, ...patch },
  }
}
