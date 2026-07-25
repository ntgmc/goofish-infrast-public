import { beforeEach, describe, expect, it, vi } from 'vitest'

const { ensureDatabaseSchema, getProfileWorkspace, listProfilesForUser, query } = vi.hoisted(() => ({
  ensureDatabaseSchema: vi.fn(),
  getProfileWorkspace: vi.fn(),
  listProfilesForUser: vi.fn(),
  query: vi.fn(),
}))

vi.mock('./schema', () => ({ ensureDatabaseSchema }))
vi.mock('./postgres', () => ({ query, withTransaction: vi.fn() }))
vi.mock('./user-store', () => ({
  getProfileWorkspace,
  listProfilesForUser,
  isDepotValueProfile: (profile: { kind?: string }) => profile.kind === 'depot_value',
}))

import { listInventory } from './inventory-store'

describe('inventory listing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureDatabaseSchema.mockResolvedValue(undefined)
    listProfilesForUser.mockResolvedValue([
      { id: 'schedule-profile', user_id: 'user-1', kind: 'cdk', status: 'active', display_name: '排班档案' },
      { id: 'depot-profile', user_id: 'user-1', kind: 'depot_value', status: 'active', display_name: '仓库档案' },
    ])
    getProfileWorkspace.mockResolvedValue(null)
    query.mockImplementation(async (statement: string) => {
      if (statement.includes('from reward_grants grants')) return { rows: [] }
      if (statement.includes('from inventory_ledger')) return { rows: [] }
      if (statement.includes('from profile_entitlement_balances balances')) return { rows: [] }
      throw new Error(`Unexpected inventory query: ${statement}`)
    })
  })

  it('returns zero usage for a scheduling profile without a workspace and excludes depot profiles', async () => {
    const inventory = await listInventory('user-1', new Date('2026-07-25T00:00:00.000Z'))

    expect(inventory.stacks).toEqual([])
    expect(inventory.capacities).toEqual([expect.objectContaining({
      profile_id: 'schedule-profile',
      display_name: '排班档案',
      plan_slots: expect.objectContaining({ used: 0 }),
      history_slots: expect.objectContaining({ used: 0 }),
      archive_slots: expect.objectContaining({ used: 0 }),
    })])
    expect(getProfileWorkspace).toHaveBeenCalledTimes(1)
    expect(getProfileWorkspace).toHaveBeenCalledWith('schedule-profile')
  })
})
