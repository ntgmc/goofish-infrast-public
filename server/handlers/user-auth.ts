import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Announcement, AuthSuccessResponse, AuthUser, UserGameAccount } from '../../src/lib/types'
import {
  deleteSessionByTokenHash,
  deleteEmailVerificationTokenByHash,
  deleteSessionsForUser,
  emptyWorkspace,
  getAnnouncementReads,
  getPasswordResetTokenByHash,
  getProfileForUser,
  getRecentPasswordResetTokenForUser,
  getRecentEmailVerificationTokenForUser,
  getSessionByTokenHash,
  getUserByEmail,
  getUserById,
  listProfileWorkspaces,
  listProfilesForUser,
  migrateLegacyUserIfNeeded,
  resetUserPasswordWithToken,
  savePasswordResetToken,
  saveEmailVerificationToken,
  updateProfileWorkspaceAtomically,
  saveUserAccount,
  saveUserProfile,
  saveUserSession,
  isFreePreviewProfile,
  toPublicProfile,
  toPublicWorkspace,
  touchSession,
  verifyUserEmailWithToken,
  upgradeUserPasswordHash,
  type UserAccountRecord,
  type UserGameAccountRecord,
  type UserWorkspaceRecord,
  type UserSessionRecord,
} from '../storage/user-store'
import { createPostgresAnnouncementStore } from '../storage/announcement-store'
import { getFreePreviewTrial, hasFreePreviewTrialEnded } from '../free-preview-trial'
import { createPasswordHash, verifyPasswordHash, verifyPasswordHashOrDummy } from '../security/password'
import { sendEmailVerificationEmail, sendPasswordResetEmail } from './email'
import { getRegistrationSettings } from '../storage/registration-settings-store'
import {
  findCdkRecordByCode,
  getCdkRecordStore,
  normalizeCode,
  normalizePermissionMode,
  getFreePreviewDefaultConfig,
  resolveFreePreviewConfig,
  type CdkRecord,
} from './license-utils'
import {
  CdkAlreadyRedeemedError,
  IdempotencyConflictError,
  createRequestHash,
  redeemCdkAtomically,
  saveUserAccountInTransaction,
  saveProfileInTransaction,
  saveWorkspaceInTransaction,
} from '../storage/cdk-redemption'
import {
  InvitationCodeError,
  saveInvitationInTransaction,
  saveRegistrationWithInvitation,
  settleInvitationForActivatedUser,
  validateInvitationCode,
  type ValidatedInvitationCode,
} from '../storage/invitation-store'

const SESSION_COOKIE = 'maa_session'
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30
export const USER_SESSION_TOUCH_INTERVAL_MS = 10 * 60 * 1000
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ANNOUNCEMENT_KEY = 'current.json'
const PASSWORD_RESET_DEFAULT_TTL_MINUTES = 30
const PASSWORD_RESET_RESEND_WINDOW_MS = 1000 * 60 * 5
const PASSWORD_RESET_REQUEST_MESSAGE = 'If the email exists, a reset link has been sent.'
const PASSWORD_RESET_INVALID_MESSAGE = 'The reset link is invalid or expired.'
const EMAIL_VERIFICATION_DEFAULT_TTL_HOURS = 24
const EMAIL_VERIFICATION_RESEND_WINDOW_MS = 1000 * 60 * 5
const EMAIL_VERIFICATION_SENT_MESSAGE = '请检查邮箱并点击验证链接完成注册。'
const EMAIL_VERIFICATION_RESEND_MESSAGE = '如果该账号仍需验证，验证邮件已发送，请检查收件箱。'
const EMAIL_VERIFICATION_INVALID_MESSAGE = '验证链接无效或已过期。'

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
      ...headers,
    },
  })
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return EMAIL_PATTERN.test(email) && email.length <= 254 ? email : null
}

function validatePassword(value: unknown): { ok: true; password: string } | { ok: false; message: string } {
  if (typeof value !== 'string') return { ok: false, message: 'Password must be a string.' }
  if (value.length < 8) return { ok: false, message: 'Password must be at least 8 characters.' }
  if (value.length > 128) return { ok: false, message: 'Password must be at most 128 characters.' }
  return { ok: true, password: value }
}

export async function registerUser(
  emailValue: unknown,
  passwordValue: unknown,
  cdkValue?: unknown,
  idempotencyKey?: string | null,
  inviteCodeValue?: unknown,
): Promise<
  | { ok: true; user: UserAccountRecord; verificationRequired?: false }
  | { ok: true; user: UserAccountRecord; verificationRequired: true; message: string; resendAfterSeconds: number }
  | { ok: false; status: number; message: string; code?: string }
> {
  const email = normalizeEmail(emailValue)
  if (!email) return { ok: false, status: 400, message: 'Invalid email format.' }
  const passwordCheck = validatePassword(passwordValue)
  if (!passwordCheck.ok) return { ok: false, status: 400, message: passwordCheck.message }
  const existing = await getUserByEmail(email)
  const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey)
  const normalizedInviteCode = typeof inviteCodeValue === 'string' ? inviteCodeValue.trim().toUpperCase() : null
  const registrationRequestHash = typeof cdkValue === 'string' && cdkValue.trim()
    ? createRequestHash({ code: normalizeCode(cdkValue), email, password: passwordCheck.password, invite_code: normalizedInviteCode })
    : null
  if (existing) {
    await verifyPasswordHashOrDummy(passwordCheck.password, null)
    return { ok: false, status: 202, message: 'Registration request accepted.', code: 'registration_accepted' }
  }

  let invitation: ValidatedInvitationCode | null
  try {
    invitation = await validateInvitationCode(inviteCodeValue)
  } catch (error) {
    if (error instanceof InvitationCodeError) return { ok: false, status: 400, message: error.message, code: error.code }
    throw error
  }

  const now = new Date().toISOString()
  const registrationSettings = await getRegistrationSettings()
  const passwordHash = await createPasswordHash(passwordCheck.password)
  const user: UserAccountRecord = {
    version: 1,
    id: randomUUID(),
    email,
    password_hash: passwordHash.password_hash,
    salt: passwordHash.salt,
    iterations: passwordHash.iterations,
    password_algorithm: passwordHash.password_algorithm,
    permission: 'growth',
    status: 'active',
    cdk_key: null,
    cdk_code_hash: null,
    cdk_order_hash: null,
    email_verified_at: registrationSettings.email_verification_required ? null : now,
    created_at: now,
    updated_at: now,
  }
  if (typeof cdkValue === 'string' && cdkValue.trim()) {
    const redeemed = await redeemRegistrationCdk(user, cdkValue, normalizedIdempotencyKey, registrationRequestHash!, invitation)
    if (!redeemed.ok) {
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
  } else if (invitation) {
    await saveRegistrationWithInvitation(user, invitation)
  } else {
    await saveUserAccount(user)
  }

  if (registrationSettings.email_verification_required) {
    try {
      await issueEmailVerification(user)
    } catch (error) {
      console.error('registration verification email error:', error)
      return { ok: false, status: 503, message: '验证邮件发送失败，请稍后重新发送。', code: 'verification_email_send_failed' }
    }
    return verificationRequiredResult(user)
  }

  return { ok: true, user }
}

export async function loginUser(
  emailValue: unknown,
  passwordValue: unknown,
): Promise<
  | { ok: true; user: UserAccountRecord; cookie: string }
  | { ok: false; status: number; message: string; code?: string }
> {
  const email = normalizeEmail(emailValue)
  const password = typeof passwordValue === 'string' ? passwordValue : ''
  if (!email || typeof passwordValue !== 'string') {
    await verifyPasswordHashOrDummy(password, null)
    return { ok: false, status: 401, message: 'Invalid email or password.' }
  }

  let user = await getUserByEmail(email)
  const passwordVerification = await verifyPasswordHashOrDummy(password, user)
  if (!user || !passwordVerification.verified) {
    return { ok: false, status: 401, message: 'Invalid email or password.' }
  }
  if (user.status !== 'active') {
    return { ok: false, status: 403, message: 'Account is not active.' }
  }
  if (user.email_verified_at === null) {
    return { ok: false, status: 403, message: '请先验证邮箱后再登录。', code: 'email_not_verified' }
  }

  if (passwordVerification.needsRehash) {
    user = await tryUpgradeUserPasswordHash(user, password)
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
  if (typeof oldPasswordValue !== 'string') {
    return { ok: false, status: 401, message: "Invalid license signature." };
  }
  const passwordVerification = await verifyPasswordHash(oldPasswordValue, user)
  if (!passwordVerification.verified) {
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

  const tokenHash = hashPasswordResetToken(tokenValue.trim())
  const resetToken = await getPasswordResetTokenByHash(tokenHash)
  if (!resetToken || resetToken.used_at || Date.parse(resetToken.expires_at) <= Date.now()) {
    return { ok: false, status: 400, message: PASSWORD_RESET_INVALID_MESSAGE }
  }

  const user = await getUserById(resetToken.user_id)
  if (!user || user.status !== 'active') {
    return { ok: false, status: 400, message: PASSWORD_RESET_INVALID_MESSAGE }
  }

  const nextPassword = validatePassword(newPasswordValue)
  if (!nextPassword.ok) return { ok: false, status: 400, message: nextPassword.message }

  const passwordHash = await createPasswordHash(nextPassword.password)
  const updated = await resetUserPasswordWithToken(tokenHash, passwordHash, new Date())
  if (!updated) return { ok: false, status: 400, message: PASSWORD_RESET_INVALID_MESSAGE }
  return { ok: true }
}

export async function redeemProfileCdk(
  user: UserAccountRecord,
  codeValue: unknown,
  displayNameValue?: unknown,
  noteValue?: unknown,
  idempotencyKey?: string | null,
): Promise<
  | { ok: true; profile: UserGameAccountRecord }
  | { ok: false; status: number; message: string }
> {
  if (typeof codeValue !== 'string' || !codeValue.trim()) {
  if (typeof codeValue !== 'string' || !codeValue.trim()) return { ok: false, status: 400, message: 'Please enter a CDK.' }
  }

  const normalizedCode = normalizeCode(codeValue)
  const cdkMatch = await findCdkRecordByCode(normalizedCode)
  if (!cdkMatch) return { ok: false, status: 404, message: 'CDK does not exist.' }
  const { codeHash, key: cdkKey, record: cdkRecord } = cdkMatch
  if (!idempotencyKey && cdkRecord.status === 'frozen') return { ok: false, status: 409, message: 'CDK is frozen.' }
  if (!idempotencyKey && cdkRecord.status === 'revoked') return { ok: false, status: 409, message: 'CDK has been revoked.' }
  const now = new Date().toISOString()
  const profileId = randomUUID()
  const displayName = normalizeProfileDisplayName(displayNameValue) || await nextDefaultProfileName(user.id)
  const note = normalizeProfileNote(noteValue)
  try {
    const redeemed = await redeemCdkAtomically({
      key: cdkKey,
      idempotencyKey: normalizeIdempotencyKey(idempotencyKey),
      idempotencyScope: `profile:${user.id}`,
      requestHash: createRequestHash({ codeHash, displayName, note }),
      complete: async (client, cdkRecord) => {
        const permission = normalizePermissionMode(cdkRecord.permission)
        const cdkOrderHash = cdkRecord.license_order_hash || createAccountOrderHash(codeHash, profileId)
        const profile: UserGameAccountRecord = {
          version: 1, id: profileId, user_id: user.id, kind: 'cdk', cdk_key: cdkKey, cdk_code_hash: codeHash,
          cdk_order_hash: cdkOrderHash, permission, status: 'active', display_name: displayName, note, created_at: now, updated_at: now,
        }
        await saveProfileInTransaction(client, profile)
        await saveWorkspaceInTransaction(client, emptyWorkspace(profile.id))
        const record = {
          ...cdkRecord, status: 'used' as const, used_at: now, license_order_hash: cdkOrderHash,
          operator_count: cdkRecord.operator_count ?? null, config_desc: cdkRecord.config_desc ?? null,
          account_id: user.id, profile_id: profile.id, account_email_hash: createHash('sha256').update(user.email).digest('hex'), bound_at: now,
        }
        return { record, response: profile }
      },
    })
    return { ok: true, profile: redeemed.response }
  } catch (error) {
    return redemptionFailure(error)
  }
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
  idempotencyKey?: string | null,
): Promise<
  | { ok: true; profile: UserGameAccountRecord }
  | { ok: false; status: number; message: string }
> {
  if (typeof profileIdValue !== 'string' || !profileIdValue.trim()) {
    return { ok: false, status: 400, message: '缺少免费个人排班档案。' }
  }
  const profile = await getProfileForUser(user.id, profileIdValue.trim())
  if (!profile) return { ok: false, status: 404, message: '档案不存在。' }
  if (!idempotencyKey && !isFreePreviewProfile(profile)) {
    return { ok: false, status: 400, message: '只有免费个人排班档案可以原地升级。' }
  }
  if (!idempotencyKey && profile.status !== 'active') {
    return { ok: false, status: 403, message: '档案当前不可用。' }
  }
  if (typeof codeValue !== 'string' || !codeValue.trim()) {
    return { ok: false, status: 400, message: '缺少 CDK。' }
  }

  const normalizedCode = normalizeCode(codeValue)
  const cdkMatch = await findCdkRecordByCode(normalizedCode)
  if (!cdkMatch) return { ok: false, status: 404, message: 'CDK 不存在。' }
  const { codeHash, key: cdkKey, record: cdkRecord } = cdkMatch
  if (!idempotencyKey && cdkRecord.status === 'frozen') return { ok: false, status: 409, message: 'CDK 已被冻结。' }
  if (!idempotencyKey && cdkRecord.status === 'revoked') return { ok: false, status: 409, message: 'CDK 已被撤销。' }
  const now = new Date().toISOString()
  const displayName = normalizeProfileDisplayName(displayNameValue)
  const note = normalizeProfileNote(noteValue)
  try {
    const redeemed = await redeemCdkAtomically({
      key: cdkKey,
      idempotencyKey: normalizeIdempotencyKey(idempotencyKey),
      idempotencyScope: `profile-upgrade:${user.id}:${profile.id}`,
      requestHash: createRequestHash({ codeHash, profileId: profile.id, displayName, note }),
      complete: async (client, cdkRecord) => {
        const locked = await client.query<{ record_json: UserGameAccountRecord }>(
          'select record_json from user_game_accounts where id = $1 and user_id = $2 for update', [profile.id, user.id],
        )
        const current = locked.rows[0]?.record_json
        if (!current || !isFreePreviewProfile(current) || current.status !== 'active') throw new Error('档案当前不可用。')
        const cdkOrderHash = cdkRecord.license_order_hash || createAccountOrderHash(codeHash, current.id)
        const upgraded: UserGameAccountRecord = {
          ...current, kind: 'cdk', cdk_key: cdkKey, cdk_code_hash: codeHash, cdk_order_hash: cdkOrderHash,
          permission: normalizePermissionMode(cdkRecord.permission), display_name: displayName || current.display_name || '免费个人排班', note: note || current.note, updated_at: now,
        }
        await saveProfileInTransaction(client, upgraded)
        await saveWorkspaceInTransaction(client, emptyWorkspace(upgraded.id))
        const record = {
          ...cdkRecord, status: 'used' as const, used_at: now, license_order_hash: cdkOrderHash,
          operator_count: cdkRecord.operator_count ?? null, config_desc: cdkRecord.config_desc ?? null,
          account_id: user.id, profile_id: upgraded.id, account_email_hash: createHash('sha256').update(user.email).digest('hex'), bound_at: now,
        }
        return { record, response: upgraded }
      },
    })
    return { ok: true, profile: redeemed.response }
  } catch (error) {
    return redemptionFailure(error)
  }
}

async function redeemRegistrationCdk(
  user: UserAccountRecord,
  codeValue: string,
  idempotencyKey?: string | null,
  requestHash?: string,
  invitation?: ValidatedInvitationCode | null,
): Promise<{ ok: true; profile: UserGameAccountRecord } | { ok: false; status: number; message: string }> {
  const cdkMatch = await findCdkRecordByCode(normalizeCode(codeValue))
  if (!cdkMatch) return { ok: false, status: 404, message: 'CDK does not exist.' }
  const { codeHash, key: cdkKey } = cdkMatch
  const now = new Date().toISOString()
  const profileId = randomUUID()
  try {
    const redeemed = await redeemCdkAtomically({
      key: cdkKey,
      idempotencyKey: normalizeIdempotencyKey(idempotencyKey),
      idempotencyScope: `register:${user.email}`,
      requestHash: requestHash ?? createRequestHash({ codeHash, email: user.email }),
      complete: async (client, cdkRecord) => {
        const cdkOrderHash = cdkRecord.license_order_hash || createAccountOrderHash(codeHash, profileId)
        const permission = normalizePermissionMode(cdkRecord.permission)
        const boundUser: UserAccountRecord = {
          ...user, permission, cdk_key: cdkKey, cdk_code_hash: codeHash, cdk_order_hash: cdkOrderHash, updated_at: now,
        }
        const profile: UserGameAccountRecord = {
          version: 1, id: profileId, user_id: user.id, kind: 'cdk', cdk_key: cdkKey, cdk_code_hash: codeHash,
          cdk_order_hash: cdkOrderHash, permission, status: 'active', display_name: '账号 1', note: '', created_at: now, updated_at: now,
        }
        await saveUserAccountInTransaction(client, boundUser)
        if (invitation) await saveInvitationInTransaction(client, user.id, invitation)
        await saveProfileInTransaction(client, profile)
        await saveWorkspaceInTransaction(client, emptyWorkspace(profile.id))
        return {
          record: {
            ...cdkRecord, status: 'used' as const, used_at: now, license_order_hash: cdkOrderHash,
            operator_count: cdkRecord.operator_count ?? null, config_desc: cdkRecord.config_desc ?? null,
            account_id: user.id, profile_id: profile.id, account_email_hash: createHash('sha256').update(user.email).digest('hex'), bound_at: now,
          },
          response: profile,
        }
      },
    })
    return { ok: true, profile: redeemed.response }
  } catch (error) {
    return redemptionFailure(error)
  }
}

function normalizeIdempotencyKey(value: string | null | undefined): string | null {
  const key = value?.trim() ?? ''
  return key && key.length <= 200 ? key : null
}

function redemptionFailure(error: unknown): { ok: false; status: number; message: string } {
  if (error instanceof CdkAlreadyRedeemedError || error instanceof IdempotencyConflictError) return { ok: false, status: 409, message: error.message }
  console.error('CDK redemption failed:', error instanceof Error ? error.name : typeof error)
  return { ok: false, status: 500, message: 'Internal server error' }
}

export async function requireUserSession(req: Request, now = new Date()): Promise<AuthContext | null> {
  const token = getSessionToken(req)
  if (!token) return null
  const tokenHash = hashSessionToken(token)
  const session = await getSessionByTokenHash(tokenHash)
  if (!session) return null
  if (Date.parse(session.expires_at) <= now.getTime()) {
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
  const touchCutoff = new Date(now.getTime() - USER_SESSION_TOUCH_INTERVAL_MS)
  const lastSeenAt = Date.parse(session.last_seen_at)
  if (!Number.isFinite(lastSeenAt) || lastSeenAt <= touchCutoff.getTime()) {
    await touchSession(session, now, touchCutoff)
  }
  return { user, session, tokenHash, profiles, activeProfile, cdkRecord }
}

export async function logoutRequest(req: Request): Promise<void> {
  const token = getSessionToken(req)
  if (!token) return
  await deleteSessionByTokenHash(hashSessionToken(token))
}

export async function buildAuthPayload(user: UserAccountRecord, activeProfileId?: string | null): Promise<AuthSuccessResponse> {
  await settleInvitationForActivatedUser(user.id)
  const records = await migrateLegacyUserIfNeeded(user)
  const [workspaces, announcementUnreadCount] = await Promise.all([
    listProfileWorkspaces(records.map((profile) => profile.id)),
    getAnnouncementUnreadCount(user.id),
  ])
  for (const profile of records) {
    const workspace = workspaces.get(profile.id) ?? null
    if (!workspace || !hasFreePreviewTrialEnded(profile)) continue
    const current = await updateProfileWorkspaceAtomically(profile.id, (latestWorkspace) => {
      const latest = latestWorkspace ?? emptyWorkspace(profile.id)
      return normalizeExpiredFreePreviewWorkspace(profile, latest) ?? latest
    })
    workspaces.set(profile.id, current)
  }
  const publicProfiles: UserGameAccount[] = records.map((profile) => (
    toPublicProfile(profile, workspaces.get(profile.id) ?? null, getFreePreviewTrial(profile))
  ))
  const defaultActiveProfile = records.find((profile) => profile.kind !== 'depot_value') ?? records[0] ?? null
  const activeProfileRecord = activeProfileId
    ? records.find((profile) => profile.id === activeProfileId) ?? defaultActiveProfile
    : defaultActiveProfile
  const activeWorkspace = activeProfileRecord ? workspaces.get(activeProfileRecord.id) ?? null : null
  return {
    user: toPublicUser(user),
    profiles: publicProfiles,
    active_profile: activeProfileRecord
      ? toPublicProfile(activeProfileRecord, activeWorkspace, getFreePreviewTrial(activeProfileRecord))
      : null,
    workspace: activeProfileRecord ? toPublicWorkspace(activeWorkspace) : null,
    announcement_unread_count: announcementUnreadCount,
  }
}

export async function verifyEmailWithToken(
  tokenValue: unknown,
): Promise<
  | { ok: true; user: UserAccountRecord; cookie: string }
  | { ok: false; status: number; message: string; code?: string }
> {
  if (typeof tokenValue !== 'string' || !tokenValue.trim()) {
    return { ok: false, status: 400, message: EMAIL_VERIFICATION_INVALID_MESSAGE }
  }
  const user = await verifyUserEmailWithToken(hashEmailVerificationToken(tokenValue.trim()), new Date())
  if (!user) return { ok: false, status: 400, message: EMAIL_VERIFICATION_INVALID_MESSAGE }
  const session = await createSession(user.id)
  return { ok: true, user, cookie: session.cookie }
}

export async function resendEmailVerification(emailValue: unknown): Promise<{ ok: true; message: string }> {
  const email = normalizeEmail(emailValue)
  if (!email) return { ok: true, message: EMAIL_VERIFICATION_RESEND_MESSAGE }
  try {
    const user = await getUserByEmail(email)
    if (!user || user.status !== 'active' || user.email_verified_at !== null) {
      return { ok: true, message: EMAIL_VERIFICATION_RESEND_MESSAGE }
    }
    await issueEmailVerification(user)
  } catch (error) {
    console.error('resend verification email error:', error)
    throw error
  }
  return { ok: true, message: EMAIL_VERIFICATION_RESEND_MESSAGE }
}

function normalizeExpiredFreePreviewWorkspace(
  profile: UserGameAccountRecord,
  workspace: UserWorkspaceRecord | null,
): UserWorkspaceRecord | null {
  if (!workspace || !hasFreePreviewTrialEnded(profile)) return null
  const currentConfigNeedsDowngrade = Boolean(workspace.config && !resolveFreePreviewConfig(workspace.config).ok)
  const archivedConfig = currentConfigNeedsDowngrade ? JSON.stringify(workspace.config) : null
  const savedConfigs = workspace.saved_configs.map((item) => (
    resolveFreePreviewConfig(item.config).ok ? item : { ...item, read_only: true }
  ))
  const savedConfigsChanged = savedConfigs.some((item, index) => item.read_only !== workspace.saved_configs[index]?.read_only)
  if (archivedConfig && !savedConfigs.some((item) => item.read_only && JSON.stringify(item.config) === archivedConfig)) {
    savedConfigs.unshift({
      id: randomUUID(),
      name: '体验期高级配置（只读）',
      config: workspace.config,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_used_at: null,
      read_only: true,
    })
  }
  if (!currentConfigNeedsDowngrade && !savedConfigsChanged) return null
  return {
    ...workspace,
    config: currentConfigNeedsDowngrade ? getFreePreviewDefaultConfig() : workspace.config,
    saved_configs: savedConfigs.slice(0, 20),
    updated_at: new Date().toISOString(),
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

async function getAnnouncementUnreadCount(userId: string): Promise<number> {
  const announcements = await getActiveAnnouncements()
  const readIds = new Set((await getAnnouncementReads(userId)).map((read) => read.announcement_id))
  return announcements.filter((announcement) => !readIds.has(announcement.id)).length
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
  const passwordHash = await createPasswordHash(password)
  const updated: UserAccountRecord = {
    ...user,
    password_hash: passwordHash.password_hash,
    salt: passwordHash.salt,
    iterations: passwordHash.iterations,
    password_algorithm: passwordHash.password_algorithm,
    updated_at: new Date().toISOString(),
  }
  await saveUserAccount(updated)
  return updated
}

async function tryUpgradeUserPasswordHash(
  user: UserAccountRecord,
  password: string,
): Promise<UserAccountRecord> {
  try {
    const replacement = await createPasswordHash(password)
    return await upgradeUserPasswordHash(user.id, user.password_hash, replacement) ?? user
  } catch (error) {
    console.warn('user password hash upgrade skipped:', error instanceof Error ? error.name : 'UnknownError')
    return user
  }
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
  if (!match?.[1]) return null
  try {
    const token = decodeURIComponent(match[1])
    return SESSION_TOKEN_PATTERN.test(token) ? token : null
  } catch {
    return null
  }
}

function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function hashPasswordResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function hashEmailVerificationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

async function issueEmailVerification(user: UserAccountRecord): Promise<void> {
  const resendSince = new Date(Date.now() - EMAIL_VERIFICATION_RESEND_WINDOW_MS).toISOString()
  if (await getRecentEmailVerificationTokenForUser(user.id, resendSince)) return

  const token = randomBytes(32).toString('base64url')
  const now = new Date()
  const expiresHours = getEmailVerificationTtlHours()
  await saveEmailVerificationToken({
    id: randomUUID(),
    user_id: user.id,
    token_hash: hashEmailVerificationToken(token),
    expires_at: new Date(now.getTime() + expiresHours * 60 * 60 * 1000).toISOString(),
    used_at: null,
    created_at: now.toISOString(),
  })
  try {
    await sendEmailVerificationEmail({
      email: user.email,
      verificationUrl: buildEmailVerificationUrl(token),
      expiresHours,
    })
  } catch (error) {
    await deleteEmailVerificationTokenByHash(hashEmailVerificationToken(token))
    throw error
  }
}

function verificationRequiredResult(user: UserAccountRecord) {
  return {
    ok: true as const,
    user,
    verificationRequired: true as const,
    message: EMAIL_VERIFICATION_SENT_MESSAGE,
    resendAfterSeconds: EMAIL_VERIFICATION_RESEND_WINDOW_MS / 1000,
  }
}

function buildEmailVerificationUrl(token: string): string {
  const baseUrl = process.env.PUBLIC_APP_URL?.trim()
  if (!baseUrl) throw new Error('PUBLIC_APP_URL not configured')
  const url = new URL('/verify-email', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
  url.searchParams.set('token', token)
  return url.toString()
}

function getEmailVerificationTtlHours(): number {
  const raw = Number(process.env.EMAIL_VERIFICATION_TTL_HOURS)
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : EMAIL_VERIFICATION_DEFAULT_TTL_HOURS
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
