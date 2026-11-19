import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SITE_FEATURE_SETTINGS, computeEffectiveSiteFeatures, MODEL_FEATURES } from '../../src/lib/site-features'
import { DEFAULT_AI_SETTINGS } from '../../src/lib/ai-settings'

const auth = vi.hoisted(() => ({ authenticateAdminRequest: vi.fn() }))
const store = vi.hoisted(() => ({ getSiteFeatureSettings: vi.fn(), saveSiteFeatureSettings: vi.fn() }))
const { routeHandler, getAdminAiSettings } = vi.hoisted(() => ({ routeHandler: vi.fn(), getAdminAiSettings: vi.fn() }))

vi.mock('./admin-auth', () => auth)
vi.mock('../storage/feature-settings-store', () => store)
vi.mock('../storage/ai-settings-store', () => ({ getAdminAiSettings }))
vi.mock('../routes', () => ({ API_ROUTES: [['/api/admin/feature-settings', routeHandler]] }))

import handler from './admin-feature-settings'
import { createApiServer } from '../http-server'
import { SettingsConflictError } from '../storage/settings-conflict'
import siteHandler from './site-features'

describe('admin feature settings handler', () => {
  const settings = { ...DEFAULT_SITE_FEATURE_SETTINGS, revision: 2 }

  beforeEach(() => {
    auth.authenticateAdminRequest.mockReset().mockResolvedValue({ ok: true })
    store.getSiteFeatureSettings.mockReset().mockResolvedValue(settings)
    store.saveSiteFeatureSettings.mockReset().mockResolvedValue({ ...settings, revision: 3 })
    routeHandler.mockReset().mockImplementation(handler)
    getAdminAiSettings.mockReset().mockResolvedValue({ settings: DEFAULT_AI_SETTINGS, has_api_key: false })
  })

  it('reads and writes a complete revisioned feature map', async () => {
    expect((await handler(new Request('http://localhost/api/admin/feature-settings'))).status).toBe(200)
    const response = await handler(jsonRequest({ features: settings.features, expected_revision: 2 }))
    expect(response.status).toBe(200)
    expect(store.saveSiteFeatureSettings).toHaveBeenCalledWith(settings.features, 2, undefined)
  })

  it.each(MODEL_FEATURES)('requires usable AI settings before enabling %s, while allowing closure', async (feature) => {
    const features = { ...settings.features, [feature]: true }
    expect((await handler(jsonRequest({ features, expected_revision: 2 }))).status).toBe(400)
    expect(store.saveSiteFeatureSettings).not.toHaveBeenCalled()
    getAdminAiSettings.mockResolvedValueOnce({ settings: { ...DEFAULT_AI_SETTINGS, provider: '测试', model: 'chat', baseURL: 'https://example.test/v1', inputPrice: 1, outputPrice: 2 }, has_api_key: true })
    expect((await handler(jsonRequest({ features, expected_revision: 2 }))).status).toBe(200)
    expect((await handler(jsonRequest({ features: settings.features, expected_revision: 2 }))).status).toBe(200)
  })

  it('publishes a saved V1 switch without disabling V2 or shared scheduling capabilities', async () => {
    const saved = { ...settings, features: { ...settings.features, v1: false }, revision: 3 }
    store.saveSiteFeatureSettings.mockResolvedValueOnce(saved)
    expect((await handler(jsonRequest({ features: saved.features, expected_revision: 2 }))).status).toBe(200)
    expect(store.saveSiteFeatureSettings).toHaveBeenCalledWith(saved.features, 2, undefined)
    store.getSiteFeatureSettings.mockResolvedValueOnce(saved)
    const response = await siteHandler(new Request('http://localhost/api/site/features'))
    await expect(response.json()).resolves.toMatchObject({ features: { v1: false, v2: true, profiles: true, schedule_generation: true } })
  })

  it('validates pause text and publishes it only when the feature could otherwise open', async () => {
    const features = { ...settings.features, schedule_comparison: false }
    for (const pause_notices of [{ tools: '维护' }, { schedule_comparison: ' ' }, { schedule_comparison: 'x'.repeat(281) }, { material_demand: '维护' }]) {
      expect((await handler(jsonRequest({ features, pause_notices, expected_revision: 2 }))).status).toBe(400)
    }
    expect(store.saveSiteFeatureSettings).not.toHaveBeenCalled()
    const pause_notices = { schedule_comparison: '正在维护' }
    expect((await handler(jsonRequest({ features, pause_notices: { schedule_comparison: ' 正在维护 ' }, expected_revision: 2 }))).status).toBe(200)
    expect(store.saveSiteFeatureSettings).toHaveBeenCalledWith(features, 2, pause_notices)
    const saved = { ...settings, features, pause_notices }
    store.getSiteFeatureSettings.mockResolvedValueOnce(saved)
    const req = new Request('http://localhost/api/site/features')
    expect(await (await siteHandler(req)).json()).toMatchObject({ features: { schedule_comparison: false }, pause_notices })
    store.getSiteFeatureSettings.mockResolvedValueOnce({ ...saved, features: { ...features, tools: false } })
    expect(await (await siteHandler(req)).json()).not.toHaveProperty('pause_notices')
  })

  it('does not expose the management revision through the public endpoint', async () => {
    const response = await siteHandler(new Request('http://localhost/api/site/features'))
    const body = await response.json()
    expect(body).toMatchObject({
      version: 1,
      features: computeEffectiveSiteFeatures(settings),
      updated_at: settings.updated_at,
    })
    expect(body).not.toHaveProperty('revision')
  })

  it('rejects invalid input with stable issues', async () => {
    const response = await handler(jsonRequest({ features: settings.features }))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ code: 'invalid_request', issues: expect.any(Array) })
  })

  it('maps conflicts but propagates unexpected store failures', async () => {
    store.saveSiteFeatureSettings.mockRejectedValueOnce(new SettingsConflictError())
    const conflict = await handler(jsonRequest({ features: settings.features, expected_revision: 2 }))
    expect(conflict.status).toBe(409)
    await expect(conflict.json()).resolves.toMatchObject({ code: 'settings_conflict' })

    store.saveSiteFeatureSettings.mockRejectedValueOnce(new Error('database host leaked'))
    await expect(handler(jsonRequest({ features: settings.features, expected_revision: 2 }))).rejects.toThrow('database host leaked')
  })

  it('wraps unexpected store failures at the HTTP server boundary without leaking details', async () => {
    const server = createApiServer()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      store.saveSiteFeatureSettings.mockRejectedValueOnce(new Error('postgres://secret-host database host leaked'))
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Test HTTP server did not expose a TCP address')
      const response = await fetch(`http://127.0.0.1:${address.port}/api/admin/feature-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Connection: 'close' },
        body: JSON.stringify({ features: settings.features, expected_revision: 2 }),
      })
      const responseText = await response.text()
      expect(response.status).toBe(500)
      expect(JSON.parse(responseText)).toMatchObject({
        error: 'Internal server error.',
        code: 'internal_error',
      })
      expect(responseText).not.toContain('secret-host')
      expect(responseText).not.toContain('database host leaked')
    } finally {
      consoleError.mockRestore()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })

  it('keeps effective feature dependencies in the response', async () => {
    const response = await handler(jsonRequest({ features: settings.features, expected_revision: 2 }))
    await expect(response.json()).resolves.toMatchObject({ effective_features: computeEffectiveSiteFeatures(settings) })
  })
})

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/admin/feature-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
