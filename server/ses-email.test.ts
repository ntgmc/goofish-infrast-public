import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const aws = vi.hoisted(() => ({
  command: vi.fn(),
  destroy: vi.fn(),
  send: vi.fn(),
  client: vi.fn(),
}))

vi.mock('@aws-sdk/client-sesv2', () => ({
  SESv2Client: class {
    constructor(configuration: unknown) {
      aws.client(configuration)
    }

    send(command: unknown) {
      return aws.send(command)
    }

    destroy() {
      aws.destroy()
    }
  },
  SendEmailCommand: class {
    readonly input: unknown

    constructor(input: unknown) {
      this.input = input
      aws.command(input)
    }
  },
}))

import {
  isSesDefiniteFailure,
  isSesEmailConfigured,
  sendSesTemplateEmail,
  SesEmailConfigurationError,
} from './ses-email'

describe('Amazon SES email adapter', () => {
  beforeEach(() => {
    process.env.AWS_SES_REGION = 'ap-southeast-1'
    process.env.AWS_SES_SENDER_EMAIL = 'sender@example.test'
    process.env.AWS_SES_SENDER_NAME = 'MAA Admin'
    process.env.AWS_SES_VERIFY_EMAIL_TEMPLATE_NAME = 'verify-email'
    process.env.AWS_SES_CONFIGURATION_SET_NAME = 'transactional'
    aws.send.mockResolvedValue({ MessageId: 'message-1' })
  })

  afterEach(() => {
    vi.clearAllMocks()
    delete process.env.AWS_SES_REGION
    delete process.env.AWS_REGION
    delete process.env.AWS_SES_SENDER_EMAIL
    delete process.env.AWS_SES_SENDER_NAME
    delete process.env.AWS_SES_VERIFY_EMAIL_TEMPLATE_NAME
    delete process.env.AWS_SES_RESET_TEMPLATE_NAME
    delete process.env.AWS_SES_CONFIGURATION_SET_NAME
  })

  it('sends a templated verification email through SES v2', async () => {
    await sendSesTemplateEmail({
      email: 'user@example.test',
      params: { verification_url: 'https://example.test/verify', expires_hours: 24 },
      purpose: 'email_verification',
    })

    expect(aws.client).toHaveBeenCalledWith({ region: 'ap-southeast-1' })
    expect(aws.command).toHaveBeenCalledWith({
      FromEmailAddress: '"MAA Admin" <sender@example.test>',
      Destination: { ToAddresses: ['user@example.test'] },
      Content: {
        Template: {
          TemplateName: 'verify-email',
          TemplateData: JSON.stringify({
            verification_url: 'https://example.test/verify',
            expires_hours: 24,
          }),
        },
      },
      ConfigurationSetName: 'transactional',
      EmailTags: [{ Name: 'purpose', Value: 'email_verification' }],
    })
    expect(aws.send).toHaveBeenCalledOnce()
    expect(aws.destroy).toHaveBeenCalledOnce()
  })

  it('requires a purpose-specific template and classifies known responses as definite', async () => {
    expect(isSesEmailConfigured('password_reset')).toBe(false)
    await expect(sendSesTemplateEmail({
      email: 'user@example.test',
      params: {},
      purpose: 'password_reset',
    })).rejects.toBeInstanceOf(SesEmailConfigurationError)

    expect(isSesDefiniteFailure({ $metadata: { httpStatusCode: 400 } })).toBe(true)
    expect(isSesDefiniteFailure(new Error('connection lost'))).toBe(false)
  })
})
