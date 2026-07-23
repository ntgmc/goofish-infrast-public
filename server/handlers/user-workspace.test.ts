import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LicenseConfig, WorkspaceSavedConfig } from '../../src/lib/types'
import workspaceHandler from './user-workspace'

const mocks = vi.hoisted(() => ({
  buildAuthPayload: vi.fn(),
  getEffectiveProfilePermission: vi.fn(),
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

function createWorkspace(savedConfigs: WorkspaceSavedConfig[]) {
  return {
    version: 1 as const,
    profile_id: 'profile-1',
    operators: null,
    config: null,
    elite_overrides: {},
    last_result: null,
    saved_configs: savedConfigs,
    result_history: [],
    free_schedule_entitlement: null,
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
