import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { FREE_PREVIEW_LIMITED_CDK_ACTIVITY } from '../free-preview-trial'
import { InventoryError } from '../storage/inventory-store'
import { PersonalUseDeclarationRequiredError } from '../storage/personal-use-declaration-store'
import userResultsHandler from './user-results'

const mocks = vi.hoisted(() => ({
  consumeInventoryItemImmediately: vi.fn(),
  getProfileCapacityLimitsInTransaction: vi.fn(),
  recordPersonalUseDeclarationUsage: vi.fn(),
  getProfileForUser: vi.fn(),
  getProfileWorkspace: vi.fn(),
  getValidatedJson: vi.fn(),
  recordTrackedExportBehaviorEvent: vi.fn(),
  requireUserSession: vi.fn(),
  emptyWorkspace: vi.fn(),
  toPublicWorkspace: vi.fn(),
  updateProfileWorkspaceInTransaction: vi.fn(),
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
  emptyWorkspace: mocks.emptyWorkspace,
  getProfileForUser: mocks.getProfileForUser,
  getProfileWorkspace: mocks.getProfileWorkspace,
  isDepotValueProfile: (profile: { kind?: string }) => profile.kind === 'depot_value',
  isFreePreviewProfile: (profile: { kind?: string }) => profile.kind === 'free_preview',
  normalizeProfileKind: (profile: { kind?: string }) => profile.kind ?? 'cdk',
  toPublicWorkspace: mocks.toPublicWorkspace,
  updateProfileWorkspaceInTransaction: mocks.updateProfileWorkspaceInTransaction,
}))

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

let workspaceState: ReturnType<typeof workspaceRecord>

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
  mocks.getProfileWorkspace.mockResolvedValue({
    result_history: [{ id: 'result-1', job_id: 'job-1', result: optimizerResult() }],
    archived_results: [],
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
  workspaceState = workspaceRecord()
  mocks.getProfileCapacityLimitsInTransaction.mockResolvedValue({ plan: 3, history: 5, archive: 1 })
  mocks.emptyWorkspace.mockImplementation((profileId: string) => workspaceRecord(profileId, []))
  mocks.toPublicWorkspace.mockImplementation((workspace: unknown) => workspace)
  mocks.clientQuery.mockResolvedValue({ rows: [], rowCount: 1 })
  mocks.withTransaction.mockImplementation(async (run: (client: { query: typeof mocks.clientQuery }) => unknown) => (
    run({ query: mocks.clientQuery })
  ))
  mocks.updateProfileWorkspaceInTransaction.mockImplementation(async (
    _client: unknown,
    _profileId: string,
    update: (current: typeof workspaceState) => typeof workspaceState,
  ) => {
    workspaceState = update(workspaceState)
    return workspaceState
  })
})

describe('result history mutations', () => {
  it('archives the only result without recreating a legacy duplicate', async () => {
    mocks.getValidatedJson.mockResolvedValue({ ...exportBody, action: 'archive' })

    const response = await userResultsHandler(exportRequest('result-archive'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      workspace: {
        last_result: null,
        result_history: [],
        archived_results: [{ id: 'result-1' }],
      },
      action: 'archive',
      result_id: 'result-1',
    })
    expect(workspaceState.last_result).toBeNull()
  })

  it('restores last_result when unarchiving a result', async () => {
    const item = storedHistoryItem()
    workspaceState = workspaceRecord('profile-1', [], [item])
    mocks.getValidatedJson.mockResolvedValue({ ...exportBody, action: 'unarchive' })

    const response = await userResultsHandler(exportRequest('result-archive'))

    expect(response.status).toBe(200)
    expect(workspaceState.result_history.map((entry) => entry.id)).toEqual(['result-1'])
    expect(workspaceState.archived_results).toEqual([])
    expect(workspaceState.last_result).toEqual(item.result)
  })

  it('deletes the only result and clears last_result', async () => {
    mocks.getValidatedJson.mockResolvedValue({ ...exportBody, action: 'delete' })

    const response = await userResultsHandler(exportRequest('result-archive'))

    expect(response.status).toBe(200)
    expect(workspaceState.result_history).toEqual([])
    expect(workspaceState.last_result).toBeNull()
  })

  it('returns 404 for a new delete operation targeting a missing result', async () => {
    workspaceState = workspaceRecord('profile-1', [])
    mocks.getValidatedJson.mockResolvedValue({ ...exportBody, action: 'delete' })

    const response = await userResultsHandler(exportRequest('result-archive'))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ code: 'result_archive_failed' })
  })

  it('replays a completed mutation with the same idempotency key', async () => {
    const replay = { workspace: workspaceRecord('profile-1', []), action: 'delete', result_id: 'result-1', operation_id: 'operation-replay' }
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
    expect(mocks.updateProfileWorkspaceInTransaction).not.toHaveBeenCalled()
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
    mocks.getProfileWorkspace.mockRejectedValue(new Error('database unavailable'))

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
    expect(mocks.getProfileWorkspace).not.toHaveBeenCalled()
    expect(mocks.consumeInventoryItemImmediately).not.toHaveBeenCalled()
  })

  it('downloads a complete rotation result from the archive', async () => {
    mocks.getProfileForUser.mockResolvedValue(profile('cdk', 'advanced'))
    mocks.getProfileWorkspace.mockResolvedValue({
      result_history: [],
      archived_results: [{ id: 'result-1', result: { ...optimizerResult(), schedule_mode: 'rotation' } }],
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
    mocks.getProfileWorkspace.mockRejectedValue(new Error('database unavailable'))

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
  }
}

function workspaceRecord(profileId = 'profile-1', resultHistory = [storedHistoryItem()], archivedResults: ReturnType<typeof storedHistoryItem>[] = []) {
  return {
    version: 1 as const,
    profile_id: profileId,
    operators: [],
    config: null,
    elite_overrides: {},
    last_result: resultHistory[0]?.result ?? null,
    saved_configs: [],
    result_history: resultHistory,
    archived_results: archivedResults,
    free_schedule_entitlement: null,
    updated_at: '2026-08-01T00:00:00.000Z',
  }
}
