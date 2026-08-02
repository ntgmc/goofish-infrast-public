import type { BrevoEmailPurpose } from '../../src/lib/types'
import {
  BrevoDailyQuotaExceededError,
  markEmailDeliveryFailed,
  markEmailDeliverySent,
  markEmailDeliveryUncertain,
  releaseEmailDeliveryReservation as releaseStoredEmailDeliveryReservation,
  reserveSesEmail,
  type EmailDeliveryReservation,
} from '../storage/brevo-email-store'
import { reserveBrevoEmailWithOfficialQuota } from '../brevo-quota'
import { getRegistrationSettings } from '../storage/registration-settings-store'
import {
  isSesDefiniteFailure,
  isSesEmailConfigured,
  sendSesTemplateEmail,
} from '../ses-email'

export { BrevoDailyQuotaExceededError }
export type { EmailDeliveryReservation }

interface SendPasswordResetEmailInput {
  email: string
  resetUrl: string
  expiresMinutes: number
}

interface SendEmailVerificationEmailInput {
  email: string
  verificationUrl: string
  expiresHours: number
}

interface SendLifecycleEmailInput {
  email: string
  params: Record<string, string | number>
  purpose: BrevoEmailPurpose
  reservation?: EmailDeliveryReservation
}

export async function sendPasswordResetEmail(
  input: SendPasswordResetEmailInput,
  reservation?: EmailDeliveryReservation,
): Promise<void> {
  await sendLifecycleEmail({
    email: input.email,
    params: { reset_url: input.resetUrl, expires_minutes: input.expiresMinutes },
    purpose: 'password_reset',
    reservation,
  })
}

export async function reserveEmailVerificationDelivery(
  purpose: 'email_verification' | 'admin_invite_verification' = 'email_verification',
): Promise<EmailDeliveryReservation> {
  return reserveEmailDelivery(purpose)
}

export async function reservePasswordResetDelivery(): Promise<EmailDeliveryReservation> {
  return reserveEmailDelivery('password_reset')
}

export async function releaseEmailDeliveryReservation(reservation: EmailDeliveryReservation): Promise<void> {
  await releaseStoredEmailDeliveryReservation(reservation)
}

export async function sendEmailVerificationEmail(
  input: SendEmailVerificationEmailInput,
  reservation?: EmailDeliveryReservation,
  purpose: 'email_verification' | 'admin_invite_verification' = reservation?.purpose === 'admin_invite_verification'
    ? 'admin_invite_verification'
    : 'email_verification',
): Promise<void> {
  await sendLifecycleEmail({
    email: input.email,
    params: { verification_url: input.verificationUrl, expires_hours: input.expiresHours },
    purpose,
    reservation,
  })
}

export async function sendAccountDeletionCancellationEmail(email: string, cancelUrl: string): Promise<void> {
  await sendLifecycleEmail({
    email,
    params: { cancel_url: cancelUrl, expires_days: 7 },
    purpose: 'account_deletion_cancellation',
  })
}

export async function sendAccountDeletionReceiptEmail(email: string, receiptId: string): Promise<void> {
  await sendLifecycleEmail({
    email,
    params: { receipt_id: receiptId },
    purpose: 'account_deletion_receipt',
  })
}

async function sendLifecycleEmail(input: SendLifecycleEmailInput): Promise<void> {
  const reservation = input.reservation ?? await reserveEmailDelivery(input.purpose)
  if (reservation.provider === 'ses') {
    await sendWithSes(input, reservation)
    return
  }
  await sendWithBrevo(input, reservation)
}

async function reserveEmailDelivery(purpose: BrevoEmailPurpose): Promise<EmailDeliveryReservation> {
  const { email_provider_priority: priority } = await getRegistrationSettings()
  let quotaError: BrevoDailyQuotaExceededError | null = null

  for (const provider of priority) {
    if (provider === 'ses') {
      if (isSesEmailConfigured(purpose)) return reserveSesEmail(purpose)
      continue
    }
    if (!isBrevoEmailConfigured(purpose)) continue
    try {
      return await reserveBrevoEmailWithOfficialQuota(purpose)
    } catch (error) {
      if (!(error instanceof BrevoDailyQuotaExceededError)) throw error
      quotaError = error
    }
  }

  if (quotaError) throw quotaError
  throw new Error(`No configured email provider is available for ${purpose}`)
}

async function sendWithBrevo(
  input: SendLifecycleEmailInput,
  reservation: EmailDeliveryReservation,
): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY?.trim()
  const senderEmail = process.env.BREVO_SENDER_EMAIL?.trim()
  const senderName = process.env.BREVO_SENDER_NAME?.trim() || 'MAA Admin'

  if (!apiKey) throw new Error('BREVO_API_KEY not configured')
  if (!senderEmail) throw new Error('BREVO_SENDER_EMAIL not configured')

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'api-key': apiKey,
  }
  if (process.env.BREVO_SANDBOX === '1') headers['X-Sib-Sandbox'] = 'drop'

  let response: Response
  try {
    response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        sender: {
          name: senderName,
          email: senderEmail,
        },
        to: [
          {
            email: input.email,
          },
        ],
        templateId: requiredTemplateId(brevoTemplateEnvironmentName(input.purpose)),
        params: input.params,
      }),
    })
  } catch (error) {
    await markEmailDeliveryUncertain(reservation)
    throw error
  }

  if (!response.ok) {
    let responseText = ''
    try {
      responseText = await response.text()
    } finally {
      await markEmailDeliveryFailed(reservation)
    }
    throw new Error(`Brevo send failed: ${response.status} ${responseText.slice(0, 500)}`)
  }

  await markEmailDeliverySent(reservation)
}

async function sendWithSes(
  input: SendLifecycleEmailInput,
  reservation: EmailDeliveryReservation,
): Promise<void> {
  try {
    await sendSesTemplateEmail({ email: input.email, params: input.params, purpose: input.purpose })
  } catch (error) {
    if (isSesDefiniteFailure(error)) await markEmailDeliveryFailed(reservation)
    else await markEmailDeliveryUncertain(reservation)
    throw error
  }
  await markEmailDeliverySent(reservation)
}

function isBrevoEmailConfigured(purpose: BrevoEmailPurpose): boolean {
  const templateId = Number(process.env[brevoTemplateEnvironmentName(purpose)])
  return Boolean(process.env.BREVO_API_KEY?.trim())
    && Boolean(process.env.BREVO_SENDER_EMAIL?.trim())
    && Number.isInteger(templateId)
    && templateId > 0
}

function brevoTemplateEnvironmentName(purpose: BrevoEmailPurpose): string {
  if (purpose === 'password_reset') return 'BREVO_RESET_TEMPLATE_ID'
  if (purpose === 'account_deletion_cancellation') return 'BREVO_ACCOUNT_DELETION_CANCEL_TEMPLATE_ID'
  if (purpose === 'account_deletion_receipt') return 'BREVO_ACCOUNT_DELETION_RECEIPT_TEMPLATE_ID'
  return 'BREVO_VERIFY_EMAIL_TEMPLATE_ID'
}

function requiredTemplateId(name: string): number {
  const value = Number(process.env[name])
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} not configured`)
  return value
}
