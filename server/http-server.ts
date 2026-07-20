import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { nodeRequestToWebRequest, writeWebResponse } from './http-adapter'
import { RequestBodyTooLargeError } from './request-body-limits'
import { routeRequest } from './routes'
import { applyHttpSecurityHeaders, isSecureIncomingRequest } from './security/http-security'
import { inspectIncomingRequest } from './security/http-boundary'
import { describeServerError } from './security/error-reporting'
import { RequestInputError, validateAndStoreJsonBody } from './security/request-validation'

export function createApiServer(): Server {
  const server = createServer({
    maxHeaderSize: 16 * 1024,
    requireHostHeader: true,
    rejectNonStandardBodyWrites: true,
  }, async (req, res) => {
    const requestId = randomUUID()
    try {
      const boundary = inspectIncomingRequest(req)
      if (!boundary.allowed) {
        await sendResponse(req, res, boundary.response, requestId)
        return
      }

      const request = await nodeRequestToWebRequest(req, boundary.bodyLimitBytes)
      if (boundary.methodPolicy.schema) {
        await validateAndStoreJsonBody(
          request,
          boundary.methodPolicy.schema,
          boundary.methodPolicy.bodyProfile,
        )
      }
      const response = await routeRequest(request)
      await sendResponse(req, res, response, requestId)
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        res.shouldKeepAlive = false
        res.setHeader('Connection', 'close')
        res.once('finish', () => req.destroy())
        await sendResponse(
          req,
          res,
          errorResponse(413, 'payload_too_large', 'Request body too large.', requestId),
          requestId,
        )
        return
      }

      if (error instanceof RequestInputError) {
        await sendResponse(
          req,
          res,
          errorResponse(error.status, error.code, error.message, requestId, error.issues),
          requestId,
        )
        return
      }

      console.error('server request error:', {
        request_id: requestId,
        method: req.method || 'UNKNOWN',
        path: requestPathname(req.url),
        error: describeServerError(error),
      })
      await sendResponse(
        req,
        res,
        errorResponse(500, 'internal_error', 'Internal server error.', requestId),
        requestId,
      )
    }
  })

  server.headersTimeout = 10_000
  server.requestTimeout = 30_000
  server.keepAliveTimeout = 5_000
  server.maxHeadersCount = 100
  server.maxRequestsPerSocket = 100
  server.on('clientError', (error, socket) => {
    if (!socket.writable) return socket.destroy()
    const status = 'code' in error && error.code === 'HPE_HEADER_OVERFLOW' ? 431 : 400
    socket.end(`HTTP/1.1 ${status} ${status === 431 ? 'Request Header Fields Too Large' : 'Bad Request'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
  })
  server.on('upgrade', (_req, socket) => socket.destroy())
  return server
}

function requestPathname(url: string | undefined): string {
  try {
    return new URL(`http://request.invalid${url ?? '/'}`).pathname
  } catch {
    return '/invalid-request-url'
  }
}

async function sendResponse(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  response: Response,
  requestId: string,
): Promise<void> {
  response.headers.set('X-Request-ID', requestId)
  const pathname = requestPathname(req.url)
  if (
    response.status >= 400
    || ['/api/auth/', '/api/user/', '/api/admin/'].some((prefix) => pathname.startsWith(prefix))
  ) {
    response.headers.set('Cache-Control', 'no-store')
  }
  await writeWebResponse(res, applyHttpSecurityHeaders(response, isSecureIncomingRequest(req)))
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  requestId: string,
  issues: Array<{ path: string; code: string }> = [],
): Response {
  return new Response(JSON.stringify({
    error: message,
    code,
    request_id: requestId,
    ...(issues.length > 0 && { issues: issues.slice(0, 10) }),
  }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}
