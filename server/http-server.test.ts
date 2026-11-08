import { once } from 'node:events'
import { createConnection, Socket, type AddressInfo } from 'node:net'
import { get as httpGet, IncomingMessage, ServerResponse } from 'node:http'
import { performance } from 'node:perf_hooks'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const { routeHandler } = vi.hoisted(() => ({ routeHandler: vi.fn(async (_request: Request) => new Response('ok')) }))
vi.mock('./routes', () => ({
  API_ROUTES: [
    ['/api/health/live', routeHandler, false],
    ['/api/auth/login', routeHandler],
    ['/api/user/results/:resultId', routeHandler],
    ['/api/optimization/jobs/:jobId', routeHandler],
  ],
}))
vi.mock('./feature-gate', () => ({ enforceFeatureGate: vi.fn(async () => null) }))

import { createApiServer } from './http-server'
import { flushPerformanceDurations, getPerformanceContext } from './performance-observation'
import { observeHttpRequest } from './http-observation'
import { getValidatedJsonRecord } from './security/request-validation'

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
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
})

describe('API HTTP request lifecycle', () => {
  it.each(['100-continue', 'unsupported'])('rejects Expect: %s before accepting a body', async (expectation) => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('PUBLIC_APP_URL', 'https://app.example.test')
    const response = await rawRequest(
      [
        'POST /api/auth/login HTTP/1.1',
        'Host: app.example.test',
        `Expect: ${expectation}`,
        'Content-Type: application/json',
        'Content-Length: 2',
        '',
        '',
      ].join('\r\n'),
    )

    expect(response).toMatch(/^HTTP\/1\.1 417 /)
    expect(response).not.toContain('100 Continue')
    expect(response).toMatch(/X-Request-ID: /i)
    expect(response).toMatch(/Cache-Control: no-store/i)
    expect(response).toMatch(/X-Content-Type-Options: nosniff/i)
    expect(response).toContain('"code":"expectation_failed"')
    expect(routeHandler).not.toHaveBeenCalled()
  })

  it('delivers validated POST data and separate session cookies through Fastify', async () => {
    const payload = { email: 'user@example.test', password: 'example-password' }
    vi.mocked(routeHandler).mockImplementationOnce(async (request) => {
      expect(await getValidatedJsonRecord(request)).toEqual(payload)
      expect(getPerformanceContext().request_id).toBeTruthy()
      return new Response(null, {
        status: 204,
        headers: [
          ['Set-Cookie', 'session=first; HttpOnly; Path=/'],
          ['Set-Cookie', 'csrf=second; Path=/'],
        ],
      })
    })
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(response.headers.getSetCookie()).toEqual(['session=first; HttpOnly; Path=/', 'csrf=second; Path=/'])
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(routeHandler).toHaveBeenCalledOnce()
  })

  it('streams binary downloads without serializing their contents', async () => {
    const content = Uint8Array.from([0, 1, 127, 128, 255])
    vi.mocked(routeHandler).mockImplementationOnce(
      async () =>
        new Response(content, {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': 'attachment; filename="result.bin"',
          },
        }),
    )
    const response = await fetch(`http://127.0.0.1:${port}/api/user/results/result-id?profile_id=profile-id`)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(content)
    expect(response.headers.get('Content-Disposition')).toContain('result.bin')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('delivers streamed chunks before the producer finishes', async () => {
    let producer!: ReadableStreamDefaultController<Uint8Array>
    routeHandler.mockResolvedValueOnce(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            producer = controller
            controller.enqueue(new TextEncoder().encode('first-'))
          },
        }),
      ),
    )
    const response = await fetch(`http://127.0.0.1:${port}/api/health/live`)
    const reader = response.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('first-')
    producer.enqueue(new TextEncoder().encode('second'))
    producer.close()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('second')
    expect((await reader.read()).done).toBe(true)
  })

  it('finishes a large response through backpressure', async () => {
    const body = 'x'.repeat(256 * 1024)
    routeHandler.mockResolvedValueOnce(new Response(body))
    const response = await fetch(`http://127.0.0.1:${port}/api/health/live`)
    await expect(response.text()).resolves.toBe(body)
  })

  it('aborts the request and cancels a late response after the client disconnects', async () => {
    const started = Promise.withResolvers<void>()
    const aborted = Promise.withResolvers<void>()
    const resumed = Promise.withResolvers<void>()
    const cancelled = Promise.withResolvers<void>()
    const cancel = vi.fn(() => cancelled.resolve())
    routeHandler.mockImplementationOnce(async (request) => {
      request.signal.addEventListener('abort', () => aborted.resolve(), { once: true })
      started.resolve()
      await resumed.promise
      return new Response(new ReadableStream({ cancel }))
    })
    const request = httpGet(`http://127.0.0.1:${port}/api/health/live`)
    request.on('error', () => undefined)
    await started.promise
    request.destroy()
    await aborted.promise
    resumed.resolve()
    await cancelled.promise
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('cancels a streaming producer when the client disconnects mid-response', async () => {
    const cancelled = Promise.withResolvers<void>()
    const cancel = vi.fn(() => cancelled.resolve())
    routeHandler.mockResolvedValueOnce(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(64 * 1024))
          },
          cancel,
        }),
      ),
    )
    const request = httpGet(`http://127.0.0.1:${port}/api/health/live`, (response) => {
      response.on('error', () => undefined)
      response.once('data', () => request.destroy())
    })
    request.on('error', () => undefined)
    await cancelled.promise
    expect(cancel).toHaveBeenCalledOnce()
  })

  it.each([128, 129])('keeps the boundary limit for a dynamic parameter of %s characters', async (length) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/user/results/${'r'.repeat(length)}`)
    expect(response.status).toBe(length === 128 ? 200 : 404)
    await response.text()
    expect(routeHandler).toHaveBeenCalledTimes(length === 128 ? 1 : 0)
  })

  it.each(['//api/health/live', '/api/health/live#fragment'])(
    'rejects the original target %s before URL normalization',
    async (target) => {
      const response = await rawRequest(`GET ${target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`)
      expect(response).toMatch(/^HTTP\/1\.1 400 /)
      expect(response).toMatch(/X-Content-Type-Options: nosniff/i)
      expect(routeHandler).not.toHaveBeenCalled()
    },
  )

  it('aggregates ordinary requests without logging each request', async () => {
    const events: Array<Record<string, unknown>> = []
    vi.spyOn(console, 'info').mockImplementation((line: string) => {
      events.push(JSON.parse(line))
    })
    flushPerformanceDurations()
    events.length = 0
    const response = await fetch(`http://127.0.0.1:${port}/api/health/live`)
    expect(response.status).toBe(200)
    expect(response.headers.get('X-Request-ID')).toBeTruthy()
    await expect(response.text()).resolves.toBe('ok')
    expect(routeHandler).toHaveBeenCalledOnce()
    expect(events).toHaveLength(0)
    flushPerformanceDurations()
    expect(events).toEqual([
      expect.objectContaining({
        event: 'performance.duration',
        metric: 'http.request',
        count: 1,
        labels: { method: 'GET', route: '/api/health/live', status: 200, outcome: 'completed' },
      }),
    ])
  })

  it.each([
    { status: 200, durationMs: 999, logged: false },
    { status: 200, durationMs: 1_000, logged: true },
    { status: 400, durationMs: 0, logged: true },
    { status: 500, durationMs: 0, logged: true },
  ])('logs status $status at $durationMs ms: $logged', async ({ status, durationMs, logged }) => {
    const events: Array<Record<string, unknown>> = []
    vi.spyOn(console, 'info').mockImplementation((line: string) => {
      events.push(JSON.parse(line))
    })
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.mocked(routeHandler).mockImplementationOnce(async () => {
      now = durationMs
      return new Response('ok', { status })
    })
    const response = await fetch(`http://127.0.0.1:${port}/api/health/live`)
    await response.text()
    expect(events).toHaveLength(logged ? 1 : 0)
    if (logged)
      expect(events[0]).toMatchObject({
        event: 'http.request',
        status,
        duration_ms: durationMs,
        outcome: 'completed',
        request_id: response.headers.get('X-Request-ID'),
      })
  })

  it('correlates concurrent failed requests and logs route templates without query values or result IDs', async () => {
    const events: Array<Record<string, unknown>> = []
    vi.spyOn(console, 'info').mockImplementation((line: string) => {
      events.push(JSON.parse(line))
    })
    const observed: string[] = []
    const handler = async () => {
      await new Promise<void>((resolve) => setImmediate(resolve))
      observed.push(getPerformanceContext().request_id!)
      return new Response('unavailable', { status: 503 })
    }
    vi.mocked(routeHandler).mockImplementationOnce(handler).mockImplementationOnce(handler)
    const responses = await Promise.all([
      fetch(`http://127.0.0.1:${port}/api/health/live`),
      fetch(`http://127.0.0.1:${port}/api/user/results/private-result?profile_id=secret-marker`),
    ])
    await Promise.all(responses.map((response) => response.text()))
    const ids = responses.map((response) => response.headers.get('X-Request-ID')).sort()
    expect(observed.sort()).toEqual(ids)
    expect(events.map((event) => event.request_id).sort()).toEqual(ids)
    expect(events).toContainEqual(
      expect.objectContaining({ route: '/api/user/results/:resultId', outcome: 'completed', status: 503 }),
    )
    expect(JSON.stringify(events)).not.toMatch(/private-result|secret-marker/)
  })

  it('counts an aborted response once even when multiple lifecycle events arrive', () => {
    const events: Array<Record<string, unknown>> = []
    vi.spyOn(console, 'info').mockImplementation((line: string) => {
      events.push(JSON.parse(line))
    })
    const request = new IncomingMessage(new Socket())
    request.method = 'GET'
    request.url = '/unknown-private-path?token=secret-marker'
    const response = new ServerResponse(request)
    observeHttpRequest(request, response, 'aborted-request')
    response.emit('close')
    response.emit('finish')
    response.emit('close')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      request_id: 'aborted-request',
      route: 'unmatched',
      status: null,
      outcome: 'aborted',
    })
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
    socket.on('data', (chunk) => {
      response += chunk
    })
    socket.on('end', () => resolve(response))
    socket.on('error', reject)
  })
}
