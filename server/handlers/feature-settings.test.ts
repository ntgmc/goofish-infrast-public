import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SITE_FEATURE_SETTINGS, computeEffectiveSiteFeatures } from '../../src/lib/site-features'

const auth = vi.hoisted(() => ({ authenticateAdminRequest: vi.fn() }))
const store = vi.hoisted(() => ({ getSiteFeatureSettings: vi.fn(), saveSiteFeatureSettings: vi.fn() }))
const routes = vi.hoisted(() => ({ routeRequest: vi.fn() }))

vi.mock('./admin-auth', () => auth)
vi.mock('../storage/feature-settings-store', () => store)
vi.mock('../routes', () => routes)

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
    routes.routeRequest.mockReset().mockImplementation(handler)
  })

  it('reads and writes a complete revisioned feature map', async () => {
    expect((await handler(new Request('http://localhost/api/admin/feature-settings'))).status).toBe(200)
    const response = await handler(jsonRequest({ features: settings.features, expected_revision: 2 }))
    expect(response.status).toBe(200)
    expect(store.saveSiteFeatureSettings).toHaveBeenCalledWith(settings.features, 2)
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
