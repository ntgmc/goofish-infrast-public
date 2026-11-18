import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSklandConnectorServer } from './skland-connector'
import { fetchSkland, getSklandConnectorConfiguration, isSklandConnectorReady, SklandConnectorError } from './skland-transport'
import { createHypergryphScan, getScanCode, getHypergryphTokenByScanCode, getCredByHypergryphToken, SklandClient, SklandClientError } from './handlers/skland-client'

const TOKEN = 'connector-test-token-with-at-least-32-characters'
const realFetch = globalThis.fetch
let server: Server
let base: string
let upstream: ReturnType<typeof vi.fn<typeof fetch>>

beforeEach(async () => {
  server = createSklandConnectorServer(TOKEN)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  vi.stubEnv('SKLAND_CONNECTOR_URL', base)
  vi.stubEnv('SKLAND_CONNECTOR_TOKEN', TOKEN)
  upstream = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ code: 0, message: 'OK', data: {} }))
  vi.stubGlobal('fetch', vi.fn<typeof fetch>((input, init) => {
    if (String(input).startsWith(base)) return realFetch(input, init)
    return upstream(input, init)
  }))
})

afterEach(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function relay(input: unknown, token = TOKEN) {
  return realFetch(`${base}/request`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
}

const signedRequest = { url: 'https://zonai.skland.com/api/v1/auth/refresh', method: 'GET', headers: { cred: 'user-cred' } }

describe('Skland connector isolation', () => {
  it('requires service authentication before forwarding or probing', async () => {
    expect((await relay(signedRequest, 'wrong-service-token')).status).toBe(401)
    expect((await realFetch(`${base}/health/ready`)).status).toBe(401)
    expect(upstream).not.toHaveBeenCalled()
  })

  it.each([
    { ...signedRequest, url: 'http://127.0.0.1:5432/' },
    { ...signedRequest, url: 'https://zonai.skland.com.evil.example/api/v1/auth/refresh' },
    { ...signedRequest, url: 'https://user:password@zonai.skland.com/api/v1/auth/refresh' },
    { ...signedRequest, url: 'https://zonai.skland.com/api/v1/user/delete' },
    { ...signedRequest, method: 'POST' },
    { ...signedRequest, body: 'GET body' },
    { ...signedRequest, headers: { host: 'evil.example' } },
    { ...signedRequest, headers: { authorization: 'must-not-forward' } },
  ])('rejects destinations, methods and headers outside the integration: %j', async (input) => {
    expect((await relay(input)).status).toBe(400)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('limits the request body and rejects invalid JSON', async () => {
    expect((await relay({ ...signedRequest, body: 'x'.repeat(17 * 1024) })).status).toBe(413)
    const invalid = await realFetch(`${base}/request`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: '{' })
    expect(invalid.status).toBe(400)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('preserves upstream error status and retry information without forwarding cookies', async () => {
    upstream.mockResolvedValue(Response.json({ code: 429, message: 'retry' }, { status: 429, headers: { 'Retry-After': '60', 'Set-Cookie': 'private=value' } }))
    const response = await fetchSkland(signedRequest.url, signedRequest)
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
    expect(response.headers.get('Set-Cookie')).toBeNull()
    await expect(response.json()).resolves.toEqual({ code: 429, message: 'retry' })
    expect(upstream).toHaveBeenCalledWith(signedRequest.url, expect.objectContaining({ redirect: 'error', headers: { cred: 'user-cred' } }))
  })

  it('fails closed on connector authentication failure without invalidating personal credentials', async () => {
    vi.stubEnv('SKLAND_CONNECTOR_TOKEN', 'different-connector-token-with-32-characters')
    await expect(new SklandClient('valid-user-cred').getArknightsBindings()).rejects.toMatchObject({
      code: 'request_failed', publicCode: 'skland_connector_unavailable', httpStatus: 503,
    })
    expect(upstream).not.toHaveBeenCalled()
  })

  it('still identifies a genuine upstream credential failure', async () => {
    upstream.mockImplementation(async () => Response.json({ message: 'invalid credential' }, { status: 401 }))
    await expect(new SklandClient('expired-user-cred').getArknightsBindings()).rejects.toBeInstanceOf(SklandClientError)
    await expect(new SklandClient('expired-user-cred').getArknightsBindings()).rejects.toMatchObject({ code: 'credential_invalid' })
  })

  it('returns a sanitized failure and never retries from the API when upstream access fails', async () => {
    upstream.mockRejectedValue(new Error('private credential details'))
    const response = await relay(signedRequest)
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('private')
    await expect(fetchSkland(signedRequest.url, signedRequest)).rejects.toBeInstanceOf(SklandConnectorError)
    expect(upstream).toHaveBeenCalledTimes(2)
  })
})

describe('Skland login and import transport', () => {
  it('routes every login and data endpoint through the connector with signed headers intact', async () => {
    upstream.mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname
      const data: Record<string, unknown> = {
        '/general/v1/gen_scan/login': { status: 0, msg: 'OK', data: { scanId: 'scan-id' } },
        '/general/v1/scan_status': { status: 0, data: { scanCode: 'scan-code' } },
        '/user/auth/v1/token_by_scan_code': { status: 0, msg: 'OK', data: { token: 'account-token' } },
        '/user/oauth2/v2/grant': { msg: 'OK', data: { code: 'grant-code' } },
        '/api/v1/user/auth/generate_cred_by_code': { message: 'OK', data: { cred: 'user-cred' } },
        '/api/v1/auth/refresh': { code: 0, message: 'OK', data: { token: 'signing-token' } },
        '/api/v1/game/player/binding': { code: 0, message: 'OK', data: { list: [{ appCode: 'arknights', bindingList: [{ uid: '123', nickName: 'test' }] }] } },
      }
      return Response.json(data[path] ?? { code: 0, message: 'OK', data: {} })
    })
    expect((await createHypergryphScan()).scanId).toBe('scan-id')
    expect(await getScanCode('scan-id')).toBe('scan-code')
    expect(await getHypergryphTokenByScanCode('scan-code')).toBe('account-token')
    expect(await getCredByHypergryphToken('account-token')).toBe('user-cred')
    const client = new SklandClient('user-cred')
    expect(await client.getArknightsBindings()).toMatchObject([{ uid: '123' }])
    await client.getGamePlayerInfo('123')
    await client.getCultivatePlayer('123')
    await client.getCultivateInfo()
    await client.getCultivateCharacter('connector-test-character')
    expect(upstream).toHaveBeenCalledTimes(11)
    const paths = upstream.mock.calls.map(([input]) => new URL(String(input)).pathname)
    expect(new Set(paths).size).toBe(11)
    expect(upstream.mock.calls.find(([input]) => String(input).includes('/game/player/info'))?.[1]).toMatchObject({
      headers: { cred: 'user-cred', token: 'signing-token', sign: expect.any(String) }, redirect: 'error',
    })
    const outgoing = vi.mocked(globalThis.fetch).mock.calls.filter(([input]) => String(input).startsWith(base))
    expect(outgoing).toHaveLength(11)
    expect(outgoing.every(([input]) => String(input) === `${base}/request`)).toBe(true)
  })
})

describe('Skland connector readiness', () => {
  it('probes both upstreams without credentials and coalesces cached status requests', async () => {
    const ready = await Promise.all([isSklandConnectorReady(), isSklandConnectorReady()])
    expect(ready).toEqual([true, true])
    expect(upstream).toHaveBeenCalledTimes(2)
    expect(upstream.mock.calls.map(([input]) => input)).toEqual(['https://as.hypergryph.com', 'https://zonai.skland.com'])
    expect(upstream.mock.calls.every(([, init]) => init?.method === 'HEAD' && !init.headers && !init.body)).toBe(true)
    expect(await isSklandConnectorReady()).toBe(true)
    expect(upstream).toHaveBeenCalledTimes(2)
  })

  it.each([429, 503])('reports unavailable when an upstream returns %i', async (status) => {
    upstream.mockResolvedValue(new Response(null, { status }))
    expect(await isSklandConnectorReady()).toBe(false)
  })

  it('reports unavailable on network failure', async () => {
    upstream.mockRejectedValue(new Error('network unavailable'))
    expect(await isSklandConnectorReady()).toBe(false)
  })

  it('allows direct development use but requires a connector in production', () => {
    vi.stubEnv('SKLAND_CONNECTOR_URL', '')
    vi.stubEnv('SKLAND_CONNECTOR_TOKEN', '')
    vi.stubEnv('NODE_ENV', 'development')
    expect(getSklandConnectorConfiguration()).toBeNull()
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => getSklandConnectorConfiguration()).toThrow()
  })

  it.each(['http://remote.example', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?token=secret'])('rejects unsafe connector configuration: %s', (url) => {
    vi.stubEnv('SKLAND_CONNECTOR_URL', url)
    expect(() => getSklandConnectorConfiguration()).toThrow()
  })
})
