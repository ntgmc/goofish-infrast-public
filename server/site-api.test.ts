import { once } from 'node:events'
import { request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SITE_FEATURE_SETTINGS, computeEffectiveSiteFeatures } from '../src/lib/site-features'
import { cloneDefaultPublicContentSettings } from '../src/lib/public-content'

const stores = vi.hoisted(() => ({ getSiteFeatureSettings: vi.fn(), getPublicContentSettings: vi.fn() }))
vi.mock('./storage/feature-settings-store', () => ({ getSiteFeatureSettings: stores.getSiteFeatureSettings }))
vi.mock('./storage/public-content-settings-store', () => ({
  getPublicContentSettings: stores.getPublicContentSettings,
}))
vi.mock('./routes', async (original) => {
  const routes = await original<typeof import('./routes')>()
  return { ...routes, routeRequest: vi.fn(routes.routeRequest) }
})

import { createApiServer } from './http-server'
import { routeRequest } from './routes'
import { flushPerformanceDurations } from './performance-observation'

const server = createApiServer()
let port: number
beforeAll(async () => {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  port = (server.address() as AddressInfo).port
})
beforeEach(() => {
  stores.getSiteFeatureSettings.mockResolvedValue({ ...DEFAULT_SITE_FEATURE_SETTINGS, revision: 4 })
  stores.getPublicContentSettings.mockResolvedValue({ ...cloneDefaultPublicContentSettings(), revision: 7 })
})
afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})
afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
})

describe('Fastify public site routes through the real HTTP server', () => {
  it.each(['/api/site/features', '/api/site/public-content'])(
    'serves %s with the existing public response and security headers',
    async (path) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`)
      expect(response.status).toBe(200)
      expect(response.headers.get('X-Request-ID')).toBeTruthy()
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
      expect(response.headers.get('Content-Type')).toContain('application/json')
      const body = await response.json()
      expect(body).toEqual(
        path.endsWith('features')
          ? {
              version: 1,
              features: computeEffectiveSiteFeatures(DEFAULT_SITE_FEATURE_SETTINGS),
              updated_at: DEFAULT_SITE_FEATURE_SETTINGS.updated_at,
            }
          : cloneDefaultPublicContentSettings(),
      )
      expect(body).not.toHaveProperty('revision')
      expect(routeRequest).toHaveBeenCalledOnce()
    },
  )

  it.each([
    ['/api/site/features', stores.getSiteFeatureSettings, 'feature_settings_unavailable'],
    ['/api/site/public-content', stores.getPublicContentSettings, 'public_content_unavailable'],
  ] as const)('preserves the 503 response and observations for unavailable %s', async (path, store, code) => {
    const events: Array<Record<string, unknown>> = []
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(console, 'info').mockImplementation((line: string) => {
      events.push(JSON.parse(line))
    })
    flushPerformanceDurations()
    events.length = 0
    store.mockRejectedValueOnce(new Error('private database details'))
    const response = await fetch(`http://127.0.0.1:${port}${path}`)
    expect(response.status).toBe(503)
    const text = await response.text()
    expect(JSON.parse(text)).toMatchObject({ code })
    expect(text).not.toContain('private database details')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'http.request',
        route: path,
        status: 503,
        request_id: response.headers.get('X-Request-ID'),
      }),
    )
    expect(routeRequest).toHaveBeenCalledOnce()
  })

  it.each([
    { path: '/api/site/features?unknown=value', method: 'GET', status: 400 },
    { path: '/api/site/public-content', method: 'POST', status: 405 },
    { path: '/api/site/features', method: 'HEAD', status: 405 },
    { path: '/api/site/features/', method: 'GET', status: 404 },
  ])('retains the HTTP boundary for $method $path', async ({ path, method, status }) => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method })
    expect(response.status).toBe(status)
    await response.arrayBuffer()
    expect(response.headers.get('X-Request-ID')).toBeTruthy()
    expect(stores.getSiteFeatureSettings).not.toHaveBeenCalled()
    expect(stores.getPublicContentSettings).not.toHaveBeenCalled()
    expect(routeRequest).not.toHaveBeenCalled()
  })

  it('uses the same URL normalization as the existing HTTP boundary', async () => {
    const response = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
      const request = httpRequest({ host: '127.0.0.1', port, path: '/api/unused/../site/features' }, (incoming) => {
        let body = ''
        incoming.setEncoding('utf8')
        incoming.on('data', (chunk: string) => {
          body += chunk
        })
        incoming.on('end', () => resolve({ status: incoming.statusCode, body }))
        incoming.on('error', reject)
      })
      request.on('error', reject)
      request.end()
    })
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toHaveProperty('features')
    expect(routeRequest).toHaveBeenCalledOnce()
  })

  it('keeps production host validation ahead of Fastify', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('PUBLIC_APP_URL', 'https://app.example.test')
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const response = await fetch(`http://127.0.0.1:${port}/api/site/features`)
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ code: 'invalid_request' })
    expect(stores.getSiteFeatureSettings).not.toHaveBeenCalled()
  })

  it('serves health routes through the same Fastify lifecycle', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/health/live`)
    await expect(response.json()).resolves.toMatchObject({ ok: true })
    expect(routeRequest).toHaveBeenCalledOnce()
    expect(stores.getSiteFeatureSettings).not.toHaveBeenCalled()
    expect(stores.getPublicContentSettings).not.toHaveBeenCalled()
  })
})
