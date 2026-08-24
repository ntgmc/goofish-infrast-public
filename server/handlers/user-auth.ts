import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Announcement, AuthSuccessResponse, AuthUser, UserGameAccount } from '../../src/lib/types'
import {
  AUTH_EMAIL_MAX_LENGTH,
  AUTH_PASSWORD_MAX_LENGTH,
  AUTH_PASSWORD_MIN_LENGTH,
  AUTH_RESEND_COOLDOWN_SECONDS,
} from '../../src/lib/auth-constraints'
import {
  deleteSessionByTokenHash,
  emptyWorkspace,
  getAnnouncementReads,
  getPasswordResetTokenByHash,
  getProfileForUser,
  getRecentPasswordResetTokenForUser,
  getRecentEmailVerificationTokenForUser,
  getSessionByTokenHash,
  getUserByEmail,
  getUserById,
  insertUserAccountForRegistration,
  listProfileWorkspaces,
  listProfileWorkspaceSummaries,
  listProfilesForUser,
  migrateLegacyUserIfNeeded,
  savePasswordResetToken,
  saveEmailVerificationToken,
  saveUserProfile,
  saveUserSession,
  isFreePreviewProfile,
  toPublicProfile,
  toPublicWorkspace,
  touchSession,
  updateUserPasswordAtomically,
  verifyUserEmailWithToken,
  upgradeUserPasswordHash,
  RegistrationEmailConflictError,
  type UserAccountRecord,
  type UserGameAccountRecord,
  type UserSessionRecord,
  type UpdateUserPasswordAtomicallyInput,
} from '../storage/user-store'
import { getProfileCapacityLimits } from '../storage/inventory-store'
import { getWorkspaceOptimizationResultOverview } from '../storage/optimization-result-store'
import { createPostgresAnnouncementStore } from '../storage/announcement-store'
import { getFreePreviewTrial } from '../free-preview-trial'
import { createPasswordHash, verifyPasswordHash, verifyPasswordHashOrDummy } from '../security/password'
import {
  BrevoDailyQuotaExceededError,
  releaseEmailDeliveryReservation,
  reserveEmailVerificationDelivery,
  reservePasswordResetDelivery,
  sendEmailVerificationEmail,
  sendPasswordResetEmail,
  type EmailDeliveryReservation,
} from './email'
import { getRegistrationSettings } from '../storage/registration-settings-store'
import { validateRegistrationEmailForRegistration } from '../security/registration-email-policy'
import { authCopy } from '../../src/copy/zh-CN/auth'
import {
  findCdkRecordByCode,
  addProfileCdkDuration,
  getCdkType,
  getCdkProfileDuration,
  getCdkProfileExpiresAt,
  isProfileCdkRecord,
  getCdkRecordStore,
  normalizeCode,
  normalizePermissionMode,
  type CdkRecord,
} from './license-utils'
import {
  CdkAlreadyRedeemedError,
  IdempotencyConflictError,
  createRequestHash,
  redeemCdkAtomically,
  saveUserAccountInTransaction,
  updateRegisteredUserCdkInTransaction,
  saveProfileInTransaction,
  saveWorkspaceInTransaction,
} from '../storage/cdk-redemption'
import {
  InvitationCodeError,
  saveInvitationInTransaction,
  saveRegistrationWithInvitation,
  activateInvitationForUser,
  validateInvitationCode,
  type ValidatedInvitationCode,
} from '../storage/invitation-store'
import {
  AdminRegistrationInvitationError,
  consumeAdminRegistrationInvitationInTransaction,
  normalizeAdminRegistrationInviteCode,
  saveRegistrationWithAdminInvitation,
  userRegisteredWithAdminInvitation,
  validateAdminRegistrationInvitation,
  type ValidatedAdminRegistrationInvitation,
} from '../storage/admin-registration-invitation-store'
import { selectAuthPayloadProfiles } from './auth-payload-profiles'
import { projectExpiredFreePreviewWorkspace } from '../free-preview-workspace'

const SESSION_COOKIE = 'maa_session'
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30
export const USER_SESSION_TOUCH_INTERVAL_MS = 10 * 60 * 1000
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ANNOUNCEMENT_KEY = 'current.json'
const PASSWORD_RESET_DEFAULT_TTL_MINUTES = 30
const PASSWORD_RESET_RESEND_WINDOW_MS = AUTH_RESEND_COOLDOWN_SECONDS * 1000
const EMAIL_VERIFICATION_DEFAULT_TTL_HOURS = 24
const EMAIL_VERIFICATION_RESEND_WINDOW_MS = AUTH_RESEND_COOLDOWN_SECONDS * 1000

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
  return EMAIL_PATTERN.test(email) && email.length <= AUTH_EMAIL_MAX_LENGTH ? email : null
}

function validatePassword(value: unknown): { ok: true; password: string } | { ok: false; message: string } {
  if (typeof value !== 'string') return { ok: false, message: authCopy.api_password_type_invalid }
  if (value.length < AUTH_PASSWORD_MIN_LENGTH) return { ok: false, message: authCopy.api_password_too_short }
  if (value.length > AUTH_PASSWORD_MAX_LENGTH) return { ok: false, message: authCopy.api_password_too_long }
  return { ok: true, password: value }
}

export async function registerUser(
  emailValue: unknown,
  passwordValue: unknown,
  cdkValue?: unknown,
  idempotencyKey?: string | null,
  inviteCodeValue?: unknown,
): Promise<
  | { ok: true; user: UserAccountRecord | null; verificationRequired: false }
  | { ok: true; user: UserAccountRecord | null; verificationRequired: true; message: string; resendAfterSeconds: number }
  | { ok: false; status: number; message: string; code?: string; retryAfterSeconds?: number; suggestedEmail?: string }
> {
  const emailCheck = validateRegistrationEmailForRegistration(emailValue)
  if (!emailCheck.ok) return emailCheck
  const email = emailCheck.email
  const passwordCheck = validatePassword(passwordValue)
  if (!passwordCheck.ok) return { ok: false, status: 400, message: passwordCheck.message }
  const registrationSettings = await getRegistrationSettings()
  if (registrationSettings.invite_code_required && (typeof inviteCodeValue !== 'string' || !inviteCodeValue.trim())) {
    return { ok: false, status: 400, message: authCopy.api_invite_code_required, code: 'invite_code_required' }
  }
  const normalizedInviteCode = typeof inviteCodeValue === 'string' ? inviteCodeValue.trim().toUpperCase() : null
  let invitation: ValidatedInvitationCode | null = null
  let adminInvitation: ValidatedAdminRegistrationInvitation | null = null
  try {
    if (normalizeAdminRegistrationInviteCode(normalizedInviteCode)) {
      adminInvitation = await validateAdminRegistrationInvitation(normalizedInviteCode)
    } else if (normalizedInviteCode) {
      if (registrationSettings.invite_code_required) throw new AdminRegistrationInvitationError()
      invitation = await validateInvitationCode(normalizedInviteCode)
    }
  } catch (error) {
    if (error instanceof InvitationCodeError || error instanceof AdminRegistrationInvitationError) {
      return { ok: false, status: 400, message: error.message, code: error.code }
    }
    throw error
  }
  let verificationRequired = registrationSettings.email_verification_required
  let emailReservation: EmailDeliveryReservation | null = null

  if (verificationRequired) {
    try {
      emailReservation = await reserveEmailVerificationDelivery(
        adminInvitation ? 'admin_invite_verification' : 'email_verification',
      )
    } catch (error) {
      if (!(error instanceof BrevoDailyQuotaExceededError)) throw error
      if (registrationSettings.brevo_quota_action === 'pause_registration') {
        return {
          ok: false,
          status: 503,
          message: error.reason === 'reserved_capacity'
            ? authCopy.api_registration_brevo_reserve_reached
            : authCopy.api_registration_brevo_limit_reached,
          code: error.code,
          retryAfterSeconds: error.retryAfterSeconds,
        }
      }
      verificationRequired = false
    }
  }

  try {
    const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey)
    const registrationRequestHash = typeof cdkValue === 'string' && cdkValue.trim()
      ? createRequestHash({ code: normalizeCode(cdkValue), email, password: passwordCheck.password, invite_code: normalizedInviteCode })
      : null
    const now = new Date().toISOString()
    const passwordHash = await createPasswordHash(passwordCheck.password)
    const existing = await getUserByEmail(email)
    if (existing) return acceptedRegistrationResult(null, verificationRequired)

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
      email_verified_at: verificationRequired ? null : now,
      created_at: now,
      updated_at: now,
    }
    try {
      if (typeof cdkValue === 'string' && cdkValue.trim()) {
        const redeemed = await redeemRegistrationCdk(
          user,
          cdkValue,
          normalizedIdempotencyKey,
          registrationRequestHash!,
          invitation,
          adminInvitation,
        )
        if (!redeemed.ok) return redeemed
        user.permission = redeemed.profile.permission
        user.cdk_key = redeemed.profile.cdk_key
        user.cdk_code_hash = redeemed.profile.cdk_code_hash
        user.cdk_order_hash = redeemed.profile.cdk_order_hash
        user.updated_at = redeemed.profile.updated_at
      } else {
        if (adminInvitation) {
          await saveRegistrationWithAdminInvitation(
            (client) => saveUserAccountInTransaction(client, user),
            adminInvitation,
            user.id,
          )
        } else if (invitation) {
          await saveRegistrationWithInvitation(user, invitation)
        } else {
          await insertUserAccountForRegistration(user)
        }
      }
    } catch (error) {
      if (error instanceof RegistrationEmailConflictError) {
        return acceptedRegistrationResult(null, verificationRequired)
      }
      if (error instanceof AdminRegistrationInvitationError) {
        return { ok: false, status: 400, message: error.message, code: error.code }
      }
      throw error
    }

    if (verificationRequired) {
      try {
        await issueEmailVerification(user, emailReservation ?? undefined)
      } catch (error) {
        console.warn('registration verification email delivery failed:', safeErrorName(error))
      }
      return acceptedRegistrationResult(user, true)
    }

    return { ok: true, user, verificationRequired: false }
  } finally {
    if (emailReservation) await safelyReleaseEmailReservation(emailReservation)
  }
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
    return { ok: false, status: 401, message: authCopy.api_credentials_invalid }
  }

  let user = await getUserByEmail(email)
  const passwordVerification = await verifyPasswordHashOrDummy(password, user)
  if (!user || !passwordVerification.verified) {
    return { ok: false, status: 401, message: authCopy.api_credentials_invalid }
  }
  if (user.status !== 'active') {
    return { ok: false, status: 403, message: authCopy.api_account_inactive }
  }
  if (user.email_verified_at === null) {
    return { ok: false, status: 403, message: authCopy.api_email_not_verified, code: 'email_not_verified' }
  }

  if (passwordVerification.needsRehash) {
    user = await tryUpgradeUserPasswordHash(user, password)
  }

  await migrateLegacyUserIfNeeded(user)
  const session = await createSession(user.id)
  scheduleInvitationSettlement(user.id)
  return { ok: true, user, cookie: session.cookie }
}

export async function changeUserPassword(
  user: UserAccountRecord,
  oldPasswordValue: unknown,
  newPasswordValue: unknown,
  keepTokenHash: string,
): Promise<
  | { ok: true; user: UserAccountRecord }
  | { ok: false; status: number; message: string; code?: 'password_update_conflict' }
> {
  if (typeof oldPasswordValue !== 'string') {
    return { ok: false, status: 401, message: authCopy.api_current_password_invalid }
  }
  const passwordVerification = await verifyPasswordHash(oldPasswordValue, user)
  if (!passwordVerification.verified) {
    return { ok: false, status: 401, message: authCopy.api_current_password_invalid }
  }
  const nextPassword = validatePassword(newPasswordValue)
  if (!nextPassword.ok) return { ok: false, status: 400, message: nextPassword.message }
  const replacement = await createPasswordHash(nextPassword.password)
  const updated = await updateUserPasswordAtomically({
    userId: user.id,
    expectedPasswordHash: user.password_hash,
    replacement,
    updatedAt: new Date(),
    keepSessionTokenHash: keepTokenHash,
  })
  if (!updated.ok) {
    return {
      ok: false,
      status: 409,
      message: authCopy.api_password_update_conflict,
      code: 'password_update_conflict',
    }
  }
  return updated
}

export async function resetUserPasswordByAdmin(
  user: UserAccountRecord,
  newPasswordValue: unknown,
  adminAudit?: UpdateUserPasswordAtomicallyInput['adminAudit'],
): Promise<
  | { ok: true; user: UserAccountRecord }
  | { ok: false; status: number; message: string; code?: 'password_update_conflict' }
> {
  const nextPassword = validatePassword(newPasswordValue)
  if (!nextPassword.ok) return { ok: false, status: 400, message: nextPassword.message }
  if (user.status !== 'active') {
    return {
      ok: false,
      status: 409,
      message: authCopy.api_password_update_conflict,
      code: 'password_update_conflict',
    }
  }
  const replacement = await createPasswordHash(nextPassword.password)
  const updated = await updateUserPasswordAtomically({
    userId: user.id,
    expectedPasswordHash: user.password_hash,
    replacement,
    updatedAt: new Date(),
    adminAudit,
  })
  if (!updated.ok) {
    return {
      ok: false,
      status: 409,
      message: authCopy.api_password_update_conflict,
      code: 'password_update_conflict',
    }
  }
  return updated
}

export async function requestPasswordReset(emailValue: unknown): Promise<{ ok: true; message: string }> {
  const email = normalizeEmail(emailValue)
  if (!email) return { ok: true, message: authCopy.api_password_reset_requested }

  try {
    const user = await getUserByEmail(email)
    if (!user || user.status !== 'active') return { ok: true, message: authCopy.api_password_reset_requested }

    const resendSince = new Date(Date.now() - PASSWORD_RESET_RESEND_WINDOW_MS).toISOString()
    const recent = await getRecentPasswordResetTokenForUser(user.id, resendSince)
    if (recent) return { ok: true, message: authCopy.api_password_reset_requested }

    const reservation = await reservePasswordResetDelivery()
    const token = randomBytes(32).toString('base64url')
    const now = new Date()
    const expiresMinutes = getPasswordResetTtlMinutes()
    const expiresAt = new Date(now.getTime() + expiresMinutes * 60 * 1000).toISOString()
    try {
      await savePasswordResetToken({
        id: randomUUID(),
        user_id: user.id,
        token_hash: hashPasswordResetToken(token),
        delivery_id: reservation.id,
        expires_at: expiresAt,
        used_at: null,
        created_at: now.toISOString(),
      })

      await sendPasswordResetEmail({
        email: user.email,
        resetUrl: buildPasswordResetUrl(token),
        expiresMinutes,
      }, reservation)
    } finally {
      await safelyReleaseEmailReservation(reservation)
    }
  } catch (error) {
    console.error('password reset request error:', error)
  }

  return { ok: true, message: authCopy.api_password_reset_requested }
}

export async function resetPasswordWithToken(
  tokenValue: unknown,
  newPasswordValue: unknown,
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  if (typeof tokenValue !== 'string' || !tokenValue.trim()) {
    return { ok: false, status: 400, message: authCopy.api_password_reset_invalid }
  }

  const tokenHash = hashPasswordResetToken(tokenValue.trim())
  const resetToken = await getPasswordResetTokenByHash(tokenHash)
  if (!resetToken || resetToken.used_at || Date.parse(resetToken.expires_at) <= Date.now()) {
    return { ok: false, status: 400, message: authCopy.api_password_reset_invalid }
  }

  const user = await getUserById(resetToken.user_id)
  if (!user || user.status !== 'active') {
    return { ok: false, status: 400, message: authCopy.api_password_reset_invalid }
  }

  const nextPassword = validatePassword(newPasswordValue)
  if (!nextPassword.ok) return { ok: false, status: 400, message: nextPassword.message }

  const passwordHash = await createPasswordHash(nextPassword.password)
  const updated = await updateUserPasswordAtomically({
    userId: user.id,
    expectedPasswordHash: user.password_hash,
    replacement: passwordHash,
    updatedAt: new Date(),
    resetTokenHash: tokenHash,
  })
  if (!updated.ok) return { ok: false, status: 400, message: authCopy.api_password_reset_invalid }
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
  if (typeof codeValue !== 'string' || !codeValue.trim()) return { ok: false, status: 400, message: authCopy.api_cdk_required }

  const normalizedCode = normalizeCode(codeValue)
  const cdkMatch = await findCdkRecordByCode(normalizedCode)
  if (!cdkMatch) return { ok: false, status: 404, message: authCopy.api_cdk_not_found }
  const { codeHash, key: cdkKey, record: cdkRecord } = cdkMatch
  if (!isProfileCdkRecord(cdkRecord)) return profileCdkTypeFailure(cdkRecord)
  if (!idempotencyKey && cdkRecord.status === 'frozen') return { ok: false, status: 409, message: authCopy.api_cdk_frozen }
  if (!idempotencyKey && cdkRecord.status === 'revoked') return { ok: false, status: 409, message: authCopy.api_cdk_revoked }
  const now = new Date().toISOString()
  const profileId = randomUUID()
  const requestedDisplayName = normalizeProfileDisplayName(displayNameValue)
  const displayName = requestedDisplayName || await nextDefaultProfileName(user.id)
  const note = normalizeProfileNote(noteValue)
  try {
    const redeemed = await redeemCdkAtomically({
      key: cdkKey,
      idempotencyKey: normalizeIdempotencyKey(idempotencyKey),
      idempotencyScope: `profile:${user.id}`,
      requestHash: createRequestHash({ codeHash, displayName: requestedDisplayName || null, note }),
      complete: async (client, cdkRecord) => {
        if (!isProfileCdkRecord(cdkRecord)) throw new Error(authCopy.api_cdk_type_mismatch)
        const permission = normalizePermissionMode(cdkRecord.permission)
        const profileExpiresAt = resolveProfileCdkExpiresAt(cdkRecord, now)
        const cdkOrderHash = cdkRecord.license_order_hash || createAccountOrderHash(codeHash, profileId)
        const profile: UserGameAccountRecord = {
          version: 1, id: profileId, user_id: user.id, kind: 'cdk', cdk_key: cdkKey, cdk_code_hash: codeHash,
          cdk_order_hash: cdkOrderHash, permission, status: 'active', display_name: displayName, note,
          expires_at: profileExpiresAt, created_at: now, updated_at: now,
        }
        await saveProfileInTransaction(client, profile)
        await saveWorkspaceInTransaction(client, emptyWorkspace(profile.id))
        const record = {
          ...cdkRecord, status: 'used' as const, used_at: now, license_order_hash: cdkOrderHash,
          profile_expires_at: profileExpiresAt,
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
    message: authCopy.api_free_profile_skland_required,
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
    return { ok: false, status: 400, message: authCopy.api_free_profile_required }
  }
  const profile = await getProfileForUser(user.id, profileIdValue.trim())
  if (!profile) return { ok: false, status: 404, message: authCopy.api_profile_not_found }
  if (!idempotencyKey && !isFreePreviewProfile(profile) && profile.kind !== 'metered_personal') {
    return { ok: false, status: 400, message: authCopy.api_free_profile_upgrade_only }
  }
  if (!idempotencyKey && profile.status !== 'active') {
    return { ok: false, status: 403, message: authCopy.api_profile_unavailable }
  }
  if (typeof codeValue !== 'string' || !codeValue.trim()) {
    return { ok: false, status: 400, message: authCopy.api_cdk_required }
  }

  const normalizedCode = normalizeCode(codeValue)
  const cdkMatch = await findCdkRecordByCode(normalizedCode)
  if (!cdkMatch) return { ok: false, status: 404, message: authCopy.api_cdk_not_found }
  const { codeHash, key: cdkKey, record: cdkRecord } = cdkMatch
  if (!isProfileCdkRecord(cdkRecord)) return profileCdkTypeFailure(cdkRecord)
  if (!idempotencyKey && cdkRecord.status === 'frozen') return { ok: false, status: 409, message: authCopy.api_cdk_frozen }
  if (!idempotencyKey && cdkRecord.status === 'revoked') return { ok: false, status: 409, message: authCopy.api_cdk_revoked }
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
        if (!isProfileCdkRecord(cdkRecord)) throw new Error(authCopy.api_cdk_type_mismatch)
        const locked = await client.query<{ record_json: UserGameAccountRecord }>(
          'select record_json from user_game_accounts where id = $1 and user_id = $2 for update', [profile.id, user.id],
        )
        const current = locked.rows[0]?.record_json
        if (!current || (!isFreePreviewProfile(current) && current.kind !== 'metered_personal') || current.status !== 'active') throw new Error('档案当前不可用。')
        const cdkOrderHash = cdkRecord.license_order_hash || createAccountOrderHash(codeHash, current.id)
        const profileExpiresAt = resolveProfileCdkExpiresAt(cdkRecord, now)
        const upgraded: UserGameAccountRecord = {
          ...current, kind: 'cdk', cdk_key: cdkKey, cdk_code_hash: codeHash, cdk_order_hash: cdkOrderHash,
          permission: normalizePermissionMode(cdkRecord.permission), display_name: displayName || current.display_name || '免费个人排班', note: note || current.note,
          expires_at: profileExpiresAt, updated_at: now,
        }
        await saveProfileInTransaction(client, upgraded)
        await saveWorkspaceInTransaction(client, emptyWorkspace(upgraded.id))
        const record = {
          ...cdkRecord, status: 'used' as const, used_at: now, license_order_hash: cdkOrderHash,
          profile_expires_at: profileExpiresAt,
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
  adminInvitation?: ValidatedAdminRegistrationInvitation | null,
): Promise<{ ok: true; profile: UserGameAccountRecord } | { ok: false; status: number; message: string; code?: string }> {
  const cdkMatch = await findCdkRecordByCode(normalizeCode(codeValue))
  if (!cdkMatch) return { ok: false, status: 404, message: authCopy.api_cdk_not_found }
  const { codeHash, key: cdkKey, record: cdkRecord } = cdkMatch
  if (!isProfileCdkRecord(cdkRecord)) return profileCdkTypeFailure(cdkRecord)
  const now = new Date().toISOString()
  const profileId = randomUUID()
  try {
    const redeemed = await redeemCdkAtomically({
      key: cdkKey,
      idempotencyKey: normalizeIdempotencyKey(idempotencyKey),
      idempotencyScope: `register:${user.email}`,
      requestHash: requestHash ?? createRequestHash({ codeHash, email: user.email }),
      prepare: (client) => saveUserAccountInTransaction(client, user),
      complete: async (client, cdkRecord) => {
        if (!isProfileCdkRecord(cdkRecord)) throw new Error(authCopy.api_cdk_type_mismatch)
        const cdkOrderHash = cdkRecord.license_order_hash || createAccountOrderHash(codeHash, profileId)
        const permission = normalizePermissionMode(cdkRecord.permission)
        const profileExpiresAt = resolveProfileCdkExpiresAt(cdkRecord, now)
        const boundUser: UserAccountRecord = {
          ...user, permission, cdk_key: cdkKey, cdk_code_hash: codeHash, cdk_order_hash: cdkOrderHash, updated_at: now,
        }
        const profile: UserGameAccountRecord = {
          version: 1, id: profileId, user_id: user.id, kind: 'cdk', cdk_key: cdkKey, cdk_code_hash: codeHash,
          cdk_order_hash: cdkOrderHash, permission, status: 'active', display_name: '账号 1', note: '',
          expires_at: profileExpiresAt, created_at: now, updated_at: now,
        }
        await updateRegisteredUserCdkInTransaction(client, boundUser)
        if (invitation) await saveInvitationInTransaction(client, user.id, invitation)
        if (adminInvitation) await consumeAdminRegistrationInvitationInTransaction(client, adminInvitation, user.id)
        await saveProfileInTransaction(client, profile)
        await saveWorkspaceInTransaction(client, emptyWorkspace(profile.id))
        return {
          record: {
            ...cdkRecord, status: 'used' as const, used_at: now, license_order_hash: cdkOrderHash,
            profile_expires_at: profileExpiresAt,
            operator_count: cdkRecord.operator_count ?? null, config_desc: cdkRecord.config_desc ?? null,
            account_id: user.id, profile_id: profile.id, account_email_hash: createHash('sha256').update(user.email).digest('hex'), bound_at: now,
          },
          response: profile,
        }
      },
    })
    return { ok: true, profile: redeemed.response }
  } catch (error) {
    if (error instanceof RegistrationEmailConflictError) throw error
    return redemptionFailure(error)
  }
}

function normalizeIdempotencyKey(value: string | null | undefined): string | null {
  const key = value?.trim() ?? ''
  return key && key.length <= 200 ? key : null
}

function profileCdkTypeFailure(record: CdkRecord): { ok: false; status: number; message: string; code: string } {
  if (getCdkType(record) === 'item') {
    return { ok: false, status: 409, message: authCopy.api_cdk_type_unavailable, code: 'cdk_type_mismatch' }
  }
  return { ok: false, status: 409, message: authCopy.api_cdk_type_mismatch, code: 'cdk_type_mismatch' }
}

function redemptionFailure(error: unknown): { ok: false; status: number; message: string; code?: string } {
  if (error instanceof CdkAlreadyRedeemedError) return { ok: false, status: 409, message: authCopy.api_cdk_already_redeemed }
  if (error instanceof IdempotencyConflictError) return { ok: false, status: 409, message: authCopy.api_idempotency_conflict }
  if (error instanceof AdminRegistrationInvitationError) {
    return { ok: false, status: 400, message: error.message, code: error.code }
  }
  console.error('CDK redemption failed:', error instanceof Error ? error.name : typeof error)
  return { ok: false, status: 500, message: authCopy.api_internal_error }
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
  const allRecords = await migrateLegacyUserIfNeeded(user)
  const { records, activeProfileRecord, workspaceProfileIds } = selectAuthPayloadProfiles(allRecords, activeProfileId)
  const [workspaces, workspaceSummaries, announcementUnreadCount, activeCapacityLimits, activeOverview] = await Promise.all([
    listProfileWorkspaces(activeProfileRecord ? [activeProfileRecord.id] : []),
    listProfileWorkspaceSummaries(workspaceProfileIds),
    getAnnouncementUnreadCount(user.id),
    activeProfileRecord ? getProfileCapacityLimits(activeProfileRecord.id) : null,
    activeProfileRecord ? getWorkspaceOptimizationResultOverview(activeProfileRecord.id) : null,
  ])
  if (activeProfileRecord) {
    const activeWorkspace = workspaces.get(activeProfileRecord.id)
    if (activeWorkspace) {
      workspaces.set(
        activeProfileRecord.id,
        projectExpiredFreePreviewWorkspace(activeProfileRecord, activeWorkspace).workspace,
      )
    }
  }
  const publicProfiles: UserGameAccount[] = records.map((profile) => (
    toPublicProfile(
      profile,
      workspaces.get(profile.id) ?? workspaceSummaries.get(profile.id) ?? null,
      getFreePreviewTrial(profile),
    )
  ))
  const activeWorkspace = activeProfileRecord ? workspaces.get(activeProfileRecord.id) ?? null : null
  return {
    user: toPublicUser(user),
    profiles: publicProfiles,
    active_profile: activeProfileRecord
      ? toPublicProfile(
          activeProfileRecord,
          activeWorkspace ?? workspaceSummaries.get(activeProfileRecord.id) ?? null,
          getFreePreviewTrial(activeProfileRecord),
        )
      : null,
    workspace: activeProfileRecord
      ? toPublicWorkspace(activeWorkspace, activeCapacityLimits ?? undefined, activeOverview ?? undefined)
      : null,
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
    return { ok: false, status: 400, message: authCopy.api_email_verification_invalid }
  }
  const user = await verifyUserEmailWithToken(hashEmailVerificationToken(tokenValue.trim()), new Date())
  if (!user) return { ok: false, status: 400, message: authCopy.api_email_verification_invalid }
  const session = await createSession(user.id)
  scheduleInvitationSettlement(user.id)
  return { ok: true, user, cookie: session.cookie }
}

export async function resendEmailVerification(emailValue: unknown): Promise<{ ok: true; message: string }> {
  const email = normalizeEmail(emailValue)
  if (!email) return { ok: true, message: authCopy.api_email_verification_resend }
  try {
    const user = await getUserByEmail(email)
    if (!user || user.status !== 'active' || user.email_verified_at !== null) {
      return { ok: true, message: authCopy.api_email_verification_resend }
    }
    await issueEmailVerification(user)
  } catch (error) {
    console.warn('resend verification email delivery skipped:', safeErrorName(error))
  }
  return { ok: true, message: authCopy.api_email_verification_resend }
}

export async function resendEmailVerificationForUserId(userId: string): Promise<boolean> {
  const user = await getUserById(userId)
  if (!user || user.email_verified_at) return false
  await issueEmailVerification(user)
  return true
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
  try {
    const announcements = await getActiveAnnouncements()
    const readIds = new Set((await getAnnouncementReads(userId)).map((read) => read.announcement_id))
    return announcements.filter((announcement) => !readIds.has(announcement.id)).length
  } catch (error) {
    console.warn('announcement unread count unavailable:', safeErrorName(error))
    return 0
  }
}

export function scheduleInvitationSettlement(userId: string): void {
  void activateInvitationForUser(userId).catch((error) => {
    console.warn('invitation activation deferred:', safeErrorName(error))
  })
}

export async function getActiveAnnouncements(): Promise<Announcement[]> {
  const store = createPostgresAnnouncementStore(ANNOUNCEMENT_KEY)
  const { data: value } = await store.get()
  if (!value || typeof value !== 'object' || !Array.isArray((value as { announcements?: unknown }).announcements)) return []
  return ((value as { announcements: unknown[] }).announcements)
    .filter((item): item is Announcement => isAnnouncement(item) && item.kind === 'popup' && item.active)
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureCookieSuffix()}`
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

async function issueEmailVerification(
  user: UserAccountRecord,
  suppliedReservation?: EmailDeliveryReservation,
): Promise<void> {
  const resendSince = new Date(Date.now() - EMAIL_VERIFICATION_RESEND_WINDOW_MS).toISOString()
  if (await getRecentEmailVerificationTokenForUser(user.id, resendSince)) return

  const purpose = suppliedReservation?.purpose === 'admin_invite_verification'
    || (!suppliedReservation && await userRegisteredWithAdminInvitation(user.id))
    ? 'admin_invite_verification'
    : 'email_verification'
  const reservation = suppliedReservation ?? await reserveEmailVerificationDelivery(purpose)
  try {
    const token = randomBytes(32).toString('base64url')
    const now = new Date()
    const expiresHours = getEmailVerificationTtlHours()
    await saveEmailVerificationToken({
      id: randomUUID(),
      user_id: user.id,
      token_hash: hashEmailVerificationToken(token),
      delivery_id: reservation.id,
      expires_at: new Date(now.getTime() + expiresHours * 60 * 60 * 1000).toISOString(),
      used_at: null,
      created_at: now.toISOString(),
    })
    await sendEmailVerificationEmail({
      email: user.email,
      verificationUrl: buildEmailVerificationUrl(token),
      expiresHours,
    }, reservation, purpose)
  } finally {
    if (!suppliedReservation) await safelyReleaseEmailReservation(reservation)
  }
}

async function safelyReleaseEmailReservation(reservation: EmailDeliveryReservation): Promise<void> {
  try {
    await releaseEmailDeliveryReservation(reservation)
  } catch (error) {
    console.error('registration email reservation release error:', error)
  }
}

function acceptedRegistrationResult(user: UserAccountRecord | null, verificationRequired: boolean) {
  if (!verificationRequired) return { ok: true as const, user, verificationRequired: false as const }
  return {
    ok: true as const,
    user,
    verificationRequired: true as const,
    message: authCopy.api_email_verification_sent,
    resendAfterSeconds: EMAIL_VERIFICATION_RESEND_WINDOW_MS / 1000,
  }
}

function safeErrorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error
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

function resolveProfileCdkExpiresAt(cdkRecord: CdkRecord, now: string): string | null {
  return getCdkProfileExpiresAt(cdkRecord) ?? addProfileCdkDuration(now, getCdkProfileDuration(cdkRecord))
}

async function getCdkRecordForProfile(profile: UserGameAccountRecord): Promise<CdkRecord | null> {
  if (!profile.cdk_key) return null
  const store = await getCdkRecordStore()
  const record = await store.get(profile.cdk_key)
  return record && isProfileCdkRecord(record) ? record : null
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
