import { afterEach, describe, expect, it } from 'vitest'
import { setServiceLifecycleStateForTesting } from './lifecycle'
import { routeRequest } from './routes'
import { resetRuntimeDatabaseSchemaStateForTesting } from './storage/schema'

afterEach(() => {
  setServiceLifecycleStateForTesting('ready')
  resetRuntimeDatabaseSchemaStateForTesting()
})

describe('service health lifecycle', () => {
  it('keeps liveness healthy while draining', async () => {
    setServiceLifecycleStateForTesting('draining')
    const response = await routeRequest(new Request('http://localhost/api/health/live'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true, state: 'draining' })
  })

  it('marks legacy and explicit readiness unhealthy while draining', async () => {
    setServiceLifecycleStateForTesting('draining')
    for (const path of ['/api/health', '/api/health/ready']) {
      const response = await routeRequest(new Request(`http://localhost${path}`))
      expect(response.status).toBe(503)
      await expect(response.json()).resolves.toMatchObject({ ok: false, state: 'draining' })
    }
  })

  it('rejects new optimization admissions while draining', async () => {
    setServiceLifecycleStateForTesting('draining')
    const response = await routeRequest(new Request('http://localhost/api/optimization/jobs', { method: 'POST' }))

    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('60')
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'service_draining' },
    })
  })

  it('does not report ready without a validated runtime schema identity', async () => {
    setServiceLifecycleStateForTesting('ready')
    const response = await routeRequest(new Request('http://localhost/api/health/ready'))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      storage: { ok: false, schema: { ok: false } },
    })
  })
})
