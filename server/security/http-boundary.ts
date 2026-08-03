import type { IncomingMessage } from 'node:http'
import {
  getAllowedMethods,
  getRoutePolicy,
  REQUEST_BODY_LIMITS,
  type RequestMethodPolicy,
  type RoutePolicy,
} from './request-policy'

const MAX_REQUEST_TARGET_BYTES = 8 * 1024
const SAFE_METHODS = new Set(['GET', 'HEAD'])

export type HttpBoundaryDecision =
  | {
    allowed: true
    pathname: string
    routePolicy: RoutePolicy
    methodPolicy: RequestMethodPolicy
    bodyLimitBytes: number
  }
  | { allowed: false; response: Response }

export function inspectIncomingRequest(req: IncomingMessage): HttpBoundaryDecision {
  const method = (req.method ?? '').toUpperCase()
  const target = req.url ?? ''
  if (!method || !target || Buffer.byteLength(target, 'utf8') > MAX_REQUEST_TARGET_BYTES) {
    return reject(400, 'invalid_request', 'Invalid request target.')
  }
  if (!target.startsWith('/') || target.startsWith('//') || /[\u0000-\u001f\u007f#]/.test(target)) {
    return reject(400, 'invalid_request', 'Invalid request target.')
  }
  if (!isValidHost(firstHeader(req.headers.host))) {
    return reject(400, 'invalid_request', 'Invalid Host header.')
  }
  if (!isAllowedProductionHost(firstHeader(req.headers.host))) {
    return reject(400, 'invalid_request', 'Host header is not allowed.')
  }

  let url: URL
  try {
    url = new URL(target, 'http://request.invalid')
  } catch {
    return reject(400, 'invalid_request', 'Invalid request target.')
  }

  const routePolicy = getRoutePolicy(url.pathname)
  if (!routePolicy) return reject(404, 'route_not_found', 'API route not found.')
  const queryFailure = validateQuery(url, routePolicy)
  if (queryFailure) return queryFailure
  const methodPolicy = routePolicy.methods[method]
  if (!methodPolicy) {
    return reject(405, 'method_not_allowed', 'Method not allowed.', {
      Allow: getAllowedMethods(routePolicy).join(', '),
    })
  }

  const expect = firstHeader(req.headers.expect)
  if (expect) return reject(417, 'expectation_failed', 'Expect header is not supported.')
  if (firstHeader(req.headers.upgrade)) return reject(426, 'upgrade_not_supported', 'Protocol upgrade is not supported.')
  const idempotencyKey = firstHeader(req.headers['idempotency-key'])
  if (idempotencyKey !== null && (!/^[\x21-\x7e]{1,200}$/.test(idempotencyKey) || headerCount(req, 'idempotency-key') !== 1)) {
    return reject(400, 'invalid_request', 'Invalid Idempotency-Key header.')
  }

  const bodyDeclared = requestDeclaresBody(req)
  if (methodPolicy.bodyProfile === 'none' && bodyDeclared) {
    return reject(400, 'invalid_request', 'This endpoint does not accept a request body.')
  }
  if (methodPolicy.bodyProfile !== 'none') {
    const contentType = firstHeader(req.headers['content-type'])
    if (!contentType || !isJsonContentType(contentType)) {
      return reject(415, 'unsupported_media_type', 'Content-Type must be application/json with UTF-8 encoding.')
    }
  }

  if (!SAFE_METHODS.has(method)) {
    const fetchSite = firstHeader(req.headers['sec-fetch-site'])?.trim().toLowerCase()
    if (fetchSite === 'cross-site') return reject(403, 'cross_origin_rejected', 'Cross-origin request rejected.')
    const origin = firstHeader(req.headers.origin)
    if (origin && !isTrustedOrigin(origin)) {
      return reject(403, 'cross_origin_rejected', 'Cross-origin request rejected.')
    }
  }

  return {
    allowed: true,
    pathname: url.pathname,
    routePolicy,
    methodPolicy,
    bodyLimitBytes: REQUEST_BODY_LIMITS[methodPolicy.bodyProfile],
  }
}

function requestDeclaresBody(req: IncomingMessage): boolean {
  const transferEncoding = firstHeader(req.headers['transfer-encoding'])
  if (transferEncoding) return true
  const contentLength = firstHeader(req.headers['content-length'])
  if (!contentLength) return false
  return !/^0+$/.test(contentLength.trim())
}

function isJsonContentType(value: string): boolean {
  return /^application\/json(?:\s*;\s*charset\s*=\s*"?utf-8"?)?\s*$/i.test(value)
}

function validateQuery(url: URL, policy: RoutePolicy): HttpBoundaryDecision | null {
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key)
    if (!policy.queryKeys.has(key) || values.length !== 1 || values[0].length > 512) {
      return reject(400, 'invalid_request', 'Invalid query parameters.')
    }
  }
  return null
}

function headerCount(req: IncomingMessage, headerName: string): number {
  let count = 0
  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    if (req.rawHeaders[index]?.toLowerCase() === headerName) count += 1
  }
  return count
}

function isValidHost(value: string | null): boolean {
  if (!value || value.length > 255 || /[\s\\/]/.test(value)) return false
  try {
    const parsed = new URL(`http://${value}`)
    return Boolean(parsed.hostname) && parsed.username === '' && parsed.password === '' && parsed.pathname === '/'
  } catch {
    return false
  }
}

function isTrustedOrigin(value: string): boolean {
  const configured = process.env.PUBLIC_APP_URL?.trim()
  if (!configured) return process.env.NODE_ENV !== 'production'
  try {
    return new URL(value).origin === new URL(configured).origin
  } catch {
    return false
  }
}

function isAllowedProductionHost(value: string | null): boolean {
  if (process.env.NODE_ENV !== 'production') return true
  const publicAppUrl = process.env.PUBLIC_APP_URL?.trim()
  if (!value || !publicAppUrl) return false
  try {
    return new URL(`http://${value}`).host.toLowerCase() === new URL(publicAppUrl).host.toLowerCase()
  } catch {
    return false
  }
}

function reject(status: number, code: string, message: string, headers: Record<string, string> = {}): HttpBoundaryDecision {
  return {
    allowed: false,
    response: new Response(JSON.stringify({ error: message, code }), {
      status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
    }),
  }
}

function firstHeader(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}
