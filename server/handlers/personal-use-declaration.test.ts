import { beforeEach, describe, expect, it, vi } from 'vitest'
import personalUseDeclarationHandler from './personal-use-declaration'

const mocks = vi.hoisted(() => ({
  requireUserSession: vi.fn(),
  getProfileForUser: vi.fn(),
  isFreePreviewProfile: vi.fn(),
  getAcceptance: vi.fn(),
  confirm: vi.fn(),
  getRequestClientIp: vi.fn(),
}))

vi.mock('../storage/user-store', () => ({
  getProfileForUser: mocks.getProfileForUser,
  isFreePreviewProfile: mocks.isFreePreviewProfile,
}))

vi.mock('../storage/personal-use-declaration-store', () => ({
  getPersonalUseDeclarationAcceptance: mocks.getAcceptance,
  confirmPersonalUseDeclaration: mocks.confirm,
}))

vi.mock('../security/client-ip', () => ({ getRequestClientIp: mocks.getRequestClientIp }))

vi.mock('./user-auth', () => ({
  requireUserSession: mocks.requireUserSession,
  jsonResponse: (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: status === 204 ? undefined : { 'Content-Type': 'application/json' },
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireUserSession.mockResolvedValue({ user: { id: 'user-1' } })
  mocks.getRequestClientIp.mockReturnValue('203.0.113.8')
  mocks.isFreePreviewProfile.mockReturnValue(true)
  mocks.getProfileForUser.mockResolvedValue({ id: 'profile-1', user_id: 'user-1', kind: 'free_preview' })
  mocks.confirm.mockResolvedValue({
    declaration_id: 'personal_use_v1',
    declaration_version: 'V1.0',
    action: 'generated_result_export',
    accepted_at: '2026-07-23T10:00:00.000Z',
  })
})

describe('personal use declaration endpoint', () => {
  it('reports whether the current declaration is already accepted', async () => {
    mocks.getAcceptance.mockResolvedValue(null)

    const response = await personalUseDeclarationHandler(new Request('http://localhost/api/user/personal-use-declaration?profile_id=profile-1'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      accepted: false,
      declaration: { id: 'personal_use_v1', version: 'V1.0' },
    })
    expect(mocks.getProfileForUser).toHaveBeenCalledWith('user-1', 'profile-1')
  })

  it('only records result export confirmation for the caller\'s free preview profile', async () => {
    const response = await personalUseDeclarationHandler(new Request('http://localhost/api/user/personal-use-declaration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'generated_result_export', profile_id: 'profile-1' }),
    }))

    expect(response.status).toBe(200)
    expect(mocks.confirm).toHaveBeenCalledWith('user-1', 'generated_result_export', '203.0.113.8', 'profile-1')
    await expect(response.json()).resolves.toMatchObject({ accepted: true })
  })

  it('rejects attempts to attach generated-result confirmation to a non-free profile', async () => {
    mocks.isFreePreviewProfile.mockReturnValue(false)

    const response = await personalUseDeclarationHandler(new Request('http://localhost/api/user/personal-use-declaration', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'generated_result_export', profile_id: 'profile-1' }),
    }))

    expect(response.status).toBe(403)
    expect(mocks.confirm).not.toHaveBeenCalled()
  })
})
