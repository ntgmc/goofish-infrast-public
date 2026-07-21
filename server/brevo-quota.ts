import type { BrevoEmailPurpose } from '../src/lib/types'
import {
  BREVO_DAILY_EMAIL_LIMIT,
  getUtcDate,
  getBrevoOfficialQuotaSnapshot,
  recordBrevoOfficialQuotaSyncFailure,
  reserveBrevoEmail,
  saveBrevoOfficialQuotaSnapshot,
  type BrevoEmailReservation,
  type BrevoOfficialQuotaSnapshot,
} from './storage/brevo-email-store'
import { getRegistrationSettings } from './storage/registration-settings-store'

const BREVO_ACCOUNT_URL = 'https://api.brevo.com/v3/account'
const OFFICIAL_QUOTA_REFRESH_INTERVAL_MS = 60_000
const OFFICIAL_QUOTA_REQUEST_TIMEOUT_MS = 3_000

const refreshPromises = new Map<string, Promise<BrevoOfficialQuotaSnapshot | null>>()

export async function reserveBrevoEmailWithOfficialQuota(
  purpose: BrevoEmailPurpose,
  now = new Date(),
): Promise<BrevoEmailReservation> {
  const [, settings] = await Promise.all([
    refreshBrevoOfficialQuotaIfStale(now),
    getRegistrationSettings(),
  ])
  return reserveBrevoEmail(purpose, now, {
    adminInviteReserve: settings.admin_invite_email_reserve,
    passwordResetReserve: settings.password_reset_email_reserve,
  })
}

export async function refreshBrevoOfficialQuotaIfStale(
  now = new Date(),
  force = false,
): Promise<BrevoOfficialQuotaSnapshot | null> {
  const existing = await getBrevoOfficialQuotaSnapshot(now)
  if (!force && isSnapshotInCooldown(existing, now)) return existing
  const quotaDate = getUtcDate(now)
  const pending = refreshPromises.get(quotaDate)
  if (pending) return pending

  const refresh = performOfficialQuotaRefresh(now).finally(() => {
    if (refreshPromises.get(quotaDate) === refresh) refreshPromises.delete(quotaDate)
  })
  refreshPromises.set(quotaDate, refresh)
  return refresh
}

export function parseBrevoAccountRemainingCredits(value: unknown): number {
  if (!value || typeof value !== 'object') throw new Error('Brevo account response is invalid')
  const plans = (value as { plan?: unknown }).plan
  if (!Array.isArray(plans)) throw new Error('Brevo account response has no plans')
  const candidates = plans.filter((plan): plan is Record<string, unknown> => (
    Boolean(plan) && typeof plan === 'object' && (plan as Record<string, unknown>).creditsType === 'sendLimit'
  ))
  const emailPlan = candidates.find((plan) => plan.type === 'free')
    ?? candidates.find((plan) => plan.type !== 'sms')
  if (!emailPlan) throw new Error('Brevo email send-limit plan was not found')

  const credits = Number(emailPlan.credits)
  if (!Number.isFinite(credits) || credits < 0) throw new Error('Brevo email credits are invalid')
  return Math.min(BREVO_DAILY_EMAIL_LIMIT, Math.trunc(credits))
}

async function performOfficialQuotaRefresh(now: Date): Promise<BrevoOfficialQuotaSnapshot | null> {
  const apiKey = process.env.BREVO_API_KEY?.trim()
  if (!apiKey) {
    await recordBrevoOfficialQuotaSyncFailure(now)
    return getBrevoOfficialQuotaSnapshot(now)
  }

  try {
    const response = await fetch(BREVO_ACCOUNT_URL, {
      method: 'GET',
      headers: { 'api-key': apiKey },
      signal: AbortSignal.timeout(OFFICIAL_QUOTA_REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`Brevo account request failed with status ${response.status}`)
    const remainingCredits = parseBrevoAccountRemainingCredits(await response.json())
    return await saveBrevoOfficialQuotaSnapshot(remainingCredits, now)
  } catch (error) {
    await recordBrevoOfficialQuotaSyncFailure(now)
    console.warn('[brevo] official quota sync failed:', safeErrorMessage(error))
    return getBrevoOfficialQuotaSnapshot(now)
  }
}

function isSnapshotInCooldown(snapshot: BrevoOfficialQuotaSnapshot | null, now: Date): boolean {
  if (!snapshot) return false
  const referenceAt = snapshot.syncStatus === 'success' ? snapshot.syncedAt : snapshot.lastAttemptAt
  if (!referenceAt) return false
  const timestamp = Date.parse(referenceAt)
  return Number.isFinite(timestamp) && now.getTime() - timestamp < OFFICIAL_QUOTA_REFRESH_INTERVAL_MS
}

function safeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error'
  if (error.name === 'TimeoutError') return 'request timed out'
  return error.message.slice(0, 200)
}
