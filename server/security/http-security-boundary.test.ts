import type { IncomingMessage } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveClientIp, resolveTrustedProxyAddresses } from './client-ip'
import { inspectIncomingRequest } from './http-boundary'
import { applyHttpSecurityHeaders } from './http-security'

const originalNodeEnv = process.env.NODE_ENV
const originalPublicAppUrl = process.env.PUBLIC_APP_URL

afterEach(() => {
  restoreEnvironment('NODE_ENV', originalNodeEnv)
  restoreEnvironment('PUBLIC_APP_URL', originalPublicAppUrl)
})

describe('HTTP security boundary', () => {
  it('trusts forwarded client IP only from explicitly configured production proxies', () => {
    expect(resolveClientIp('127.0.0.1', '203.0.113.8', { NODE_ENV: 'production' })).toBe('127.0.0.1')
    expect(resolveClientIp('::ffff:127.0.0.1', '203.0.113.8', {
      NODE_ENV: 'production',
      TRUSTED_PROXY_ADDRESSES: '127.0.0.1,::1',
    })).toBe('203.0.113.8')
    expect(() => resolveTrustedProxyAddresses({ TRUSTED_PROXY_ADDRESSES: '127.0.0.1,not-an-ip' }))
      .toThrow('TRUSTED_PROXY_ADDRESSES must be a comma-separated list of IP addresses')
  })

  it('rejects a syntactically valid but unconfigured production Host', async () => {
    process.env.NODE_ENV = 'production'
    process.env.PUBLIC_APP_URL = 'https://app.example.test'

    const decision = inspectIncomingRequest(incomingGet('/api/health/live', 'evil.example.test'))
    expect(decision.allowed).toBe(false)
    if (!decision.allowed) {
      expect(decision.response.status).toBe(400)
      await expect(decision.response.json()).resolves.toMatchObject({ code: 'invalid_request' })
    }
    expect(inspectIncomingRequest(incomingGet('/api/health/live', 'app.example.test')).allowed).toBe(true)
  })

  it('ships a strict-style report-only policy during inline-style migration', () => {
    const response = applyHttpSecurityHeaders(new Response('ok'), true)

    expect(response.headers.get('Content-Security-Policy')).toContain("style-src 'self' 'unsafe-inline'")
    expect(response.headers.get('Content-Security-Policy-Report-Only')).toContain("style-src 'self'")
    expect(response.headers.get('Content-Security-Policy-Report-Only')).not.toContain("style-src 'self' 'unsafe-inline'")
    expect(response.headers.get('Strict-Transport-Security')).toContain('max-age=31536000')
  })
})

function incomingGet(target: string, host: string): IncomingMessage {
  return {
    method: 'GET',
    url: target,
    headers: { host },
    rawHeaders: ['Host', host],
  } as IncomingMessage
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
