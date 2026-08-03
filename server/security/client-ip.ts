import type { IncomingMessage } from 'node:http'
import { isIP } from 'node:net'

export const INTERNAL_CLIENT_IP_HEADER = 'X-Goofish-Client-IP'

export function resolveIncomingClientIp(req: IncomingMessage): string {
  return resolveClientIp(req.socket.remoteAddress, req.headers['x-real-ip'], process.env)
}

export function resolveClientIp(
  remoteAddress: string | undefined,
  realIpHeader: string | string[] | undefined,
  environment: Pick<NodeJS.ProcessEnv, 'NODE_ENV' | 'TRUSTED_PROXY_ADDRESSES'> = process.env,
): string {
  const remoteIp = normalizeIp(remoteAddress)
  const forwardedIp = normalizeIp(Array.isArray(realIpHeader) ? realIpHeader[0] : realIpHeader)
  if (remoteIp && isTrustedProxyAddress(remoteIp, environment) && forwardedIp) return forwardedIp
  return remoteIp ?? 'unknown'
}

export function isTrustedProxyAddress(
  remoteAddress: string | undefined,
  environment: Pick<NodeJS.ProcessEnv, 'NODE_ENV' | 'TRUSTED_PROXY_ADDRESSES'> = process.env,
): boolean {
  const remoteIp = normalizeIp(remoteAddress)
  if (!remoteIp) return false
  const configured = resolveTrustedProxyAddresses(environment)
  if (configured.length > 0) return configured.includes(remoteIp)
  return environment.NODE_ENV !== 'production' && isLoopbackIpAddress(remoteIp)
}

export function isLoopbackIpAddress(value: string | undefined): boolean {
  const normalized = normalizeIp(value)
  return normalized === '::1' || Boolean(normalized?.startsWith('127.'))
}

export function resolveTrustedProxyAddresses(
  environment: Pick<NodeJS.ProcessEnv, 'TRUSTED_PROXY_ADDRESSES'> = process.env,
): string[] {
  const rawValue = environment.TRUSTED_PROXY_ADDRESSES?.trim()
  if (!rawValue) return []
  const addresses = rawValue.split(',').map((value) => normalizeIp(value)).filter((value): value is string => Boolean(value))
  if (addresses.length !== rawValue.split(',').length) {
    throw new Error('TRUSTED_PROXY_ADDRESSES must be a comma-separated list of IP addresses')
  }
  return [...new Set(addresses)]
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
