import { createHash, pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { Announcement, AuthSuccessResponse, AuthUser, PermissionMode, UserGameAccount } from '../../src/lib/types'
import {
  deleteSessionByTokenHash,
  deleteSessionsForUser,
  deleteUserAccount,
  emptyWorkspace,
  getAnnouncementReads,
  getPasswordResetTokenByHash,
  getProfileForUser,
  getProfileWorkspace,
  getRecentPasswordResetTokenForUser,
  getSessionByTokenHash,
  getUserByEmail,
  getUserById,
  listProfilesForUser,
  markPasswordResetTokenUsed,
  markAnnouncementRead,
  migrateLegacyUserIfNeeded,
  savePasswordResetToken,
  saveProfileWorkspace,
  saveUserAccount,
  saveUserProfile,
  saveUserSession,
  isFreePreviewProfile,
  toPublicProfile,
  toPublicWorkspace,
  touchSession,
  type UserAccountRecord,
  type UserGameAccountRecord,
  type UserSessionRecord,
} from '../storage/user-store'
import { createPostgresAnnouncementStore } from '../storage/announcement-store'
import { sendPasswordResetEmail } from './email'
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
const ANNOUNCEMENT_KEY = 'current.json'
const PASSWORD_RESET_DEFAULT_TTL_MINUTES = 30
const PASSWORD_RESET_RESEND_WINDOW_MS = 1000 * 60 * 5
export const PASSWORD_RESET_REQUEST_MESSAGE = 'If the email exists, a reset link has been sent.'
const PASSWORD_RESET_INVALID_MESSAGE = 'The reset link is invalid or expired.'

export interface AuthContext {
  user: UserAccountRecord
  session: UserSessionRecord
  tokenHash: string
  profiles: UserGameAccountRecord[]
  activeProfile: UserGameAccountRecord | null
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
  if (typeof value !== 'string') return { ok: false, message: 'Password must be a string.' }
  if (value.length < 8) return { ok: false, message: 'Password must be at least 8 characters.' }
  if (value.length > 128) return { ok: false, message: 'Password must be at most 128 characters.' }
  return { ok: true, password: value }
}

export async function registerUser(
  emailValue: unknown,
  passwordValue: unknown,
  cdkValue?: unknown,
): Promise<
  | { ok: true; user: UserAccountRecord; cookie: string }
  | { ok: false; status: number; message: string }
> {
  const email = normalizeEmail(emailValue)
  if (!email) return { ok: false, status: 400, message: 'Invalid email format.' }
  const passwordCheck = validatePassword(passwordValue)
  if (!passwordCheck.ok) return { ok: false, status: 400, message: passwordCheck.message }
  const existing = await getUserByEmail(email)
  if (existing) return { ok: false, status: 409, message: 'Email is already registered.' }

  const now = new Date().toISOString()
  const passwordHash = hashPassword(passwordCheck.password)
  const user: UserAccountRecord = {
    version: 1,
    id: randomUUID(),
    email,
    password_hash: passwordHash.hash,
    salt: passwordHash.salt,
    iterations: PASSWORD_ITERATIONS,
    permission: 'growth',
    status: 'active',
    cdk_key: null,
    cdk_code_hash: null,
    cdk_order_hash: null,
    created_at: now,
    updated_at: now,
  }
  await saveUserAccount(user)

  if (typeof cdkValue === 'string' && cdkValue.trim()) {
    const redeemed = await redeemProfileCdk(user, cdkValue, '账号 1', '')
    if (!redeemed.ok) {
      await deleteUserAccount(user.id)
      return redeemed
    }
    const primary = {
      ...user,
      permission: redeemed.profile.permission,
      cdk_key: redeemed.profile.cdk_key,
      cdk_code_hash: redeemed.profile.cdk_code_hash,
      cdk_order_hash: redeemed.profile.cdk_order_hash,
      updated_at: new Date().toISOString(),
    }
    await saveUserAccount(primary)
    user.permission = primary.permission
    user.cdk_key = primary.cdk_key
    user.cdk_code_hash = primary.cdk_code_hash
    user.cdk_order_hash = primary.cdk_order_hash
    user.updated_at = primary.updated_at
  }

  const session = await createSession(user.id)
  return { ok: true, user, cookie: session.cookie }
}

export async function loginUser(
  emailValue: unknown,
  passwordValue: unknown,
): Promise<
  | { ok: true; user: UserAccountRecord; cookie: string }
  | { ok: false; status: number; message: string }
> {
  const email = normalizeEmail(emailValue)
  if (!email) return { ok: false, status: 400, message: 'Invalid email format.' }
  if (typeof passwordValue !== 'string') return { ok: false, status: 400, message: 'Password must be a string.' }

  const user = await getUserByEmail(email)
  if (!user || !verifyPassword(passwordValue, user)) {
    return { ok: false, status: 401, message: 'Invalid email or password.' }
  }
  if (user.status !== 'active') {
    return { ok: false, status: 403, message: 'Account is not active.' }
  }

  await migrateLegacyUserIfNeeded(user)
  const session = await createSession(user.id)
  return { ok: true, user, cookie: session.cookie }
}

export async function changeUserPassword(
  user: UserAccountRecord,
  oldPasswordValue: unknown,
  newPasswordValue: unknown,
  keepTokenHash: string,
): Promise<{ ok: true; user: UserAccountRecord } | { ok: false; status: number; message: string }> {
  if (typeof oldPasswordValue !== 'string' || !verifyPassword(oldPasswordValue, user)) {
    return { ok: false, status: 401, message: "Invalid license signature." };
  }
  const nextPassword = validatePassword(newPasswordValue)
  if (!nextPassword.ok) return { ok: false, status: 400, message: nextPassword.message }
  const updated = await setUserPassword(user, nextPassword.password)
  await deleteSessionsForUser(user.id, keepTokenHash)
  return { ok: true, user: updated }
}

export async function resetUserPasswordByAdmin(
  user: UserAccountRecord,
  newPasswordValue: unknown,
): Promise<{ ok: true; user: UserAccountRecord } | { ok: false; message: string }> {
  const nextPassword = validatePassword(newPasswordValue)
  if (!nextPassword.ok) return { ok: false, message: nextPassword.message }
  const updated = await setUserPassword(user, nextPassword.password)
  await deleteSessionsForUser(user.id)
  return { ok: true, user: updated }
}

export async function requestPasswordReset(emailValue: unknown): Promise<{ ok: true; message: string }> {
  const email = normalizeEmail(emailValue)
  if (!email) return { ok: true, message: PASSWORD_RESET_REQUEST_MESSAGE }

  try {
    const user = await getUserByEmail(email)
    if (!user || user.status !== 'active') return { ok: true, message: PASSWORD_RESET_REQUEST_MESSAGE }

    const resendSince = new Date(Date.now() - PASSWORD_RESET_RESEND_WINDOW_MS).toISOString()
    const recent = await getRecentPasswordResetTokenForUser(user.id, resendSince)
    if (recent) return { ok: true, message: PASSWORD_RESET_REQUEST_MESSAGE }

    const token = randomBytes(32).toString('base64url')
    const now = new Date()
    const expiresMinutes = getPasswordResetTtlMinutes()
    const expiresAt = new Date(now.getTime() + expiresMinutes * 60 * 1000).toISOString()
    await savePasswordResetToken({
      id: randomUUID(),
      user_id: user.id,
      token_hash: hashPasswordResetToken(token),
      expires_at: expiresAt,
      used_at: null,
      created_at: now.toISOString(),
    })

    await sendPasswordResetEmail({
      email: user.email,
      resetUrl: buildPasswordResetUrl(token),
      expiresMinutes,
    })
  } catch (error) {
    console.error('password reset request error:', error)
  }

  return { ok: true, message: PASSWORD_RESET_REQUEST_MESSAGE }
}

export async function resetPasswordWithToken(
  tokenValue: unknown,
  newPasswordValue: unknown,
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  if (typeof tokenValue !== 'string' || !tokenValue.trim()) {
    return { ok: false, status: 400, message: PASSWORD_RESET_INVALID_MESSAGE }
  }

  const resetToken = await getPasswordResetTokenByHash(hashPasswordResetToken(tokenValue.trim()))
  if (!resetToken || resetToken.used_at || Date.parse(resetToken.expires_at) <= Date.now()) {
    return { ok: false, status: 400, message: PASSWORD_RESET_INVALID_MESSAGE }
  }

  const user = await getUserById(resetToken.user_id)
  if (!user || user.status !== 'active') {
    return { ok: false, status: 400, message: PASSWORD_RESET_INVALID_MESSAGE }
  }

  const nextPassword = validatePassword(newPasswordValue)
  if (!nextPassword.ok) return { ok: false, status: 400, message: nextPassword.message }

  await setUserPassword(user, nextPassword.password)
  await markPasswordResetTokenUsed(resetToken.id)
  await deleteSessionsForUser(user.id)
  return { ok: true }
}

export async function redeemProfileCdk(
  user: UserAccountRecord,
  codeValue: unknown,
  displayNameValue?: unknown,
  noteValue?: unknown,
): Promise<
  | { ok: true; profile: UserGameAccountRecord }
  | { ok: false; status: number; message: string }
> {
  if (typeof codeValue !== 'string' || !codeValue.trim()) {
  if (typeof codeValue !== 'string' || !codeValue.trim()) return { ok: false, status: 400, message: 'Please enter a CDK.' }
  }

  const normalizedCode = normalizeCode(codeValue)
  const codeHash = hashCdk(normalizedCode, requireEnv('CDK_HASH_SECRET'))
  const cdkKey = `cdk/${codeHash}.json`
  const cdkStore = await getCdkRecordStore()
  const cdkRecord = await cdkStore.get(cdkKey)
  if (!cdkRecord) return { ok: false, status: 404, message: 'CDK does not exist.' }
  if (cdkRecord.status === 'frozen') return { ok: false, status: 409, message: 'CDK is frozen.' }
  if (cdkRecord.status === 'revoked') return { ok: false, status: 409, message: 'CDK has been revoked.' }
  if (cdkRecord.status !== 'unused') return { ok: false, status: 409, message: 'CDK has already been used.' }

  const now = new Date().toISOString()
  const profileId = randomUUID()
  const permission = normalizePermissionMode(cdkRecord.permission)
  const cdkOrderHash = cdkRecord.license_order_hash || createAccountOrderHash(codeHash, profileId)
  const displayName = normalizeProfileDisplayName(displayNameValue) || await nextDefaultProfileName(user.id)
  const note = normalizeProfileNote(noteValue)
  const profile: UserGameAccountRecord = {
    version: 1,
    id: profileId,
    user_id: user.id,
    kind: 'cdk',
    cdk_key: cdkKey,
    cdk_code_hash: codeHash,
    cdk_order_hash: cdkOrderHash,
    permission,
    status: 'active',
    display_name: displayName,
    note,
    created_at: now,
    updated_at: now,
  }

  await saveUserProfile(profile)
  await saveProfileWorkspace(emptyWorkspace(profile.id))
  await cdkStore.set(cdkKey, {
    ...cdkRecord,
    status: 'used',
    used_at: now,
    license_order_hash: cdkOrderHash,
    operator_count: cdkRecord.operator_count ?? null,
    config_desc: cdkRecord.config_desc ?? null,
    account_id: user.id,
    profile_id: profile.id,
    account_email_hash: createHash('sha256').update(user.email).digest('hex'),
    bound_at: now,
  } as CdkRecord)

  return { ok: true, profile }
}

export async function createOrReusePreviewProfile(
  user: UserAccountRecord,
  displayNameValue?: unknown,
  noteValue?: unknown,
): Promise<
  | { ok: true; profile: UserGameAccountRecord }
  | { ok: false; status: number; message: string }
> {
  const profiles = await listProfilesForUser(user.id)
  const existing = profiles.find((profile) => isFreePreviewProfile(profile))
  const displayName = normalizeProfileDisplayName(displayNameValue)
  const note = normalizeProfileNote(noteValue)

  if (existing) {
    if (!displayName && !note) return { ok: true, profile: existing }
    const updated: UserGameAccountRecord = {
      ...existing,
      display_name: displayName || existing.display_name,
      note: note || existing.note,
      updated_at: new Date().toISOString(),
    }
    await saveUserProfile(updated)
    return { ok: true, profile: updated }
  }

  return {
    ok: false,
    status: 400,
    message: '免费个人排班档案必须通过森空岛登录领取。',
  }
}

export async function upgradePreviewProfileWithCdk(
  user: UserAccountRecord,
  profileIdValue: unknown,
  codeValue: unknown,
  displayNameValue?: unknown,
  noteValue?: unknown,
): Promise<
  | { ok: true; profile: UserGameAccountRecord }
  | { ok: false; status: number; message: string }
> {
  if (typeof profileIdValue !== 'string' || !profileIdValue.trim()) {
    return { ok: false, status: 400, message: '缺少免费个人排班档案。' }
  }
  const profile = await getProfileForUser(user.id, profileIdValue.trim())
  if (!profile) return { ok: false, status: 404, message: '档案不存在。' }
  if (!isFreePreviewProfile(profile)) {
    return { ok: false, status: 400, message: '只有免费个人排班档案可以原地升级。' }
  }
  if (profile.status !== 'active') {
    return { ok: false, status: 403, message: '档案当前不可用。' }
  }
  if (typeof codeValue !== 'string' || !codeValue.trim()) {
    return { ok: false, status: 400, message: '缺少 CDK。' }
  }

  const normalizedCode = normalizeCode(codeValue)
  const codeHash = hashCdk(normalizedCode, requireEnv('CDK_HASH_SECRET'))
  const cdkKey = `cdk/${codeHash}.json`
  const cdkStore = await getCdkRecordStore()
  const cdkRecord = await cdkStore.get(cdkKey)
  if (!cdkRecord) return { ok: false, status: 404, message: 'CDK 不存在。' }
  if (cdkRecord.status === 'frozen') return { ok: false, status: 409, message: 'CDK 已被冻结。' }
  if (cdkRecord.status === 'revoked') return { ok: false, status: 409, message: 'CDK 已被撤销。' }
  if (cdkRecord.status !== 'unused') return { ok: false, status: 409, message: 'CDK 已被使用。' }

  const now = new Date().toISOString()
  const permission = normalizePermissionMode(cdkRecord.permission)
  const cdkOrderHash = cdkRecord.license_order_hash || createAccountOrderHash(codeHash, profile.id)
  const displayName = normalizeProfileDisplayName(displayNameValue)
  const note = normalizeProfileNote(noteValue)
  const upgraded: UserGameAccountRecord = {
    ...profile,
    kind: 'cdk',
    cdk_key: cdkKey,
    cdk_code_hash: codeHash,
    cdk_order_hash: cdkOrderHash,
    permission,
    display_name: displayName || profile.display_name || '免费个人排班',
    note: note || profile.note,
    updated_at: now,
  }

  await saveUserProfile(upgraded)
  if (!(await getProfileWorkspace(upgraded.id))) {
    await saveProfileWorkspace(emptyWorkspace(upgraded.id))
  }
  await cdkStore.set(cdkKey, {
    ...cdkRecord,
    status: 'used',
    used_at: now,
    license_order_hash: cdkOrderHash,
    operator_count: cdkRecord.operator_count ?? null,
    config_desc: cdkRecord.config_desc ?? null,
    account_id: user.id,
    profile_id: upgraded.id,
    account_email_hash: createHash('sha256').update(user.email).digest('hex'),
    bound_at: now,
  } as CdkRecord)

  return { ok: true, profile: upgraded }
}

export async function requireUserSession(req: Request): Promise<AuthContext | null> {
  const token = getSessionToken(req)
  if (!token) return null
  const tokenHash = hashSessionToken(token)
  const session = await getSessionByTokenHash(tokenHash)
  if (!session) return null
  if (Date.parse(session.expires_at) <= Date.now()) {
    await deleteSessionByTokenHash(tokenHash)
    return null
  }
  const user = await getUserById(session.user_id)
  if (!user) {
    await deleteSessionByTokenHash(tokenHash)
    return null
  }
  if (user.status !== 'active') {
    await deleteSessionByTokenHash(tokenHash)
    return null
  }
  const profiles = await migrateLegacyUserIfNeeded(user)
  const activeProfile = profiles.find((profile) => profile.kind !== 'depot_value') ?? profiles[0] ?? null
  const cdkRecord = activeProfile ? await getCdkRecordForProfile(activeProfile) : null
  await touchSession(session)
  return { user, session, tokenHash, profiles, activeProfile, cdkRecord }
}

export async function logoutRequest(req: Request): Promise<void> {
  const token = getSessionToken(req)
  if (!token) return
  await deleteSessionByTokenHash(hashSessionToken(token))
}

export async function buildAuthPayload(user: UserAccountRecord, activeProfileId?: string | null): Promise<AuthSuccessResponse> {
  const records = await migrateLegacyUserIfNeeded(user)
  const publicProfiles: UserGameAccount[] = []
  for (const profile of records) {
    publicProfiles.push(toPublicProfile(profile, await getProfileWorkspace(profile.id)))
  }
  const defaultActiveProfile = records.find((profile) => profile.kind !== 'depot_value') ?? records[0] ?? null
  const activeProfileRecord = activeProfileId
    ? records.find((profile) => profile.id === activeProfileId) ?? defaultActiveProfile
    : defaultActiveProfile
  const activeWorkspace = activeProfileRecord ? await getProfileWorkspace(activeProfileRecord.id) : null
  return {
    user: toPublicUser(user),
    profiles: publicProfiles,
    active_profile: activeProfileRecord ? toPublicProfile(activeProfileRecord, activeWorkspace) : null,
    workspace: activeProfileRecord ? toPublicWorkspace(activeWorkspace) : null,
    announcement_unread_count: await getAnnouncementUnreadCount(user.id),
  }
}

export function toPublicUser(user: UserAccountRecord): AuthUser {
  return {
    id: user.id,
    email: user.email,
    permission: user.permission,
    status: user.status,
    cdk_status: user.cdk_key ? (user.status === 'active' ? 'used' : user.status) : 'none',
    cdk_order_hash: user.cdk_order_hash,
    created_at: user.created_at,
  }
}

export async function getAnnouncementUnreadCount(userId: string): Promise<number> {
  const announcements = await getActiveAnnouncements()
  const readIds = new Set((await getAnnouncementReads(userId)).map((read) => read.announcement_id))
  return announcements.filter((announcement) => !readIds.has(announcement.id)).length
}

export async function markAnnouncementsRead(userId: string, announcementIds: string[]): Promise<void> {
  for (const announcementId of announcementIds) {
    await markAnnouncementRead(userId, announcementId)
  }
}

export async function getActiveAnnouncements(): Promise<Announcement[]> {
  const store = createPostgresAnnouncementStore(ANNOUNCEMENT_KEY)
  const value = await store.get()
  if (!value || typeof value !== 'object' || !Array.isArray((value as { announcements?: unknown }).announcements)) return []
  return ((value as { announcements: unknown[] }).announcements)
    .filter((item): item is Announcement => isAnnouncement(item) && item.active)
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureCookieSuffix()}`
}

async function setUserPassword(user: UserAccountRecord, password: string): Promise<UserAccountRecord> {
  const passwordHash = hashPassword(password)
  const updated: UserAccountRecord = {
    ...user,
    password_hash: passwordHash.hash,
    salt: passwordHash.salt,
    iterations: PASSWORD_ITERATIONS,
    updated_at: new Date().toISOString(),
  }
  await saveUserAccount(updated)
  return updated
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
  const cookie = req.headers.get('cookie') ?? ''
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function hashPasswordResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function buildPasswordResetUrl(token: string): string {
  const baseUrl = process.env.PUBLIC_APP_URL?.trim()
  if (!baseUrl) throw new Error('PUBLIC_APP_URL not configured')
  const url = new URL('/reset-password', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
  url.searchParams.set('token', token)
  return url.toString()
}

function getPasswordResetTtlMinutes(): number {
  const raw = Number(process.env.PASSWORD_RESET_TTL_MINUTES)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : PASSWORD_RESET_DEFAULT_TTL_MINUTES
}

function secureCookieSuffix(): string {
  return process.env.NODE_ENV === 'production' ? '; Secure' : ''
}

function createAccountOrderHash(codeHash: string, profileId: string): string {
  return createHash('sha256').update(`${codeHash}:${profileId}`).digest('hex').slice(0, 32)
}

async function nextDefaultProfileName(userId: string): Promise<string> {
  const profiles = await listProfilesForUser(userId)
  return `账号 ${profiles.length + 1}`
}

function normalizeProfileDisplayName(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 40) : ''
}

function normalizeProfileNote(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 500) : ''
}

async function getCdkRecordForProfile(profile: UserGameAccountRecord): Promise<CdkRecord | null> {
  if (!profile.cdk_key) return null
  const store = await getCdkRecordStore()
  return store.get(profile.cdk_key)
}

function isAnnouncement(value: unknown): value is Announcement {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return typeof item.id === 'string'
    && (item.kind === 'banner' || item.kind === 'popup')
    && typeof item.title === 'string'
    && typeof item.body === 'string'
    && typeof item.created_at === 'string'
    && typeof item.updated_at === 'string'
}
