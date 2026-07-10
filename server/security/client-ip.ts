import type { IncomingMessage } from 'node:http'
import { isIP } from 'node:net'

export const INTERNAL_CLIENT_IP_HEADER = 'X-Goofish-Client-IP'

export function resolveIncomingClientIp(req: IncomingMessage): string {
  return resolveClientIp(req.socket.remoteAddress, req.headers['x-real-ip'])
}

export function resolveClientIp(
  remoteAddress: string | undefined,
  realIpHeader: string | string[] | undefined,
): string {
  const remoteIp = normalizeIp(remoteAddress)
  const forwardedIp = normalizeIp(Array.isArray(realIpHeader) ? realIpHeader[0] : realIpHeader)
  if (remoteIp && isLoopbackIp(remoteIp) && forwardedIp) return forwardedIp
  return remoteIp ?? 'unknown'
}

export function getRequestClientIp(req: Request): string {
  return normalizeIp(req.headers.get(INTERNAL_CLIENT_IP_HEADER) ?? undefined) ?? 'unknown'
}

function normalizeIp(value: string | undefined): string | null {
  if (!value) return null
  let candidate = value.trim().toLowerCase()
  if (candidate.startsWith('::ffff:') && isIP(candidate.slice(7)) === 4) {
    candidate = candidate.slice(7)
  }
  return isIP(candidate) ? candidate : null
}

function isLoopbackIp(value: string): boolean {
  return value === '::1' || value.startsWith('127.')
}
