import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FREE_PREVIEW_ADVANCED_TRIAL } from '../free-preview-trial'
import { InventoryError } from '../storage/inventory-store'
import userResultsHandler from './user-results'

const mocks = vi.hoisted(() => ({
  consumeInventoryItemImmediately: vi.fn(),
  getPersonalUseDeclarationAcceptance: vi.fn(),
  getProfileForUser: vi.fn(),
  getProfileWorkspace: vi.fn(),
  getValidatedJson: vi.fn(),
  recordTrackedExportBehaviorEvent: vi.fn(),
  requireUserSession: vi.fn(),
}))

vi.mock('../storage/inventory-store', () => {
  class MockInventoryError extends Error {
    constructor(
      readonly code: string,
      message: string,
      readonly status: 400 | 403 | 404 | 409 = 409,
    ) {
      super(message)
      this.name = 'InventoryError'
    }
  }

  return {
    consumeInventoryItemImmediately: mocks.consumeInventoryItemImmediately,
    getProfileCapacityLimits: vi.fn(),
    InventoryError: MockInventoryError,
  }
})

vi.mock('../storage/user-store', () => ({
  emptyWorkspace: vi.fn(),
  getProfileForUser: mocks.getProfileForUser,
  getProfileWorkspace: mocks.getProfileWorkspace,
  isDepotValueProfile: (profile: { kind?: string }) => profile.kind === 'depot_value',
  isFreePreviewProfile: (profile: { kind?: string }) => profile.kind === 'free_preview',
  toPublicWorkspace: vi.fn(),
  updateProfileWorkspaceInTransaction: vi.fn(),
}))

vi.mock('../storage/postgres', () => ({ withTransaction: vi.fn() }))
vi.mock('../behavior-risk/service', () => ({
  recordTrackedExportBehaviorEvent: mocks.recordTrackedExportBehaviorEvent,
}))
vi.mock('../storage/personal-use-declaration-store', () => ({
  getPersonalUseDeclarationAcceptance: mocks.getPersonalUseDeclarationAcceptance,
}))
vi.mock('../security/request-policy', () => ({
  requestSchemas: { maaExport: {}, resultArchive: {} },
}))
vi.mock('../security/request-validation', () => ({
  getValidatedJson: mocks.getValidatedJson,
  stableJsonStringify: (value: unknown) => JSON.stringify(value),
}))
vi.mock('./user-auth', () => ({
  jsonResponse: (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: status === 204 ? undefined : { 'Content-Type': 'application/json' },
  }),
  requireUserSession: mocks.requireUserSession,
}))

const exportBody = {
  profile_id: 'profile-1',
  result_id: 'result-1',
  idempotency_key: 'export-request-1',
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(FREE_PREVIEW_ADVANCED_TRIAL.startsAt))
  vi.clearAllMocks()
  mocks.requireUserSession.mockResolvedValue({
    user: { id: 'user-1' },
    tokenHash: 'session-hash',
  })
  mocks.getValidatedJson.mockResolvedValue(exportBody)
  mocks.getProfileForUser.mockResolvedValue(profile('cdk', 'growth'))
  mocks.getProfileWorkspace.mockResolvedValue({
    result_history: [{ id: 'result-1', result: { schedule_mode: 'maa', plans: [] } }],
    archived_results: [],
  })
  mocks.getPersonalUseDeclarationAcceptance.mockResolvedValue(null)
  mocks.recordTrackedExportBehaviorEvent.mockResolvedValue(true)
  mocks.consumeInventoryItemImmediately.mockImplementation(async (input: { response: Record<string, unknown> }) => ({
    ...input.response,
    operation_id: 'operation-1',
  }))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('MAA JSON export entitlement', () => {
  it('lets a CDK profile export without consuming a trial coupon', async () => {
    const response = await userResultsHandler(exportRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ consumed_coupon: false, result_id: 'result-1' })
    expect(mocks.consumeInventoryItemImmediately).not.toHaveBeenCalled()
  })

  it('lets an active advanced free preview export without consuming a trial coupon', async () => {
    mocks.getProfileForUser.mockResolvedValue(profile('free_preview', 'growth'))

    const response = await userResultsHandler(exportRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ consumed_coupon: false })
    expect(mocks.consumeInventoryItemImmediately).not.toHaveBeenCalled()
  })

  it('consumes a trial coupon for an ordinary free preview after the advanced trial', async () => {
    vi.setSystemTime(new Date(FREE_PREVIEW_ADVANCED_TRIAL.endsAt))
    mocks.getProfileForUser.mockResolvedValue(profile('free_preview', 'growth'))

    const response = await userResultsHandler(exportRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ consumed_coupon: true, operation_id: 'operation-1' })
    expect(mocks.consumeInventoryItemImmediately).toHaveBeenCalledWith(expect.objectContaining({
      itemCode: 'maa_export_trial_coupon',
      profileId: 'profile-1',
    }))
  })

  it('preserves the inventory error when an ordinary free preview has no coupon', async () => {
    vi.setSystemTime(new Date(FREE_PREVIEW_ADVANCED_TRIAL.endsAt))
    mocks.getProfileForUser.mockResolvedValue(profile('free_preview', 'growth'))
    mocks.consumeInventoryItemImmediately.mockRejectedValue(new InventoryError(
      'item_unavailable',
      '没有可用的 MAA 导出体验券。',
      409,
    ))

    const response = await userResultsHandler(exportRequest())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: '没有可用的 MAA 导出体验券。',
      code: 'item_unavailable',
    })
  })

  it('does not fail an entitled export when behavior tracking fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mocks.recordTrackedExportBehaviorEvent.mockRejectedValue(new Error('tracking unavailable'))

    const response = await userResultsHandler(exportRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ consumed_coupon: false })
  })

  it('does not return an error after consuming a coupon when behavior tracking fails', async () => {
    vi.setSystemTime(new Date(FREE_PREVIEW_ADVANCED_TRIAL.endsAt))
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mocks.getProfileForUser.mockResolvedValue(profile('free_preview', 'growth'))
    mocks.recordTrackedExportBehaviorEvent.mockRejectedValue(new Error('tracking unavailable'))

    const response = await userResultsHandler(exportRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ consumed_coupon: true, operation_id: 'operation-1' })
  })

  it('returns a stable localized error for an unexpected export failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.getProfileWorkspace.mockRejectedValue(new Error('database unavailable'))

    const response = await userResultsHandler(exportRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: '导出 MAA JSON 失败，请稍后重试。',
      code: 'maa_export_failed',
    })
  })
})

function exportRequest(): Request {
  return new Request('http://localhost/api/user/maa-export', { method: 'POST' })
}

function profile(kind: 'cdk' | 'free_preview', permission: 'growth' | 'advanced') {
  return {
    id: 'profile-1',
    user_id: 'user-1',
    kind,
    permission,
    status: 'active',
    display_name: '测试档案',
    note: '',
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    skland_binding: null,
  }
}
