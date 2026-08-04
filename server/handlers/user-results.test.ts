import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { FREE_PREVIEW_LIMITED_CDK_ACTIVITY } from '../free-preview-trial'
import { InventoryError } from '../storage/inventory-store'
import { PersonalUseDeclarationRequiredError } from '../storage/personal-use-declaration-store'
import { OptimizationResultMutationError } from '../storage/optimization-result-store'
import userResultsHandler from './user-results'

const mocks = vi.hoisted(() => ({
  consumeInventoryItemImmediately: vi.fn(),
  getProfileCapacityLimitsInTransaction: vi.fn(),
  recordPersonalUseDeclarationUsage: vi.fn(),
  getProfileForUser: vi.fn(),
  getValidatedJson: vi.fn(),
  recordTrackedExportBehaviorEvent: vi.fn(),
  requireUserSession: vi.fn(),
  toPublicWorkspace: vi.fn(),
  updateProfileWorkspaceInTransaction: vi.fn(),
  getProfileOptimizationResult: vi.fn(),
  getWorkspaceOptimizationResultOverviewWithClient: vi.fn(),
  listProfileOptimizationResults: vi.fn(),
  mutateProfileOptimizationResultInTransaction: vi.fn(),
  withTransaction: vi.fn(),
  clientQuery: vi.fn(),
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
    getProfileCapacityLimitsInTransaction: mocks.getProfileCapacityLimitsInTransaction,
    InventoryError: MockInventoryError,
  }
})

vi.mock('../storage/user-store', () => ({
  getProfileForUser: mocks.getProfileForUser,
  isDepotValueProfile: (profile: { kind?: string }) => profile.kind === 'depot_value',
  isFreePreviewProfile: (profile: { kind?: string }) => profile.kind === 'free_preview',
  normalizeProfileKind: (profile: { kind?: string }) => profile.kind ?? 'cdk',
  toPublicWorkspace: mocks.toPublicWorkspace,
  updateProfileWorkspaceInTransaction: mocks.updateProfileWorkspaceInTransaction,
}))

vi.mock('../storage/optimization-result-store', () => {
  class MockOptimizationResultCursorError extends Error {
    readonly code = 'result_cursor_invalid'
    readonly status = 400
  }
  class MockOptimizationResultMutationError extends Error {
    constructor(
      message: string,
      readonly status: 404 | 409,
      readonly code: 'result_not_found' | 'result_archive_full' | 'result_history_full',
    ) {
      super(message)
    }
  }
  return {
    getProfileOptimizationResult: mocks.getProfileOptimizationResult,
    getWorkspaceOptimizationResultOverviewWithClient: mocks.getWorkspaceOptimizationResultOverviewWithClient,
    listProfileOptimizationResults: mocks.listProfileOptimizationResults,
    mutateProfileOptimizationResultInTransaction: mocks.mutateProfileOptimizationResultInTransaction,
    OPTIMIZATION_RESULT_PAGE_MAX_SIZE: 50,
    OptimizationResultCursorError: MockOptimizationResultCursorError,
    OptimizationResultMutationError: MockOptimizationResultMutationError,
  }
})

vi.mock('../storage/postgres', () => ({ withTransaction: mocks.withTransaction }))
vi.mock('../behavior-risk/service', () => ({
  recordTrackedExportBehaviorEvent: mocks.recordTrackedExportBehaviorEvent,
}))
vi.mock('../storage/personal-use-declaration-store', () => ({
  PersonalUseDeclarationRequiredError: class PersonalUseDeclarationRequiredError extends Error {
    readonly code = 'personal_use_declaration_required'
    readonly status = 428

    constructor() {
      super('请先确认当前版本的个人使用声明。')
    }
  },
  recordPersonalUseDeclarationUsage: mocks.recordPersonalUseDeclarationUsage,
}))
vi.mock('../security/request-policy', () => ({
  requestSchemas: { maaExport: {}, fullResultExport: {}, resultArchive: {} },
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
vi.mock('./profile-authorization', () => ({
  resolveProfileAuthorization: vi.fn(async (profile: { permission: string; temporary_permission?: { permission?: string } }) => ({
    ok: true,
    permission: profile.temporary_permission?.permission ?? profile.permission,
    cdkRecord: null,
  })),
}))

const exportBody = {
  profile_id: 'profile-1',
  result_id: 'result-1',
  idempotency_key: 'export-request-1',
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(FREE_PREVIEW_LIMITED_CDK_ACTIVITY.startsAt))
  vi.clearAllMocks()
  mocks.requireUserSession.mockResolvedValue({
    user: { id: 'user-1' },
    tokenHash: 'session-hash',
  })
  mocks.getValidatedJson.mockResolvedValue(exportBody)
  mocks.getProfileForUser.mockResolvedValue(profile('cdk', 'advanced'))
  mocks.getProfileOptimizationResult.mockResolvedValue(storedHistoryItem())
  mocks.listProfileOptimizationResults.mockResolvedValue({
    items: [historySummary()],
    next_cursor: 'next-page',
  })
  mocks.recordPersonalUseDeclarationUsage.mockResolvedValue({
    declaration_version: 'V1.1',
    acceptance_accepted_at: '2026-07-31T00:00:00.000Z',
  })
  mocks.recordTrackedExportBehaviorEvent.mockResolvedValue(true)
  mocks.consumeInventoryItemImmediately.mockImplementation(async (input: { response: Record<string, unknown> }) => ({
    ...input.response,
    operation_id: 'operation-1',
  }))
  mocks.getProfileCapacityLimitsInTransaction.mockResolvedValue({ plan: 3, history: 5, archive: 1 })
  mocks.getWorkspaceOptimizationResultOverviewWithClient.mockResolvedValue({
    latest_result: historySummary(),
    result_history: { items: [historySummary()], next_cursor: null },
    archived_results: { items: [], next_cursor: null },
  })
  mocks.toPublicWorkspace.mockImplementation((_workspace: unknown, _limits: unknown, overview: unknown) => overview)
  mocks.clientQuery.mockResolvedValue({ rows: [], rowCount: 1 })
  mocks.withTransaction.mockImplementation(async (run: (client: { query: typeof mocks.clientQuery }) => unknown) => (
    run({ query: mocks.clientQuery })
  ))
  mocks.updateProfileWorkspaceInTransaction.mockResolvedValue(workspaceRecord())
})

describe('result history mutations', () => {
  it('archives by profile and result ID and returns a fresh summary overview', async () => {
    mocks.getValidatedJson.mockResolvedValue({ ...exportBody, action: 'archive' })

    const response = await userResultsHandler(exportRequest('result-archive'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      workspace: {
        latest_result: { id: 'result-1' },
      },
      action: 'archive',
      result_id: 'result-1',
    })
    expect(mocks.mutateProfileOptimizationResultInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        profileId: 'profile-1',
        resultId: 'result-1',
        action: 'archive',
        historyLimit: 5,
        archiveLimit: 1,
      }),
    )
  })

  it('returns 404 for a new delete operation targeting a missing result', async () => {
    mocks.getValidatedJson.mockResolvedValue({ ...exportBody, action: 'delete' })
    mocks.mutateProfileOptimizationResultInTransaction.mockRejectedValue(
      new OptimizationResultMutationError('排班结果不存在。', 404, 'result_not_found'),
    )

    const response = await userResultsHandler(exportRequest('result-archive'))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ code: 'result_not_found' })
  })

  it('replays a completed mutation with the same idempotency key', async () => {
    const replay = { workspace: null, action: 'delete', result_id: 'result-1', operation_id: 'operation-replay' }
    mocks.getValidatedJson.mockResolvedValue({ ...exportBody, action: 'delete' })
    mocks.clientQuery.mockResolvedValueOnce({
      rows: [{
        request_hash: createHash('sha256')
          .update(JSON.stringify({ profile_id: 'profile-1', result_id: 'result-1', action: 'delete' }))
          .digest('hex'),
        response_json: replay,
      }],
      rowCount: 1,
    })

    const response = await userResultsHandler(exportRequest('result-archive'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(replay)
    expect(mocks.mutateProfileOptimizationResultInTransaction).not.toHaveBeenCalled()
  })
})

describe('result history reads', () => {
  it('returns a cursor-paginated summary list for an owned profile', async () => {
    const response = await userResultsHandler(new Request(
      'http://localhost/api/user/results?profile_id=profile-1&scope=active&cursor=cursor-1&limit=20',
    ))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ items: [historySummary()], next_cursor: 'next-page' })
    expect(mocks.listProfileOptimizationResults).toHaveBeenCalledWith('profile-1', 'active', {
      cursor: 'cursor-1',
      limit: 20,
    })
  })

  it('loads one capability-projected detail by profile and result ID', async () => {
    mocks.getProfileForUser.mockResolvedValue(profile('cdk', 'growth'))

    const response = await userResultsHandler(new Request(
      'http://localhost/api/user/results/result-1?profile_id=profile-1',
    ))

    expect(response.status).toBe(200)
    const body = await response.json() as { item: { result: Record<string, unknown> } }
    expect(body.item.result.raw_results).toEqual([])
    expect(body.item.result).not.toHaveProperty('daily_production')
    expect(mocks.getProfileOptimizationResult).toHaveBeenCalledWith('profile-1', 'result-1')
  })

  it('does not query result storage when the profile is not owned by the session user', async () => {
    mocks.getProfileForUser.mockResolvedValue(null)

    const response = await userResultsHandler(new Request(
      'http://localhost/api/user/results/result-1?profile_id=other-profile',
    ))

    expect(response.status).toBe(404)
    expect(mocks.getProfileOptimizationResult).not.toHaveBeenCalled()
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('MAA JSON export entitlement', () => {
  it('lets an advanced CDK profile export without consuming a trial coupon', async () => {
    const response = await userResultsHandler(exportRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      consumed_coupon: false,
      result_id: 'result-1',
      result: {
        title: '测试排班',
        description: '测试说明',
        plans: [{
          name: '第1班',
          rooms: {
            trading: [{
              operators: ['巫恋'],
              skip: false,
              sort: true,
              autofill: false,
              product: 'LMD',
            }],
          },
        }],
      },
    })
    expect(mocks.consumeInventoryItemImmediately).not.toHaveBeenCalled()
    expect(mocks.recordTrackedExportBehaviorEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventKey: 'maa-export:user-1:export-request-1',
      jobId: 'job-1',
      result: expect.not.objectContaining({ raw_results: expect.anything() }),
    }))
  })

  it('lets an active advanced free preview export without consuming a trial coupon', async () => {
    mocks.getProfileForUser.mockResolvedValue({
      ...profile('free_preview', 'growth'),
      temporary_permission: {
        source: 'limited_profile_voucher',
        activity_id: FREE_PREVIEW_LIMITED_CDK_ACTIVITY.id,
        permission: 'advanced',
        starts_at: FREE_PREVIEW_LIMITED_CDK_ACTIVITY.startsAt,
        ends_at: FREE_PREVIEW_LIMITED_CDK_ACTIVITY.endsAt,
        operation_id: 'limited-operation-1',
      },
    })

    const response = await userResultsHandler(exportRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ consumed_coupon: false })
    expect(mocks.consumeInventoryItemImmediately).not.toHaveBeenCalled()
    expect(mocks.recordPersonalUseDeclarationUsage).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      profileId: 'profile-1',
      action: 'generated_result_export',
    }))
  })

  it('rejects a personal-use export when the current declaration is not accepted', async () => {
    mocks.getProfileForUser.mockResolvedValue(profile('free_preview', 'growth'))
    mocks.getValidatedJson.mockResolvedValue({ ...exportBody, use_coupon: true })
    mocks.recordPersonalUseDeclarationUsage.mockRejectedValue(new PersonalUseDeclarationRequiredError())

    const response = await userResultsHandler(exportRequest())

    expect(response.status).toBe(428)
    await expect(response.json()).resolves.toEqual({
      error: '请先确认当前版本的个人使用声明。',
      code: 'personal_use_declaration_required',
    })
    expect(mocks.recordTrackedExportBehaviorEvent).not.toHaveBeenCalled()
    expect(mocks.consumeInventoryItemImmediately).not.toHaveBeenCalled()
  })

  it('fails closed when the declaration audit store is unavailable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.getProfileForUser.mockResolvedValue(profile('free_preview', 'growth'))
    mocks.getValidatedJson.mockResolvedValue({ ...exportBody, use_coupon: true })
    mocks.recordPersonalUseDeclarationUsage.mockRejectedValue(new Error('database unavailable'))

    const response = await userResultsHandler(exportRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: '导出 MAA JSON 失败，请稍后重试。',
      code: 'maa_export_failed',
    })
    expect(mocks.recordTrackedExportBehaviorEvent).not.toHaveBeenCalled()
    expect(mocks.consumeInventoryItemImmediately).not.toHaveBeenCalled()
  })

  it('consumes a trial coupon for an ordinary free preview after the advanced trial', async () => {
    vi.setSystemTime(new Date(FREE_PREVIEW_LIMITED_CDK_ACTIVITY.endsAt))
    mocks.getProfileForUser.mockResolvedValue(profile('free_preview', 'growth'))
    mocks.getValidatedJson.mockResolvedValue({ ...exportBody, use_coupon: true })

    const response = await userResultsHandler(exportRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ consumed_coupon: true, operation_id: 'operation-1' })
    expect(mocks.consumeInventoryItemImmediately).toHaveBeenCalledWith(expect.objectContaining({
      itemCode: 'maa_export_trial_coupon',
      profileId: 'profile-1',
    }))
  })

  it('preserves the inventory error when an ordinary free preview has no coupon', async () => {
    vi.setSystemTime(new Date(FREE_PREVIEW_LIMITED_CDK_ACTIVITY.endsAt))
    mocks.getProfileForUser.mockResolvedValue(profile('free_preview', 'growth'))
    mocks.getValidatedJson.mockResolvedValue({ ...exportBody, use_coupon: true })
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
    vi.setSystemTime(new Date(FREE_PREVIEW_LIMITED_CDK_ACTIVITY.endsAt))
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mocks.getProfileForUser.mockResolvedValue(profile('free_preview', 'growth'))
    mocks.getValidatedJson.mockResolvedValue({ ...exportBody, use_coupon: true })
    mocks.recordTrackedExportBehaviorEvent.mockRejectedValue(new Error('tracking unavailable'))

    const response = await userResultsHandler(exportRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ consumed_coupon: true, operation_id: 'operation-1' })
  })

  it('returns a stable localized error for an unexpected export failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.getProfileOptimizationResult.mockRejectedValue(new Error('database unavailable'))

    const response = await userResultsHandler(exportRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: '导出 MAA JSON 失败，请稍后重试。',
      code: 'maa_export_failed',
    })
  })

  it('requires an explicit coupon confirmation for a growth profile', async () => {
    mocks.getProfileForUser.mockResolvedValue(profile('cdk', 'growth'))

    const response = await userResultsHandler(exportRequest())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: '当前档案需要使用 1 张 MAA 导出体验券，请确认后重试。',
      code: 'maa_export_coupon_required',
    })
    expect(mocks.recordPersonalUseDeclarationUsage).not.toHaveBeenCalled()
    expect(mocks.consumeInventoryItemImmediately).not.toHaveBeenCalled()
  })

  it('requires an explicit coupon confirmation for a recommended profile', async () => {
    mocks.getProfileForUser.mockResolvedValue(profile('cdk', 'recommended'))

    const response = await userResultsHandler(exportRequest())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ code: 'maa_export_coupon_required' })
    expect(mocks.consumeInventoryItemImmediately).not.toHaveBeenCalled()
  })

  it('lets a growth profile export only after explicitly submitting a coupon', async () => {
    mocks.getProfileForUser.mockResolvedValue(profile('cdk', 'growth'))
    mocks.getValidatedJson.mockResolvedValue({ ...exportBody, use_coupon: true })

    const response = await userResultsHandler(exportRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ consumed_coupon: true, operation_id: 'operation-1' })
    expect(mocks.consumeInventoryItemImmediately).toHaveBeenCalledWith(expect.objectContaining({
      itemCode: 'maa_export_trial_coupon',
      profileId: 'profile-1',
    }))
  })

  it('lets a metered advanced profile export without a coupon after declaration audit', async () => {
    mocks.getProfileForUser.mockResolvedValue(profile('metered_personal', 'metered_advanced'))

    const response = await userResultsHandler(exportRequest())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ consumed_coupon: false })
    expect(mocks.consumeInventoryItemImmediately).not.toHaveBeenCalled()
    expect(mocks.recordPersonalUseDeclarationUsage).toHaveBeenCalledWith(expect.objectContaining({
      profileId: 'profile-1',
      action: 'generated_result_export',
    }))
  })

  it('lets an advanced profile download the complete stored result', async () => {
    mocks.getProfileForUser.mockResolvedValue(profile('cdk', 'advanced'))

    const response = await userResultsHandler(exportRequest('full-result-export'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      result_id: 'result-1',
      filename: 'maatool_full_result_result-1.json',
      result: {
        raw_results: [{ total_efficiency: 100 }],
        daily_production: { manufacturing: { LMD: 1000 } },
      },
    })
    expect(mocks.consumeInventoryItemImmediately).not.toHaveBeenCalled()
    expect(mocks.recordTrackedExportBehaviorEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventKey: 'full-result-export:user-1:export-request-1',
      jobId: 'job-1',
      result: expect.objectContaining({ raw_results: expect.any(Array) }),
    }))
  })

  it('rejects complete-result downloads without the advanced capability', async () => {
    vi.setSystemTime(new Date(FREE_PREVIEW_LIMITED_CDK_ACTIVITY.endsAt))
    mocks.getProfileForUser.mockResolvedValue(profile('free_preview', 'growth'))

    const response = await userResultsHandler(exportRequest('full-result-export'))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: '当前档案不支持下载完整计算数据。',
      code: 'full_result_export_forbidden',
    })
    expect(mocks.getProfileOptimizationResult).not.toHaveBeenCalled()
    expect(mocks.consumeInventoryItemImmediately).not.toHaveBeenCalled()
  })

  it('downloads a complete rotation result from the archive', async () => {
    mocks.getProfileForUser.mockResolvedValue(profile('cdk', 'advanced'))
    mocks.getProfileOptimizationResult.mockResolvedValue({
      ...storedHistoryItem(),
      result: { ...optimizerResult(), schedule_mode: 'rotation' },
    })

    const response = await userResultsHandler(exportRequest('full-result-export'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      result: { schedule_mode: 'rotation', raw_results: expect.any(Array) },
    })
  })

  it('does not fail a complete-result download when behavior tracking fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    mocks.getProfileForUser.mockResolvedValue(profile('cdk', 'advanced'))
    mocks.recordTrackedExportBehaviorEvent.mockRejectedValue(new Error('tracking unavailable'))

    const response = await userResultsHandler(exportRequest('full-result-export'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ result_id: 'result-1' })
  })

  it('returns a stable localized error for an unexpected complete-result export failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.getProfileForUser.mockResolvedValue(profile('cdk', 'advanced'))
    mocks.getProfileOptimizationResult.mockRejectedValue(new Error('database unavailable'))

    const response = await userResultsHandler(exportRequest('full-result-export'))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: '下载完整计算数据失败，请稍后重试。',
      code: 'full_result_export_failed',
    })
  })
})

function exportRequest(path = 'maa-export'): Request {
  return new Request(`http://localhost/api/user/${path}`, { method: 'POST' })
}

function profile(kind: 'cdk' | 'free_preview' | 'metered_personal', permission: 'recommended' | 'growth' | 'advanced' | 'metered_advanced') {
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

function optimizerResult() {
  return {
    author: '开发者',
    title: '测试排班',
    description: '测试说明',
    schedule_mode: 'maa',
    buildingType: 253,
    planTimes: '1班',
    plans: [{
      name: '第1班',
      rooms: {
        trading: [{
          operators: ['巫恋'],
          product: 'LMD',
          skip: false,
          sort: true,
          autofill: false,
          efficiency: 100,
          mood: { 巫恋: { start: 24, end: 12 } },
        }],
      },
    }],
    raw_results: [{ total_efficiency: 100, assignment_detail: [] }],
    daily_production: { manufacturing: { LMD: 1000 } },
  }
}

function storedHistoryItem() {
  return {
    id: 'result-1',
    job_id: 'job-1',
    name: '历史结果',
    created_at: '2026-08-01T00:00:00.000Z',
    config: null,
    result: optimizerResult(),
    operator_count: 1,
    source: 'generated' as const,
    archived_at: null,
  }
}

function historySummary() {
  return {
    id: 'result-1',
    job_id: 'job-1',
    name: '历史结果',
    created_at: '2026-08-01T00:00:00.000Z',
    operator_count: 1,
    source: 'generated' as const,
    archived: false,
    schedule_mode: 'maa',
    maa_exportable: true,
    has_config: false,
  }
}

function workspaceRecord(profileId = 'profile-1') {
  return {
    version: 1 as const,
    profile_id: profileId,
    operators: [],
    config: null,
    elite_overrides: {},
    saved_configs: [],
    free_schedule_entitlement: null,
    updated_at: '2026-08-01T00:00:00.000Z',
  }
}
