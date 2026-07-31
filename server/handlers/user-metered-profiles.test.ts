import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  acceptance: vi.fn(),
  createCommercialProfile: vi.fn(),
  createOrConvertMeteredPersonal: vi.fn(),
  effective: vi.fn(),
  requireUserSession: vi.fn(),
}))

vi.mock('./user-auth', () => ({
  jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }),
  requireUserSession: mocks.requireUserSession,
}))
vi.mock('../personal-use-declaration', () => ({
  isCurrentPersonalUseDeclarationEffective: mocks.effective,
}))
vi.mock('../storage/personal-use-declaration-store', () => ({
  getPersonalUseDeclarationAcceptance: mocks.acceptance,
}))
vi.mock('../storage/metered-profile-store', () => ({
  MeteredProfileError: class MeteredProfileError extends Error {},
  createCommercialProfile: mocks.createCommercialProfile,
  createOrConvertMeteredPersonal: mocks.createOrConvertMeteredPersonal,
  deleteCommercialProfile: vi.fn(),
  listCommercialProfiles: vi.fn(),
  patchCommercialProfile: vi.fn(),
}))

import userMeteredProfilesHandler from './user-metered-profiles'

describe('metered profile handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireUserSession.mockResolvedValue({ user: { id: 'user-1' } })
    mocks.effective.mockReturnValue(true)
    mocks.createOrConvertMeteredPersonal.mockResolvedValue({ id: 'personal-1', kind: 'metered_personal' })
    mocks.createCommercialProfile.mockResolvedValue({ profile: { id: 'commercial-1', kind: 'metered_commercial' } })
  })

  it('requires the current personal-use declaration before creating a personal metered profile', async () => {
    mocks.acceptance.mockResolvedValue(null)

    const response = await userMeteredProfilesHandler(request('/api/user/profiles/metered-personal'))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ code: 'personal_use_declaration_required' })
    expect(mocks.createOrConvertMeteredPersonal).not.toHaveBeenCalled()
  })

  it('creates a personal metered profile after declaration acceptance', async () => {
    mocks.acceptance.mockResolvedValue({ declaration_id: 'personal_use_v1_1' })

    const response = await userMeteredProfilesHandler(request('/api/user/profiles/metered-personal'))

    expect(response.status).toBe(201)
    expect(mocks.createOrConvertMeteredPersonal).toHaveBeenCalledWith({
      userId: 'user-1',
      profileId: undefined,
      displayName: undefined,
      note: undefined,
    })
  })

  it('does not apply the personal-use declaration to commercial profile creation', async () => {
    mocks.acceptance.mockResolvedValue(null)

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
