import { createHash, randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import {
  ITEM_ICON_PATHS,
  normalizeExpiryPolicy,
  type GiftPackContentInput,
  type GiftPackVersion,
  type ItemDefinition,
  type OnboardingTaskCode,
} from '../../src/lib/inventory-contracts'
import { ensureDatabaseSchema } from './schema'
import { query, withTransaction } from './postgres'
import { grantItemInTransaction, InventoryError } from './inventory-store'
import {
  assertInvitationGiftVersionCanBeRetired,
  assertInvitationItemCanBeDisabled,
} from './invitation-store'

type CampaignStatus = 'draft' | 'queued' | 'running' | 'paused' | 'completed' | 'completed_with_failures' | 'cancelled' | 'reversing' | 'reversed'

const CAMPAIGN_MAX_ATTEMPTS = 3

export async function getAdminInventoryOverview(): Promise<Record<string, unknown>> {
  await ensureDatabaseSchema()
  const [definitions, versions, tasks, campaigns, audits, users] = await Promise.all([
    query<ItemDefinition>('select * from item_definitions order by system_owned desc, created_at asc, code asc'),
    query<{ id: string; item_code: string; version: number; status: GiftPackVersion['status']; created_at: string; published_at: string | null; contents: GiftPackContentInput[] }>(
      `select version.id, version.item_code, version.version, version.status, version.created_at, version.published_at,
              coalesce(jsonb_agg(jsonb_build_object(
                'item_code', content.item_code,
                'quantity', content.quantity,
                'expiry', case when content.validity_days = 0
                  then jsonb_build_object('mode', 'never')
                  else jsonb_build_object('mode', 'relative_days', 'days', content.validity_days) end
              ) order by content.item_code) filter (where content.item_code is not null), '[]'::jsonb) as contents
         from gift_pack_versions version
         left join gift_pack_version_contents content on content.gift_pack_version_id = version.id
        group by version.id order by version.item_code, version.version desc`,
    ),
    query<{ task_code: OnboardingTaskCode; version: number; enabled: boolean; rewards_json: GiftPackContentInput[]; created_at: string }>(
      `select current.task_code, version.version, version.enabled, version.rewards_json, version.created_at
         from onboarding_task_current current join onboarding_task_versions version on version.id = current.version_id
        order by case current.task_code when 'welcome_inventory' then 1 when 'bind_skland' then 2 else 3 end`,
    ),
    query(
      `select campaign.*,
              count(recipient.user_id)::integer as recipient_count,
              count(*) filter (where recipient.status = 'granted')::integer as granted_count,
              count(*) filter (where recipient.status = 'failed')::integer as failed_count,
              count(*) filter (where recipient.status = 'pending')::integer as pending_count,
              count(*) filter (where recipient.status = 'processing')::integer as processing_count,
              count(*) filter (where recipient.status = 'skipped')::integer as skipped_count,
              count(*) filter (where recipient.status = 'revoked')::integer as revoked_count,
              coalesce((
                select jsonb_agg(to_jsonb(failure) order by failure.processed_at desc, failure.user_id)
                  from (
                    select failed.user_id, failed.error_message, failed.attempt_count, failed.processed_at
                      from inventory_distribution_recipients failed
                     where failed.campaign_id = campaign.id and failed.status = 'failed'
                     order by failed.processed_at desc, failed.user_id
                     limit 50
                  ) failure
              ), '[]'::jsonb) as failed_recipients
         from inventory_distribution_campaigns campaign
         left join inventory_distribution_recipients recipient on recipient.campaign_id = campaign.id
        group by campaign.id order by campaign.created_at desc limit 100`,
    ),
    query('select * from inventory_admin_audit order by created_at desc limit 100'),
    query<{ count: string }>('select count(*)::text as count from user_accounts'),
  ])
  return {
    definitions: definitions.rows,
    gift_pack_versions: versions.rows,
    tasks: tasks.rows,
    campaigns: campaigns.rows,
    audits: audits.rows,
    user_count: Number(users.rows[0]?.count ?? 0),
  }
}

export async function createCustomGiftPack(
  adminUsername: string,
  input: { name: unknown; description: unknown; icon_key?: unknown; contents: unknown; idempotencyKey?: string },
): Promise<Record<string, unknown>> {
  const name = requireString(input.name, 1, 80, '礼包名称')
  const description = requireString(input.description, 1, 500, '礼包描述')
  const iconKey = typeof input.icon_key === 'string' && input.icon_key.trim() ? input.icon_key.trim() : 'generic_gift_pack'
  if (!ITEM_ICON_PATHS[iconKey]) throw new InventoryError('icon_key_invalid', '只能选择受控的本地图标。', 400)
  const contents = normalizeContents(input.contents)
  return withTransaction(async (client) => {
    const operation = await beginAdminOperation(client, adminUsername, input.idempotencyKey ?? randomUUID(), 'create_gift_pack', {
      name, description, icon_key: iconKey, contents,
    })
    if (operation.replayedResponse) return operation.replayedResponse
    await assertGiftContents(client, contents)
    const itemCode = `gift_pack_${randomUUID().replaceAll('-', '')}`
    const versionId = randomUUID()
    const now = new Date().toISOString()
    await client.query(
      `insert into item_definitions
        (code, kind, effect_code, name, description, icon_key, system_owned, issuance_enabled, created_at, updated_at)
       values ($1, 'gift_pack', 'open_gift_pack', $2, $3, $4, false, false, $5, $5)`,
      [itemCode, name, description, iconKey, now],
    )
    await client.query(
      `insert into gift_pack_versions (id, item_code, version, status, created_at)
       values ($1, $2, 1, 'draft', $3)`,
      [versionId, itemCode, now],
    )
    await replaceGiftContents(client, versionId, contents)
    await audit(client, adminUsername, 'create_gift_pack', 'item', itemCode, '创建自定义礼包草稿。', null, { name, description, version_id: versionId }, now)
    const response = { item_code: itemCode, version_id: versionId, version: 1, status: 'draft' }
    await completeAdminOperation(client, operation.id, response, now)
    return response
  })
}

export async function createGiftPackDraft(
  adminUsername: string,
  itemCode: string,
  contentsValue: unknown,
  idempotencyKey = randomUUID(),
): Promise<Record<string, unknown>> {
  const contents = normalizeContents(contentsValue)
  return withTransaction(async (client) => {
    const operation = await beginAdminOperation(client, adminUsername, idempotencyKey, 'create_gift_pack_version', {
      item_code: itemCode, contents,
    })
    if (operation.replayedResponse) return operation.replayedResponse
    const item = await client.query<{ kind: string }>('select kind from item_definitions where code = $1 for update', [itemCode])
    if (item.rows[0]?.kind !== 'gift_pack') throw new InventoryError('gift_pack_missing', '礼包不存在。', 404)
    await assertGiftContents(client, contents)
    const version = await client.query<{ next_version: number }>(
      'select coalesce(max(version), 0)::integer + 1 as next_version from gift_pack_versions where item_code = $1',
      [itemCode],
    )
    const nextVersion = Number(version.rows[0]?.next_version ?? 1)
    const versionId = randomUUID()
    const now = new Date().toISOString()
    await client.query(
      `insert into gift_pack_versions (id, item_code, version, status, created_at)
       values ($1, $2, $3, 'draft', $4)`,
      [versionId, itemCode, nextVersion, now],
    )
    await replaceGiftContents(client, versionId, contents)
    await audit(client, adminUsername, 'create_gift_pack_version', 'gift_pack_version', versionId, '创建礼包新版本草稿。', null, { item_code: itemCode, version: nextVersion }, now)
    const response = { item_code: itemCode, version_id: versionId, version: nextVersion, status: 'draft' }
    await completeAdminOperation(client, operation.id, response, now)
    return response
  })
}

export async function publishGiftPackVersion(adminUsername: string, versionId: string): Promise<void> {
  await withTransaction(async (client) => {
    const version = await client.query<{ item_code: string; status: string }>(
      'select item_code, status from gift_pack_versions where id = $1 for update', [versionId],
    )
    const row = version.rows[0]
    if (!row) throw new InventoryError('gift_pack_version_missing', '礼包版本不存在。', 404)
    if (row.status !== 'draft') throw new InventoryError('gift_pack_version_immutable', '只有草稿版本可以发布。', 409)
    const count = await client.query<{ count: string }>('select count(*)::text as count from gift_pack_version_contents where gift_pack_version_id = $1', [versionId])
    if (Number(count.rows[0]?.count ?? 0) === 0) throw new InventoryError('gift_pack_empty', '空礼包不能发布。', 409)
    const now = new Date().toISOString()
    await client.query("update gift_pack_versions set status = 'published', published_at = $2 where id = $1", [versionId, now])
    await client.query('update item_definitions set issuance_enabled = true, updated_at = $2 where code = $1', [row.item_code, now])
    await audit(client, adminUsername, 'publish_gift_pack_version', 'gift_pack_version', versionId, '发布礼包版本。', { status: 'draft' }, { status: 'published' }, now)
  })
}

export async function retireGiftPackVersion(adminUsername: string, versionId: string): Promise<void> {
  await withTransaction(async (client) => {
    await assertInvitationGiftVersionCanBeRetired(client, versionId)
    const version = await client.query<{ status: string }>('select status from gift_pack_versions where id = $1 for update', [versionId])
    if (!version.rows[0]) throw new InventoryError('gift_pack_version_missing', '礼包版本不存在。', 404)
    if (version.rows[0].status !== 'published') throw new InventoryError('gift_pack_version_not_published', '只有已发布版本可以退役。', 409)
    const now = new Date().toISOString()
    await client.query("update gift_pack_versions set status = 'retired' where id = $1", [versionId])
    await audit(client, adminUsername, 'retire_gift_pack_version', 'gift_pack_version', versionId, '退役礼包版本。', { status: 'published' }, { status: 'retired' }, now)
  })
}

export async function updateItemPresentation(
  adminUsername: string,
  itemCode: string,
  patch: { name?: unknown; description?: unknown; icon_key?: unknown; issuance_enabled?: unknown },
): Promise<void> {
  await withTransaction(async (client) => {
    if (patch.issuance_enabled === false) await assertInvitationItemCanBeDisabled(client, itemCode)
    const current = await client.query<ItemDefinition>('select * from item_definitions where code = $1 for update', [itemCode])
    if (!current.rows[0]) throw new InventoryError('item_unknown', '道具不存在。', 404)
    const next = {
      name: patch.name === undefined ? current.rows[0].name : requireString(patch.name, 1, 80, '道具名称'),
      description: patch.description === undefined ? current.rows[0].description : requireString(patch.description, 1, 500, '道具描述'),
      icon_key: patch.icon_key === undefined ? current.rows[0].icon_key : requireString(patch.icon_key, 1, 128, '图标键'),
      issuance_enabled: patch.issuance_enabled === undefined ? current.rows[0].issuance_enabled : patch.issuance_enabled === true,
    }
    if (!ITEM_ICON_PATHS[next.icon_key]) throw new InventoryError('icon_key_invalid', '只能选择受控的本地图标。', 400)
    const now = new Date().toISOString()
    await client.query(
      `update item_definitions set name = $2, description = $3, icon_key = $4, issuance_enabled = $5, updated_at = $6 where code = $1`,
      [itemCode, next.name, next.description, next.icon_key, next.issuance_enabled, now],
    )
    await audit(client, adminUsername, 'update_item', 'item', itemCode, '更新道具展示与发放状态。', current.rows[0], next, now)
  })
}

export async function configureOnboardingTask(
  adminUsername: string,
  taskCode: OnboardingTaskCode,
  enabled: boolean,
  rewardsValue: unknown,
): Promise<void> {
  const rewards = normalizeContents(rewardsValue)
  if (enabled && rewards.length === 0) throw new InventoryError('task_rewards_missing', '启用任务前必须配置奖励。', 400)
  await withTransaction(async (client) => {
    const snapshottedRewards = await snapshotRewardContents(client, rewards)
    const current = await client.query<{ version: number }>(
      `select version.version from onboarding_task_current current
       join onboarding_task_versions version on version.id = current.version_id
       where current.task_code = $1 for update`, [taskCode],
    )
    const nextVersion = Number(current.rows[0]?.version ?? 0) + 1
    const versionId = randomUUID()
    const now = new Date().toISOString()
    await client.query(
      `insert into onboarding_task_versions (id, task_code, version, enabled, rewards_json, created_at)
       values ($1, $2, $3, $4, $5::jsonb, $6)`,
      [versionId, taskCode, nextVersion, enabled, JSON.stringify(snapshottedRewards), now],
    )
    await client.query(
      `insert into onboarding_task_current (task_code, version_id, updated_at) values ($1, $2, $3)
       on conflict (task_code) do update set version_id = excluded.version_id, updated_at = excluded.updated_at`,
      [taskCode, versionId, now],
    )
    await audit(client, adminUsername, 'configure_onboarding_task', 'onboarding_task', taskCode, '发布新人任务配置。', current.rows[0] ?? null, { version: nextVersion, enabled, rewards: snapshottedRewards }, now)
  })
}

export async function adminGrantItem(
  adminUsername: string,
  input: {
    userId: string; itemCode: string; quantity: number; validityDays: number
    giftPackVersionId?: string | null; reason: string; idempotencyKey?: string
  },
): Promise<string | null> {
  return withTransaction(async (client) => {
    const now = new Date().toISOString()
    const operation = await beginAdminOperation(client, adminUsername, input.idempotencyKey ?? randomUUID(), 'grant_item', input)
    if (operation.replayedResponse) return typeof operation.replayedResponse.grant_id === 'string' ? operation.replayedResponse.grant_id : null
    const user = await client.query('select 1 from user_accounts where id = $1', [input.userId])
    if (!user.rowCount) throw new InventoryError('user_missing', '目标用户不存在。', 404)
    const grantId = await grantItemInTransaction(client, {
      userId: input.userId,
      itemCode: input.itemCode,
      quantity: input.quantity,
      expiry: input.validityDays > 0 ? { mode: 'relative_days', days: input.validityDays } : { mode: 'never' },
      sourceType: 'admin_grant',
      sourceId: operation.id,
      recipientRole: 'user',
      giftPackVersionId: input.giftPackVersionId,
      metadata: { reason: input.reason, admin_username: adminUsername },
      now,
    })
    await audit(client, adminUsername, 'grant_item', 'user', input.userId, input.reason, null, { grant_id: grantId, ...input }, now)
    await completeAdminOperation(client, operation.id, { grant_id: grantId }, now)
    return grantId
  })
}

export async function revokeGrant(adminUsername: string, grantId: string, reason: string): Promise<Record<string, unknown>> {
  return withTransaction(async (client) => {
    const grant = await client.query<{ user_id: string; reward_type: string; remaining_quantity: number; revoked_quantity: number }>(
      'select user_id, reward_type, remaining_quantity, revoked_quantity from reward_grants where id = $1 for update', [grantId],
    )
    const row = grant.rows[0]
    if (!row) throw new InventoryError('grant_missing', '发放批次不存在。', 404)
    const revoked = Number(row.remaining_quantity)
    if (revoked <= 0) throw new InventoryError('grant_consumed', '该批次没有可撤回的未消费数量。', 409)
    const now = new Date().toISOString()
    await client.query(
      'update reward_grants set remaining_quantity = 0, revoked_quantity = revoked_quantity + $2 where id = $1',
      [grantId, revoked],
    )
    await client.query(
      `insert into inventory_ledger
        (id, user_id, item_code, event_type, quantity, grant_id, reference_type, reference_id, metadata_json, created_at)
       values ($1, $2, $3, 'revoke', $4, $5, 'admin_revoke', $5, $6::jsonb, $7)
       on conflict do nothing`,
      [randomUUID(), row.user_id, row.reward_type, revoked, grantId, JSON.stringify({ reason, admin_username: adminUsername }), now],
    )
    await audit(client, adminUsername, 'revoke_grant', 'grant', grantId, reason, row, { remaining_quantity: 0, revoked }, now)
    return { grant_id: grantId, revoked_quantity: revoked }
  })
}

export async function createDistributionCampaign(adminUsername: string, input: {
  itemCode: string
  giftPackVersionId?: string | null
  quantity: number
  validityDays: number
  targetMode: 'user_ids' | 'all_users'
  userIds?: string[]
  reason: string
  idempotencyKey?: string
}): Promise<Record<string, unknown>> {
  return withTransaction(async (client) => {
    const now = new Date().toISOString()
    const normalizedUserIds = input.targetMode === 'user_ids' ? [...new Set(input.userIds ?? [])].sort() : []
    const operation = await beginAdminOperation(client, adminUsername, input.idempotencyKey ?? randomUUID(), 'create_campaign', {
      ...input, userIds: normalizedUserIds,
    })
    if (operation.replayedResponse) return operation.replayedResponse
    if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 10000) {
      throw new InventoryError('quantity_invalid', '发放数量必须是 1 到 10000 之间的整数。', 400)
    }
    if (!Number.isInteger(input.validityDays) || input.validityDays < 0 || input.validityDays > 3650) {
      throw new InventoryError('expiry_invalid', '有效天数必须是 0 到 3650 之间的整数。', 400)
    }
    const item = await client.query<{ kind: string; issuance_enabled: boolean }>(
      'select kind, issuance_enabled from item_definitions where code = $1', [input.itemCode],
    )
    if (!item.rows[0]) throw new InventoryError('item_unknown', '道具不存在。', 404)
    if (!item.rows[0].issuance_enabled) throw new InventoryError('item_issuance_disabled', '该道具当前不可发放。', 409)
    if (item.rows[0].kind === 'cosmetic' || item.rows[0].kind === 'badge') {
      throw new InventoryError('item_kind_not_implemented', '主题装扮和成就勋章尚未开放。', 409)
    }
    if (item.rows[0].kind === 'gift_pack') {
      const version = await client.query<{ status: string; item_code: string }>(
        'select status, item_code from gift_pack_versions where id = $1', [input.giftPackVersionId ?? null],
      )
      if (version.rows[0]?.status !== 'published' || version.rows[0]?.item_code !== input.itemCode) {
        throw new InventoryError('gift_pack_version_unavailable', '礼包活动必须绑定对应的已发布版本。', 409)
      }
    } else if (input.giftPackVersionId) {
      throw new InventoryError('gift_pack_version_not_applicable', '非礼包道具不能绑定礼包版本。', 400)
    }
    const campaignId = randomUUID()
    await client.query(
      `insert into inventory_distribution_campaigns
        (id, item_code, gift_pack_version_id, quantity, validity_days, target_mode, status, reason, created_by, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, 'queued', $7, $8, $9, $9)`,
      [campaignId, input.itemCode, input.giftPackVersionId ?? null, input.quantity, input.validityDays, input.targetMode, input.reason, adminUsername, now],
    )
    if (input.targetMode === 'all_users') {
      await client.query(
        `insert into inventory_distribution_recipients (campaign_id, user_id, status)
         select $1, id, 'pending' from user_accounts on conflict do nothing`,
        [campaignId],
      )
    } else {
      const userIds = normalizedUserIds
      if (userIds.length === 0) throw new InventoryError('campaign_targets_missing', '批量发放必须提供用户 ID。', 400)
      await client.query(
        `insert into inventory_distribution_recipients (campaign_id, user_id, status)
         select $1, id, 'pending' from user_accounts where id = any($2::text[]) on conflict do nothing`,
        [campaignId, userIds],
      )
      const targetCount = await client.query<{ count: string }>(
        'select count(*)::text as count from inventory_distribution_recipients where campaign_id = $1', [campaignId],
      )
      if (Number(targetCount.rows[0]?.count ?? 0) !== userIds.length) {
        throw new InventoryError('campaign_target_unknown', '批量发放目标中包含不存在的用户。', 400)
      }
    }
    const count = await client.query<{ count: string }>('select count(*)::text as count from inventory_distribution_recipients where campaign_id = $1', [campaignId])
    await audit(client, adminUsername, 'create_distribution_campaign', 'campaign', campaignId, input.reason, null, { ...input, recipient_count: count.rows[0]?.count }, now)
    const response = { campaign_id: campaignId, status: 'queued', recipient_count: Number(count.rows[0]?.count ?? 0) }
    await completeAdminOperation(client, operation.id, response, now)
    return response
  })
}

export async function updateCampaignStatus(adminUsername: string, campaignId: string, action: 'pause' | 'resume' | 'cancel' | 'reverse', reason: string): Promise<void> {
  await withTransaction(async (client) => {
    const campaign = await client.query<{ status: CampaignStatus }>('select status from inventory_distribution_campaigns where id = $1 for update', [campaignId])
    if (!campaign.rows[0]) throw new InventoryError('campaign_missing', '发放活动不存在。', 404)
    const currentStatus = campaign.rows[0].status
    const nextStatus: CampaignStatus = action === 'pause' ? 'paused' : action === 'resume' ? 'queued' : action === 'cancel' ? 'cancelled' : 'reversing'
    if (currentStatus === nextStatus || (action === 'reverse' && currentStatus === 'reversed')) return
    const allowed = action === 'pause'
      ? currentStatus === 'queued' || currentStatus === 'running'
      : action === 'resume'
        ? currentStatus === 'paused'
        : action === 'cancel'
          ? currentStatus === 'queued' || currentStatus === 'running' || currentStatus === 'paused'
          : currentStatus === 'completed' || currentStatus === 'completed_with_failures'
    if (!allowed) throw new InventoryError('campaign_transition_invalid', `发放活动不能从 ${currentStatus} 执行 ${action}。`, 409)
    const now = new Date().toISOString()
    await client.query('update inventory_distribution_campaigns set status = $2, updated_at = $3 where id = $1', [campaignId, nextStatus, now])
    if (action === 'pause') {
      await client.query(
        "update inventory_distribution_recipients set status = 'pending', processed_at = null, next_attempt_at = $2 where campaign_id = $1 and status = 'processing'",
        [campaignId, now],
      )
    }
    if (action === 'cancel') {
      await client.query(
        "update inventory_distribution_recipients set status = 'skipped', processed_at = $2 where campaign_id = $1 and status in ('pending', 'processing')",
        [campaignId, now],
      )
    }
    await audit(client, adminUsername, `campaign_${action}`, 'campaign', campaignId, reason, campaign.rows[0], { status: nextStatus }, now)
  })
}

export async function retryFailedCampaignRecipients(adminUsername: string, campaignId: string, reason: string): Promise<number> {
  return withTransaction(async (client) => {
    const campaign = await client.query<{ status: CampaignStatus }>(
      'select status from inventory_distribution_campaigns where id = $1 for update',
      [campaignId],
    )
    if (!campaign.rows[0]) throw new InventoryError('campaign_missing', '发放活动不存在。', 404)
    if (campaign.rows[0].status !== 'completed_with_failures') {
      throw new InventoryError('campaign_retry_invalid', '只有部分失败的已结束活动可以重试。', 409)
    }
    const now = new Date().toISOString()
    const retried = await client.query(
      `update inventory_distribution_recipients
          set status = 'pending', attempt_count = 0, next_attempt_at = $2, processed_at = null, error_message = null
        where campaign_id = $1 and status = 'failed'
        returning user_id`,
      [campaignId, now],
    )
    await client.query("update inventory_distribution_campaigns set status = 'queued', updated_at = $2 where id = $1", [campaignId, now])
    await audit(client, adminUsername, 'campaign_retry_failures', 'campaign', campaignId, reason, campaign.rows[0], { status: 'queued', retried: retried.rowCount ?? 0 }, now)
    return retried.rowCount ?? 0
  })
}

export async function isAllUsersDistributionCampaign(campaignId: string): Promise<boolean> {
  await ensureDatabaseSchema()
  const campaign = await query<{ target_mode: 'user_ids' | 'all_users' }>(
    'select target_mode from inventory_distribution_campaigns where id = $1',
    [campaignId],
  )
  if (!campaign.rows[0]) throw new InventoryError('campaign_missing', '发放活动不存在。', 404)
  return campaign.rows[0].target_mode === 'all_users'
}

export async function processInventoryCampaignBatch(limit = 100): Promise<number> {
  await ensureDatabaseSchema()
  await recoverStaleInventoryCampaignRecipients()
  const campaign = await query<{ id: string; status: CampaignStatus }>(
    `select id, status from inventory_distribution_campaigns
      where status in ('queued', 'running', 'reversing') order by created_at asc limit 1`,
  )
  const selected = campaign.rows[0]
  if (!selected) return 0
  if (selected.status === 'reversing') return reverseCampaignBatch(selected.id, limit)
  return grantCampaignBatch(selected.id, limit)
}

export async function recoverStaleInventoryCampaignRecipients(now = new Date()): Promise<number> {
  await ensureDatabaseSchema()
  const cutoff = new Date(now.getTime() - 10 * 60_000).toISOString()
  const recovered = await query(
    `update inventory_distribution_recipients recipient
        set status = 'pending', processed_at = null, error_message = null
       from inventory_distribution_campaigns campaign
      where recipient.campaign_id = campaign.id
        and recipient.status = 'processing'
        and campaign.status in ('queued', 'running')
        and (recipient.processed_at is null or recipient.processed_at < $1)
      returning recipient.user_id`,
    [cutoff],
  )
  return recovered.rowCount ?? 0
}

async function grantCampaignBatch(campaignId: string, limit: number): Promise<number> {
  const claimed = await withTransaction(async (client) => {
    const campaign = await client.query<{
      item_code: string; gift_pack_version_id: string | null; quantity: number; validity_days: number; status: CampaignStatus
    }>('select item_code, gift_pack_version_id, quantity, validity_days, status from inventory_distribution_campaigns where id = $1 for update', [campaignId])
    const row = campaign.rows[0]
    if (!row || (row.status !== 'queued' && row.status !== 'running')) return { row: null, recipients: [] as string[] }
    const now = new Date().toISOString()
    const recipients = await client.query<{ user_id: string }>(
      `with selected as (
         select user_id from inventory_distribution_recipients
          where campaign_id = $1 and status = 'pending' and next_attempt_at <= $3
          order by user_id for update skip locked limit $2
       )
       update inventory_distribution_recipients recipient set status = 'processing', processed_at = $3, error_message = null
        from selected where recipient.campaign_id = $1 and recipient.user_id = selected.user_id
       returning recipient.user_id`,
      [campaignId, Math.max(1, Math.min(500, limit)), now],
    )
    await client.query("update inventory_distribution_campaigns set status = 'running', updated_at = $2 where id = $1", [campaignId, now])
    return { row, recipients: recipients.rows.map((recipient) => recipient.user_id) }
  })
  if (!claimed.row) return 0
  for (const userId of claimed.recipients) {
    try {
      await withTransaction(async (client) => {
        const now = new Date().toISOString()
        const row = claimed.row!
        const campaignState = await client.query<{ status: CampaignStatus }>(
          'select status from inventory_distribution_campaigns where id = $1 for share',
          [campaignId],
        )
        if (campaignState.rows[0]?.status !== 'running' && campaignState.rows[0]?.status !== 'queued') return
        const recipientState = await client.query<{ status: string }>(
          'select status from inventory_distribution_recipients where campaign_id = $1 and user_id = $2 for update',
          [campaignId, userId],
        )
        if (recipientState.rows[0]?.status !== 'processing') return
        const grantId = await grantItemInTransaction(client, {
          userId,
          itemCode: row.item_code,
          quantity: Number(row.quantity),
          expiry: row.validity_days > 0 ? { mode: 'relative_days', days: Number(row.validity_days) } : { mode: 'never' },
          sourceType: 'distribution_campaign', sourceId: campaignId, recipientRole: 'recipient',
          giftPackVersionId: row.gift_pack_version_id, metadata: { campaign_id: campaignId }, now,
        })
        const resolvedGrant = grantId ?? (await client.query<{ id: string }>(
          `select id from reward_grants where user_id = $1 and reward_type = $2
            and source_type = 'distribution_campaign' and source_id = $3 and recipient_role = 'recipient'`,
          [userId, row.item_code, campaignId],
        )).rows[0]?.id ?? null
        await client.query(
          "update inventory_distribution_recipients set status = 'granted', grant_id = $3, processed_at = $4, error_message = null where campaign_id = $1 and user_id = $2 and status = 'processing'",
          [campaignId, userId, resolvedGrant, now],
        )
      })
    } catch (error) {
      await query(
        `update inventory_distribution_recipients
            set attempt_count = attempt_count + 1,
                status = case when attempt_count + 1 >= $5 then 'failed' else 'pending' end,
                error_message = $3,
                processed_at = $4,
                next_attempt_at = $4::timestamptz + make_interval(secs => least(300, (power(2, attempt_count)::integer * 5)))
          where campaign_id = $1 and user_id = $2 and status = 'processing'`,
        [campaignId, userId, error instanceof Error ? error.message.slice(0, 500) : 'unknown error', new Date().toISOString(), CAMPAIGN_MAX_ATTEMPTS],
      )
    }
  }
  await withTransaction(async (client) => {
    const counts = await client.query<{ active_count: string; failed_count: string }>(
      `select count(*) filter (where status in ('pending', 'processing'))::text as active_count,
              count(*) filter (where status = 'failed')::text as failed_count
         from inventory_distribution_recipients where campaign_id = $1`,
      [campaignId],
    )
    if (Number(counts.rows[0]?.active_count ?? 0) === 0) {
      const status = Number(counts.rows[0]?.failed_count ?? 0) > 0 ? 'completed_with_failures' : 'completed'
      await client.query('update inventory_distribution_campaigns set status = $2, updated_at = $3 where id = $1 and status = \'running\'', [campaignId, status, new Date().toISOString()])
    }
  })
  return claimed.recipients.length
}

async function reverseCampaignBatch(campaignId: string, limit: number): Promise<number> {
  return withTransaction(async (client) => {
    const recipients = await client.query<{ user_id: string; grant_id: string }>(
      `select user_id, grant_id from inventory_distribution_recipients
        where campaign_id = $1 and status = 'granted' and grant_id is not null
        order by user_id for update skip locked limit $2`,
      [campaignId, Math.max(1, Math.min(500, limit))],
    )
    const now = new Date().toISOString()
    for (const recipient of recipients.rows) {
      const grant = await client.query<{ remaining_quantity: number; reward_type: string }>('select remaining_quantity, reward_type from reward_grants where id = $1 for update', [recipient.grant_id])
      const remaining = Number(grant.rows[0]?.remaining_quantity ?? 0)
      if (remaining > 0) {
        await client.query('update reward_grants set remaining_quantity = 0, revoked_quantity = revoked_quantity + $2 where id = $1', [recipient.grant_id, remaining])
        await client.query(
          `insert into inventory_ledger
            (id, user_id, item_code, event_type, quantity, grant_id, reference_type, reference_id, metadata_json, created_at)
           values ($1, $2, $3, 'revoke', $4, $5, 'campaign_reverse', $6, $7::jsonb, $8)
           on conflict do nothing`,
          [randomUUID(), recipient.user_id, grant.rows[0]?.reward_type, remaining, recipient.grant_id, campaignId,
            JSON.stringify({ campaign_id: campaignId }), now],
        )
      }
      await client.query(
        "update inventory_distribution_recipients set status = 'revoked', processed_at = $3 where campaign_id = $1 and user_id = $2",
        [campaignId, recipient.user_id, now],
      )
    }
    const left = await client.query<{ count: string }>("select count(*)::text as count from inventory_distribution_recipients where campaign_id = $1 and status = 'granted'", [campaignId])
    if (Number(left.rows[0]?.count ?? 0) === 0) await client.query("update inventory_distribution_campaigns set status = 'reversed', updated_at = $2 where id = $1", [campaignId, now])
    return recipients.rows.length
  })
}

function normalizeContents(value: unknown): GiftPackContentInput[] {
  if (!Array.isArray(value)) throw new InventoryError('contents_invalid', '奖励内容必须是数组。', 400)
  const seen = new Set<string>()
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new InventoryError('contents_invalid', '奖励内容格式不正确。', 400)
    const row = entry as Record<string, unknown>
    const itemCode = requireString(row.item_code, 1, 128, '道具代码')
    if (seen.has(itemCode)) throw new InventoryError('contents_duplicate', '同一礼包或任务中不能重复配置相同道具。', 400)
    seen.add(itemCode)
    const quantity = Number(row.quantity)
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) throw new InventoryError('quantity_invalid', '奖励数量必须是 1 到 10000 之间的整数。', 400)
    const expiry = normalizeExpiryPolicy(row.expiry)
    if (!expiry) throw new InventoryError('expiry_invalid', '必须明确配置永久或 1 到 3650 天有效期。', 400)
    return { item_code: itemCode, quantity, expiry }
  })
}

async function assertGiftContents(client: PoolClient, contents: GiftPackContentInput[]): Promise<void> {
  if (contents.length === 0) throw new InventoryError('gift_pack_empty', '礼包内容不能为空。', 400)
  const result = await client.query<{ code: string; kind: string; issuance_enabled: boolean }>(
    'select code, kind, issuance_enabled from item_definitions where code = any($1::text[])',
    [contents.map((item) => item.item_code)],
  )
  if (result.rows.length !== contents.length) throw new InventoryError('contents_item_unknown', '礼包包含不存在的道具。', 400)
  if (result.rows.some((item) => item.kind === 'gift_pack')) throw new InventoryError('gift_pack_nested', '礼包不能包含其他礼包。', 400)
  if (result.rows.some((item) => item.kind === 'cosmetic' || item.kind === 'badge')) throw new InventoryError('item_kind_not_implemented', '主题装扮和成就勋章尚未开放。', 400)
  if (result.rows.some((item) => !item.issuance_enabled)) throw new InventoryError('contents_item_disabled', '礼包包含当前不可发放的道具。', 409)
}

async function assertIssuableContents(client: PoolClient, contents: GiftPackContentInput[]): Promise<void> {
  if (contents.length === 0) return
  const result = await client.query<{ code: string; kind: string; issuance_enabled: boolean }>(
    'select code, kind, issuance_enabled from item_definitions where code = any($1::text[])',
    [contents.map((item) => item.item_code)],
  )
  if (result.rows.length !== contents.length || result.rows.some((item) => !item.issuance_enabled || item.kind === 'cosmetic' || item.kind === 'badge')) {
    throw new InventoryError('reward_item_unavailable', '任务奖励包含不存在、停用或尚未实现的道具。', 400)
  }
}

async function snapshotRewardContents(client: PoolClient, contents: GiftPackContentInput[]): Promise<GiftPackContentInput[]> {
  await assertIssuableContents(client, contents)
  const snapshotted: GiftPackContentInput[] = []
  for (const content of contents) {
    const item = await client.query<{ kind: string }>('select kind from item_definitions where code = $1', [content.item_code])
    if (item.rows[0]?.kind !== 'gift_pack') {
      snapshotted.push(content)
      continue
    }
    const version = await client.query<{ id: string }>(
      `select id from gift_pack_versions
        where item_code = $1 and status = 'published'
        order by version desc limit 1`,
      [content.item_code],
    )
    if (!version.rows[0]) throw new InventoryError('gift_pack_version_unavailable', '任务奖励中的礼包没有可发放版本。', 409)
    snapshotted.push({ ...content, gift_pack_version_id: version.rows[0].id })
  }
  return snapshotted
}

async function replaceGiftContents(client: PoolClient, versionId: string, contents: GiftPackContentInput[]): Promise<void> {
  await client.query('delete from gift_pack_version_contents where gift_pack_version_id = $1', [versionId])
  for (const item of contents) {
    await client.query(
      `insert into gift_pack_version_contents (gift_pack_version_id, item_code, quantity, validity_days)
       values ($1, $2, $3, $4)`,
      [versionId, item.item_code, item.quantity, item.expiry.mode === 'relative_days' ? item.expiry.days : 0],
    )
  }
}

async function audit(
  client: PoolClient,
  adminUsername: string,
  action: string,
  targetType: string,
  targetId: string,
  reason: string,
  before: unknown,
  after: unknown,
  now: string,
): Promise<void> {
  await client.query(
    `insert into inventory_admin_audit
      (id, admin_username, action, target_type, target_id, reason, before_json, after_json, created_at)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)`,
    [randomUUID(), adminUsername, action, targetType, targetId, reason, JSON.stringify(before), JSON.stringify(after), now],
  )
}

async function beginAdminOperation(
  client: PoolClient,
  adminUsername: string,
  idempotencyKey: string,
  operationType: string,
  request: unknown,
): Promise<{ id: string; replayedResponse: Record<string, unknown> | null }> {
  const key = requireString(idempotencyKey, 1, 200, '本次提交信息')
  const requestHash = createHash('sha256').update(JSON.stringify(request)).digest('hex')
  const operationId = randomUUID()
  const now = new Date().toISOString()
  const inserted = await client.query(
    `insert into inventory_admin_operations
      (id, admin_username, idempotency_key, operation_type, request_hash, created_at)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (admin_username, idempotency_key) do nothing`,
    [operationId, adminUsername, key, operationType, requestHash, now],
  )
  if (inserted.rowCount) return { id: operationId, replayedResponse: null }
  const existing = await client.query<{
    id: string; operation_type: string; request_hash: string; response_json: Record<string, unknown> | null
  }>(
    `select id, operation_type, request_hash, response_json from inventory_admin_operations
      where admin_username = $1 and idempotency_key = $2 for update`,
    [adminUsername, key],
  )
  const row = existing.rows[0]
  if (!row || row.operation_type !== operationType || row.request_hash !== requestHash) {
    throw new InventoryError('idempotency_conflict', '提交内容已发生变化，请刷新页面后重新操作。', 409)
  }
  if (!row.response_json) throw new InventoryError('operation_in_progress', '管理员操作正在处理中。', 409)
  return { id: row.id, replayedResponse: row.response_json }
}

async function completeAdminOperation(
  client: PoolClient,
  operationId: string,
  response: Record<string, unknown>,
  now: string,
): Promise<void> {
  await client.query(
    'update inventory_admin_operations set response_json = $2::jsonb, completed_at = $3 where id = $1',
    [operationId, JSON.stringify(response), now],
  )
}

function requireString(value: unknown, min: number, max: number, label: string): string {
  if (typeof value !== 'string') throw new InventoryError('string_invalid', `${label}格式不正确。`, 400)
  const normalized = value.trim()
  if (normalized.length < min || normalized.length > max) throw new InventoryError('string_invalid', `${label}长度必须为 ${min}-${max} 个字符。`, 400)
  return normalized
}
