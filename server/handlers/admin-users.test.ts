import { beforeEach, describe, expect, it, vi } from 'vitest'
import adminUsersHandler from './admin-users'

const mocks = vi.hoisted(() => ({
  authenticateAdminRequest: vi.fn(),
  getCdk: vi.fn(),
  getProfileById: vi.fn(),
  getProfileWorkspace: vi.fn(),
  getUserById: vi.fn(),
  listProfilesForUser: vi.fn(),
  resetUserPasswordByAdmin: vi.fn(),
  saveUserProfile: vi.fn(),
  setOperatorBaselineByAdmin: vi.fn(),
}))

vi.mock('./admin-auth', () => ({
  authenticateAdminRequest: mocks.authenticateAdminRequest,
  createAdminUser: vi.fn(),
  deleteAdminUser: vi.fn(),
  listAdminUsers: vi.fn(async () => []),
  requireRootAdminPassword: vi.fn(),
}))

vi.mock('../security/password', () => ({
  PasswordWorkCapacityError: class PasswordWorkCapacityError extends Error {},
}))

vi.mock('./license-utils', () => ({
  CDK_PRODUCT_PERMISSIONS: ['recommended', 'growth', 'advanced', 'ultimate'],
  getCdkRecordStore: vi.fn(async () => ({ get: mocks.getCdk })),
  isProfileCdkRecord: (record: { cdk_type?: string }) => (record.cdk_type ?? 'profile') === 'profile',
  jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }),
  setOperatorBaselineByAdmin: mocks.setOperatorBaselineByAdmin,
}))

vi.mock('../storage/user-store', () => ({
  deleteSessionsForUser: vi.fn(),
  deleteUserAccount: vi.fn(),
  emptyWorkspace: vi.fn(),
  getUserByEmail: vi.fn(),
  getUserById: mocks.getUserById,
  getProfileById: mocks.getProfileById,
  getProfileWorkspace: mocks.getProfileWorkspace,
  isFreePreviewProfile: vi.fn(() => false),
  listProfilesForUser: mocks.listProfilesForUser,
  listAdminUserAccountsPage: vi.fn(),
  normalizeProfileKind: vi.fn(() => 'cdk'),
  saveProfileWorkspace: vi.fn(),
  saveUserProfile: mocks.saveUserProfile,
  saveUserAccount: vi.fn(),
  toPublicProfile: (profile: unknown) => profile,
}))

vi.mock('./user-auth', () => ({ resetUserPasswordByAdmin: mocks.resetUserPasswordByAdmin }))
vi.mock('../storage/personal-use-declaration-store', () => ({
  listPersonalUseDeclarationAcceptancesForUser: vi.fn(async () => []),
}))
vi.mock('../behavior-risk/service', () => ({ recordAccountDeletedBehaviorEvent: vi.fn() }))

const user = {
  version: 1,
  id: 'user-1',
  email: 'user@example.test',
  permission: 'advanced',
  status: 'active',
  cdk_key: null,
  cdk_code_hash: null,
  cdk_order_hash: null,
  email_verified_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

const profile = {
  version: 1,
  id: 'profile-1',
  user_id: user.id,
  kind: 'cdk',
  cdk_key: 'cdk/hash-1.json',
  cdk_code_hash: 'hash-1',
  cdk_order_hash: 'order-1',
  permission: 'advanced',
  status: 'active',
  display_name: '账号 B',
  note: '',
  skland_binding: { uid: 'uid-b' },
  skland_pending_binding: { uid: 'uid-a' },
  skland_risk: { uid_mismatch_count: 1 },
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
}

const cdk = {
  version: 1,
  code_hash: 'hash-1',
  permission: 'advanced',
  status: 'used',
  baseline_operator_fingerprint: { hash: 'baseline-b', owned_count: 20, operators: {} },
  latest_operator_fingerprint: { hash: 'latest-b', owned_count: 20, operators: {} },
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.authenticateAdminRequest.mockResolvedValue({ ok: true })
  mocks.getUserById.mockResolvedValue(user)
  mocks.getProfileById.mockResolvedValue(profile)
  mocks.getProfileWorkspace.mockResolvedValue(null)
  mocks.getCdk.mockResolvedValue(cdk)
  mocks.setOperatorBaselineByAdmin.mockResolvedValue({ ...cdk, baseline_operator_fingerprint: undefined, latest_operator_fingerprint: undefined })
  mocks.saveUserProfile.mockResolvedValue(undefined)
  mocks.resetUserPasswordByAdmin.mockResolvedValue({ ok: true, user })
  mocks.listProfilesForUser.mockImplementation(async () => [
    mocks.saveUserProfile.mock.calls.at(-1)?.[0] ?? profile,
  ])
})

describe('admin user Skland binding reset', () => {
  it('resets the linked CDK baseline before clearing the binding', async () => {
    const response = await adminUsersHandler(clearBindingRequest())

    expect(response.status).toBe(200)
    expect(mocks.setOperatorBaselineByAdmin).toHaveBeenCalledWith(cdk, expect.objectContaining({
      source: 'next_import',
      unfreeze: false,
      eventType: 'admin_operator_baseline_reset',
      reviewed: false,
    }))
    expect(mocks.saveUserProfile).toHaveBeenCalledWith(expect.objectContaining({
      skland_binding: null,
      skland_pending_binding: null,
      skland_risk: null,
    }))
    expect(mocks.setOperatorBaselineByAdmin.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.saveUserProfile.mock.invocationCallOrder[0],
    )
  })

  it('keeps the binding when the active CDK baseline cannot be reset', async () => {
    mocks.setOperatorBaselineByAdmin.mockResolvedValue(null)

    const response = await adminUsersHandler(clearBindingRequest())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: '重置关联 CDK 的干员基线失败，绑定未清除。' })
    expect(mocks.saveUserProfile).not.toHaveBeenCalled()
  })

  it('clears a binding without touching CDK storage when the profile has no CDK', async () => {
    mocks.getProfileById.mockResolvedValue({ ...profile, cdk_key: null, cdk_code_hash: null })

    const response = await adminUsersHandler(clearBindingRequest())

    expect(response.status).toBe(200)
    expect(mocks.getCdk).not.toHaveBeenCalled()
    expect(mocks.setOperatorBaselineByAdmin).not.toHaveBeenCalled()
    expect(mocks.saveUserProfile).toHaveBeenCalled()
  })
})

describe('admin user password reset', () => {
  it('returns a stable conflict when the account is not active or changes concurrently', async () => {
    mocks.resetUserPasswordByAdmin.mockResolvedValue({
      ok: false,
      status: 409,
      message: '账号状态或密码已发生变化，请刷新后重试。',
      code: 'password_update_conflict',
    })

    const response = await adminUsersHandler(new Request('http://localhost/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'reset_password',
        user_id: user.id,
        new_password: 'StrongReplacementPassword!2026',
      }),
    }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: '账号状态或密码已发生变化，请刷新后重试。',
      code: 'password_update_conflict',
    })
  })
})

function clearBindingRequest() {
  return new Request('http://localhost/api/admin/users', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'clear_profile_skland_binding',
      user_id: user.id,
      profile_id: profile.id,
    }),
  })
}
