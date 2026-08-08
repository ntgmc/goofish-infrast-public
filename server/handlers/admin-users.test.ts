import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminUserWorkspaceExportV1 } from '../../src/lib/types'
import adminUsersHandler from './admin-users'

const mocks = vi.hoisted(() => ({
  authenticateAdminRequest: vi.fn(),
  getCdk: vi.fn(),
  getProfileById: vi.fn(),
  getProfileWorkspace: vi.fn(),
  getUserById: vi.fn(),
  listProfilesForUser: vi.fn(),
  listProfileWorkspaces: vi.fn(),
  listOptimizationResultsForProfiles: vi.fn(),
  getLatestProfileOptimizationResultSummaries: vi.fn(),
  resetUserPasswordByAdmin: vi.fn(),
  saveUserAccountByAdmin: vi.fn(),
  saveUserProfileByAdmin: vi.fn(),
  listCdkRecordsByKeys: vi.fn(),
  recordAdminOperationAudit: vi.fn(),
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
}))

vi.mock('../storage/user-store', () => ({
  AdminProfileMutationConflictError: class AdminProfileMutationConflictError extends Error {},
  deleteUserAccount: vi.fn(),
  emptyWorkspace: vi.fn(),
  getUserByEmail: vi.fn(),
  getUserById: mocks.getUserById,
  getProfileById: mocks.getProfileById,
  getProfileWorkspace: mocks.getProfileWorkspace,
  isFreePreviewProfile: vi.fn(() => false),
  listProfilesForUser: mocks.listProfilesForUser,
  listProfileWorkspaces: mocks.listProfileWorkspaces,
  listAdminUserAccountsPage: vi.fn(),
  normalizeProfileKind: vi.fn(() => 'cdk'),
  saveUserProfileByAdmin: mocks.saveUserProfileByAdmin,
  saveUserAccountByAdmin: mocks.saveUserAccountByAdmin,
  toPublicProfile: (profile: unknown) => profile,
}))
vi.mock('../storage/cdk-store', () => ({ listCdkRecordsByKeys: mocks.listCdkRecordsByKeys }))
vi.mock('../storage/admin-operation-audit-store', () => ({
  recordAdminOperationAudit: mocks.recordAdminOperationAudit,
}))
vi.mock('../storage/optimization-result-store', () => ({
  listOptimizationResultsForProfiles: mocks.listOptimizationResultsForProfiles,
  getLatestProfileOptimizationResultSummaries: mocks.getLatestProfileOptimizationResultSummaries,
}))

vi.mock('./user-auth', () => ({ resetUserPasswordByAdmin: mocks.resetUserPasswordByAdmin }))
vi.mock('../storage/personal-use-declaration-store', () => ({
  listPersonalUseDeclarationAcceptancesForUser: vi.fn(async () => []),
  listPersonalUseDeclarationUsageEventsForUser: vi.fn(async () => []),
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
  mocks.authenticateAdminRequest.mockResolvedValue({ ok: true, username: 'operator' })
  mocks.getUserById.mockResolvedValue(user)
  mocks.getProfileById.mockResolvedValue(profile)
  mocks.getProfileWorkspace.mockResolvedValue(null)
  mocks.getCdk.mockResolvedValue(cdk)
  mocks.saveUserProfileByAdmin.mockResolvedValue(undefined)
  mocks.saveUserAccountByAdmin.mockResolvedValue(undefined)
  mocks.listCdkRecordsByKeys.mockResolvedValue(new Map([[profile.cdk_key, cdk]]))
  mocks.recordAdminOperationAudit.mockResolvedValue(undefined)
  mocks.resetUserPasswordByAdmin.mockResolvedValue({ ok: true, user })
  mocks.listProfilesForUser.mockImplementation(async () => [
    mocks.saveUserProfileByAdmin.mock.calls.at(-1)?.[0] ?? profile,
  ])
  mocks.listProfileWorkspaces.mockResolvedValue(new Map())
  mocks.listOptimizationResultsForProfiles.mockResolvedValue(new Map())
  mocks.getLatestProfileOptimizationResultSummaries.mockResolvedValue(new Map())
})

describe('admin user workspace export', () => {
  it('exports every profile workspace with complete history through one batch query', async () => {
    const secondProfile = {
      ...profile,
      id: 'profile-2',
      display_name: '账号 C',
      cdk_key: 'cdk/hash-2.json',
      cdk_code_hash: 'hash-2',
      cdk_order_hash: 'order-2',
      note: '不应导出的备注',
      skland_binding: { uid: 'uid-c', encrypted_cred: 'encrypted-secret' },
    }
    const workspace = {
      version: 1,
      profile_id: profile.id,
      operators: [{ name: 'Amiya', own: true }],
      config: { desc: '243 基建', layout: '243' },
      elite_overrides: { Amiya: 2 },
      saved_configs: [{ id: 'config-1', name: '243', config: { desc: '243' } }],
      free_schedule_entitlement: { revision_count: 2 },
      free_preview_normalized_activity_id: 'internal-activity-marker',
      updated_at: '2026-08-03T00:00:00.000Z',
    }
    const activeResult = {
      id: 'history-1',
      name: '历史排班',
      created_at: '2026-07-31T00:00:00.000Z',
      config: null,
      result: { title: '历史' },
      operator_count: 12,
      source: 'generated' as const,
      archived_at: null,
    }
    const archivedResult = {
      id: 'archive-1',
      name: '封存排班',
      created_at: '2026-07-30T00:00:00.000Z',
      config: null,
      result: { title: '封存' },
      operator_count: 10,
      source: 'legacy' as const,
      archived_at: '2026-08-01T00:00:00.000Z',
    }
    mocks.listProfilesForUser.mockResolvedValue([profile, secondProfile])
    mocks.listProfileWorkspaces.mockResolvedValue(new Map([[profile.id, workspace]]))
    mocks.listOptimizationResultsForProfiles.mockResolvedValue(new Map([
      [profile.id, [activeResult, archivedResult]],
    ]))

    const response = await adminUsersHandler(workspaceExportRequest())
    const body = await response.json() as AdminUserWorkspaceExportV1

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8')
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="maa-user-workspaces.json"')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(body.version).toBe(1)
    expect(body.user).toEqual({ id: user.id, email: user.email })
    expect(new Date(body.exported_at).toISOString()).toBe(body.exported_at)
    expect(mocks.listProfileWorkspaces).toHaveBeenCalledOnce()
    expect(mocks.listProfileWorkspaces).toHaveBeenCalledWith([profile.id, secondProfile.id])
    expect(mocks.listOptimizationResultsForProfiles).toHaveBeenCalledOnce()
    expect(mocks.listOptimizationResultsForProfiles).toHaveBeenCalledWith([profile.id, secondProfile.id])
    expect(body.profiles.map((item) => item.id)).toEqual([profile.id, secondProfile.id])
    expect(body.profiles[0]?.workspace).toMatchObject({
      operators: workspace.operators,
      config: workspace.config,
      elite_overrides: workspace.elite_overrides,
      last_result: activeResult.result,
      saved_configs: workspace.saved_configs,
      result_history: [{
        id: activeResult.id,
        name: activeResult.name,
        created_at: activeResult.created_at,
        config: activeResult.config,
        result: activeResult.result,
        operator_count: activeResult.operator_count,
        source: activeResult.source,
      }],
      archived_results: [{
        id: archivedResult.id,
        name: archivedResult.name,
        created_at: archivedResult.created_at,
        config: archivedResult.config,
        result: archivedResult.result,
        operator_count: archivedResult.operator_count,
        source: archivedResult.source,
      }],
      free_schedule_entitlement: workspace.free_schedule_entitlement,
      updated_at: workspace.updated_at,
    })
    expect(body.profiles[1]?.workspace).toBeNull()
    expect(body.profiles[1]).not.toHaveProperty('note')
    expect(body.profiles[1]).not.toHaveProperty('cdk_key')
    expect(body.profiles[1]).not.toHaveProperty('cdk_order_hash')
    expect(body.profiles[1]).not.toHaveProperty('skland_binding')
    expect(body.profiles[0]?.workspace).not.toHaveProperty('free_preview_normalized_activity_id')
    expect(JSON.stringify(body)).not.toContain('encrypted-secret')
    expect(JSON.stringify(body)).not.toContain('internal-activity-marker')
    expect(mocks.authenticateAdminRequest).toHaveBeenCalledWith(expect.any(Request), 'sensitive_data_view')
  })

  it('exports an empty profile list without querying workspaces individually', async () => {
    mocks.listProfilesForUser.mockResolvedValue([])

    const response = await adminUsersHandler(workspaceExportRequest())
    const body = await response.json() as AdminUserWorkspaceExportV1

    expect(response.status).toBe(200)
    expect(body.profiles).toEqual([])
    expect(mocks.listProfileWorkspaces).toHaveBeenCalledOnce()
    expect(mocks.listProfileWorkspaces).toHaveBeenCalledWith([])
    expect(mocks.getProfileWorkspace).not.toHaveBeenCalled()
  })

  it('rejects unauthenticated requests and reports a missing target user', async () => {
    mocks.authenticateAdminRequest.mockResolvedValueOnce({
      ok: false,
      response: new Response(JSON.stringify({ error: '请先登录。' }), { status: 401 }),
    })

    const unauthenticated = await adminUsersHandler(workspaceExportRequest())
    expect(unauthenticated.status).toBe(401)
    expect(mocks.getUserById).not.toHaveBeenCalled()
    expect(mocks.listProfileWorkspaces).not.toHaveBeenCalled()

    mocks.getUserById.mockResolvedValueOnce(null)
    const missing = await adminUsersHandler(workspaceExportRequest())
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toEqual({ error: '用户不存在。' })
    expect(mocks.listProfileWorkspaces).not.toHaveBeenCalled()
  })
})

describe('admin user profile pagination', () => {
  it('loads only the requested profile page with fixed batch query counts', async () => {
    const profiles = Array.from({ length: 1_000 }, (_, index) => ({
      ...profile,
      id: `profile-${String(index + 1).padStart(4, '0')}`,
      cdk_key: null,
      cdk_code_hash: null,
    }))
    mocks.listProfilesForUser.mockResolvedValue(profiles)
    mocks.listProfileWorkspaces.mockResolvedValue(new Map())
    mocks.listCdkRecordsByKeys.mockResolvedValue(new Map())

    const response = await adminUsersHandler(new Request(
      `http://localhost/api/admin/users?user_id=${user.id}&profile_page=10&profile_page_size=100`,
    ))
    const body = await response.json() as { detail: { profiles: typeof profiles; profile_pagination: Record<string, number | boolean> } }

    expect(response.status).toBe(200)
    expect(body.detail.profiles).toHaveLength(100)
    expect(body.detail.profiles[0]?.id).toBe('profile-0901')
    expect(body.detail.profile_pagination).toEqual({
      page: 10,
      page_size: 100,
      total: 1_000,
      total_pages: 10,
      returned: 100,
      truncated: true,
    })
    const expectedIds = profiles.slice(900).map((item) => item.id)
    expect(mocks.listProfileWorkspaces).toHaveBeenCalledOnce()
    expect(mocks.listProfileWorkspaces).toHaveBeenCalledWith(expectedIds)
    expect(mocks.listCdkRecordsByKeys).toHaveBeenCalledOnce()
    expect(mocks.listCdkRecordsByKeys).toHaveBeenCalledWith([])
    expect(mocks.getProfileWorkspace).not.toHaveBeenCalled()
    expect(mocks.getCdk).not.toHaveBeenCalled()
  })

  it('rejects unsafe profile page values before querying profile data', async () => {
    const response = await adminUsersHandler(new Request(
      `http://localhost/api/admin/users?user_id=${user.id}&profile_page=999999999999999999999`,
    ))

    expect(response.status).toBe(400)
    expect(mocks.listProfilesForUser).not.toHaveBeenCalled()
  })
})

describe('admin user profile concurrency', () => {
  it('uses the profile timestamp instead of the workspace timestamp for mutations', async () => {
    const workspace = {
      version: 1,
      profile_id: profile.id,
      operators: [],
      config: null,
      elite_overrides: {},
      saved_configs: [],
      free_schedule_entitlement: null,
      free_preview_normalized_activity_id: null,
      updated_at: '2026-01-03T00:00:00.000Z',
    }
    mocks.listProfileWorkspaces.mockResolvedValue(new Map([[profile.id, workspace]]))

    const detailResponse = await adminUsersHandler(new Request(`http://localhost/api/admin/users?user_id=${user.id}`))
    const detailBody = await detailResponse.json() as { detail: { profiles: Array<{ updated_at: string; workspace: { updated_at: string } }> } }
    const summary = detailBody.detail.profiles[0]

    expect(detailResponse.status).toBe(200)
    expect(summary.updated_at).toBe(profile.updated_at)
    expect(summary.workspace.updated_at).toBe(workspace.updated_at)

    const mutationResponse = await adminUsersHandler(new Request('http://localhost/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'set_profile_status',
        user_id: user.id,
        profile_id: profile.id,
        expected_updated_at: summary.updated_at,
        status: 'frozen',
        reason: '工单 OPS-102 冻结档案',
      }),
    }))

    expect(mutationResponse.status).toBe(200)
    expect(mocks.saveUserProfileByAdmin).toHaveBeenCalledWith(expect.objectContaining({ status: 'frozen' }), expect.objectContaining({
      expectedUpdatedAt: profile.updated_at,
    }))
  })
})

describe('admin user Skland binding reset', () => {
  it('clears the binding and linked CDK baseline in one storage transaction', async () => {
    const response = await adminUsersHandler(clearBindingRequest())

    expect(response.status).toBe(200)
    expect(mocks.saveUserProfileByAdmin).toHaveBeenCalledWith(expect.objectContaining({
      skland_binding: null,
      skland_pending_binding: null,
      skland_risk: null,
    }), expect.objectContaining({
      expectedUpdatedAt: profile.updated_at,
      resetLinkedCdkOperatorBaselineReason: expect.stringContaining('管理员清除森空岛绑定'),
      audit: expect.objectContaining({
        actorUsername: 'operator',
        action: 'profile.clear_profile_skland_binding',
        reason: '工单 OPS-100 清理失效绑定',
      }),
    }))
    expect(mocks.authenticateAdminRequest).toHaveBeenCalledWith(expect.any(Request), {
      capability: 'user_manage',
      requireRecentLogin: true,
    })
  })

  it('returns a conflict without retrying when the atomic profile mutation fails', async () => {
    const ConflictError = (await import('../storage/user-store')).AdminProfileMutationConflictError
    mocks.saveUserProfileByAdmin.mockRejectedValue(new ConflictError('关联 CDK 干员基线重置冲突，请刷新后重试。'))

    const response = await adminUsersHandler(clearBindingRequest())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: '关联 CDK 干员基线重置冲突，请刷新后重试。' })
    expect(mocks.saveUserProfileByAdmin).toHaveBeenCalledOnce()
  })

  it('clears a binding without touching CDK storage when the profile has no CDK', async () => {
    mocks.getProfileById.mockResolvedValue({ ...profile, cdk_key: null, cdk_code_hash: null })

    const response = await adminUsersHandler(clearBindingRequest())

    expect(response.status).toBe(200)
    expect(mocks.saveUserProfileByAdmin).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      resetLinkedCdkOperatorBaselineReason: expect.any(String),
    }))
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
        reason: '工单 OPS-101 重置用户密码',
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
      expected_updated_at: profile.updated_at,
      reason: '工单 OPS-100 清理失效绑定',
    }),
  })
}

function workspaceExportRequest() {
  return new Request(`http://localhost/api/admin/users?user_id=${user.id}&include=workspaces`)
}
