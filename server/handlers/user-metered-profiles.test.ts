import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createCommercialProfile: vi.fn(),
  createOrConvertMeteredPersonal: vi.fn(),
  requireUserSession: vi.fn(),
}))

vi.mock('./user-auth', () => ({
  jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }),
  requireUserSession: mocks.requireUserSession,
}))
vi.mock('../storage/personal-use-declaration-store', () => ({
  PersonalUseDeclarationRequiredError: class PersonalUseDeclarationRequiredError extends Error {
    readonly code = 'personal_use_declaration_required'
    readonly status = 428

    constructor() {
      super('请先确认当前版本的个人使用声明。')
    }
  },
}))
vi.mock('../security/client-ip', () => ({ getRequestClientIp: vi.fn(() => '203.0.113.9') }))
vi.mock('../storage/metered-profile-store', () => ({
  MeteredProfileError: class MeteredProfileError extends Error {},
  createCommercialProfile: mocks.createCommercialProfile,
  createOrConvertMeteredPersonal: mocks.createOrConvertMeteredPersonal,
  deleteCommercialProfile: vi.fn(),
  listCommercialProfiles: vi.fn(),
  patchCommercialProfile: vi.fn(),
}))

import { PersonalUseDeclarationRequiredError } from '../storage/personal-use-declaration-store'
import userMeteredProfilesHandler from './user-metered-profiles'

describe('metered profile handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireUserSession.mockResolvedValue({ user: { id: 'user-1' } })
    mocks.createOrConvertMeteredPersonal.mockResolvedValue({ id: 'personal-1', kind: 'metered_personal' })
    mocks.createCommercialProfile.mockResolvedValue({ profile: { id: 'commercial-1', kind: 'metered_commercial' } })
  })

  it('requires the current personal-use declaration before creating a personal metered profile', async () => {
    mocks.createOrConvertMeteredPersonal.mockRejectedValueOnce(new PersonalUseDeclarationRequiredError())

    const response = await userMeteredProfilesHandler(request('/api/user/profiles/metered-personal'))

    expect(response.status).toBe(428)
    await expect(response.json()).resolves.toMatchObject({ code: 'personal_use_declaration_required' })
    expect(mocks.createOrConvertMeteredPersonal).toHaveBeenCalledTimes(1)
  })

  it('creates a personal metered profile after declaration acceptance', async () => {
    const response = await userMeteredProfilesHandler(request('/api/user/profiles/metered-personal'))

    expect(response.status).toBe(201)
    expect(mocks.createOrConvertMeteredPersonal).toHaveBeenCalledWith({
      userId: 'user-1',
      profileId: undefined,
      displayName: undefined,
      note: undefined,
      personalUseClientIp: '203.0.113.9',
    })
  })

  it('does not apply the personal-use declaration to commercial profile creation', async () => {
    const response = await userMeteredProfilesHandler(request('/api/user/commercial/profiles'))

    expect(response.status).toBe(201)
    expect(mocks.createCommercialProfile).toHaveBeenCalledWith({
      userId: 'user-1',
      displayName: undefined,
      note: undefined,
    })
  })
})

function request(path: string): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
}
