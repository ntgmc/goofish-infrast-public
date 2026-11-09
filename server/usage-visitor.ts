import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const VALID_VISITOR_ID = /^[A-Za-z0-9_-]{8,128}$/
const USAGE_VISITOR_COOKIE = 'maa_usage_visitor'
const USAGE_VISITOR_MAX_AGE_SECONDS = 180 * 24 * 60 * 60
const DEVELOPMENT_USAGE_SECRET = randomBytes(32).toString('base64url')

export function resolveUsageVisitor(req: Request, now = new Date()): { id: string; cookie: string | null } {
  const secrets = usageSecrets()
  const raw = readCookie(req.headers.get('cookie'), USAGE_VISITOR_COOKIE)
  const existing = raw ? verifyUsageVisitorCookie(raw, secrets, now) : null
  if (existing && existing.secretIndex === 0) return { id: existing.id, cookie: null }
  const id = existing?.id ?? randomBytes(24).toString('base64url')
  const issuedAt = Math.floor(now.getTime() / 1000)
  const payload = `${id}.${issuedAt}`
  const signature = signUsageVisitorCookie(secrets[0], payload)
  return {
    id,
    cookie: `${USAGE_VISITOR_COOKIE}=${payload}.${signature}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${USAGE_VISITOR_MAX_AGE_SECONDS}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`,
  }
}

function verifyUsageVisitorCookie(
  value: string,
  secrets: string[],
  now: Date,
): { id: string; secretIndex: number } | null {
  const [id, issuedAtValue, signature, ...extra] = value.split('.')
  if (extra.length > 0 || !id || !issuedAtValue || !signature) return null
  if (!VALID_VISITOR_ID.test(id) || !/^\d{1,12}$/.test(issuedAtValue)) return null
  const issuedAtMs = Number(issuedAtValue) * 1000
  if (!Number.isSafeInteger(issuedAtMs)
    || issuedAtMs > now.getTime() + 5 * 60 * 1000
    || issuedAtMs < now.getTime() - USAGE_VISITOR_MAX_AGE_SECONDS * 1000) return null
  const payload = `${id}.${issuedAtValue}`
  const secretIndex = secrets.findIndex((secret) => safeEqual(signature, signUsageVisitorCookie(secret, payload)))
  return secretIndex >= 0 ? { id, secretIndex } : null
}

function usageSecrets(): string[] {
  const current = process.env.USAGE_VISITOR_SECRET?.trim()
    || process.env.MAA_ADMIN_SECRET?.trim()
    || (process.env.NODE_ENV === 'production' ? '' : DEVELOPMENT_USAGE_SECRET)
  if (!current) throw new Error('USAGE_VISITOR_SECRET or MAA_ADMIN_SECRET is required for public usage events')
  const previous = process.env.USAGE_VISITOR_SECRET_PREVIOUS?.trim()
    || process.env.MAA_ADMIN_SECRET_PREVIOUS?.trim()
  return previous && previous !== current ? [current, previous] : [current]
}

function signUsageVisitorCookie(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(`usage-visitor-cookie:${payload}`).digest('base64url')
}

export function usageHmac(value: string): string {
  return createHmac('sha256', usageSecrets()[0]).update(`usage-event:${value}`).digest('hex')
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

function readCookie(header: string | null, name: string): string | null {
  const match = (header ?? '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))
  if (!match?.[1]) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return null
  }
}
