import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  buildAuthPayload: vi.fn(),
  findCdkRecordByCode: vi.fn(),
  getValidatedJson: vi.fn(),
  grantItemInTransaction: vi.fn(),
  listInventory: vi.fn(),
  redeemCdkAtomically: vi.fn(),
  requireUserSession: vi.fn(),
}))

vi.mock('../security/request-validation', () => ({ getValidatedJson: mocks.getValidatedJson }))
vi.mock('../security/request-policy', () => ({ requestSchemas: { cdkRedeem: {} } }))
vi.mock('../storage/cdk-redemption', () => ({
  CdkAlreadyRedeemedError: class CdkAlreadyRedeemedError extends Error {},
  IdempotencyConflictError: class IdempotencyConflictError extends Error {},
  createRequestHash: () => 'request-hash',
  redeemCdkAtomically: mocks.redeemCdkAtomically,
}))
vi.mock('../storage/inventory-store', () => ({
  InventoryError: class InventoryError extends Error {
    constructor(readonly code: string, message: string, readonly status: number) { super(message) }
  },
  grantItemInTransaction: mocks.grantItemInTransaction,
  listInventory: mocks.listInventory,
}))
vi.mock('./license-utils', () => ({
  findCdkRecordByCode: mocks.findCdkRecordByCode,
  getCdkItemCode: (record: { item_code?: string | null }) => record.item_code ?? null,
  getCdkItemExpiresAt: (record: { item_expires_at?: string | null }) => record.item_expires_at ?? null,
  getCdkType: (record: { cdk_type?: string }) => record.cdk_type ?? 'profile',
  normalizeCode: (value: string) => value.trim().toUpperCase(),
}))
vi.mock('./user-auth', () => ({
  buildAuthPayload: mocks.buildAuthPayload,
  jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }),
  redeemProfileCdk: vi.fn(),
  requireUserSession: mocks.requireUserSession,
  upgradePreviewProfileWithCdk: vi.fn(),
}))

import userCdkHandler from './user-cdk'

const itemRecord = {
  version: 3,
  cdk_type: 'item',
  code_hash: 'a'.repeat(64),
  status: 'unused',
  permission: null,
  balance_amount: null,
  item_code: 'lifetime_profile_voucher',
  item_expires_at: null,
  used_at: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireUserSession.mockResolvedValue({ user: { id: 'user-1', email: 'user@example.test' } })
  mocks.getValidatedJson.mockResolvedValue({ cdk: 'item-code', idempotency_key: 'request-1' })
  mocks.listInventory.mockResolvedValue({ stacks: [], capacities: [], recent_events: [] })
  mocks.grantItemInTransaction.mockResolvedValue('grant-1')
})

afterEach(() => vi.useRealTimers())

describe('user CDK redemption', () => {
  it('routes balance CDKs to the points page without claiming them', async () => {
    mocks.findCdkRecordByCode.mockResolvedValue({ key: 'cdk/balance.json', codeHash: 'b'.repeat(64), record: { cdk_type: 'balance' } })
    const response = await userCdkHandler(request())
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ code: 'cdk_type_mismatch', target: '/tool/balance' })
    expect(mocks.redeemCdkAtomically).not.toHaveBeenCalled()
  })

  it('rejects legacy item records without claiming the CDK', async () => {
    mocks.findCdkRecordByCode.mockResolvedValue({ key: 'cdk/legacy.json', codeHash: 'c'.repeat(64), record: { cdk_type: 'item', version: 2 } })
    const response = await userCdkHandler(request())
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      code: 'cdk_payload_unsupported',
      error: '该道具 CDK 的载荷格式不受支持，暂时无法兑换。',
    })
    expect(mocks.redeemCdkAtomically).not.toHaveBeenCalled()
  })

  it('does not consume an item CDK submitted for a profile upgrade', async () => {
    mocks.getValidatedJson.mockResolvedValue({
      cdk: 'item-code',
      idempotency_key: 'request-1',
      profile_id: 'preview-profile',
    })
    mocks.findCdkRecordByCode.mockResolvedValue({ key: 'cdk/item.json', codeHash: itemRecord.code_hash, record: itemRecord })

    const response = await userCdkHandler(request())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ code: 'cdk_type_mismatch' })
    expect(mocks.redeemCdkAtomically).not.toHaveBeenCalled()
    expect(mocks.grantItemInTransaction).not.toHaveBeenCalled()
  })

  it('grants a version 3 item inside the CDK completion callback', async () => {
    const match = { key: 'cdk/item.json', codeHash: itemRecord.code_hash, record: itemRecord }
    mocks.findCdkRecordByCode.mockResolvedValue(match)
    mocks.redeemCdkAtomically.mockImplementation(async (options) => {
      const completed = await options.complete({}, itemRecord)
      return { response: completed.response, replayed: false }
    })

    const response = await userCdkHandler(request())
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      redemption_type: 'inventory',
      item: { code: 'lifetime_profile_voucher', name: '终身版兑换 CDK', quantity: 1, expires_at: null },
      replayed: false,
    })
    expect(mocks.grantItemInTransaction).toHaveBeenCalledWith({}, expect.objectContaining({
      userId: 'user-1',
      itemCode: 'lifetime_profile_voucher',
      sourceType: 'item_cdk',
      sourceId: itemRecord.code_hash,
    }))
  })

  it('passes a limited item CDK expiry through to the inventory grant', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-31T00:00:00.000Z'))
    const limitedRecord = { ...itemRecord, item_code: 'limited_profile_voucher', item_expires_at: '2026-09-01T15:59:59.000Z' }
    mocks.findCdkRecordByCode.mockResolvedValue({ key: 'cdk/item.json', codeHash: itemRecord.code_hash, record: limitedRecord })
    mocks.redeemCdkAtomically.mockImplementation(async (options) => {
      const completed = await options.complete({}, limitedRecord)
      return { response: completed.response, replayed: false }
    })

    const response = await userCdkHandler(request())
    expect(response.status).toBe(200)
    expect(mocks.grantItemInTransaction).toHaveBeenCalledWith({}, expect.objectContaining({
      itemCode: 'limited_profile_voucher',
      expiresAt: '2026-09-01T15:59:59.000Z',
    }))
  })
})

function request(): Request {
  return new Request('http://localhost/api/user/cdk/redeem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cdk: 'item-code', idempotency_key: 'request-1' }),
  })
}
