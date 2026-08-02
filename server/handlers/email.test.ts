import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({
  markEmailDeliverySent: vi.fn(),
  markEmailDeliveryFailed: vi.fn(),
  markEmailDeliveryUncertain: vi.fn(),
  releaseEmailDeliveryReservation: vi.fn(),
  reserveSesEmail: vi.fn(),
}))

const quota = vi.hoisted(() => ({
  reserveBrevoEmailWithOfficialQuota: vi.fn(),
}))

const settings = vi.hoisted(() => ({
  getRegistrationSettings: vi.fn(),
}))

const ses = vi.hoisted(() => ({
  isSesDefiniteFailure: vi.fn(),
  isSesEmailConfigured: vi.fn(),
  sendSesTemplateEmail: vi.fn(),
}))

vi.mock('../storage/brevo-email-store', async (importOriginal) => ({
  ...await importOriginal<typeof import('../storage/brevo-email-store')>(),
  ...store,
}))

vi.mock('../brevo-quota', () => quota)
vi.mock('../storage/registration-settings-store', () => settings)
vi.mock('../ses-email', () => ses)

import {
  sendAccountDeletionCancellationEmail,
  sendAccountDeletionReceiptEmail,
  sendEmailVerificationEmail,
  sendPasswordResetEmail,
  BrevoDailyQuotaExceededError,
  type EmailDeliveryReservation,
} from './email'

describe('email provider delivery accounting', () => {
  beforeEach(() => {
    process.env.BREVO_API_KEY = 'test-key'
    process.env.BREVO_SENDER_EMAIL = 'sender@example.test'
    process.env.BREVO_RESET_TEMPLATE_ID = '1'
    process.env.BREVO_VERIFY_EMAIL_TEMPLATE_ID = '2'
    process.env.BREVO_ACCOUNT_DELETION_CANCEL_TEMPLATE_ID = '3'
    process.env.BREVO_ACCOUNT_DELETION_RECEIPT_TEMPLATE_ID = '4'
    settings.getRegistrationSettings.mockResolvedValue({ email_provider_priority: ['brevo', 'ses'] })
    quota.reserveBrevoEmailWithOfficialQuota.mockImplementation(async (purpose) => ({
      id: `reservation-${purpose}`,
      quotaDate: '2026-07-21',
      purpose,
      provider: 'brevo',
    }))
    store.reserveSesEmail.mockImplementation(async (purpose) => ({
      id: `ses-reservation-${purpose}`,
      quotaDate: '2026-07-21',
      purpose,
      provider: 'ses',
    }))
    ses.isSesEmailConfigured.mockReturnValue(true)
    ses.isSesDefiniteFailure.mockReturnValue(false)
    ses.sendSesTemplateEmail.mockResolvedValue(undefined)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 201 })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('maps all five email types to quota purposes and marks them sent', async () => {
    await sendEmailVerificationEmail({ email: 'user@example.test', verificationUrl: 'https://example.test/verify', expiresHours: 24 })
    await sendEmailVerificationEmail(
      { email: 'invited@example.test', verificationUrl: 'https://example.test/verify-admin', expiresHours: 24 },
      undefined,
      'admin_invite_verification',
    )
    await sendPasswordResetEmail({ email: 'user@example.test', resetUrl: 'https://example.test/reset', expiresMinutes: 30 })
    await sendAccountDeletionCancellationEmail('user@example.test', 'https://example.test/cancel')
    await sendAccountDeletionReceiptEmail('user@example.test', 'receipt-1')

    expect(quota.reserveBrevoEmailWithOfficialQuota.mock.calls.map(([purpose]) => purpose)).toEqual([
      'email_verification',
      'admin_invite_verification',
      'password_reset',
      'account_deletion_cancellation',
      'account_deletion_receipt',
    ])
    expect(store.markEmailDeliverySent).toHaveBeenCalledTimes(5)
  })

  it('releases a reservation after a definite Brevo rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('rejected', { status: 400 })))
    await expect(sendPasswordResetEmail({
      email: 'user@example.test',
      resetUrl: 'https://example.test/reset',
      expiresMinutes: 30,
    })).rejects.toThrow(/Brevo send failed: 400/)
    expect(store.markEmailDeliveryFailed).toHaveBeenCalledOnce()
    expect(store.markEmailDeliveryUncertain).not.toHaveBeenCalled()
  })

  it('retains quota when the network result is uncertain', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection lost')))
    await expect(sendAccountDeletionReceiptEmail('user@example.test', 'receipt-1')).rejects.toThrow('connection lost')
    expect(store.markEmailDeliveryUncertain).toHaveBeenCalledOnce()
    expect(store.markEmailDeliveryFailed).not.toHaveBeenCalled()
  })

  it('reuses a registration reservation without reserving twice', async () => {
    const reservation: EmailDeliveryReservation = {
      id: 'registration-reservation',
      quotaDate: '2026-07-21',
      purpose: 'email_verification',
      provider: 'brevo',
    }
    await sendEmailVerificationEmail({
      email: 'user@example.test',
      verificationUrl: 'https://example.test/verify',
      expiresHours: 24,
    }, reservation)
    expect(quota.reserveBrevoEmailWithOfficialQuota).not.toHaveBeenCalled()
    expect(store.markEmailDeliverySent).toHaveBeenCalledWith(reservation)
  })

  it('reuses a password reset reservation without reserving twice', async () => {
    const reservation: EmailDeliveryReservation = {
      id: 'password-reset-reservation',
      quotaDate: '2026-07-21',
      purpose: 'password_reset',
      provider: 'brevo',
    }
    await sendPasswordResetEmail({
      email: 'user@example.test',
      resetUrl: 'https://example.test/reset',
      expiresMinutes: 30,
    }, reservation)
    expect(quota.reserveBrevoEmailWithOfficialQuota).not.toHaveBeenCalled()
    expect(store.markEmailDeliverySent).toHaveBeenCalledWith(reservation)
  })

  it('falls back to Amazon SES after the Brevo quota is exhausted', async () => {
    quota.reserveBrevoEmailWithOfficialQuota.mockRejectedValueOnce(
      new BrevoDailyQuotaExceededError('2026-07-21', 120, 'daily_limit'),
    )

    await sendEmailVerificationEmail({
      email: 'user@example.test',
      verificationUrl: 'https://example.test/verify',
      expiresHours: 24,
    })

    expect(store.reserveSesEmail).toHaveBeenCalledWith('email_verification')
    expect(ses.sendSesTemplateEmail).toHaveBeenCalledWith({
      email: 'user@example.test',
      params: { verification_url: 'https://example.test/verify', expires_hours: 24 },
      purpose: 'email_verification',
    })
    expect(store.markEmailDeliverySent).toHaveBeenCalledWith(expect.objectContaining({ provider: 'ses' }))
  })

  it('uses Amazon SES first when selected in the admin settings', async () => {
    settings.getRegistrationSettings.mockResolvedValueOnce({ email_provider_priority: ['ses', 'brevo'] })

    await sendPasswordResetEmail({
      email: 'user@example.test',
      resetUrl: 'https://example.test/reset',
      expiresMinutes: 30,
    })

    expect(store.reserveSesEmail).toHaveBeenCalledWith('password_reset')
    expect(quota.reserveBrevoEmailWithOfficialQuota).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('marks an accepted SES error response as failed', async () => {
    settings.getRegistrationSettings.mockResolvedValueOnce({ email_provider_priority: ['ses', 'brevo'] })
    ses.isSesDefiniteFailure.mockReturnValueOnce(true)
    ses.sendSesTemplateEmail.mockRejectedValueOnce(Object.assign(new Error('rejected'), {
      $metadata: { httpStatusCode: 400 },
    }))

    await expect(sendAccountDeletionReceiptEmail('user@example.test', 'receipt-1')).rejects.toThrow('rejected')
    expect(store.markEmailDeliveryFailed).toHaveBeenCalledOnce()
    expect(store.markEmailDeliveryUncertain).not.toHaveBeenCalled()
  })

  it('keeps an SES reservation uncertain after a network failure', async () => {
    settings.getRegistrationSettings.mockResolvedValueOnce({ email_provider_priority: ['ses', 'brevo'] })
    ses.sendSesTemplateEmail.mockRejectedValueOnce(new Error('connection lost'))

    await expect(sendAccountDeletionCancellationEmail(
      'user@example.test',
      'https://example.test/cancel',
    )).rejects.toThrow('connection lost')
    expect(store.markEmailDeliveryUncertain).toHaveBeenCalledOnce()
    expect(store.markEmailDeliveryFailed).not.toHaveBeenCalled()
  })
})
