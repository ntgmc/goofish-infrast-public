import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  buildAuthPayload: vi.fn(),
  createLifetimeProfileForJsonImport: vi.fn(),
  requireUserSession: vi.fn(),
  useInventoryItem: vi.fn(),
}))

vi.mock('./user-auth', () => ({
  buildAuthPayload: mocks.buildAuthPayload,
  jsonResponse: (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }),
  requireUserSession: mocks.requireUserSession,
}))

vi.mock('../storage/inventory-store', () => ({
  claimOnboardingTask: vi.fn(),
  createLifetimeProfileForJsonImport: mocks.createLifetimeProfileForJsonImport,
  InventoryError: class InventoryError extends Error {
    constructor(readonly code: string, message: string, readonly status: number) {
      super(message)
    }
  },
  listInventory: vi.fn(),
  listOnboardingTasks: vi.fn(),
  useInventoryItem: mocks.useInventoryItem,
}))

vi.mock('../security/request-validation', () => ({
  getValidatedJson: (req: Request) => req.json(),
}))

import userInventoryHandler from './user-inventory'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireUserSession.mockResolvedValue({ user: { id: 'user-1' } })
  mocks.createLifetimeProfileForJsonImport.mockResolvedValue({ profileId: 'lifetime-1', replayed: false })
  mocks.buildAuthPayload.mockResolvedValue({
    user: { id: 'user-1' },
    profiles: [{ id: 'lifetime-1' }],
    active_profile: { id: 'lifetime-1' },
    workspace: null,
  })
})

describe('user inventory item use', () => {
  const activation = {
    operation_id: 'operation-1',
    item_code: 'limited_profile_voucher',
    profile_id: 'preview-1',
    permission: 'advanced',
    starts_at: '2026-08-01T00:00:00.000Z',
    ends_at: '2026-08-19T16:00:00.000Z',
  }

  it('returns a fresh auth payload after activating a limited profile voucher', async () => {
    const authPayload = {
      user: { id: 'user-1' },
      profiles: [{ id: 'preview-1', trial: { active: true } }],
      active_profile: { id: 'preview-1', trial: { active: true } },
      workspace: null,
    }
    mocks.useInventoryItem.mockResolvedValue(activation)
    mocks.buildAuthPayload.mockResolvedValue(authPayload)

    const response = await userInventoryHandler(itemUseRequest())

    expect(response.status).toBe(200)
    expect(mocks.useInventoryItem).toHaveBeenCalledWith('user-1', {
      item_code: 'limited_profile_voucher',
      quantity: 1,
      idempotency_key: 'limited-request-1',
    })
    expect(mocks.buildAuthPayload).toHaveBeenCalledWith({ id: 'user-1' }, 'preview-1')
    await expect(response.json()).resolves.toEqual({ ...activation, auth: authPayload })
  })

  it('does not build an auth payload for ordinary item responses', async () => {
    const ordinaryResult = {
      operation_id: 'operation-2',
      item_code: 'newcomer_supply_pack',
      rewards: [{ item_code: 'priority_compute_coupon', quantity: 1, expires_at: null }],
    }
    mocks.useInventoryItem.mockResolvedValue(ordinaryResult)

    const response = await userInventoryHandler(itemUseRequest('newcomer_supply_pack'))

    expect(mocks.buildAuthPayload).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual(ordinaryResult)
  })

  it('rebuilds the auth payload when an idempotent activation is replayed', async () => {
    const firstAuth = { user: { id: 'user-1' }, profiles: [], active_profile: null, workspace: null }
    const replayedAuth = {
      user: { id: 'user-1' },
      profiles: [{ id: 'preview-1', trial: { active: true } }],
      active_profile: { id: 'preview-1', trial: { active: true } },
      workspace: null,
    }
    mocks.useInventoryItem.mockResolvedValue(activation)
    mocks.buildAuthPayload.mockResolvedValueOnce(firstAuth).mockResolvedValueOnce(replayedAuth)

    await userInventoryHandler(itemUseRequest())
    const replayed = await userInventoryHandler(itemUseRequest())

    expect(mocks.useInventoryItem).toHaveBeenCalledTimes(2)
    expect(mocks.buildAuthPayload).toHaveBeenCalledTimes(2)
    await expect(replayed.json()).resolves.toEqual({ ...activation, auth: replayedAuth })
  })
})

describe('user inventory lifetime JSON profile', () => {
  it('creates an unbound lifetime profile and returns the standard auth payload', async () => {
    const response = await userInventoryHandler(new Request('http://localhost/api/user/inventory/lifetime-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idempotency_key: 'lifetime-json-request',
        display_name: 'JSON 终身档案',
        note: '手动导入',
      }),
    }))

    expect(response.status).toBe(201)
    expect(mocks.createLifetimeProfileForJsonImport).toHaveBeenCalledWith({
      userId: 'user-1',
      idempotencyKey: 'lifetime-json-request',
      displayName: 'JSON 终身档案',
      note: '手动导入',
    })
    expect(mocks.buildAuthPayload).toHaveBeenCalledWith({ id: 'user-1' }, 'lifetime-1')
    await expect(response.json()).resolves.toMatchObject({
      active_profile: { id: 'lifetime-1' },
      replayed: false,
    })
  })
})

function itemUseRequest(itemCode = 'limited_profile_voucher'): Request {
  return new Request('http://localhost/api/user/inventory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      item_code: itemCode,
      quantity: 1,
      idempotency_key: 'limited-request-1',
    }),
  })
}
