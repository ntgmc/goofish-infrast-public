import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRegistrationSettings: vi.fn(),
  validateAdminRegistrationInvitation: vi.fn(),
  reserveEmailVerificationDelivery: vi.fn(),
  getUserByEmail: vi.fn(),
  insertUserAccountForRegistration: vi.fn(),
}))

vi.mock('../storage/user-store', async (importOriginal) => ({
  ...await importOriginal<typeof import('../storage/user-store')>(),
  getUserByEmail: mocks.getUserByEmail,
  insertUserAccountForRegistration: mocks.insertUserAccountForRegistration,
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
import { RegistrationEmailDeletedError } from '../storage/user-store'
import { DEFAULT_REGISTRATION_SETTINGS } from '../storage/registration-settings-store'

const continued = new Error('registration continued')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getRegistrationSettings.mockResolvedValue({ ...DEFAULT_REGISTRATION_SETTINGS, bot_registration_enabled: false })
  mocks.validateAdminRegistrationInvitation.mockResolvedValue({ source: 'qqbot' })
  mocks.reserveEmailVerificationDelivery.mockRejectedValue(continued)
  mocks.getUserByEmail.mockResolvedValue(null)
  mocks.insertUserAccountForRegistration.mockResolvedValue(undefined)
})

it('blocks previously issued Bot invitations before email delivery or account creation', async () => {
  await expect(registerUser('user@qq.com', 'valid-password', undefined, undefined, '12AB34CD5E6F7G8H'))
    .resolves.toMatchObject({ ok: false, status: 403, code: 'bot_registration_disabled' })
  expect(mocks.reserveEmailVerificationDelivery).not.toHaveBeenCalled()
})

it('returns an actionable registration error for a permanently deleted email', async () => {
  mocks.getRegistrationSettings.mockResolvedValueOnce({ ...DEFAULT_REGISTRATION_SETTINGS, email_verification_required: false })
  mocks.insertUserAccountForRegistration.mockRejectedValueOnce(new RegistrationEmailDeletedError())
  await expect(registerUser('USER@qq.com', 'valid-password')).resolves.toMatchObject({
    ok: false, status: 403, code: 'registration_email_deleted', message: '此邮箱对应的账号已注销，无法再次注册。',
  })
})

it('allows Bot invitations when enabled and ordinary invitations when disabled', async () => {
  mocks.getRegistrationSettings.mockResolvedValueOnce(DEFAULT_REGISTRATION_SETTINGS)
  await expect(registerUser('user@qq.com', 'valid-password', undefined, undefined, '12AB34CD5E6F7G8H')).rejects.toBe(continued)
  mocks.validateAdminRegistrationInvitation.mockResolvedValueOnce({})
  await expect(registerUser('user@qq.com', 'valid-password', undefined, undefined, '12AB34CD5E6F7G8H')).rejects.toBe(continued)
  await expect(registerUser('user@qq.com', 'valid-password')).rejects.toBe(continued)
})
