import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { CONFIG_PRESETS } from '../src/lib/config'
import { createApiServer } from './http-server'
import { setServiceLifecycleStateForTesting } from './lifecycle'
import { resetRuntimeDatabaseSchemaStateForTesting } from './storage/schema'

const { readFeatures } = vi.hoisted(() => ({ readFeatures: vi.fn() }))
vi.mock('./storage/feature-settings-store', () => ({ getSiteFeatureSettings: readFeatures }))

const server = createApiServer()
let baseUrl: string
beforeAll(async () => {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterEach(() => {
  setServiceLifecycleStateForTesting('ready')
  resetRuntimeDatabaseSchemaStateForTesting()
  vi.clearAllMocks()
})
afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
})

describe('service health lifecycle through Fastify', () => {
  it('keeps liveness healthy while draining without reading feature settings', async () => {
    setServiceLifecycleStateForTesting('draining')
    const response = await fetch(`${baseUrl}/api/health/live`)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true, state: 'draining' })
    expect(readFeatures).not.toHaveBeenCalled()
  })

  it('marks legacy and explicit readiness unhealthy while draining', async () => {
    setServiceLifecycleStateForTesting('draining')
    for (const path of ['/api/health', '/api/health/ready']) {
      const response = await fetch(baseUrl + path)
      expect(response.status).toBe(503)
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        state: 'draining',
        build_meta: { frontend_version: expect.any(String), backend_version: expect.any(String) },
      })
    }
    expect(readFeatures).not.toHaveBeenCalled()
  })

  it('rejects new optimization admissions while draining before reading feature settings', async () => {
    setServiceLifecycleStateForTesting('draining')
    const response = await fetch(`${baseUrl}/api/optimization/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'schedule',
        identity: { type: 'profile', profileId: 'profile-1' },
        operators: [{ id: 'char_002_amiya', name: '阿米娅', own: true, elite: 2, rarity: 5 }],
        config: CONFIG_PRESETS['243'],
        includeUpgradeSuggestions: false,
      }),
    })
    const body = await response.json()
    expect(response.status, JSON.stringify(body)).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(body).toMatchObject({ error: { code: 'service_draining' } })
    expect(readFeatures).not.toHaveBeenCalled()
  })

  it('does not report ready without a validated runtime schema identity', async () => {
    setServiceLifecycleStateForTesting('ready')
    const response = await fetch(`${baseUrl}/api/health/ready`)
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      storage: { ok: false, schema: { ok: false } },
    })
    expect(readFeatures).not.toHaveBeenCalled()
  })
})
