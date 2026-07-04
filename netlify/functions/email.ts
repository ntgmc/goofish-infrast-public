interface SendPasswordResetEmailInput {
  email: string
  resetUrl: string
  expiresMinutes: number
}

export async function sendPasswordResetEmail(input: SendPasswordResetEmailInput): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY?.trim()
  const senderEmail = process.env.BREVO_SENDER_EMAIL?.trim()
  const senderName = process.env.BREVO_SENDER_NAME?.trim() || 'MAA Admin'
  const templateId = Number(process.env.BREVO_RESET_TEMPLATE_ID)

  if (!apiKey) throw new Error('BREVO_API_KEY not configured')
  if (!senderEmail) throw new Error('BREVO_SENDER_EMAIL not configured')
  if (!Number.isInteger(templateId) || templateId <= 0) {
    throw new Error('BREVO_RESET_TEMPLATE_ID not configured')
  }

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
      templateId,
      params: {
        reset_url: input.resetUrl,
        expires_minutes: input.expiresMinutes,
      },
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Brevo send failed: ${response.status} ${text.slice(0, 500)}`)
  }
}
