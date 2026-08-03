import { beforeEach, describe, expect, it, vi } from 'vitest'
import adminCdkHandler from './admin-cdk'

const mocks = vi.hoisted(() => ({
  authenticateAdminRequest: vi.fn(),
  buildOperatorFingerprint: vi.fn(),
  generateCdk: vi.fn(),
  hashCdk: vi.fn(),
  getCdk: vi.fn(),
  listAdminPage: vi.fn(),
  createCdkBatch: vi.fn(),
  deleteUnusedCdk: vi.fn(),
  mutateCdk: vi.fn(),
  getProfileById: vi.fn(),
  getProfileWorkspace: vi.fn(),
  setOperatorBaselineByAdmin: vi.fn(),
  validateOperators: vi.fn(),
}))

vi.mock('./admin-auth', () => ({ authenticateAdminRequest: mocks.authenticateAdminRequest }))

vi.mock('./license-utils', () => ({
  CDK_PRODUCT_PERMISSIONS: ['recommended', 'growth', 'advanced', 'ultimate'],
  acceptLatestOperatorBaselineAndUnfreeze: vi.fn(),
  buildOperatorFingerprint: mocks.buildOperatorFingerprint,
  generateCdk: mocks.generateCdk,
  getCdkBalanceAmount: vi.fn(() => null),
  getCdkType: (record: { cdk_type?: string }) => record.cdk_type ?? 'profile',
  getCdkItemCode: (record: { item_code?: string | null }) => record.item_code ?? null,
  getCdkItemExpiresAt: (record: { item_expires_at?: string | null }) => record.item_expires_at ?? null,
  getCdkRecordStore: vi.fn(async () => ({
    get: mocks.getCdk,
    listAdminPage: mocks.listAdminPage,
    createBatch: mocks.createCdkBatch,
    deleteUnused: mocks.deleteUnusedCdk,
    mutate: mocks.mutateCdk,
  })),
  hashCdk: mocks.hashCdk,
  isProfileCdkRecord: (record: { cdk_type?: string }) => (record.cdk_type ?? 'profile') === 'profile',
  jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }),
  requireEnv: vi.fn(() => 'test-secret'),
  setOperatorBaselineByAdmin: mocks.setOperatorBaselineByAdmin,
  unfreezeCdkRecord: vi.fn(),
  validateOperators: mocks.validateOperators,
}))

vi.mock('../storage/user-store', () => ({
  getProfileById: mocks.getProfileById,
  getProfileWorkspace: mocks.getProfileWorkspace,
}))

const codeHash = 'a'.repeat(64)
const workspaceOperators = [
  { id: 'char-1', name: '工作区干员', own: true, elite: 2, rarity: 5 },
]
const workspaceFingerprint = { hash: 'workspace-hash', owned_count: 1, operators: {} }
const record = {
  version: 1,
  code_hash: codeHash,
  permission: 'advanced',
  status: 'used',
  created_at: '2026-01-01T00:00:00.000Z',
  used_at: '2026-01-02T00:00:00.000Z',
  order_note: null,
  license_order_hash: 'order-1',
  operator_count: 12,
  config_desc: null,
  account_id: 'user-1',
  profile_id: 'profile-1',
  baseline_operator_fingerprint: { hash: 'baseline-hash', owned_count: 8, operators: {} },
  latest_operator_fingerprint: { hash: 'latest-hash', owned_count: 10, operators: {} },
  risk_events: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.authenticateAdminRequest.mockResolvedValue({ ok: true })
  mocks.getCdk.mockResolvedValue(record)
  mocks.listAdminPage.mockResolvedValue({ records: [], page: 1, total: 0 })
  mocks.generateCdk.mockReturnValue('ITEM-CDK-CODE')
  mocks.hashCdk.mockReturnValue(codeHash)
  mocks.createCdkBatch.mockResolvedValue(undefined)
  mocks.deleteUnusedCdk.mockResolvedValue(true)
  mocks.mutateCdk.mockImplementation(async (_key, mutate) => mutate(record))
  mocks.getProfileById.mockResolvedValue({
    id: record.profile_id,
    user_id: record.account_id,
    cdk_code_hash: record.code_hash,
  })
  mocks.getProfileWorkspace.mockResolvedValue({
    profile_id: record.profile_id,
    operators: workspaceOperators,
    updated_at: '2026-01-03T00:00:00.000Z',
  })
  mocks.validateOperators.mockReturnValue({ ok: true, operators: workspaceOperators })
  mocks.buildOperatorFingerprint.mockReturnValue(workspaceFingerprint)
  mocks.setOperatorBaselineByAdmin.mockImplementation(async (current, options) => ({
    ...current,
    status: 'used',
    baseline_operator_fingerprint: options.fingerprint ?? current.latest_operator_fingerprint,
    latest_operator_fingerprint: options.fingerprint ?? current.latest_operator_fingerprint,
  }))
})

describe('admin CDK operator baseline controls', () => {
  it('returns availability metadata for all trusted baseline sources', async () => {
    const response = await adminCdkHandler(new Request(`http://localhost/api/admin/cdk?code_hash=${codeHash}`))

    expect(response.status).toBe(200)
    const body = await response.json() as { cdk: { operator_baseline_options: unknown[] } }
    expect(body.cdk.operator_baseline_options).toEqual([
      { source: 'latest', available: true, owned_count: 10, updated_at: null },
      { source: 'workspace', available: true, owned_count: 1, updated_at: '2026-01-03T00:00:00.000Z' },
      { source: 'next_import', available: true, owned_count: null, updated_at: null },
    ])
    expect(mocks.authenticateAdminRequest).toHaveBeenCalledWith(expect.any(Request), 'admin_manage')
  })

  it('rebuilds the workspace fingerprint on the server before selecting it', async () => {
    const response = await adminCdkHandler(baselineRequest('workspace'))

    expect(response.status).toBe(200)
    expect(mocks.validateOperators).toHaveBeenCalledWith(workspaceOperators)
    expect(mocks.buildOperatorFingerprint).toHaveBeenCalledWith(workspaceOperators)
    expect(mocks.setOperatorBaselineByAdmin).toHaveBeenCalledWith(record, {
      source: 'workspace',
      reason: '已核验工作区',
      unfreeze: true,
      fingerprint: workspaceFingerprint,
    })
  })

  it('rejects workspace selection when the linked profile does not belong to the CDK account', async () => {
    mocks.getProfileById.mockResolvedValue({
      id: record.profile_id,
      user_id: 'other-user',
      cdk_code_hash: record.code_hash,
    })

    const response = await adminCdkHandler(baselineRequest('workspace'))

    expect(response.status).toBe(409)
    expect(mocks.setOperatorBaselineByAdmin).not.toHaveBeenCalled()
  })

  it('rejects baseline changes for an unused CDK', async () => {
    mocks.getCdk.mockResolvedValue({ ...record, status: 'unused' })

    const response = await adminCdkHandler(baselineRequest('next_import'))

    expect(response.status).toBe(409)
    expect(mocks.setOperatorBaselineByAdmin).not.toHaveBeenCalled()
  })
})

describe('admin item CDK generation', () => {
  it('creates a version 3 lifetime voucher CDK', async () => {
    mocks.getCdk.mockResolvedValue(null)
    const response = await adminCdkHandler(createRequest({
      cdk_type: 'item',
      item_code: 'lifetime_profile_voucher',
      count: 1,
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      code: 'ITEM-CDK-CODE',
      cdk_type: 'item',
      item_code: 'lifetime_profile_voucher',
      item_name: '终身版兑换 CDK',
      item_expires_at: null,
    })
    expect(mocks.createCdkBatch).toHaveBeenCalledWith([{
      key: `cdk/${codeHash}.json`,
      record: expect.objectContaining({
        version: 3,
        cdk_type: 'item',
        item_code: 'lifetime_profile_voucher',
        item_expires_at: null,
        permission: null,
        balance_amount: null,
      }),
    }])
    expect(mocks.authenticateAdminRequest).toHaveBeenCalledWith(expect.any(Request), {
      capability: 'admin_manage',
      requireRecentLogin: true,
    })
  })

  it('rejects mixed item and balance payloads', async () => {
    const response = await adminCdkHandler(createRequest({
      cdk_type: 'item',
      item_code: 'limited_profile_voucher',
      amount: '10.00',
    }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'cdk_payload_mismatch' })
    expect(mocks.createCdkBatch).not.toHaveBeenCalled()
  })
})

describe('admin CDK capability gates', () => {
  it('keeps the dedicated risk listing behind risk_view', async () => {
    const response = await adminCdkHandler(new Request('http://localhost/api/admin/cdk?view=risk&page=1&page_size=25'))

    expect(response.status).toBe(200)
    expect(mocks.authenticateAdminRequest).toHaveBeenCalledWith(expect.any(Request), 'risk_view')
  })
})

describe('admin CDK atomic lifecycle operations', () => {
  it('returns stable per-item results for a batch revoke', async () => {
    const secondHash = 'b'.repeat(64)
    const response = await adminCdkHandler(new Request('http://localhost/api/admin/cdk', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'revoke', code_hashes: [codeHash, secondHash] }),
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ succeeded: 2, failed: 0 })
    expect(mocks.mutateCdk).toHaveBeenCalledTimes(2)
  })

  it('reports a conflict when the conditional delete loses a redemption race', async () => {
    mocks.getCdk.mockResolvedValue({ ...record, status: 'unused' })
    mocks.deleteUnusedCdk.mockResolvedValue(false)
    const response = await adminCdkHandler(new Request('http://localhost/api/admin/cdk', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code_hash: codeHash }),
    }))

    expect(response.status).toBe(409)
    expect(mocks.deleteUnusedCdk).toHaveBeenCalledWith(`cdk/${codeHash}.json`)
  })
})

function baselineRequest(source: 'latest' | 'workspace' | 'next_import') {
  return new Request('http://localhost/api/admin/cdk', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code_hash: codeHash,
      action: 'set_operator_baseline',
      baseline_source: source,
      reason: '已核验工作区',
    }),
  })
}

function createRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/admin/cdk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
