import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  buildAuthPayload: vi.fn(),
  createLifetimeProfileForJsonImport: vi.fn(),
  requireUserSession: vi.fn(),
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
  useInventoryItem: vi.fn(),
}))

vi.mock('../optimization/jobs/entitlements', () => ({ getReorderCheckQuota: vi.fn() }))

import userInventoryHandler from './user-inventory'

describe('user inventory lifetime JSON profile', () => {
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
