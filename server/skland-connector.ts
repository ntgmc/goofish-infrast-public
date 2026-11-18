import { timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { z } from 'zod'
import { checkSklandUpstreams } from './skland-transport'

const REQUEST_LIMIT = 16 * 1024
const routes = new Map([
  ['https://as.hypergryph.com/general/v1/gen_scan/login', 'POST'],
  ['https://as.hypergryph.com/general/v1/scan_status', 'GET'],
  ['https://as.hypergryph.com/user/auth/v1/token_by_scan_code', 'POST'],
  ['https://as.hypergryph.com/user/oauth2/v2/grant', 'POST'],
  ['https://zonai.skland.com/api/v1/user/auth/generate_cred_by_code', 'POST'],
  ['https://zonai.skland.com/api/v1/auth/refresh', 'GET'],
  ['https://zonai.skland.com/api/v1/game/player/binding', 'GET'],
  ['https://zonai.skland.com/api/v1/game/player/info', 'GET'],
  ['https://zonai.skland.com/api/v1/game/cultivate/info', 'GET'],
  ['https://zonai.skland.com/api/v1/game/cultivate/player', 'GET'],
  ['https://zonai.skland.com/api/v1/game/cultivate/character', 'GET'],
])
const allowedHeaders = new Set([
  'user-agent', 'accept-encoding', 'content-type', 'platform', 'accept-language',
  'did', 'vname', 'language', 'sign', 'timestamp', 'cred', 'token',
])
const requestSchema = z.object({
  url: z.url(),
  method: z.enum(['GET', 'POST']),
  headers: z.record(z.string(), z.string()),
  body: z.string().optional(),
}).strict().refine((request) => {
  const url = new URL(request.url)
  return !url.username && !url.password && !url.hash
    && routes.get(`${url.origin}${url.pathname}`) === request.method
    && (request.method !== 'GET' || request.body === undefined)
    && Object.keys(request.headers).every((name) => allowedHeaders.has(name.toLowerCase()))
})

export function createSklandConnectorServer(token: string) {
  if (token.length < 32 || /\s/.test(token)) throw new Error('SKLAND_CONNECTOR_TOKEN 必须至少包含 32 个非空白字符。')
  const authorization = Buffer.from(`Bearer ${token}`)
  let health: { expiresAt: number; promise: Promise<boolean> } | undefined
  const server = createServer({ maxHeaderSize: 8 * 1024 }, async (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    const supplied = Buffer.from(request.headers.authorization ?? '')
    if (supplied.length !== authorization.length || !timingSafeEqual(supplied, authorization)) {
      writeJson(response, 401, { error: 'unauthorized' })
      return
    }
    if (request.method === 'GET' && request.url === '/health/live') {
      writeJson(response, 200, { ok: true, role: 'skland-connector' })
      return
    }
    if (request.method === 'GET' && request.url === '/health/ready') {
      if (!health || health.expiresAt <= Date.now()) {
        health = { expiresAt: Date.now() + 10_000, promise: checkSklandUpstreams() }
      }
      const ok = await health.promise
      writeJson(response, ok ? 200 : 503, { ok, role: 'skland-connector' })
      return
    }
    if (request.method !== 'POST' || request.url !== '/request') {
      writeJson(response, 404, { error: 'not_found' })
      return
    }
    try {
      const body = await readBody(request)
      if (body === null) {
        writeJson(response, 413, { error: 'request_too_large' })
        return
      }
      const parsed = requestSchema.safeParse(JSON.parse(body))
      if (!parsed.success) {
        writeJson(response, 400, { error: 'invalid_request' })
        return
      }
      const input = parsed.data
      const upstream = await fetch(input.url, {
        method: input.method,
        headers: input.headers,
        body: input.body,
        redirect: 'error',
        signal: AbortSignal.timeout(25_000),
      })
      const data = await upstream.arrayBuffer()
      response.writeHead(upstream.status, {
        'Content-Type': 'application/json',
        'X-Skland-Upstream': 'true',
        ...(upstream.headers.has('Retry-After') ? { 'Retry-After': upstream.headers.get('Retry-After')! } : {}),
      })
      response.end(Buffer.from(data))
    } catch (error) {
      if (error instanceof SyntaxError) writeJson(response, 400, { error: 'invalid_request' })
      else writeJson(response, 502, { error: 'skland_upstream_unavailable' })
    }
  })
  server.headersTimeout = 10_000
  server.requestTimeout = 30_000
  server.keepAliveTimeout = 5_000
  server.maxHeadersCount = 50
  server.on('upgrade', (_request, socket) => socket.destroy())
  return server
}

async function readBody(request: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > REQUEST_LIMIT) return null
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify(body))
}
