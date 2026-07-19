import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { requireEnv, jsonResponse } from './license-utils'
import { createPostgresAdminUserStore } from '../storage/admin-user-store'
import {
  createPostgresAdminSessionStore,
  type AdminSessionRecord,
} from '../storage/admin-session-store'
import { reserveAdminAuthenticationAttempt } from '../security/auth-rate-limit'
import { getRequestClientIp } from '../security/client-ip'
import {
  constantTimeSecretEqual,
  createPasswordHash,
  type PasswordAlgorithm,
  type PasswordHashRecord,
  PasswordWorkCapacityError,
  verifyPasswordHash,
} from '../security/password'

const ADMIN_SESSION_COOKIE = 'maa_admin_session'
export const ADMIN_SESSION_IDLE_MS = 30 * 60 * 1000
export const ADMIN_SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000

export interface AdminUserRecord {
  version: 1
  username: string
  password_hash: string
  salt: string
  iterations: number
  password_algorithm?: PasswordAlgorithm
  created_at: string
  updated_at: string
}

interface AdminUserStore {
  get: (username: string) => Promise<AdminUserRecord | null>
  set: (username: string, user: AdminUserRecord) => Promise<void>
  upgradePasswordHash: (
    username: string,
    expectedPasswordHash: string,
    replacement: PasswordHashRecord,
  ) => Promise<AdminUserRecord | null>
  delete: (username: string) => Promise<void>
  list: () => Promise<AdminUserRecord[]>
}

const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,32}$/
const ADMIN_SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export type AdminAuthenticationResult =
  | { ok: true; username: string }
  | AdminFailureResult

export type AdminLoginResult =
  | { ok: true; username: string; cookie: string }
  | AdminFailureResult

type AdminFailureResult = { ok: false; response: Response }

export async function loginAdminRequest(
  req: Request,
  usernameValue: unknown,
  passwordValue: unknown,
  now = new Date(),
): Promise<AdminLoginResult> {
  const originFailure = unsafeOriginFailure(req)
  if (originFailure) return { ok: false, response: originFailure }

  const suppliedUsername = typeof usernameValue === 'string' ? usernameValue : ''
  const username = normalizeUsername(suppliedUsername)
  const rateLimit = reserveAdminAuthenticationAttempt(
    getRequestClientIp(req),
    username ?? 'invalid',
  )
  if (!rateLimit.allowed) return rateLimitedResult(rateLimit.retryAfterSeconds)

  try {
    const password = typeof passwordValue === 'string' ? passwordValue : ''
    const authenticated = Boolean(username && password && await verifyAdminUser(username, password))
    if (!authenticated || !username) {
      rateLimit.attempt.retainFailure()
      return unauthorizedResult('管理账号或密码错误。')
    }

    const session = createAdminSessionRecord(username, now)
    const sessionStore = createPostgresAdminSessionStore()
    await sessionStore.deleteExpired(now.toISOString(), idleCutoff(now).toISOString())
    await sessionStore.save(session.record)
    rateLimit.attempt.refund()
    return { ok: true, username, cookie: adminSessionCookie(session.token) }
  } catch (error) {
    rateLimit.attempt.refund()
    if (error instanceof PasswordWorkCapacityError) return passwordCapacityResult()
    throw error
  }
}

export async function authenticateAdminRequest(
  req: Request,
  now = new Date(),
): Promise<AdminAuthenticationResult> {
  const originFailure = unsafeOriginFailure(req)
  if (originFailure) return { ok: false, response: originFailure }

  const sessionCookie = getAdminSessionToken(req)
  if (!sessionCookie.token) return sessionRequiredResult(sessionCookie.present)
  const store = createPostgresAdminSessionStore()
  const session = await store.authenticateAndTouch(
    hashSessionToken(sessionCookie.token),
    now.toISOString(),
    idleCutoff(now).toISOString(),
  )
  if (!session) return sessionRequiredResult(true)
  return { ok: true, username: session.username }
}

export async function logoutAdminRequest(req: Request): Promise<{ ok: true; cookie: string } | { ok: false; response: Response }> {
  const originFailure = unsafeOriginFailure(req)
  if (originFailure) return { ok: false, response: originFailure }
  const sessionCookie = getAdminSessionToken(req)
  if (sessionCookie.token) {
    await createPostgresAdminSessionStore().deleteByTokenHash(hashSessionToken(sessionCookie.token))
  }
  return { ok: true, cookie: clearAdminSessionCookie() }
}

export async function requireRootAdminPassword(req: Request, value: unknown): Promise<AdminAuthenticationResult> {
  const originFailure = unsafeOriginFailure(req)
  if (originFailure) return { ok: false, response: originFailure }

  const rootPassword = requireEnv('MAA_ADMIN_PASSWORD')
  const rateLimit = reserveAdminAuthenticationAttempt(getRequestClientIp(req), 'root')
  if (!rateLimit.allowed) return rateLimitedResult(rateLimit.retryAfterSeconds)

  const authenticated = typeof value === 'string' && constantTimeSecretEqual(value, rootPassword)
  if (authenticated) {
    rateLimit.attempt.refund()
    return { ok: true, username: 'root' }
  }
  rateLimit.attempt.retainFailure()
  return unauthorizedResult('Root 口令错误。')
}

export async function createAdminUser(usernameValue: unknown, passwordValue: unknown): Promise<{ ok: true; user: AdminUserRecord } | { ok: false; message: string }> {
  const username = normalizeUsername(usernameValue)
  if (!username) return { ok: false, message: '账号名需为 3-32 位字母、数字、下划线或短横线。' }
  if (typeof passwordValue !== 'string' || passwordValue.length < 8) {
    return { ok: false, message: '账号密码至少需要 8 位。' }
  }

  const now = new Date().toISOString()
  const passwordHash = await createPasswordHash(passwordValue)
  const user: AdminUserRecord = {
    version: 1,
    username,
    password_hash: passwordHash.password_hash,
    salt: passwordHash.salt,
    iterations: passwordHash.iterations,
    password_algorithm: passwordHash.password_algorithm,
    created_at: now,
    updated_at: now,
  }
  const store = await getAdminUserStore()
  await store.set(username, user)
  return { ok: true, user }
}

export async function listAdminUsers(): Promise<Array<Pick<AdminUserRecord, 'username' | 'created_at' | 'updated_at'>>> {
  const store = await getAdminUserStore()
  return (await store.list())
    .sort((a, b) => a.username.localeCompare(b.username))
    .map(({ username, created_at, updated_at }) => ({ username, created_at, updated_at }))
}

export async function deleteAdminUser(usernameValue: unknown): Promise<{ ok: true } | { ok: false; message: string }> {
  const username = normalizeUsername(usernameValue)
  if (!username) return { ok: false, message: '账号名格式不正确。' }
  const store = await getAdminUserStore()
  await store.delete(username)
  return { ok: true }
}

function clearAdminSessionCookie(): string {
  return `${ADMIN_SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=0${secureCookieSuffix()}`
}

async function verifyAdminUser(username: string, password: string): Promise<boolean> {
  const store = await getAdminUserStore()
  const user = await store.get(username)
  if (!user) return false
  const passwordVerification = await verifyPasswordHash(password, user)
  if (!passwordVerification.verified) return false
  if (passwordVerification.needsRehash) {
    try {
      const replacement = await createPasswordHash(password)
      await store.upgradePasswordHash(username, user.password_hash, replacement)
    } catch (error) {
      console.warn('admin password hash upgrade skipped:', error instanceof Error ? error.name : 'UnknownError')
    }
  }
  return true
}

function createAdminSessionRecord(username: string, now: Date): { token: string; record: AdminSessionRecord } {
  const token = randomBytes(32).toString('base64url')
  return {
    token,
    record: {
      id: randomUUID(),
      username,
      token_hash: hashSessionToken(token),
      created_at: now.toISOString(),
      last_seen_at: now.toISOString(),
      expires_at: new Date(now.getTime() + ADMIN_SESSION_ABSOLUTE_MS).toISOString(),
    },
  }
}

function adminSessionCookie(token: string): string {
  return `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/api/admin${secureCookieSuffix()}`
}

function getAdminSessionToken(req: Request): { present: boolean; token: string | null } {
  const cookie = req.headers.get('cookie') ?? ''
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${ADMIN_SESSION_COOKIE}=([^;]+)`))
  if (!match?.[1]) return { present: false, token: null }
  const token = decodeCookieValue(match[1])
  return {
    present: true,
    token: token && ADMIN_SESSION_TOKEN_PATTERN.test(token) ? token : null,
  }
}

function decodeCookieValue(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function idleCutoff(now: Date): Date {
  return new Date(now.getTime() - ADMIN_SESSION_IDLE_MS)
}

function normalizeUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const username = value.trim()
  return USERNAME_PATTERN.test(username) ? username : null
}

async function getAdminUserStore(): Promise<AdminUserStore> {
  return createPostgresAdminUserStore()
}

function unsafeOriginFailure(req: Request): Response | null {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return null
  const origin = req.headers.get('origin')
  if (!origin) return null
  try {
    if (new URL(origin).origin === new URL(req.url).origin) return null
  } catch {
    // Invalid origins fail closed.
  }
  return jsonResponse(
    { error: 'Cross-origin admin request rejected.' },
    403,
    { 'Cache-Control': 'no-store' },
  )
}

function unauthorizedResult(message: string): AdminFailureResult {
  return {
    ok: false,
    response: jsonResponse({ error: message }, 401, { 'Cache-Control': 'no-store' }),
  }
}

function sessionRequiredResult(clearCookie: boolean): AdminFailureResult {
  return {
    ok: false,
    response: jsonResponse(
      { error: '管理员会话无效或已过期。' },
      401,
      {
        'Cache-Control': 'no-store',
        ...(clearCookie ? { 'Set-Cookie': clearAdminSessionCookie() } : {}),
      },
    ),
  }
}

function rateLimitedResult(retryAfterSeconds: number): AdminFailureResult {
  return {
    ok: false,
    response: jsonResponse(
      { error: '认证尝试过多，请稍后重试。' },
      429,
      rateLimitHeaders(retryAfterSeconds),
    ),
  }
}

function passwordCapacityResult(): AdminFailureResult {
  return {
    ok: false,
    response: jsonResponse(
      { error: '认证服务繁忙，请稍后重试。' },
      429,
      rateLimitHeaders(1),
    ),
  }
}

function rateLimitHeaders(retryAfterSeconds: number): Record<string, string> {
  return {
    'Retry-After': String(retryAfterSeconds),
    'Cache-Control': 'no-store',
    'Access-Control-Expose-Headers': 'Retry-After',
  }
}

function secureCookieSuffix(): string {
  return process.env.NODE_ENV === 'production' ? '; Secure' : ''
}
