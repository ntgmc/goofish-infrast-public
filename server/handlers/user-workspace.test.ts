import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LicenseConfig, WorkspaceSavedConfig } from '../../src/lib/types'
import type { UserWorkspaceRecord } from '../storage/user-store'
import workspaceHandler from './user-workspace'

const mocks = vi.hoisted(() => ({
  buildAuthPayload: vi.fn(),
  getEffectiveProfilePermission: vi.fn(),
  getProfileCapacityLimits: vi.fn(),
  getProfileForUser: vi.fn(),
  getValidatedJson: vi.fn(),
  isFreePreviewTrialActive: vi.fn(),
  requireUserSession: vi.fn(),
  resolveConfigForPermission: vi.fn(),
  resolveFreePreviewConfig: vi.fn(),
  updateProfileWorkspaceAtomically: vi.fn(),
  validateConfig: vi.fn(),
  validateOperators: vi.fn(),
}))

vi.mock('../storage/user-store', () => ({
  emptyWorkspace: vi.fn(),
  getProfileForUser: mocks.getProfileForUser,
  getProfileWorkspace: vi.fn(),
  isDepotValueProfile: () => false,
  isFreePreviewProfile: () => false,
  toPublicWorkspace: vi.fn(),
  updateProfileWorkspaceAtomically: mocks.updateProfileWorkspaceAtomically,
}))

vi.mock('../free-preview-trial', () => ({
  getEffectiveProfilePermission: mocks.getEffectiveProfilePermission,
  isFreePreviewTrialActive: mocks.isFreePreviewTrialActive,
}))

vi.mock('../storage/inventory-store', () => ({
  getProfileCapacityLimits: mocks.getProfileCapacityLimits,
}))

vi.mock('../storage/postgres', () => ({
  hasDatabaseUrl: () => true,
  withTransaction: vi.fn(),
}))

vi.mock('./license-utils', () => ({
  resolveConfigForPermission: mocks.resolveConfigForPermission,
  resolveFreePreviewConfig: mocks.resolveFreePreviewConfig,
  validateConfig: mocks.validateConfig,
  validateOperators: mocks.validateOperators,
}))

vi.mock('./user-auth', () => ({
  buildAuthPayload: mocks.buildAuthPayload,
  jsonResponse: (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: status === 204 ? undefined : { 'Content-Type': 'application/json' },
  }),
  requireUserSession: mocks.requireUserSession,
}))
vi.mock('./profile-authorization', () => ({
  resolveProfileAuthorization: vi.fn(async (profile: { permission: string }) => ({
    ok: true,
    permission: profile.permission,
    cdkRecord: null,
  })),
}))

vi.mock('../security/request-policy', () => ({ requestSchemas: { userWorkspace: {} } }))
vi.mock('../security/request-validation', () => ({ getValidatedJson: mocks.getValidatedJson }))

const config = { layout: '2-4-3', desc: '测试配置' } as LicenseConfig
let workspace = createWorkspace([savedConfig(1), savedConfig(2), savedConfig(3)])

beforeEach(() => {
  workspace = createWorkspace([savedConfig(1), savedConfig(2), savedConfig(3)])
  vi.clearAllMocks()
  mocks.requireUserSession.mockResolvedValue({ user: { id: 'user-1', email: 'user@example.test' } })
  mocks.getProfileForUser.mockResolvedValue({
    id: 'profile-1',
    kind: 'cdk',
    permission: 'growth',
    status: 'active',
    skland_binding: null,
  })
  mocks.getEffectiveProfilePermission.mockReturnValue('growth')
  mocks.getProfileCapacityLimits.mockResolvedValue({ plan: 3, history: 5, archive: 0 })
  mocks.isFreePreviewTrialActive.mockReturnValue(false)
  mocks.validateConfig.mockImplementation((candidate: LicenseConfig) => ({ ok: true, config: candidate }))
  mocks.resolveConfigForPermission.mockImplementation((_permission: string, candidate: LicenseConfig) => ({ ok: true, config: candidate }))
  mocks.resolveFreePreviewConfig.mockImplementation((candidate: LicenseConfig) => ({ ok: true, config: candidate }))
  mocks.buildAuthPayload.mockResolvedValue({ ok: true })
  mocks.updateProfileWorkspaceAtomically.mockImplementation(async (_profileId: string, updater: (current: typeof workspace) => typeof workspace) => {
    workspace = updater(workspace)
    return workspace
  })
})

describe('saved workspace configuration limit', () => {
  it('rejects a fourth saved configuration without changing the existing three', async () => {
    mocks.getValidatedJson.mockResolvedValue(savePayload('配置 4'))

    const response = await workspaceHandler(patchRequest())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: '最多保存 3 套配置，请先删除不再需要的方案。' })
    expect(workspace.saved_configs.map((item) => item.id)).toEqual(['config-1', 'config-2', 'config-3'])
  })

  it('allows another saved configuration after one is deleted', async () => {
    mocks.getValidatedJson.mockResolvedValue({
      profile_id: 'profile-1',
      saved_config_action: { type: 'delete', id: 'config-2' },
    })

    const deleteResponse = await workspaceHandler(patchRequest())

    expect(deleteResponse.status).toBe(200)
    expect(workspace.saved_configs.map((item) => item.id)).toEqual(['config-1', 'config-3'])

    mocks.getValidatedJson.mockResolvedValue(savePayload('配置 4'))
    const saveResponse = await workspaceHandler(patchRequest())

    expect(saveResponse.status).toBe(200)
    expect(workspace.saved_configs).toHaveLength(3)
    expect(workspace.saved_configs[0]?.name).toBe('配置 4')
  })

  it('allows an expired trial configuration to be deleted while it remains read-only', async () => {
    workspace = createWorkspace([{ ...savedConfig(1), read_only: true }])
    mocks.getValidatedJson.mockResolvedValue({
      profile_id: 'profile-1',
      saved_config_action: { type: 'delete', id: 'config-1' },
    })

    const response = await workspaceHandler(patchRequest())

    expect(response.status).toBe(200)
    expect(workspace.saved_configs).toEqual([])
  })

  it('uses expanded profile capacity when saving through PATCH', async () => {
    mocks.getProfileCapacityLimits.mockResolvedValue({ plan: 4, history: 6, archive: 1 })
    mocks.getValidatedJson.mockResolvedValue(savePayload('配置 4'))

    const response = await workspaceHandler(patchRequest())

    expect(response.status).toBe(200)
    expect(mocks.getProfileCapacityLimits).toHaveBeenCalledWith('profile-1')
    expect(workspace.saved_configs).toHaveLength(4)
    expect(workspace.saved_configs[0]?.name).toBe('配置 4')
    expect(mocks.buildAuthPayload).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }), 'profile-1')
  })

  it.each(['delete', 'touch'] as const)('returns 404 when %s targets a missing configuration', async (type) => {
    mocks.getValidatedJson.mockResolvedValue({
      profile_id: 'profile-1',
      saved_config_action: { type, id: 'missing-config' },
    })

    const response = await workspaceHandler(patchRequest())

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: '方案不存在。' })
  })
})

describe('workspace elite overrides', () => {
  it('rejects overrides for operators outside the current workspace', async () => {
    workspace.operators = [{ id: 'char_001', name: '测试干员', own: true, elite: 1, rarity: 5 }]
    mocks.getValidatedJson.mockResolvedValue({
      profile_id: 'profile-1',
      elite_overrides: { char_unknown: 2 },
    })

    const response = await workspaceHandler(patchRequest())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: '精英覆盖中的干员 char_unknown 不属于当前工作区。' })
    expect(workspace.elite_overrides).toEqual({})
  })
})

function patchRequest(): Request {
  return new Request('http://localhost/api/user/workspace', { method: 'PATCH' })
}

function savePayload(name: string) {
  return {
    profile_id: 'profile-1',
    saved_config_action: { type: 'save', name, config },
  }
}

function createWorkspace(savedConfigs: WorkspaceSavedConfig[]): UserWorkspaceRecord {
  return {
    version: 1 as const,
    profile_id: 'profile-1',
    operators: null,
    config: null,
    elite_overrides: {},
    saved_configs: savedConfigs,
    free_schedule_entitlement: null,
    free_preview_normalized_activity_id: null,
    updated_at: '2026-07-23T00:00:00.000Z',
  }
}

function savedConfig(index: number): WorkspaceSavedConfig {
  return {
    id: `config-${index}`,
    name: `配置 ${index}`,
    config,
    created_at: '2026-07-23T00:00:00.000Z',
    updated_at: '2026-07-23T00:00:00.000Z',
    last_used_at: null,
  }
}
