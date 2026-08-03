import type { IncomingMessage } from 'node:http'
import { isTrustedProxyAddress } from './client-ip'

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self'",
  "manifest-src 'self'",
  "frame-src 'none'",
  "worker-src 'none'",
  'upgrade-insecure-requests',
].join('; ')

const STRICT_STYLE_CONTENT_SECURITY_POLICY = CONTENT_SECURITY_POLICY
  .replace("style-src 'self' 'unsafe-inline'", "style-src 'self'")

const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'bluetooth=()',
  'browsing-topics=()',
  'camera=()',
  'display-capture=()',
  'geolocation=()',
  'gyroscope=()',
  'hid=()',
  'magnetometer=()',
  'microphone=()',
  'midi=()',
  'payment=()',
  'picture-in-picture=()',
  'serial=()',
  'usb=()',
].join(', ')

const STRICT_TRANSPORT_SECURITY = 'max-age=31536000; includeSubDomains'

const HTTP_SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'Content-Security-Policy-Report-Only': STRICT_STYLE_CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': PERMISSIONS_POLICY,
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
})

export function applyHttpSecurityHeaders(response: Response, secureTransport: boolean): Response {
  for (const header of [...response.headers.keys()]) {
    if (header.toLowerCase().startsWith('access-control-')) response.headers.delete(header)
  }
  for (const [name, value] of Object.entries(HTTP_SECURITY_HEADERS)) {
    response.headers.set(name, value)
  }
  if (secureTransport) response.headers.set('Strict-Transport-Security', STRICT_TRANSPORT_SECURITY)
  else response.headers.delete('Strict-Transport-Security')
  return response
}

export function isSecureWebRequest(req: Request): boolean {
  return new URL(req.url).protocol === 'https:'
}

export function isSecureIncomingRequest(req: IncomingMessage): boolean {
  if (Boolean((req.socket as { encrypted?: boolean }).encrypted)) return true
  if (!isTrustedProxyAddress(req.socket.remoteAddress)) return false
  const forwardedProto = firstHeaderValue(req.headers['x-forwarded-proto'])
  return forwardedProto?.split(',', 1)[0]?.trim().toLowerCase() === 'https'
}

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}
