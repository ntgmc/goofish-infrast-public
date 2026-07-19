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
}

export async function sendPasswordResetEmail(input: SendPasswordResetEmailInput): Promise<void> {
  await sendLifecycleEmail({
    email: input.email,
    templateId: requiredTemplateId('BREVO_RESET_TEMPLATE_ID'),
    params: { reset_url: input.resetUrl, expires_minutes: input.expiresMinutes },
  })
}

export async function sendEmailVerificationEmail(input: SendEmailVerificationEmailInput): Promise<void> {
  await sendLifecycleEmail({
    email: input.email,
    templateId: requiredTemplateId('BREVO_VERIFY_EMAIL_TEMPLATE_ID'),
    params: { verification_url: input.verificationUrl, expires_hours: input.expiresHours },
  })
}

export async function sendAccountDeletionCancellationEmail(email: string, cancelUrl: string): Promise<void> {
  await sendLifecycleEmail({
    email,
    templateId: requiredTemplateId('BREVO_ACCOUNT_DELETION_CANCEL_TEMPLATE_ID'),
    params: { cancel_url: cancelUrl, expires_days: 7 },
  })
}

export async function sendAccountDeletionReceiptEmail(email: string, receiptId: string): Promise<void> {
  await sendLifecycleEmail({
    email,
    templateId: requiredTemplateId('BREVO_ACCOUNT_DELETION_RECEIPT_TEMPLATE_ID'),
    params: { receipt_id: receiptId },
  })
}

async function sendLifecycleEmail(input: SendLifecycleEmailInput): Promise<void> {
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

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
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

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Brevo send failed: ${response.status} ${text.slice(0, 500)}`)
  }
}

function requiredTemplateId(name: string): number {
  const value = Number(process.env[name])
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} not configured`)
  return value
}
