import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { requireEnv, jsonResponse } from './license-utils'
import { createPostgresAdminUserStore } from '../storage/admin-user-store'
import {
  createPostgresAdminSessionStore,
  type AdminSessionRecord,
} from '../storage/admin-session-store'
import { reserveAdminAuthenticationAttemptLayered } from '../security/layered-auth-rate-limit'
import { getRequestClientIp } from '../security/client-ip'
import {
  constantTimeSecretEqual,
  createPasswordHash,
  type PasswordAlgorithm,
  type PasswordHashRecord,
  PasswordWorkCapacityError,
  verifyPasswordHashOrDummy,
} from '../security/password'
import { RateLimitStoreError } from '../security/persistent-rate-limit'
import { recordBehaviorRiskAdminAudit } from '../storage/behavior-risk-store'
import { recordAdminOperationAudit } from '../storage/admin-operation-audit-store'
import type { AdminOperationAuditInput } from '../storage/admin-operation-audit-store'

const ADMIN_SESSION_COOKIE = 'maa_admin_session'
export const ADMIN_SESSION_IDLE_MS = 30 * 60 * 1000
export const ADMIN_SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000
export const ADMIN_STEP_UP_MAX_AGE_MS = 15 * 60 * 1000

export type AdminRole = 'risk_viewer' | 'risk_reviewer' | 'security_admin'
export type AdminCapability =
  | 'risk_view'
  | 'risk_review'
  | 'risk_config'
  | 'usage_view'
  | 'user_view'
  | 'sensitive_data_view'
  | 'user_manage'
  | 'user_delete'
  | 'optimization_view'
  | 'optimization_manage'
  | 'admin_manage'

export interface AdminAuthenticationRequirement {
  capability?: AdminCapability
  requireRecentLogin?: boolean
}

export interface AdminUserRecord {
  version: 1 | 2
  username: string
  role?: AdminRole
  disabled?: boolean
  password_hash: string
  salt: string
  iterations: number
  password_algorithm?: PasswordAlgorithm
  created_at: string
  updated_at: string
}

interface AdminUserStore {
  get: (username: string) => Promise<AdminUserRecord | null>
  set: (username: string, user: AdminUserRecord, audit?: AdminOperationAuditInput) => Promise<void>
  create: (username: string, user: AdminUserRecord, audit?: AdminOperationAuditInput) => Promise<boolean>
  upgradePasswordHash: (
    username: string,
    expectedPasswordHash: string,
    replacement: PasswordHashRecord,
  ) => Promise<AdminUserRecord | null>
  delete: (username: string, audit?: AdminOperationAuditInput) => Promise<void>
  list: () => Promise<AdminUserRecord[]>
}

const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,32}$/
const ADMIN_SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export type AdminAuthenticationResult =
  | { ok: true; username: string; role: AdminRole; capabilities: AdminCapability[]; authenticated_at: string }
  | AdminFailureResult

export type AdminLoginResult =
  | {
      ok: true
      username: string
      role: AdminRole
      capabilities: AdminCapability[]
      authenticated_at: string
      cookie: string
    }
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
  let rateLimit
  try {
    rateLimit = await reserveAdminAuthenticationAttemptLayered(
      getRequestClientIp(req),
      username ?? 'invalid',
    )
  } catch (error) {
    if (error instanceof RateLimitStoreError) return rateLimitStoreUnavailableResult()
    throw error
  }
  if (!rateLimit.allowed) return rateLimitedResult(rateLimit.retryAfterSeconds)

  try {
    const password = typeof passwordValue === 'string' ? passwordValue : ''
    const authenticated = await verifyAdminUser(username, password)
    if (!authenticated || !username) {
      rateLimit.attempt.retainFailure()
      return unauthorizedResult('管理账号或密码错误。')
    }

    const session = createAdminSessionRecord(username, now)
    const sessionStore = createPostgresAdminSessionStore()
    await sessionStore.deleteExpired(now.toISOString(), idleCutoff(now).toISOString())
    await sessionStore.save(session.record)
    await rateLimit.attempt.refund()
    const role = normalizeAdminRole(authenticated.role, authenticated.version)
    return {
      ok: true,
      username,
      role,
      capabilities: capabilitiesForRole(role),
      authenticated_at: session.record.created_at,
      cookie: adminSessionCookie(session.token),
    }
  } catch (error) {
    await rateLimit.attempt.refund()
    if (error instanceof PasswordWorkCapacityError) return passwordCapacityResult()
    throw error
  }
}

export function authenticateAdminRequest(req: Request, now?: Date): Promise<AdminAuthenticationResult>
export function authenticateAdminRequest(
  req: Request,
  requirement?: AdminCapability | AdminAuthenticationRequirement,
  now?: Date,
): Promise<AdminAuthenticationResult>
export async function authenticateAdminRequest(
  req: Request,
  requirementOrNow?: AdminCapability | AdminAuthenticationRequirement | Date,
  explicitNow = new Date(),
): Promise<AdminAuthenticationResult> {
  const requirement = normalizeAuthenticationRequirement(requirementOrNow)
  const requiredCapability = requirement.capability
  const now = requirementOrNow instanceof Date ? requirementOrNow : explicitNow
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
  const user = await (await getAdminUserStore()).get(session.username)
  if (!user) return sessionRequiredResult(true)
  if (user.disabled) {
    await store.deleteByTokenHash(hashSessionToken(sessionCookie.token))
    return sessionRequiredResult(true)
  }
  const role = normalizeAdminRole(user.role, user.version)
  const capabilities = capabilitiesForRole(role)
  if (requiredCapability && !capabilities.includes(requiredCapability)) {
    await auditAdminCapability(req, session.username, requiredCapability, 'deny', '管理员角色缺少所需能力。')
    return forbiddenResult('当前管理员账号没有执行此操作的权限。')
  }
  if (requirement.requireRecentLogin) {
    const authenticatedAt = Date.parse(session.created_at)
    if (!Number.isFinite(authenticatedAt) || now.getTime() - authenticatedAt > ADMIN_STEP_UP_MAX_AGE_MS) {
      if (requiredCapability) {
        await auditAdminCapability(req, session.username, requiredCapability, 'deny', '敏感操作需要近期管理员登录。')
      }
      return forbiddenResult('该敏感操作需要近期管理员登录，请退出后重新登录再试。')
    }
  }
  if (requiredCapability) {
    await auditAdminCapability(req, session.username, requiredCapability, 'allow', '管理员能力校验通过。')
  }
  return {
    ok: true,
    username: session.username,
    role,
    capabilities,
    authenticated_at: session.created_at,
  }
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
  let rateLimit
  try {
    rateLimit = await reserveAdminAuthenticationAttemptLayered(getRequestClientIp(req), 'root')
  } catch (error) {
    if (error instanceof RateLimitStoreError) return rateLimitStoreUnavailableResult()
    throw error
  }
  if (!rateLimit.allowed) return rateLimitedResult(rateLimit.retryAfterSeconds)

  const authenticated = typeof value === 'string' && constantTimeSecretEqual(value, rootPassword)
  if (authenticated) {
    await rateLimit.attempt.refund()
    return {
      ok: true,
      username: 'root',
      role: 'security_admin',
      capabilities: capabilitiesForRole('security_admin'),
      authenticated_at: new Date().toISOString(),
    }
  }
  rateLimit.attempt.retainFailure()
  return unauthorizedResult('Root 口令错误。')
}

export async function createAdminUser(
  usernameValue: unknown,
  passwordValue: unknown,
  roleValue: unknown = 'risk_viewer',
  replaceExisting = false,
  auditContext?: AdminUserAuditContext,
): Promise<{ ok: true; user: AdminUserRecord; replaced: boolean } | { ok: false; message: string; code?: 'already_exists' }> {
  const username = normalizeUsername(usernameValue)
  if (!username) return { ok: false, message: '账号名需为 3-32 位字母、数字、下划线或短横线。' }
  if (typeof passwordValue !== 'string' || passwordValue.length < 8 || passwordValue.length > 128) {
    return { ok: false, message: '账号密码必须为 8-128 位。' }
  }
  const role = normalizeAdminRoleValue(roleValue)
  if (!role) return { ok: false, message: '管理员角色无效。' }

  const store = await getAdminUserStore()
  const existing = await store.get(username)
  if (existing && !replaceExisting) {
    return { ok: false, code: 'already_exists', message: '同名管理员已存在；如需替换密码和角色，请明确确认覆盖。' }
  }
  const now = new Date().toISOString()
  const passwordHash = await createPasswordHash(passwordValue)
  const user: AdminUserRecord = {
    version: 2,
    username,
    role,
    disabled: false,
    password_hash: passwordHash.password_hash,
    salt: passwordHash.salt,
    iterations: passwordHash.iterations,
    password_algorithm: passwordHash.password_algorithm,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  }
  if (existing) {
    await store.set(username, user, auditContext && {
      ...auditContext,
      action: 'admin_user.replace',
      targetType: 'admin_user',
      targetId: username,
      before: adminUserAuditSnapshot(existing),
      after: adminUserAuditSnapshot(user),
    })
    return { ok: true, user, replaced: true }
  }
  if (!await store.create(username, user, auditContext && {
    ...auditContext,
    action: 'admin_user.create',
    targetType: 'admin_user',
    targetId: username,
    after: adminUserAuditSnapshot(user),
  })) {
    return { ok: false, code: 'already_exists', message: '同名管理员已存在；请刷新列表后重试。' }
  }
  return { ok: true, user, replaced: false }
}

export async function listAdminUsers(): Promise<Array<Pick<AdminUserRecord, 'username' | 'created_at' | 'updated_at'> & { role: AdminRole; capabilities: AdminCapability[] }>> {
  const store = await getAdminUserStore()
  return (await store.list())
    .sort((a, b) => a.username.localeCompare(b.username))
    .map(({ username, role, version, created_at, updated_at }) => {
      const normalizedRole = normalizeAdminRole(role, version)
      return { username, role: normalizedRole, capabilities: capabilitiesForRole(normalizedRole), created_at, updated_at }
    })
}

export async function deleteAdminUser(
  usernameValue: unknown,
  auditContext?: AdminUserAuditContext,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const username = normalizeUsername(usernameValue)
  if (!username) return { ok: false, message: '账号名格式不正确。' }
  const store = await getAdminUserStore()
  const existing = await store.get(username)
  if (!existing) return { ok: false, message: '管理员账号不存在。' }
  await store.delete(username, auditContext && {
    ...auditContext,
    action: 'admin_user.delete',
    targetType: 'admin_user',
    targetId: username,
    before: adminUserAuditSnapshot(existing),
    after: { deleted: true },
  })
  return { ok: true }
}

type AdminUserAuditContext = Pick<
  AdminOperationAuditInput,
  'actorUsername' | 'reason' | 'requestId' | 'clientIp'
>

function adminUserAuditSnapshot(user: AdminUserRecord) {
  return {
    username: user.username,
    role: normalizeAdminRole(user.role, user.version),
    disabled: user.disabled ?? false,
    created_at: user.created_at,
    updated_at: user.updated_at,
  }
}

function clearAdminSessionCookie(): string {
  return `${ADMIN_SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=0${secureCookieSuffix()}`
}

async function verifyAdminUser(username: string | null, password: string): Promise<AdminUserRecord | null> {
  const store = await getAdminUserStore()
  const user = username ? await store.get(username) : null
  const passwordVerification = await verifyPasswordHashOrDummy(password, user)
  if (!user || user.disabled || !passwordVerification.verified) return null
  if (passwordVerification.needsRehash) {
    try {
      const replacement = await createPasswordHash(password)
      await store.upgradePasswordHash(username, user.password_hash, replacement)
    } catch (error) {
      console.warn('admin password hash upgrade skipped:', error instanceof Error ? error.name : 'UnknownError')
    }
  }
  return user
}

function rateLimitStoreUnavailableResult(): AdminFailureResult {
  return {
    ok: false,
    response: jsonResponse(
      { error: 'Authentication service is temporarily unavailable.' },
      503,
      rateLimitHeaders(1),
    ),
  }
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

function normalizeAdminRoleValue(value: unknown): AdminRole | null {
  return value === 'risk_viewer' || value === 'risk_reviewer' || value === 'security_admin' ? value : null
}

function normalizeAdminRole(value: unknown, version: AdminUserRecord['version']): AdminRole {
  return normalizeAdminRoleValue(value) ?? (version === 1 ? 'security_admin' : 'risk_viewer')
}

function capabilitiesForRole(role: AdminRole): AdminCapability[] {
  if (role === 'security_admin') {
    return [
      'risk_view',
      'risk_review',
      'risk_config',
      'usage_view',
      'user_view',
      'sensitive_data_view',
      'user_manage',
      'user_delete',
      'optimization_view',
      'optimization_manage',
      'admin_manage',
    ]
  }
  if (role === 'risk_reviewer') return ['risk_view', 'risk_review', 'usage_view', 'user_view']
  return ['risk_view', 'usage_view']
}

function normalizeAuthenticationRequirement(
  value: AdminCapability | AdminAuthenticationRequirement | Date | undefined,
): AdminAuthenticationRequirement {
  if (!value || value instanceof Date) return {}
  return typeof value === 'string' ? { capability: value } : value
}

async function auditAdminCapability(
  req: Request,
  username: string,
  capability: AdminCapability,
  decision: 'allow' | 'deny',
  reason: string,
): Promise<void> {
  const url = new URL(req.url)
  const requestId = req.headers.get('x-request-id')?.trim() || randomUUID()
  const action = `${req.method} ${url.pathname}`
  if (capability === 'risk_view' || capability === 'risk_review' || capability === 'risk_config') {
    await recordBehaviorRiskAdminAudit({
      adminUsername: username,
      capability,
      action,
      decision,
      reason,
      requestId,
    })
    return
  }
  await recordAdminOperationAudit({
    actorUsername: username,
    action: `authorization.${decision}`,
    targetType: 'admin_capability',
    targetId: capability,
    reason,
    requestId,
    clientIp: getRequestClientIp(req),
    after: { capability, request: action, decision },
  })
}

async function getAdminUserStore(): Promise<AdminUserStore> {
  return createPostgresAdminUserStore()
}

function unsafeOriginFailure(req: Request): Response | null {
  if (req.method === 'GET' || req.method === 'HEAD') return null
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

function forbiddenResult(message: string): AdminFailureResult {
  return {
    ok: false,
    response: jsonResponse({ error: message }, 403, { 'Cache-Control': 'no-store' }),
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
