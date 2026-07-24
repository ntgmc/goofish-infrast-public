import { beforeEach, describe, expect, it, vi } from 'vitest'
import accountDataHandler from './account-data'

const mocks = vi.hoisted(() => ({
  getProfileForUser: vi.fn(),
  saveUserProfile: vi.fn(),
  requireUserSession: vi.fn(),
}))

vi.mock('../storage/user-store', () => ({
  getProfileForUser: mocks.getProfileForUser,
  getProfileWorkspace: vi.fn(),
  getUserById: vi.fn(),
  listProfilesForUser: vi.fn(),
  saveUserProfile: mocks.saveUserProfile,
}))

vi.mock('../storage/postgres', () => ({ query: vi.fn() }))
vi.mock('../account-data-lifecycle', () => ({ cancelAccountDeletion: vi.fn(), requestAccountDeletion: vi.fn() }))
vi.mock('../security/password', () => ({ verifyPasswordHash: vi.fn() }))
vi.mock('./user-auth', () => ({
  clearSessionCookie: vi.fn(),
  normalizeEmail: vi.fn(),
  requireUserSession: mocks.requireUserSession,
  jsonResponse: (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: status === 204 ? undefined : { 'Content-Type': 'application/json' },
  }),
}))

const binding = {
  uid: '12345678',
  nickname: '博士',
  channel_name: '官服',
  bound_at: '2026-01-01T00:00:00.000Z',
  last_imported_at: '2026-01-02T00:00:00.000Z',
  encrypted_cred: 'encrypted-credential',
  credential_status: 'available' as const,
  credential_invalid_at: null,
  credential_invalid_reason: null,
}

beforeEach(() => {
  mocks.requireUserSession.mockResolvedValue({ user: { id: 'user-1', email: 'user@example.test' } })
  mocks.getProfileForUser.mockResolvedValue({
    id: 'profile-1',
    user_id: 'user-1',
    skland_binding: binding,
    skland_pending_binding: null,
    updated_at: '2026-01-02T00:00:00.000Z',
  })
})

describe('account data Skland controls', () => {
  it('clears the credential while preserving the bound account identity', async () => {
    const response = await accountDataHandler(new Request('http://localhost/api/user/data/credential/clear', {
      method: 'POST',
      body: JSON.stringify({ profile_id: 'profile-1' }),
      headers: { 'Content-Type': 'application/json' },
    }))

    expect(response.status).toBe(200)
    expect(mocks.saveUserProfile).toHaveBeenCalledWith(expect.objectContaining({
      skland_binding: expect.objectContaining({
        uid: binding.uid,
        nickname: binding.nickname,
        channel_name: binding.channel_name,
        bound_at: binding.bound_at,
        encrypted_cred: '',
        credential_status: 'invalid',
      }),
    }))
  })

  it('does not expose an unlink action through the account data handler', async () => {
    const response = await accountDataHandler(new Request('http://localhost/api/user/data/skland/unlink', {
      method: 'POST',
      body: JSON.stringify({ profile_id: 'profile-1' }),
      headers: { 'Content-Type': 'application/json' },
    }))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'API route not found' })
    expect(mocks.saveUserProfile).not.toHaveBeenCalled()
  })

  it('does not expose depot sample revocation through the account data handler', async () => {
    const response = await accountDataHandler(new Request('http://localhost/api/user/data/depot-sample/revoke', {
      method: 'POST',
      body: JSON.stringify({ profile_id: 'profile-1' }),
      headers: { 'Content-Type': 'application/json' },
    }))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'API route not found' })
  })
})
