import { requireEnv, jsonResponse } from './license-utils'
import { createPostgresAdminUserStore } from '../storage/admin-user-store'
import { reserveAdminAuthenticationAttempt } from '../security/auth-rate-limit'
import { getRequestClientIp } from '../security/client-ip'
import {
  constantTimeSecretEqual,
  createPasswordHash,
  PasswordWorkCapacityError,
  verifyPasswordHash,
} from '../security/password'

export interface AdminUserRecord {
  version: 1;
  username: string;
  password_hash: string;
  salt: string;
  iterations: number;
  created_at: string;
  updated_at: string;
}

interface AdminUserStore {
  get: (username: string) => Promise<AdminUserRecord | null>;
  set: (username: string, user: AdminUserRecord) => Promise<void>;
  delete: (username: string) => Promise<void>;
  list: () => Promise<AdminUserRecord[]>;
}

const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,32}$/

export type AdminAuthenticationResult =
  | { ok: true }
  | { ok: false; response: Response }

export async function authenticateAdminRequest(
  req: Request,
  body?: { admin_password?: unknown; admin_user?: unknown },
): Promise<AdminAuthenticationResult> {
  const rootPassword = requireEnv('MAA_ADMIN_PASSWORD')
  const headerPassword = req.headers.get('X-Admin-Password') ?? ''
  const bodyPassword = typeof body?.admin_password === 'string' ? body.admin_password : ''
  const headerUser = req.headers.get('X-Admin-User') ?? ''
  const bodyUser = typeof body?.admin_user === 'string' ? body.admin_user : ''
  const suppliedUser = headerUser || bodyUser
  const username = normalizeUsername(suppliedUser)
  const rateLimit = reserveAdminAuthenticationAttempt(
    getRequestClientIp(req),
    username ?? (suppliedUser ? 'invalid' : 'root'),
  )
  if (!rateLimit.allowed) return rateLimitedResult(rateLimit.retryAfterSeconds)

  try {
    const rootAuthenticated = !suppliedUser && (
      (Boolean(headerPassword) && constantTimeSecretEqual(headerPassword, rootPassword))
      || (Boolean(bodyPassword) && constantTimeSecretEqual(bodyPassword, rootPassword))
    )
    const password = headerPassword || bodyPassword
    const authenticated = rootAuthenticated || Boolean(
      username && password && await verifyAdminUser(username, password),
    )

    if (authenticated) {
      rateLimit.attempt.refund()
      return { ok: true }
    }
    rateLimit.attempt.retainFailure()
    return unauthorizedResult('管理账号或密码错误。')
  } catch (error) {
    rateLimit.attempt.refund()
    if (error instanceof PasswordWorkCapacityError) return passwordCapacityResult()
    throw error
  }
}

export async function requireRootAdminPassword(req: Request, value: unknown): Promise<AdminAuthenticationResult> {
  const rootPassword = requireEnv('MAA_ADMIN_PASSWORD')
  const rateLimit = reserveAdminAuthenticationAttempt(getRequestClientIp(req), 'root')
  if (!rateLimit.allowed) return rateLimitedResult(rateLimit.retryAfterSeconds)

  const authenticated = typeof value === 'string' && constantTimeSecretEqual(value, rootPassword)
  if (authenticated) {
    rateLimit.attempt.refund()
    return { ok: true }
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

async function verifyAdminUser(username: string, password: string): Promise<boolean> {
  const store = await getAdminUserStore()
  const user = await store.get(username)
  if (!user) return false
  return verifyPasswordHash(password, user)
}

function normalizeUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const username = value.trim()
  return USERNAME_PATTERN.test(username) ? username : null
}

async function getAdminUserStore(): Promise<AdminUserStore> {
  return createPostgresAdminUserStore()
}

function unauthorizedResult(message: string): AdminAuthenticationResult {
  return { ok: false, response: jsonResponse({ error: message }, 401) }
}

function rateLimitedResult(retryAfterSeconds: number): AdminAuthenticationResult {
  return {
    ok: false,
    response: jsonResponse(
      { error: '认证尝试过多，请稍后重试。' },
      429,
      rateLimitHeaders(retryAfterSeconds),
    ),
  }
}

function passwordCapacityResult(): AdminAuthenticationResult {
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
