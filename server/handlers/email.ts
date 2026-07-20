import type { BrevoEmailPurpose } from '../../src/lib/types'
import {
  BrevoDailyQuotaExceededError,
  markBrevoEmailFailed,
  markBrevoEmailSent,
  markBrevoEmailUncertain,
  releaseBrevoEmailReservation,
  type BrevoEmailReservation,
} from '../storage/brevo-email-store'
import { reserveBrevoEmailWithOfficialQuota } from '../brevo-quota'

export { BrevoDailyQuotaExceededError }
export type { BrevoEmailReservation }

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
  templateId: number
  params: Record<string, string | number>
  purpose: BrevoEmailPurpose
  reservation?: BrevoEmailReservation
}

export async function sendPasswordResetEmail(input: SendPasswordResetEmailInput): Promise<void> {
  await sendLifecycleEmail({
    email: input.email,
    templateId: requiredTemplateId('BREVO_RESET_TEMPLATE_ID'),
    params: { reset_url: input.resetUrl, expires_minutes: input.expiresMinutes },
    purpose: 'password_reset',
  })
}

export async function reserveEmailVerificationDelivery(): Promise<BrevoEmailReservation> {
  return reserveBrevoEmailWithOfficialQuota('email_verification')
}

export async function releaseEmailDeliveryReservation(reservation: BrevoEmailReservation): Promise<void> {
  await releaseBrevoEmailReservation(reservation)
}

export async function sendEmailVerificationEmail(
  input: SendEmailVerificationEmailInput,
  reservation?: BrevoEmailReservation,
): Promise<void> {
  await sendLifecycleEmail({
    email: input.email,
    templateId: requiredTemplateId('BREVO_VERIFY_EMAIL_TEMPLATE_ID'),
    params: { verification_url: input.verificationUrl, expires_hours: input.expiresHours },
    purpose: 'email_verification',
    reservation,
  })
}

export async function sendAccountDeletionCancellationEmail(email: string, cancelUrl: string): Promise<void> {
  await sendLifecycleEmail({
    email,
    templateId: requiredTemplateId('BREVO_ACCOUNT_DELETION_CANCEL_TEMPLATE_ID'),
    params: { cancel_url: cancelUrl, expires_days: 7 },
    purpose: 'account_deletion_cancellation',
  })
}

export async function sendAccountDeletionReceiptEmail(email: string, receiptId: string): Promise<void> {
  await sendLifecycleEmail({
    email,
    templateId: requiredTemplateId('BREVO_ACCOUNT_DELETION_RECEIPT_TEMPLATE_ID'),
    params: { receipt_id: receiptId },
    purpose: 'account_deletion_receipt',
  })
}

async function sendLifecycleEmail(input: SendLifecycleEmailInput): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY?.trim()
  const senderEmail = process.env.BREVO_SENDER_EMAIL?.trim()
  const senderName = process.env.BREVO_SENDER_NAME?.trim() || 'MAA Admin'

  if (!apiKey) throw new Error('BREVO_API_KEY not configured')
  if (!senderEmail) throw new Error('BREVO_SENDER_EMAIL not configured')

  const reservation = input.reservation ?? await reserveBrevoEmailWithOfficialQuota(input.purpose)

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
        templateId: input.templateId,
        params: input.params,
      }),
    })
  } catch (error) {
    await markBrevoEmailUncertain(reservation)
    throw error
  }

  if (!response.ok) {
    let responseText = ''
    try {
      responseText = await response.text()
    } finally {
      await markBrevoEmailFailed(reservation)
    }
    throw new Error(`Brevo send failed: ${response.status} ${responseText.slice(0, 500)}`)
  }

  await markBrevoEmailSent(reservation)
}

function requiredTemplateId(name: string): number {
  const value = Number(process.env[name])
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} not configured`)
  return value
}
