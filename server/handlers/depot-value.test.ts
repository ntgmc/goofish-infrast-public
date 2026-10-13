import { afterEach, expect, it, vi } from 'vitest'
import handler from './depot-value'
import { encryptSklandCredential } from './skland-client'

vi.mock('./user-auth', () => ({ requireUserSession: async () => ({ profiles: [{ id: 'profile', status: 'active',
  skland_binding: { uid: 'fixture', encrypted_cred: encryptSklandCredential('fixture-credential') } }] }) }))
vi.mock('../feature-gate', () => ({ requireSiteFeatures: async () => null }))
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

it.each(['credential', 'temporary', 'timeout', 'unknown'])('maps %s failures at the depot boundary', async (mode) => {
  vi.stubEnv('SKLAND_CREDENTIAL_SECRET', 'depot-regression-fixture-secret')
  vi.stubGlobal('fetch', async () => {
    if (mode === 'timeout') throw new DOMException('timeout', 'TimeoutError')
    if (mode === 'unknown') throw new Error('unexpected fixture failure')
    return Response.json({ code: 500, message: 'Service temporarily unavailable' }, { status: mode === 'credential' ? 401 : 200 })
  })
  const response = await handler(new Request('http://localhost/api/depot-value', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'skland', profile_id: 'profile', sample_consent: false }) }))
  expect(response.status).toBe(mode === 'credential' ? 400 : mode === 'unknown' ? 500 : 503)
  expect(await response.json()).toMatchObject(mode === 'unknown' ? { error: 'Internal server error' }
    : { code: mode === 'credential' ? 'skland_credential_invalid' : 'skland_upstream_failed', action: mode === 'credential' ? 'rebind' : 'retry' })
})
