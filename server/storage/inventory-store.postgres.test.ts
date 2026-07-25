import { randomUUID } from 'node:crypto'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createCustomGiftPack,
  createGiftPackDraft,
  publishGiftPackVersion,
  recoverStaleInventoryCampaignRecipients,
} from './admin-inventory-store'
import {
  getItemBalance,
  getProfileCapacityLimits,
  grantItem,
  listInventory,
  refundReservedItemsInTransaction,
  reserveItemsInTransaction,
  useInventoryItem,
} from './inventory-store'
import { closePool, query, withTransaction } from './postgres'
import { ensureDatabaseSchema } from './schema'

let container: PostgreSqlContainer

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  process.env.DATABASE_URL = container.getConnectionUri()
  await ensureDatabaseSchema()
})

afterAll(async () => {
  await closePool()
  if (container) await container.stop()
})

describe('PostgreSQL unified inventory', () => {
  it('lists an empty inventory for a scheduling profile without a workspace', async () => {
    const { userId, profileId } = await seedUserProfile()

    const inventory = await listInventory(userId)

    expect(inventory.stacks).toEqual([])
    expect(inventory.capacities).toEqual([expect.objectContaining({
      profile_id: profileId,
      plan_slots: expect.objectContaining({ used: 0 }),
      history_slots: expect.objectContaining({ used: 0 }),
      archive_slots: expect.objectContaining({ used: 0 }),
    })])
  })

  it('consumes the earliest expiring batch and refunds once with a renewed relative lifetime', async () => {
    const { userId, profileId } = await seedUserProfile()
    const grantedAt = '2026-07-01T00:00:00.000Z'
    await grantItem({ userId, itemCode: 'priority_compute_coupon', quantity: 1, expiry: { mode: 'never' }, sourceType: 'test', sourceId: 'permanent', recipientRole: 'test', now: grantedAt })
    const expiringGrantId = await grantItem({ userId, itemCode: 'priority_compute_coupon', quantity: 1, expiry: { mode: 'relative_days', days: 5 }, sourceType: 'test', sourceId: 'expiring', recipientRole: 'test', now: grantedAt })

    await withTransaction((client) => reserveItemsInTransaction(client, userId, ['priority_compute_coupon'], 'optimization_job', 'job-fefo', profileId, '2026-07-02T00:00:00.000Z'))
    const consumption = await query<{ grant_id: string }>("select grant_id from reward_consumptions where reference_id = 'job-fefo'")
    expect(consumption.rows[0]?.grant_id).toBe(expiringGrantId)

    const refundedAt = '2026-07-03T00:00:00.000Z'
    await withTransaction((client) => refundReservedItemsInTransaction(client, 'optimization_job', 'job-fefo', refundedAt))
    await withTransaction((client) => refundReservedItemsInTransaction(client, 'optimization_job', 'job-fefo', refundedAt))

    expect(await getItemBalance(userId, 'priority_compute_coupon', new Date(refundedAt))).toBe(2)
    const refund = await query<{ expires_at: string; count: string }>(
      `select max(expires_at)::text as expires_at, count(*)::text as count
         from reward_grants where user_id = $1 and source_type = 'operation_refund'`,
      [userId],
    )
    expect(refund.rows[0]?.count).toBe('1')
    expect(new Date(refund.rows[0]!.expires_at).toISOString()).toBe('2026-07-08T00:00:00.000Z')
  })

  it('allows only one concurrent reservation to claim the final coupon', async () => {
    const { userId, profileId } = await seedUserProfile()
    await grantItem({ userId, itemCode: 'priority_compute_coupon', quantity: 1, expiry: { mode: 'never' }, sourceType: 'test', sourceId: 'last', recipientRole: 'test' })

    const attempts = await Promise.allSettled(['job-a', 'job-b'].map((jobId) => (
      withTransaction((client) => reserveItemsInTransaction(client, userId, ['priority_compute_coupon'], 'optimization_job', jobId, profileId))
    )))
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(await getItemBalance(userId, 'priority_compute_coupon')).toBe(0)
  })

  it('keeps issued gift packs pinned to their original immutable version', async () => {
    const { userId } = await seedUserProfile()
    const first = await createCustomGiftPack('root', {
      name: 'Versioned pack',
      description: 'Versioned pack test',
      contents: [{ item_code: 'priority_compute_coupon', quantity: 1, expiry: { mode: 'never' } }],
    }) as { item_code: string; version_id: string }
    await publishGiftPackVersion('root', first.version_id)
    await grantItem({
      userId,
      itemCode: first.item_code,
      quantity: 1,
      expiry: { mode: 'never' },
      sourceType: 'test',
      sourceId: 'old-pack',
      recipientRole: 'test',
      giftPackVersionId: first.version_id,
    })
    const second = await createGiftPackDraft('root', first.item_code, [
      { item_code: 'training_diagnosis_coupon', quantity: 2, expiry: { mode: 'never' } },
    ]) as { version_id: string }
    await publishGiftPackVersion('root', second.version_id)

    const opened = await useInventoryItem(userId, {
      item_code: first.item_code,
      quantity: 1,
      gift_pack_version_id: first.version_id,
      idempotency_key: randomUUID(),
    })
    expect(opened).toMatchObject({
      gift_pack_version_id: first.version_id,
      rewards: [{ item_code: 'priority_compute_coupon', quantity: 1 }],
    })
    expect(await getItemBalance(userId, 'training_diagnosis_coupon')).toBe(0)
  })

  it('does not consume a capacity certificate after the profile reaches its hard maximum', async () => {
    const { userId, profileId } = await seedUserProfile()
    await query(
      `insert into profile_entitlement_balances (profile_id, entitlement_type, units, updated_at)
       values ($1, 'plan_slots', 16, now())`,
      [profileId],
    )
    await grantItem({ userId, itemCode: 'plan_capacity_certificate', quantity: 2, expiry: { mode: 'never' }, sourceType: 'test', sourceId: 'capacity', recipientRole: 'test' })

    await useInventoryItem(userId, { item_code: 'plan_capacity_certificate', quantity: 1, profile_id: profileId, idempotency_key: randomUUID() })
    await expect(useInventoryItem(userId, { item_code: 'plan_capacity_certificate', quantity: 1, profile_id: profileId, idempotency_key: randomUUID() })).rejects.toMatchObject({ code: 'capacity_limit_reached' })
    expect(await getProfileCapacityLimits(profileId)).toMatchObject({ plan: 20 })
    expect(await getItemBalance(userId, 'plan_capacity_certificate')).toBe(1)
  })

  it('recovers only stale campaign claims after a worker interruption', async () => {
    const { userId } = await seedUserProfile()
    const campaignId = randomUUID()
    await query(
      `insert into inventory_distribution_campaigns
        (id, item_code, quantity, validity_days, target_mode, status, reason, created_by, created_at, updated_at)
       values ($1, 'priority_compute_coupon', 1, 0, 'user_ids', 'running', 'test', 'root', now(), now())`,
      [campaignId],
    )
    await query(
      `insert into inventory_distribution_recipients (campaign_id, user_id, status, processed_at)
       values ($1, $2, 'processing', '2026-07-01T00:00:00.000Z')`,
      [campaignId, userId],
    )

    expect(await recoverStaleInventoryCampaignRecipients(new Date('2026-07-01T00:11:00.000Z'))).toBe(1)
    const recipient = await query<{ status: string; processed_at: string | null }>(
      'select status, processed_at from inventory_distribution_recipients where campaign_id = $1 and user_id = $2',
      [campaignId, userId],
    )
    expect(recipient.rows[0]).toEqual({ status: 'pending', processed_at: null })
  })
})

async function seedUserProfile(): Promise<{ userId: string; profileId: string }> {
  const userId = randomUUID()
  const profileId = randomUUID()
  const now = new Date().toISOString()
  await query(
    `insert into user_accounts
      (id, email, password_hash, salt, iterations, permission, status, record_json, created_at, updated_at)
     values ($1, $2, 'hash', 'salt', 1, 'advanced', 'active', $3::jsonb, $4, $4)`,
    [userId, `${userId}@inventory.test`, JSON.stringify({ id: userId, email: `${userId}@inventory.test` }), now],
  )
  await query(
    `insert into user_game_accounts
      (id, user_id, permission, status, display_name, note, record_json, created_at, updated_at)
     values ($1, $2, 'advanced', 'active', 'Inventory test', '', $3::jsonb, $4, $4)`,
    [profileId, userId, JSON.stringify({ id: profileId, user_id: userId, kind: 'cdk', permission: 'advanced', status: 'active', display_name: 'Inventory test' }), now],
  )
  return { userId, profileId }
}
