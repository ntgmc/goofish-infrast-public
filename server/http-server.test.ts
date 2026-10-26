import { once } from 'node:events'
import { createConnection, Socket, type AddressInfo } from 'node:net'
import { IncomingMessage, ServerResponse } from 'node:http'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./routes', () => ({ routeRequest: vi.fn(async () => new Response('ok')) }))

import { createApiServer } from './http-server'
import { routeRequest } from './routes'
import { getPerformanceContext } from './performance-observation'
import { observeHttpRequest } from './http-observation'

const server = createApiServer()
let port: number
beforeAll(async () => {
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  port = (server.address() as AddressInfo).port
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})
afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
})

describe('API HTTP request lifecycle', () => {
  it.each(['100-continue', 'unsupported'])('rejects Expect: %s before accepting a body', async (expectation) => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('PUBLIC_APP_URL', 'https://app.example.test')
    const response = await rawRequest([
      'POST /api/auth/login HTTP/1.1',
      'Host: app.example.test',
      `Expect: ${expectation}`,
      'Content-Type: application/json',
      'Content-Length: 2',
      '', '',
    ].join('\r\n'))

    expect(response).toMatch(/^HTTP\/1\.1 417 /)
    expect(response).not.toContain('100 Continue')
    expect(response).toMatch(/X-Request-ID: /i)
    expect(response).toMatch(/Cache-Control: no-store/i)
    expect(response).toMatch(/X-Content-Type-Options: nosniff/i)
    expect(response).toContain('"code":"expectation_failed"')
    expect(routeRequest).not.toHaveBeenCalled()
  })

  it('routes ordinary requests through the same response path', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/health/live`)
    expect(response.status).toBe(200)
    expect(response.headers.get('X-Request-ID')).toBeTruthy()
    await expect(response.text()).resolves.toBe('ok')
    expect(routeRequest).toHaveBeenCalledOnce()
  })

  it('correlates concurrent requests and logs route templates without query values or result IDs', async () => {
    const events: Array<Record<string, unknown>> = []
    vi.spyOn(console, 'info').mockImplementation((line: string) => { events.push(JSON.parse(line)) })
    const observed: string[] = []
    const handler = async () => {
      await new Promise<void>((resolve) => setImmediate(resolve))
      observed.push(getPerformanceContext().request_id!)
      return new Response('ok')
    }
    vi.mocked(routeRequest).mockImplementationOnce(handler).mockImplementationOnce(handler)
    const responses = await Promise.all([
      fetch(`http://127.0.0.1:${port}/api/health/live`),
      fetch(`http://127.0.0.1:${port}/api/user/results/private-result?profile_id=secret-marker`),
    ])
    await Promise.all(responses.map((response) => response.text()))
    const ids = responses.map((response) => response.headers.get('X-Request-ID')).sort()
    expect(observed.sort()).toEqual(ids)
    expect(events.map((event) => event.request_id).sort()).toEqual(ids)
    expect(events).toContainEqual(expect.objectContaining({ route: '/api/user/results/:resultId', outcome: 'completed', status: 200 }))
    expect(JSON.stringify(events)).not.toMatch(/private-result|secret-marker/)
  })

  it('counts an aborted response once even when multiple lifecycle events arrive', () => {
    const events: Array<Record<string, unknown>> = []
    vi.spyOn(console, 'info').mockImplementation((line: string) => { events.push(JSON.parse(line)) })
    const request = new IncomingMessage(new Socket())
    request.method = 'GET'
    request.url = '/unknown-private-path?token=secret-marker'
    const response = new ServerResponse(request)
    observeHttpRequest(request, response, 'aborted-request')
    response.emit('close')
    response.emit('finish')
    response.emit('close')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ request_id: 'aborted-request', route: 'unmatched', status: null, outcome: 'aborted' })
    expect(JSON.stringify(events)).not.toMatch(/unknown-private-path|secret-marker/)
    expect(response.listenerCount('finish')).toBe(0)
    expect(response.listenerCount('close')).toBe(0)
    request.destroy()
  })
})

function rawRequest(request: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    let response = ''
    socket.setEncoding('utf8')
    socket.setTimeout(2_000, () => socket.destroy(new Error('HTTP response timed out')))
    socket.on('connect', () => socket.write(request))
    socket.on('data', (chunk) => { response += chunk })
    socket.on('end', () => resolve(response))
    socket.on('error', reject)
  })
}
