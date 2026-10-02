import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRegistrationSettings: vi.fn(),
  validateAdminRegistrationInvitation: vi.fn(),
  reserveEmailVerificationDelivery: vi.fn(),
}))

vi.mock('../storage/registration-settings-store', async (importOriginal) => ({
  ...await importOriginal<typeof import('../storage/registration-settings-store')>(),
  getRegistrationSettings: mocks.getRegistrationSettings,
}))
vi.mock('../storage/admin-registration-invitation-store', async (importOriginal) => ({
  ...await importOriginal<typeof import('../storage/admin-registration-invitation-store')>(),
  validateAdminRegistrationInvitation: mocks.validateAdminRegistrationInvitation,
}))
vi.mock('./email', async (importOriginal) => ({
  ...await importOriginal<typeof import('./email')>(),
  reserveEmailVerificationDelivery: mocks.reserveEmailVerificationDelivery,
}))

import { registerUser } from './user-auth'
import { DEFAULT_REGISTRATION_SETTINGS } from '../storage/registration-settings-store'

const continued = new Error('registration continued')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getRegistrationSettings.mockResolvedValue({ ...DEFAULT_REGISTRATION_SETTINGS, bot_registration_enabled: false })
  mocks.validateAdminRegistrationInvitation.mockResolvedValue({ source: 'qqbot' })
  mocks.reserveEmailVerificationDelivery.mockRejectedValue(continued)
})

it('blocks previously issued Bot invitations before email delivery or account creation', async () => {
  await expect(registerUser('user@qq.com', 'valid-password', undefined, undefined, '12AB34CD5E6F7G8H'))
    .resolves.toMatchObject({ ok: false, status: 403, code: 'bot_registration_disabled' })
  expect(mocks.reserveEmailVerificationDelivery).not.toHaveBeenCalled()
})

it('allows Bot invitations when enabled and ordinary invitations when disabled', async () => {
  mocks.getRegistrationSettings.mockResolvedValueOnce(DEFAULT_REGISTRATION_SETTINGS)
  await expect(registerUser('user@qq.com', 'valid-password', undefined, undefined, '12AB34CD5E6F7G8H')).rejects.toBe(continued)
  mocks.validateAdminRegistrationInvitation.mockResolvedValueOnce({})
  await expect(registerUser('user@qq.com', 'valid-password', undefined, undefined, '12AB34CD5E6F7G8H')).rejects.toBe(continued)
  await expect(registerUser('user@qq.com', 'valid-password')).rejects.toBe(continued)
})
