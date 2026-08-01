import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getProfileWorkspace: vi.fn(),
  listProfileWorkspaces: vi.fn(),
  listProfilesForUser: vi.fn(),
  requireUserSession: vi.fn(),
}))

vi.mock('../storage/user-store', () => ({
  emptyWorkspace: vi.fn(),
  getOrCreateDepotValueProfile: vi.fn(),
  getProfileForUser: vi.fn(),
  getProfileWorkspace: mocks.getProfileWorkspace,
  isDepotValueProfile: () => false,
  listProfileWorkspaces: mocks.listProfileWorkspaces,
  listProfilesForUser: mocks.listProfilesForUser,
  saveProfileWorkspace: vi.fn(),
  toPublicProfile: (profile: { id: string }, workspace: unknown) => ({ id: profile.id, workspace }),
  updateUserProfileMetadata: vi.fn(),
}))
vi.mock('./user-auth', () => ({
  buildAuthPayload: vi.fn(),
  createOrReusePreviewProfile: vi.fn(),
  jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }),
  redeemProfileCdk: vi.fn(),
  requireUserSession: mocks.requireUserSession,
  toPublicUser: (user: { id: string }) => ({ id: user.id }),
  upgradePreviewProfileWithCdk: vi.fn(),
}))
vi.mock('../security/request-policy', () => ({ requestSchemas: {} }))
vi.mock('../security/request-validation', () => ({ getValidatedJson: vi.fn() }))

import userProfilesHandler from './user-profiles'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireUserSession.mockResolvedValue({ user: { id: 'user-1' } })
  mocks.listProfilesForUser.mockResolvedValue([
    { id: 'profile-1', kind: 'cdk' },
    { id: 'profile-2', kind: 'free_preview' },
  ])
  mocks.listProfileWorkspaces.mockResolvedValue(new Map([
    ['profile-1', { profile_id: 'profile-1' }],
    ['profile-2', { profile_id: 'profile-2' }],
  ]))
})

describe('user profile listing', () => {
  it('loads all workspaces in one batch instead of querying once per profile', async () => {
    const response = await userProfilesHandler(new Request('http://localhost/api/user/profiles'))

    expect(response.status).toBe(200)
    expect(mocks.listProfileWorkspaces).toHaveBeenCalledOnce()
    expect(mocks.listProfileWorkspaces).toHaveBeenCalledWith(['profile-1', 'profile-2'])
    expect(mocks.getProfileWorkspace).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({
      profiles: [
        { id: 'profile-1', workspace: { profile_id: 'profile-1' } },
        { id: 'profile-2', workspace: { profile_id: 'profile-2' } },
      ],
    })
  })
})
