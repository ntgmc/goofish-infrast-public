import { randomUUID } from 'node:crypto'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  adminGrantItem,
  configureOnboardingTask,
  createCustomGiftPack,
  createDistributionCampaign,
  createGiftPackDraft,
  processInventoryCampaignBatch,
  publishGiftPackVersion,
  recoverStaleInventoryCampaignRecipients,
  retryFailedCampaignRecipients,
  updateCampaignStatus,
} from './admin-inventory-store'
import {
  getItemBalance,
  grantFreePreviewLimitedVoucher,
  getProfileCapacityLimits,
  grantItem,
  grantItemInTransaction,
  listInventory,
  listOnboardingTasks,
  markOnboardingTaskComplete,
  refundReservedItemsInTransaction,
  reserveItemsInTransaction,
  useInventoryItem,
} from './inventory-store'
import { closePool, query, withTransaction } from './postgres'
import { ensureDatabaseSchema } from './schema'
import { buildAuthPayload } from '../handlers/user-auth'
import type { UserAccountRecord } from './user-store'

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

  it('consumes the earliest expiring batch and refunds once with the original absolute expiry', async () => {
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
    expect(new Date(refund.rows[0]!.expires_at).toISOString()).toBe('2026-07-06T00:00:00.000Z')
  })

  it('does not restore an already expired reservation as renewed inventory', async () => {
    const { userId, profileId } = await seedUserProfile()
    await grantItem({
      userId,
      itemCode: 'priority_compute_coupon',
      quantity: 1,
      expiry: { mode: 'relative_days', days: 2 },
      sourceType: 'test',
      sourceId: 'expires-during-reservation',
      recipientRole: 'test',
      now: '2026-07-01T00:00:00.000Z',
    })
    await withTransaction((client) => reserveItemsInTransaction(
      client,
      userId,
      ['priority_compute_coupon'],
      'optimization_job',
      'job-expired-refund',
      profileId,
      '2026-07-02T00:00:00.000Z',
    ))

    const refundedAt = '2026-07-04T00:00:00.000Z'
    await withTransaction((client) => refundReservedItemsInTransaction(client, 'optimization_job', 'job-expired-refund', refundedAt))

    expect(await getItemBalance(userId, 'priority_compute_coupon', new Date(refundedAt))).toBe(0)
    const consumption = await query<{ refunded_grant_id: string | null }>(
      "select refunded_grant_id from reward_consumptions where reference_id = 'job-expired-refund'",
    )
    expect(consumption.rows[0]?.refunded_grant_id).toBeNull()
    const ledger = await query<{ metadata_json: { restored: boolean; original_expires_at: string } }>(
      "select metadata_json from inventory_ledger where reference_id = 'job-expired-refund' and event_type = 'refund'",
    )
    expect(ledger.rows[0]?.metadata_json).toMatchObject({
      restored: false,
      original_expires_at: '2026-07-03T00:00:00.000Z',
    })
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

  it('serializes concurrent reservations so both can consume a multi-quantity grant', async () => {
    const { userId, profileId } = await seedUserProfile()
    await grantItem({ userId, itemCode: 'priority_compute_coupon', quantity: 2, expiry: { mode: 'never' }, sourceType: 'test', sourceId: 'multi', recipientRole: 'test' })

    const attempts = await Promise.allSettled(['job-multi-a', 'job-multi-b'].map((jobId) => (
      withTransaction((client) => reserveItemsInTransaction(client, userId, ['priority_compute_coupon'], 'optimization_job', jobId, profileId))
    )))

    expect(attempts.every((result) => result.status === 'fulfilled')).toBe(true)
    expect(await getItemBalance(userId, 'priority_compute_coupon')).toBe(0)
  })

  it('keeps onboarding list rewards and enabled state pinned to the completed version', async () => {
    const { userId } = await seedUserProfile()
    await configureOnboardingTask('root', 'welcome_inventory', true, [
      { item_code: 'priority_compute_coupon', quantity: 1, expiry: { mode: 'never' } },
    ])
    await markOnboardingTaskComplete(userId, 'welcome_inventory', '2026-07-01T00:00:00.000Z')
    await configureOnboardingTask('root', 'welcome_inventory', false, [
      { item_code: 'training_diagnosis_coupon', quantity: 2, expiry: { mode: 'never' } },
    ])

    const task = (await listOnboardingTasks(userId)).find((entry) => entry.code === 'welcome_inventory')

    expect(task).toMatchObject({
      enabled: true,
      status: 'claimable',
      rewards: [{ item_code: 'priority_compute_coupon', quantity: 1 }],
    })
    expect(task?.version).toBeGreaterThan(1)
    expect(task?.version_id).toBeTruthy()
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

  it('projects expanded history and archive capacities through an auth refresh without trimming stored results', async () => {
    const { userId, profileId } = await seedUserProfile()
    const history = Array.from({ length: 6 }, (_, index) => historyItem(`history-${index + 1}`))
    const archived = [historyItem('archive-1')]
    const workspace = {
      version: 1,
      profile_id: profileId,
      operators: null,
      config: null,
      elite_overrides: {},
      last_result: null,
      saved_configs: [],
      result_history: history,
      archived_results: archived,
      free_schedule_entitlement: null,
      updated_at: '2026-07-01T00:00:00.000Z',
    }
    await query(
      `insert into user_profile_workspaces
        (profile_id, operators_json, config_json, elite_overrides_json, last_result_json, record_json, updated_at)
       values ($1, null, null, '{}'::jsonb, null, $2::jsonb, $3)`,
      [profileId, JSON.stringify(workspace), workspace.updated_at],
    )
    const user = (await query<{ record_json: UserAccountRecord }>(
      'select record_json from user_accounts where id = $1',
      [userId],
    )).rows[0]!.record_json

    const before = await buildAuthPayload(user, profileId)
    expect(before.workspace?.result_history).toHaveLength(5)
    expect(before.workspace?.archived_results).toHaveLength(0)

    await grantItem({ userId, itemCode: 'history_capacity_certificate', quantity: 1, expiry: { mode: 'never' }, sourceType: 'test', sourceId: 'history-capacity-refresh', recipientRole: 'test' })
    await grantItem({ userId, itemCode: 'result_archive_folder', quantity: 1, expiry: { mode: 'never' }, sourceType: 'test', sourceId: 'archive-capacity-refresh', recipientRole: 'test' })
    await useInventoryItem(userId, { item_code: 'history_capacity_certificate', quantity: 1, profile_id: profileId, idempotency_key: randomUUID() })
    await useInventoryItem(userId, { item_code: 'result_archive_folder', quantity: 1, profile_id: profileId, idempotency_key: randomUUID() })

    const refreshed = await buildAuthPayload(user, profileId)
    expect(refreshed.workspace?.result_history.map((item) => item.id)).toEqual(history.map((item) => item.id))
    expect(refreshed.workspace?.archived_results.map((item) => item.id)).toEqual(['archive-1'])
    const stored = await query<{ history_count: number; archive_count: number }>(
      `select jsonb_array_length(record_json->'result_history') as history_count,
              jsonb_array_length(record_json->'archived_results') as archive_count
         from user_profile_workspaces where profile_id = $1`,
      [profileId],
    )
    expect(stored.rows[0]).toEqual({ history_count: 6, archive_count: 1 })
  })

  it('lists lifetime and limited vouchers with their dedicated actions and fixed expiry', async () => {
    const { userId } = await seedUserProfile()
    const now = new Date('2026-07-30T00:00:00.000Z')
    await grantItem({
      userId, itemCode: 'lifetime_profile_voucher', quantity: 1, expiry: { mode: 'never' },
      sourceType: 'test', sourceId: 'lifetime', recipientRole: 'test', now: now.toISOString(),
    })
    await grantItem({
      userId, itemCode: 'limited_profile_voucher', quantity: 1, expiry: { mode: 'never' },
      expiresAt: '2026-08-19T16:00:00.000Z', sourceType: 'test', sourceId: 'limited', recipientRole: 'test', now: now.toISOString(),
    })

    const inventory = await listInventory(userId, now)
    expect(inventory.stacks).toEqual(expect.arrayContaining([
      expect.objectContaining({ item: expect.objectContaining({ code: 'lifetime_profile_voucher' }), actions: ['bind'], permanent: 1 }),
      expect.objectContaining({ item: expect.objectContaining({ code: 'limited_profile_voucher' }), actions: ['use'], next_expiry_at: expect.anything() }),
    ]))
  })

  it('grants the activity voucher once and activates temporary advanced permission atomically', async () => {
    const { userId, profileId } = await seedFreePreviewProfile()
    const now = new Date('2026-07-30T00:00:00.000Z')

    expect(await grantFreePreviewLimitedVoucher(userId, now)).toBeTruthy()
    expect(await grantFreePreviewLimitedVoucher(userId, now)).toBeNull()
    expect(await getItemBalance(userId, 'limited_profile_voucher', now)).toBe(1)

    const operation = await useInventoryItem(userId, {
      item_code: 'limited_profile_voucher', quantity: 1, idempotency_key: randomUUID(),
    }, now)
    expect(operation).toMatchObject({
      item_code: 'limited_profile_voucher', profile_id: profileId, permission: 'advanced',
      ends_at: '2026-08-19T16:00:00.000Z',
    })
    expect(await getItemBalance(userId, 'limited_profile_voucher', now)).toBe(0)
    const profile = await query<{ record_json: { permission: string; temporary_permission: { permission: string; ends_at: string } } }>(
      'select record_json from user_game_accounts where id = $1', [profileId],
    )
    expect(profile.rows[0]?.record_json).toMatchObject({
      permission: 'growth',
      temporary_permission: { permission: 'advanced', ends_at: '2026-08-19T16:00:00.000Z' },
    })
  })

  it('creates, aggregates, reopens, and deduplicates item grant notifications', async () => {
    const { userId } = await seedUserProfile()
    const sourceId = randomUUID()
    const firstGrant = {
      userId, itemCode: 'priority_compute_coupon', quantity: 1, expiry: { mode: 'never' as const },
      sourceType: 'notification_test', sourceId, recipientRole: 'first', now: '2026-07-30T00:00:00.000Z',
    }
    await grantItem(firstGrant)
    await grantItem({
      userId, itemCode: 'plan_capacity_certificate', quantity: 2, expiry: { mode: 'relative_days', days: 30 },
      sourceType: 'notification_test', sourceId, recipientRole: 'second', now: '2026-07-30T00:00:01.000Z',
    })

    const grouped = await query<{ id: string; payload_json: { items: Array<{ item_code: string; quantity: number; grant_ids: string[] }> } }>(
      `select id, payload_json from user_notifications
        where user_id = $1 and source_type = 'notification_test' and source_id = $2`,
      [userId, sourceId],
    )
    expect(grouped.rows).toHaveLength(1)
    expect(grouped.rows[0]?.payload_json.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ item_code: 'priority_compute_coupon', quantity: 1 }),
      expect.objectContaining({ item_code: 'plan_capacity_certificate', quantity: 2 }),
    ]))

    await query('update user_notifications set read_at = now() where id = $1', [grouped.rows[0]!.id])
    await grantItem({ ...firstGrant, quantity: 3, recipientRole: 'third', now: '2026-07-30T00:00:02.000Z' })
    expect(await grantItem({ ...firstGrant, quantity: 3, recipientRole: 'third', now: '2026-07-30T00:00:02.000Z' })).toBeNull()

    const reopened = await query<{ read_at: string | null; payload_json: { items: Array<{ item_code: string; quantity: number; grant_ids: string[] }> } }>(
      'select read_at, payload_json from user_notifications where id = $1', [grouped.rows[0]!.id],
    )
    expect(reopened.rows[0]?.read_at).toBeNull()
    expect(reopened.rows[0]?.payload_json.items.find((item) => item.item_code === 'priority_compute_coupon')).toMatchObject({
      quantity: 4,
      grant_ids: expect.arrayContaining([expect.any(String), expect.any(String)]),
    })
  })

  it('rolls back the grant, ledger, and notification together', async () => {
    const { userId } = await seedUserProfile()
    const sourceId = randomUUID()

    await expect(withTransaction(async (client) => {
      await grantItemInTransaction(client, {
        userId, itemCode: 'priority_compute_coupon', quantity: 1, expiry: { mode: 'never' },
        sourceType: 'notification_rollback', sourceId, recipientRole: 'test',
      })
      throw new Error('force rollback')
    })).rejects.toThrow('force rollback')

    const counts = await query<{ grants: string; ledger: string; notifications: string }>(
      `select
        (select count(*) from reward_grants where user_id = $1 and source_id = $2)::text as grants,
        (select count(*) from inventory_ledger where user_id = $1 and reference_id = $2)::text as ledger,
        (select count(*) from user_notifications where user_id = $1 and source_id = $2)::text as notifications`,
      [userId, sourceId],
    )
    expect(counts.rows[0]).toEqual({ grants: '0', ledger: '0', notifications: '0' })
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
    await updateCampaignStatus('root', campaignId, 'cancel', 'test cleanup')
  })

  it('replays administrator grants and campaigns without duplicating assets or snapshots', async () => {
    const { userId } = await seedUserProfile()
    const grantInput = {
      userId,
      itemCode: 'priority_compute_coupon',
      quantity: 2,
      validityDays: 0,
      reason: 'idempotency regression',
      idempotencyKey: randomUUID(),
    }
    const firstGrantId = await adminGrantItem('root', grantInput)
    const replayedGrantId = await adminGrantItem('root', grantInput)
    expect(replayedGrantId).toBe(firstGrantId)
    expect(await getItemBalance(userId, 'priority_compute_coupon')).toBe(2)

    const campaignInput = {
      itemCode: 'training_diagnosis_coupon',
      quantity: 1,
      validityDays: 0,
      targetMode: 'user_ids' as const,
      userIds: [userId],
      reason: 'campaign idempotency regression',
      idempotencyKey: randomUUID(),
    }
    const firstCampaign = await createDistributionCampaign('root', campaignInput)
    const replayedCampaign = await createDistributionCampaign('root', campaignInput)
    expect(replayedCampaign).toEqual(firstCampaign)
    const campaigns = await query<{ count: string }>(
      'select count(*)::text as count from inventory_distribution_campaigns where reason = $1',
      [campaignInput.reason],
    )
    expect(campaigns.rows[0]?.count).toBe('1')
    await updateCampaignStatus('root', String(firstCampaign.campaign_id), 'cancel', 'test cleanup')
  })

  it('replays custom gift pack creation with the original response', async () => {
    const idempotencyKey = randomUUID()
    const input = {
      name: 'Idempotent pack',
      description: 'Created once across response retries',
      contents: [{ item_code: 'priority_compute_coupon', quantity: 1, expiry: { mode: 'never' as const } }],
      idempotencyKey,
    }

    const first = await createCustomGiftPack('root', input)
    const replayed = await createCustomGiftPack('root', input)

    expect(replayed).toEqual(first)
    const definitions = await query<{ count: string }>(
      "select count(*)::text as count from item_definitions where name = 'Idempotent pack'",
    )
    expect(definitions.rows[0]?.count).toBe('1')
  })

  it('returns claimed recipients to a safe state when a campaign is paused or cancelled', async () => {
    const { userId } = await seedUserProfile()
    const campaignId = randomUUID()
    await query(
      `insert into inventory_distribution_campaigns
        (id, item_code, quantity, validity_days, target_mode, status, reason, created_by, created_at, updated_at)
       values ($1, 'priority_compute_coupon', 1, 0, 'user_ids', 'running', 'pause test', 'root', now(), now())`,
      [campaignId],
    )
    await query(
      `insert into inventory_distribution_recipients (campaign_id, user_id, status, processed_at)
       values ($1, $2, 'processing', now())`,
      [campaignId, userId],
    )

    await updateCampaignStatus('root', campaignId, 'pause', 'pause delivery')
    expect((await query<{ status: string }>(
      'select status from inventory_distribution_recipients where campaign_id = $1 and user_id = $2',
      [campaignId, userId],
    )).rows[0]?.status).toBe('pending')

    await updateCampaignStatus('root', campaignId, 'resume', 'resume delivery')
    await query(
      "update inventory_distribution_recipients set status = 'processing', processed_at = now() where campaign_id = $1 and user_id = $2",
      [campaignId, userId],
    )
    await updateCampaignStatus('root', campaignId, 'cancel', 'cancel delivery')
    expect((await query<{ status: string }>(
      'select status from inventory_distribution_recipients where campaign_id = $1 and user_id = $2',
      [campaignId, userId],
    )).rows[0]?.status).toBe('skipped')
  })

  it('retries campaign failures before exposing a partial completion and supports a controlled retry', async () => {
    const { userId } = await seedUserProfile()
    const campaign = await createDistributionCampaign('root', {
      itemCode: 'priority_compute_coupon',
      quantity: 1,
      validityDays: 0,
      targetMode: 'user_ids',
      userIds: [userId],
      reason: 'retry regression',
      idempotencyKey: randomUUID(),
    }) as { campaign_id: string }
    await query("update item_definitions set issuance_enabled = false where code = 'priority_compute_coupon'")

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await query(
        'update inventory_distribution_recipients set next_attempt_at = now() - interval \'1 second\' where campaign_id = $1',
        [campaign.campaign_id],
      )
      await processInventoryCampaignBatch(1)
    }

    const failed = await query<{ campaign_status: string; recipient_status: string; attempt_count: number }>(
      `select campaign.status as campaign_status, recipient.status as recipient_status, recipient.attempt_count
         from inventory_distribution_campaigns campaign
         join inventory_distribution_recipients recipient on recipient.campaign_id = campaign.id
        where campaign.id = $1`,
      [campaign.campaign_id],
    )
    expect(failed.rows[0]).toEqual({
      campaign_status: 'completed_with_failures',
      recipient_status: 'failed',
      attempt_count: 3,
    })

    await query("update item_definitions set issuance_enabled = true where code = 'priority_compute_coupon'")
    expect(await retryFailedCampaignRecipients('root', campaign.campaign_id, 'retry repaired delivery')).toBe(1)
    await processInventoryCampaignBatch(1)
    expect((await query<{ status: string }>(
      'select status from inventory_distribution_campaigns where id = $1',
      [campaign.campaign_id],
    )).rows[0]?.status).toBe('completed')
    expect(await getItemBalance(userId, 'priority_compute_coupon')).toBe(1)
  })
})

async function seedUserProfile(): Promise<{ userId: string; profileId: string }> {
  const userId = randomUUID()
  const profileId = randomUUID()
  const now = new Date().toISOString()
  const email = `${userId}@inventory.test`
  const userRecord: UserAccountRecord = {
    version: 1,
    id: userId,
    email,
    password_hash: 'hash',
    salt: 'salt',
    iterations: 1,
    password_algorithm: 'pbkdf2-sha256',
    permission: 'advanced',
    status: 'active',
    cdk_key: null,
    cdk_code_hash: null,
    cdk_order_hash: null,
    email_verified_at: now,
    created_at: now,
    updated_at: now,
  }
  await query(
    `insert into user_accounts
      (id, email, password_hash, salt, iterations, permission, status, record_json, created_at, updated_at)
     values ($1, $2, 'hash', 'salt', 1, 'advanced', 'active', $3::jsonb, $4, $4)`,
    [userId, email, JSON.stringify(userRecord), now],
  )
  const profileRecord = {
    version: 1,
    id: profileId,
    user_id: userId,
    kind: 'cdk',
    cdk_key: null,
    cdk_code_hash: null,
    cdk_order_hash: null,
    permission: 'advanced',
    status: 'active',
    display_name: 'Inventory test',
    note: '',
    created_at: now,
    updated_at: now,
  }
  await query(
    `insert into user_game_accounts
      (id, user_id, permission, status, display_name, note, kind, record_json, created_at, updated_at)
     values ($1, $2, 'advanced', 'active', 'Inventory test', '', 'cdk', $3::jsonb, $4, $4)`,
    [profileId, userId, JSON.stringify(profileRecord), now],
  )
  return { userId, profileId }
}

function historyItem(id: string) {
  return {
    id,
    name: id,
    created_at: '2026-07-01T00:00:00.000Z',
    config: null,
    result: {},
    operator_count: 0,
    source: 'generated',
  }
}

async function seedFreePreviewProfile(): Promise<{ userId: string; profileId: string }> {
  const seeded = await seedUserProfile()
  const now = '2026-07-30T00:00:00.000Z'
  const record = {
    version: 1,
    id: seeded.profileId,
    user_id: seeded.userId,
    kind: 'free_preview',
    permission: 'growth',
    status: 'active',
    display_name: '免费预览',
    skland_binding: {
      uid: `uid-${seeded.profileId}`,
      nickname: 'Test',
      channel_name: 'Official',
      bound_at: now,
      last_imported_at: now,
      encrypted_cred: 'encrypted',
    },
  }
  await query(
    `update user_game_accounts set permission = 'growth', record_json = $2::jsonb, updated_at = $3 where id = $1`,
    [seeded.profileId, JSON.stringify(record), now],
  )
  return seeded
}
