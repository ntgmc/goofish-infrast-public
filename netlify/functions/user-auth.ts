import { createHash, pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { AuthUser, PermissionMode } from '../../src/lib/types'
import {
  deleteSessionByTokenHash,
  emptyWorkspace,
  getSessionByTokenHash,
  getUserByEmail,
  getUserById,
  getWorkspace,
  saveUserAccount,
  saveUserSession,
  saveWorkspace,
  toPublicWorkspace,
  touchSession,
  type UserAccountRecord,
} from '../../server/storage/user-store'
import {
  getCdkRecordStore,
  hashCdk,
  normalizeCode,
  normalizePermissionMode,
  requireEnv,
  type CdkRecord,
} from './license-utils'

const SESSION_COOKIE = 'maa_session'
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30
const PASSWORD_ITERATIONS = 120_000
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface AuthContext {
  user: UserAccountRecord
  cdkRecord: CdkRecord | null
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      ...(status === 204 ? {} : { 'Content-Type': 'application/json' }),
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      ...headers,
    },
  })
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return EMAIL_PATTERN.test(email) && email.length <= 254 ? email : null
}

export function validatePassword(value: unknown): { ok: true; password: string } | { ok: false; message: string } {
  if (typeof value !== 'string') return { ok: false, message: '请填写密码。' }
  if (value.length < 8) return { ok: false, message: '密码至少需要 8 位。' }
  if (value.length > 128) return { ok: false, message: '密码不能超过 128 位。' }
  return { ok: true, password: value }
}

export async function registerUser(emailValue: unknown, passwordValue: unknown, cdkValue: unknown): Promise<
  | { ok: true; user: UserAccountRecord; cookie: string }
  | { ok: false; status: number; message: string }
> {
  const email = normalizeEmail(emailValue)
  if (!email) return { ok: false, status: 400, message: '邮箱格式不正确。' }

  const passwordCheck = validatePassword(passwordValue)
  if (!passwordCheck.ok) return { ok: false, status: 400, message: passwordCheck.message }

  if (typeof cdkValue !== 'string' || !cdkValue.trim()) {
    return { ok: false, status: 400, message: '请填写 CDK。' }
  }

  if (await getUserByEmail(email)) {
    return { ok: false, status: 409, message: '该邮箱已经注册，请直接登录。' }
  }

  const hashSecret = requireEnv('CDK_HASH_SECRET')
  const codeHash = hashCdk(normalizeCode(cdkValue), hashSecret)
  const cdkKey = `cdk/${codeHash}.json`
  const cdkStore = await getCdkRecordStore()
  const cdkRecord = await cdkStore.get(cdkKey)

  if (!cdkRecord) return { ok: false, status: 404, message: 'CDK 不存在。' }
  if (cdkRecord.status === 'frozen') return { ok: false, status: 409, message: 'CDK 已冻结，请联系卖家。' }
  if (cdkRecord.status === 'revoked') return { ok: false, status: 409, message: 'CDK 已撤销，请联系卖家。' }
  if (cdkRecord.status !== 'unused') return { ok: false, status: 409, message: 'CDK 已被使用。' }

  const now = new Date().toISOString()
  const userId = randomUUID()
  const permission = normalizePermissionMode(cdkRecord.permission)
  const cdkOrderHash = cdkRecord.license_order_hash || createAccountOrderHash(codeHash, userId)
  const passwordHash = hashPassword(passwordCheck.password)
  const user: UserAccountRecord = {
    version: 1,
    id: userId,
    email,
    password_hash: passwordHash.hash,
    salt: passwordHash.salt,
    iterations: PASSWORD_ITERATIONS,
    permission,
    status: 'active',
    cdk_key: cdkKey,
    cdk_code_hash: codeHash,
    cdk_order_hash: cdkOrderHash,
    created_at: now,
    updated_at: now,
  }

  await saveUserAccount(user)
  await cdkStore.set(cdkKey, {
    ...cdkRecord,
    status: 'used',
    used_at: now,
    license_order_hash: cdkOrderHash,
    operator_count: cdkRecord.operator_count ?? null,
    config_desc: cdkRecord.config_desc ?? null,
    account_id: userId,
    account_email_hash: createHash('sha256').update(email).digest('hex'),
    bound_at: now,
  } as CdkRecord)
  await saveWorkspace(emptyWorkspace(userId))

  const session = await createSession(userId)
  return { ok: true, user, cookie: session.cookie }
}

export async function loginUser(emailValue: unknown, passwordValue: unknown): Promise<
  | { ok: true; user: UserAccountRecord; cookie: string }
  | { ok: false; status: number; message: string }
> {
  const email = normalizeEmail(emailValue)
  if (!email) return { ok: false, status: 400, message: '邮箱格式不正确。' }
  if (typeof passwordValue !== 'string' || !passwordValue) {
    return { ok: false, status: 400, message: '请填写密码。' }
  }

  const user = await getUserByEmail(email)
  if (!user || !verifyPassword(passwordValue, user)) {
    return { ok: false, status: 401, message: '邮箱或密码错误。' }
  }
  if (user.status !== 'active') {
    return { ok: false, status: 403, message: '账号状态不可用，请联系卖家。' }
  }

  const session = await createSession(user.id)
  return { ok: true, user, cookie: session.cookie }
}

export async function requireUserSession(req: Request): Promise<AuthContext | null> {
  const token = getSessionToken(req)
  if (!token) return null
  const tokenHash = hashSessionToken(token)
  const session = await getSessionByTokenHash(tokenHash)
  if (!session || Date.parse(session.expires_at) <= Date.now()) return null
  const user = await getUserById(session.user_id)
  if (!user || user.status !== 'active') return null
  await touchSession(session)
  const cdkRecord = await (await getCdkRecordStore()).get(user.cdk_key)
  return { user, cdkRecord }
}

export async function logoutRequest(req: Request): Promise<void> {
  const token = getSessionToken(req)
  if (token) await deleteSessionByTokenHash(hashSessionToken(token))
}

export async function buildAuthPayload(user: UserAccountRecord) {
  const workspace = await getWorkspace(user.id)
  return {
    user: toPublicUser(user),
    workspace: toPublicWorkspace(workspace),
  }
}

export function toPublicUser(user: UserAccountRecord): AuthUser {
  return {
    id: user.id,
    email: user.email,
    permission: user.permission,
    status: user.status,
    cdk_status: user.status === 'active' ? 'used' : user.status,
    cdk_order_hash: user.cdk_order_hash,
    created_at: user.created_at,
  }
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureCookieSuffix()}`
}

function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString('hex')
  return {
    salt,
    hash: pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, 32, 'sha256').toString('hex'),
  }
}

function verifyPassword(password: string, user: UserAccountRecord): boolean {
  const actual = Buffer.from(pbkdf2Sync(password, user.salt, user.iterations, 32, 'sha256').toString('hex'), 'hex')
  const expected = Buffer.from(user.password_hash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

async function createSession(userId: string): Promise<{ cookie: string }> {
  const token = randomBytes(32).toString('base64url')
  const now = new Date()
  const expires = new Date(now.getTime() + SESSION_TTL_MS)
  await saveUserSession({
    version: 1,
    id: randomUUID(),
    user_id: userId,
    token_hash: hashSessionToken(token),
    created_at: now.toISOString(),
    last_seen_at: now.toISOString(),
    expires_at: expires.toISOString(),
  })
  return {
    cookie: `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secureCookieSuffix()}`,
  }
}

function getSessionToken(req: Request): string | null {
  const cookie = req.headers.get('Cookie') || req.headers.get('cookie') || ''
  const match = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`))
  return match ? decodeURIComponent(match.slice(SESSION_COOKIE.length + 1)) : null
}

function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function createAccountOrderHash(codeHash: string, userId: string): string {
  return createHash('sha256').update(`${codeHash}:${userId}`).digest('hex').slice(0, 16)
}

function secureCookieSuffix(): string {
  return process.env.NODE_ENV === 'production' ? '; Secure' : ''
}
