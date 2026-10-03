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

import { listInventory, useInventoryItem } from './inventory-store'
import { withTransaction } from './postgres'
import type { PoolClient } from 'pg'
import type { GiftPackOpeningRule } from '../../src/lib/inventory-contracts'

vi.mock('./notification-store', () => ({
  upsertItemGrantNotificationInTransaction: vi.fn(),
  upsertItemGrantNotificationGroupInTransaction: vi.fn(),
}))

function mockChest(rule: GiftPackOpeningRule) {
  ensureDatabaseSchema.mockResolvedValue(undefined)
  let response: Record<string, unknown> | undefined
  let requestHash = ''
  const rewards = [
    { item_code: 'priority_compute_coupon', quantity: 3, validity_days: 7, name: '优先计算券', icon_key: 'placeholder', opening_rule: rule },
    { item_code: 'training_diagnosis_coupon', quantity: 2, validity_days: 0, name: '培养诊断券', icon_key: 'placeholder', opening_rule: rule },
    { item_code: 'plan_capacity_certificate', quantity: 1, validity_days: 0, name: '方案扩容证', icon_key: 'placeholder', opening_rule: rule },
  ]
  const clientQuery = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (sql.startsWith('select request_hash')) return { rows: response ? [{ request_hash: requestHash, response_json: response }] : [] }
    if (sql.includes('insert into inventory_operations')) requestHash = String(values[3])
    if (sql.startsWith('update inventory_operations')) response = JSON.parse(String(values[2])) as Record<string, unknown>
    if (sql.startsWith('select kind, effect_code')) return { rows: [{ kind: 'gift_pack', effect_code: 'open_gift_pack' }] }
    if (sql.includes('select id, gift_pack_version_id')) return { rows: [{ id: 'chest-grant', gift_pack_version_id: 'chest-v1' }] }
    if (sql.includes('from gift_pack_version_contents content')) return { rows: rewards }
    if (sql.startsWith('select kind, issuance_enabled')) return { rows: [{ kind: 'consumable', issuance_enabled: true, name: '奖励', icon_key: 'placeholder' }] }
    if (sql.includes('insert into reward_grants')) return { rows: [{ id: `reward-${values[2]}` }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  })
  vi.mocked(withTransaction).mockImplementation(async (callback) => callback({ query: clientQuery } as unknown as PoolClient))
  return clientQuery
}

describe('chest opening', () => {
  it('aggregates batch rewards and replays the entire batch without consuming again', async () => {
    const clientQuery = mockChest({ mode: 'all' })
    const request = { item_code: 'chest', quantity: 3, gift_pack_version_id: 'chest-v1', idempotency_key: 'batch-request' }
    const result = await useInventoryItem('user-1', request)
    expect(result).toMatchObject({
      quantity: 3,
      rewards: [
        { item_code: 'priority_compute_coupon', quantity: 9 },
        { item_code: 'training_diagnosis_coupon', quantity: 6 },
        { item_code: 'plan_capacity_certificate', quantity: 3 },
      ],
    })
    expect(clientQuery.mock.calls.filter(([sql]) => sql.startsWith('update reward_grants'))).toHaveLength(3)
    expect(await useInventoryItem('user-1', request)).toEqual(result)
    expect(clientQuery.mock.calls.filter(([sql]) => sql.startsWith('update reward_grants'))).toHaveLength(3)
  })

  it('rejects invalid batch sizes before beginning a transaction', async () => {
    const clientQuery = mockChest({ mode: 'all' })
    for (const quantity of [0, -1, 1.5, 101, NaN]) {
      await expect(useInventoryItem('user-1', { item_code: 'chest', quantity, idempotency_key: 'invalid' }))
        .rejects.toMatchObject({ code: 'quantity_invalid' })
    }
    expect(clientQuery).not.toHaveBeenCalled()
  })

  it('rejects invalid choices before consuming the chest and grants exactly the selected quantities', async () => {
    const clientQuery = mockChest({ mode: 'choice', count: 2 })
    const request = { item_code: 'chest', quantity: 1 as const, gift_pack_version_id: 'chest-v1', idempotency_key: 'choice-request' }
    for (const selected of [undefined, [], ['priority_compute_coupon'], ['priority_compute_coupon', 'priority_compute_coupon'], ['priority_compute_coupon', 'unknown'], ['priority_compute_coupon', 'training_diagnosis_coupon', 'plan_capacity_certificate']]) {
      await expect(useInventoryItem('user-1', { ...request, selected_item_codes: selected })).rejects.toMatchObject({ code: 'gift_pack_selection_invalid' })
    }
    expect(clientQuery.mock.calls.some(([sql]) => sql.startsWith('update reward_grants'))).toBe(false)
    const result = await useInventoryItem('user-1', { ...request, selected_item_codes: ['priority_compute_coupon', 'training_diagnosis_coupon'] }, new Date('2026-10-01T00:00:00.000Z'))
    expect(result.rewards).toEqual([
      expect.objectContaining({ item_code: 'priority_compute_coupon', quantity: 3, expires_at: '2026-10-08T00:00:00.000Z' }),
      expect.objectContaining({ item_code: 'training_diagnosis_coupon', quantity: 2, expires_at: null }),
    ])
  })

  it('draws distinct random rewards and replays the original result without consuming again', async () => {
    const clientQuery = mockChest({ mode: 'random', count: 2 })
    const request = { item_code: 'chest', quantity: 1 as const, idempotency_key: 'random-request' }
    await expect(useInventoryItem('user-1', { ...request, selected_item_codes: ['priority_compute_coupon', 'training_diagnosis_coupon'] })).rejects.toMatchObject({ code: 'gift_pack_selection_invalid' })
    const result = await useInventoryItem('user-1', request)
    const rewards = result.rewards as Array<{ item_code: string }>
    expect(rewards).toHaveLength(2)
    expect(new Set(rewards.map((reward) => reward.item_code)).size).toBe(2)
    expect(await useInventoryItem('user-1', request)).toEqual(result)
    expect(clientQuery.mock.calls.filter(([sql]) => sql.startsWith('update reward_grants'))).toHaveLength(1)
  })

  it('grants repeated choices in batches with their original expiry and replays without granting again', async () => {
    const clientQuery = mockChest({ mode: 'choice', count: 5, allow_duplicates: true })
    const selected = ['priority_compute_coupon', 'priority_compute_coupon', 'priority_compute_coupon', 'training_diagnosis_coupon', 'training_diagnosis_coupon']
    const request = {
      item_code: 'chest', quantity: 2, gift_pack_version_id: 'chest-v1',
      selected_item_codes: selected, idempotency_key: 'repeated-choice-request',
    }
    for (const invalid of [[], selected.slice(1), [...selected, 'plan_capacity_certificate'], [...selected.slice(1), 'unknown']]) {
      await expect(useInventoryItem('user-1', { ...request, selected_item_codes: invalid }))
        .rejects.toMatchObject({ code: 'gift_pack_selection_invalid' })
    }
    expect(clientQuery.mock.calls.some(([sql]) => sql.startsWith('update reward_grants'))).toBe(false)
    const result = await useInventoryItem('user-1', request, new Date('2026-10-01T00:00:00.000Z'))
    expect(result.rewards).toEqual([
      expect.objectContaining({ item_code: 'priority_compute_coupon', quantity: 18, expires_at: '2026-10-08T00:00:00.000Z' }),
      expect.objectContaining({ item_code: 'training_diagnosis_coupon', quantity: 8, expires_at: null }),
    ])
    const grants = clientQuery.mock.calls.filter(([sql]) => sql.includes('insert into reward_grants'))
    expect(grants).toHaveLength(10)
    expect(new Set(grants.map(([, values]) => JSON.stringify([values[4], values[5]]))).size).toBe(10)
    expect(await useInventoryItem('user-1', request)).toEqual(result)
    expect(clientQuery.mock.calls.filter(([sql]) => sql.includes('insert into reward_grants'))).toHaveLength(10)
  })

  it('draws the configured number of random rewards with replacement and preserves the first result on retry', async () => {
    const clientQuery = mockChest({ mode: 'random', count: 5, allow_duplicates: true })
    const request = { item_code: 'chest', quantity: 1, idempotency_key: 'repeated-random-request' }
    await expect(useInventoryItem('user-1', { ...request, selected_item_codes: ['priority_compute_coupon'] }))
      .rejects.toMatchObject({ code: 'gift_pack_selection_invalid' })
    expect(clientQuery.mock.calls.some(([sql]) => sql.startsWith('update reward_grants'))).toBe(false)
    const result = await useInventoryItem('user-1', request)
    const rewards = result.rewards as Array<{ item_code: string; quantity: number }>
    const quantities: Record<string, number> = { priority_compute_coupon: 3, training_diagnosis_coupon: 2, plan_capacity_certificate: 1 }
    expect(rewards.length).toBeLessThanOrEqual(3)
    expect(new Set(rewards.map((reward) => reward.item_code)).size).toBe(rewards.length)
    expect(rewards.reduce((total, reward) => total + reward.quantity / quantities[reward.item_code], 0)).toBe(5)
    const grants = clientQuery.mock.calls.filter(([sql]) => sql.includes('insert into reward_grants'))
    expect(grants).toHaveLength(5)
    expect(new Set(grants.map(([, values]) => values[5])).size).toBe(5)
    expect(await useInventoryItem('user-1', request)).toEqual(result)
    expect(clientQuery.mock.calls.filter(([sql]) => sql.startsWith('update reward_grants'))).toHaveLength(1)
    expect(clientQuery.mock.calls.filter(([sql]) => sql.includes('insert into reward_grants'))).toHaveLength(5)
  })
})

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
      if (statement.includes('from user_profile_workspaces')) return { rows: [] }
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
    expect(getProfileWorkspace).not.toHaveBeenCalled()
  })
})
