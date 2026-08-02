import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2'
import type { BrevoEmailPurpose } from '../src/lib/types'

interface SesEmailConfiguration {
  region: string
  senderEmail: string
  senderName: string
  templateName: string
  configurationSetName?: string
}

export class SesEmailConfigurationError extends Error {
  constructor(readonly purpose: BrevoEmailPurpose) {
    super(`Amazon SES is not configured for ${purpose}`)
    this.name = 'SesEmailConfigurationError'
  }
}

export function isSesEmailConfigured(purpose: BrevoEmailPurpose): boolean {
  return resolveSesEmailConfiguration(purpose) !== null
}

export async function sendSesTemplateEmail(input: {
  email: string
  params: Record<string, string | number>
  purpose: BrevoEmailPurpose
}): Promise<void> {
  const configuration = resolveSesEmailConfiguration(input.purpose)
  if (!configuration) throw new SesEmailConfigurationError(input.purpose)

  const client = new SESv2Client({ region: configuration.region })
  try {
    await client.send(new SendEmailCommand({
      FromEmailAddress: formatFromAddress(configuration.senderEmail, configuration.senderName),
      Destination: { ToAddresses: [input.email] },
      Content: {
        Template: {
          TemplateName: configuration.templateName,
          TemplateData: JSON.stringify(input.params),
        },
      },
      ConfigurationSetName: configuration.configurationSetName,
      EmailTags: [{ Name: 'purpose', Value: input.purpose }],
    }))
  } finally {
    client.destroy()
  }
}

export function isSesDefiniteFailure(error: unknown): boolean {
  if (error instanceof SesEmailConfigurationError) return true
  const status = (error as { $metadata?: { httpStatusCode?: unknown } } | null)?.$metadata?.httpStatusCode
  return typeof status === 'number'
}

function resolveSesEmailConfiguration(purpose: BrevoEmailPurpose): SesEmailConfiguration | null {
  const region = process.env.AWS_SES_REGION?.trim() || process.env.AWS_REGION?.trim()
  const senderEmail = process.env.AWS_SES_SENDER_EMAIL?.trim()
  const senderName = process.env.AWS_SES_SENDER_NAME?.trim() || 'MAA Admin'
  const templateName = process.env[templateEnvironmentName(purpose)]?.trim()
  const configurationSetName = process.env.AWS_SES_CONFIGURATION_SET_NAME?.trim() || undefined
  if (!region || !senderEmail || !templateName) return null
  return { region, senderEmail, senderName, templateName, configurationSetName }
}

function templateEnvironmentName(purpose: BrevoEmailPurpose): string {
  if (purpose === 'password_reset') return 'AWS_SES_RESET_TEMPLATE_NAME'
  if (purpose === 'account_deletion_cancellation') return 'AWS_SES_ACCOUNT_DELETION_CANCEL_TEMPLATE_NAME'
  if (purpose === 'account_deletion_receipt') return 'AWS_SES_ACCOUNT_DELETION_RECEIPT_TEMPLATE_NAME'
  return 'AWS_SES_VERIFY_EMAIL_TEMPLATE_NAME'
}

function formatFromAddress(email: string, name: string): string {
  const safeName = name.replace(/[\r\n"]/g, ' ').trim()
  return safeName ? `"${safeName}" <${email}>` : email
}
