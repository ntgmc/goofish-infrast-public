import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({
  reserveBrevoEmail: vi.fn(),
  markBrevoEmailSent: vi.fn(),
  markBrevoEmailFailed: vi.fn(),
  markBrevoEmailUncertain: vi.fn(),
  releaseBrevoEmailReservation: vi.fn(),
}))

vi.mock('../storage/brevo-email-store', async (importOriginal) => ({
  ...await importOriginal<typeof import('../storage/brevo-email-store')>(),
  ...store,
}))

import {
  sendAccountDeletionCancellationEmail,
  sendAccountDeletionReceiptEmail,
  sendEmailVerificationEmail,
  sendPasswordResetEmail,
  type BrevoEmailReservation,
} from './email'

describe('Brevo email delivery accounting', () => {
  beforeEach(() => {
    process.env.BREVO_API_KEY = 'test-key'
    process.env.BREVO_SENDER_EMAIL = 'sender@example.test'
    process.env.BREVO_RESET_TEMPLATE_ID = '1'
    process.env.BREVO_VERIFY_EMAIL_TEMPLATE_ID = '2'
    process.env.BREVO_ACCOUNT_DELETION_CANCEL_TEMPLATE_ID = '3'
    process.env.BREVO_ACCOUNT_DELETION_RECEIPT_TEMPLATE_ID = '4'
    store.reserveBrevoEmail.mockImplementation(async (purpose) => ({ id: `reservation-${purpose}`, quotaDate: '2026-07-21', purpose }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 201 })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('maps all four email types to quota purposes and marks them sent', async () => {
    await sendEmailVerificationEmail({ email: 'user@example.test', verificationUrl: 'https://example.test/verify', expiresHours: 24 })
    await sendPasswordResetEmail({ email: 'user@example.test', resetUrl: 'https://example.test/reset', expiresMinutes: 30 })
    await sendAccountDeletionCancellationEmail('user@example.test', 'https://example.test/cancel')
    await sendAccountDeletionReceiptEmail('user@example.test', 'receipt-1')

    expect(store.reserveBrevoEmail.mock.calls.map(([purpose]) => purpose)).toEqual([
      'email_verification',
      'password_reset',
      'account_deletion_cancellation',
      'account_deletion_receipt',
    ])
    expect(store.markBrevoEmailSent).toHaveBeenCalledTimes(4)
  })

  it('releases a reservation after a definite Brevo rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('rejected', { status: 400 })))
    await expect(sendPasswordResetEmail({
      email: 'user@example.test',
      resetUrl: 'https://example.test/reset',
      expiresMinutes: 30,
    })).rejects.toThrow(/Brevo send failed: 400/)
    expect(store.markBrevoEmailFailed).toHaveBeenCalledOnce()
    expect(store.markBrevoEmailUncertain).not.toHaveBeenCalled()
  })

  it('retains quota when the network result is uncertain', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connection lost')))
    await expect(sendAccountDeletionReceiptEmail('user@example.test', 'receipt-1')).rejects.toThrow('connection lost')
    expect(store.markBrevoEmailUncertain).toHaveBeenCalledOnce()
    expect(store.markBrevoEmailFailed).not.toHaveBeenCalled()
  })

  it('reuses a registration reservation without reserving twice', async () => {
    const reservation: BrevoEmailReservation = {
      id: 'registration-reservation',
      quotaDate: '2026-07-21',
      purpose: 'email_verification',
    }
    await sendEmailVerificationEmail({
      email: 'user@example.test',
      verificationUrl: 'https://example.test/verify',
      expiresHours: 24,
    }, reservation)
    expect(store.reserveBrevoEmail).not.toHaveBeenCalled()
    expect(store.markBrevoEmailSent).toHaveBeenCalledWith(reservation)
  })
})
