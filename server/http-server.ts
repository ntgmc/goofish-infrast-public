import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { Readable } from 'node:stream'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import { nodeRequestToWebRequest, releaseWebRequestResources } from './http-adapter'
import { RequestBodyTooLargeError } from './request-body-limits'
import { routeRequest } from './routes'
import { applyHttpSecurityHeaders, isSecureIncomingRequest } from './security/http-security'
import { inspectIncomingRequest, type HttpBoundaryDecision } from './security/http-boundary'
import { getDeclaredApiPolicyRoutes } from './security/request-policy'
import { describeServerError } from './security/error-reporting'
import { RequestInputError, validateAndStoreJsonBody } from './security/request-validation'
import { observeHttpRequest } from './http-observation'
import { withPerformanceContext } from './performance-observation'

export function createApiServer(): Server {
  const requests = new WeakMap<IncomingMessage, Request>()
  const boundaries = new WeakMap<IncomingMessage, HttpBoundaryDecision>()
  const app = Fastify({
    logger: false,
    exposeHeadRoutes: false,
    requestIdHeader: false,
    rewriteUrl: (request) => {
      // Validate the original target before Fastify normalizes or decodes it.
      const boundary = inspectIncomingRequest(request)
      boundaries.set(request, boundary)
      return boundary.allowed
        ? boundary.pathname + new URL(request.url ?? '/', 'http://request.invalid').search
        : '/__rejected_http_request__'
    },
    serverFactory: (handler) => {
      const server = createServer({
        maxHeaderSize: 16 * 1024,
        requireHostHeader: true,
        rejectNonStandardBodyWrites: true,
      })
      const dispatch = (req: IncomingMessage, res: import('node:http').ServerResponse) => {
        const requestId = randomUUID()
        res.setHeader('X-Request-ID', requestId)
        observeHttpRequest(req, res, requestId)
        withPerformanceContext({ request_id: requestId }, () => {
          void app.ready().then(() => handler(req, res), (error) => server.emit('error', error))
        })
      }
      server.on('request', dispatch)
      server.on('checkContinue', dispatch)
      server.on('checkExpectation', dispatch)
      server.headersTimeout = 10_000
      server.requestTimeout = 30_000
      server.keepAliveTimeout = 5_000
      server.maxHeadersCount = 100
      server.maxRequestsPerSocket = 100
      server.on('clientError', (error, socket) => {
        if (!socket.writable) return socket.destroy()
        const status = 'code' in error && error.code === 'HPE_HEADER_OVERFLOW' ? 431 : 400
        socket.end(
          `HTTP/1.1 ${status} ${status === 431 ? 'Request Header Fields Too Large' : 'Bad Request'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
        )
      })
      server.on('upgrade', (_req, socket) => socket.destroy())
      return server
    },
  })

  app.addHook('onRequest', async (request, reply) => {
    const req = request.raw
    const boundary = boundaries.get(req)
    if (!boundary) throw new Error('HTTP boundary did not inspect the request')
    if (!boundary.allowed) {
      if (req.headers.expect) {
        reply.raw.shouldKeepAlive = false
        boundary.response.headers.set('Connection', 'close')
      }
      return sendResponse(request, reply, boundary.response)
    }
    const webRequest = await nodeRequestToWebRequest(req, boundary.bodyLimitBytes)
    requests.set(req, webRequest)
    if (boundary.methodPolicy.schema) {
      await validateAndStoreJsonBody(webRequest, boundary.methodPolicy.schema, boundary.methodPolicy.bodyProfile)
    }
  })

  // The shared boundary reads and validates the original bytes, including signed integration payloads.
  app.removeAllContentTypeParsers()
  app.addContentTypeParser('*', (_request, _payload, done) => done(null))
  app.addHook('onResponse', async (request) => {
    const webRequest = requests.get(request.raw)
    if (webRequest) releaseWebRequestResources(webRequest)
    requests.delete(request.raw)
    boundaries.delete(request.raw)
  })
  app.setErrorHandler((error, request, reply) => {
    const requestId = String(reply.raw.getHeader('X-Request-ID'))
    if (error instanceof RequestBodyTooLargeError) {
      reply.raw.shouldKeepAlive = false
      reply.header('Connection', 'close')
      reply.raw.once('finish', () => request.raw.destroy())
      return sendResponse(request, reply, errorResponse(413, 'payload_too_large', 'Request body too large.', requestId))
    }
    if (error instanceof RequestInputError) {
      return sendResponse(
        request,
        reply,
        errorResponse(error.status, error.code, error.message, requestId, error.issues),
      )
    }
    console.error('server request error:', {
      request_id: requestId,
      method: request.raw.method || 'UNKNOWN',
      path: new URL(request.raw.url ?? '/', 'http://request.invalid').pathname,
      error: describeServerError(error),
    })
    return sendResponse(request, reply, errorResponse(500, 'internal_error', 'Internal server error.', requestId))
  })

  const handle = async (request: FastifyRequest, reply: FastifyReply) => {
    const webRequest = requests.get(request.raw)
    if (!webRequest) throw new Error('HTTP boundary did not initialize the request')
    return sendResponse(request, reply, await routeRequest(webRequest))
  }
  for (const path of getDeclaredApiPolicyRoutes()) app.all(path, handle)
  app.setNotFoundHandler(handle)

  const server = app.server
  server.once('close', () => {
    void app.close().catch((error) => console.error('API shutdown failed:', describeServerError(error)))
  })
  return server
}

function sendResponse(request: FastifyRequest, reply: FastifyReply, response: Response): FastifyReply {
  const req = request.raw
  const pathname = new URL(req.url ?? '/', 'http://request.invalid').pathname
  response = applyHttpSecurityHeaders(response, isSecureIncomingRequest(req))
  if (
    response.status >= 400 ||
    ['/api/auth/', '/api/user/', '/api/admin/'].some((prefix) => pathname.startsWith(prefix))
  ) {
    response.headers.set('Cache-Control', 'no-store')
  }
  reply.code(response.status)
  response.headers.forEach((value, key) => {
    if (key !== 'set-cookie') reply.header(key, value)
  })
  const cookies = response.headers.getSetCookie()
  if (cookies.length > 0) reply.header('set-cookie', cookies)
  if (req.method === 'HEAD') {
    void response.body?.cancel().catch(() => undefined)
    reply.hijack()
    for (const [key, value] of Object.entries(reply.getHeaders())) {
      if (value !== undefined) reply.raw.setHeader(key, value)
    }
    reply.raw.writeHead(response.status)
    reply.raw.end()
    return reply
  }
  return reply.send(response.body ? Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]) : null)
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  requestId: string,
  issues: Array<{ path: string; code: string }> = [],
): Response {
  return new Response(
    JSON.stringify({
      error: message,
      code,
      request_id: requestId,
      ...(issues.length > 0 && { issues: issues.slice(0, 10) }),
    }),
    {
      status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    },
  )
}
