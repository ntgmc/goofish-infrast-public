import { createHash, randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import {
  ITEM_ICON_PATHS,
  type ExpiryPolicy,
  type GiftPackContentInput,
  type InventoryLedgerEvent,
  type InventoryResponse,
  type InventoryStack,
  type ItemDefinition,
  type ItemUseRequest,
  type OnboardingTaskCode,
  type OnboardingTaskView,
  type ProfileCapacitySummary,
} from '../../src/lib/inventory-contracts'
import { WORKSPACE_RESULT_HISTORY_LIMIT, WORKSPACE_SAVED_CONFIG_LIMIT } from '../../src/lib/workspace-limits'
import { ensureDatabaseSchema } from './schema'
import { query, withTransaction } from './postgres'
import { getProfileWorkspace, isDepotValueProfile, listProfilesForUser } from './user-store'

const PROFILE_CAPACITY_LIMITS = Object.freeze({
  plan: { base: WORKSPACE_SAVED_CONFIG_LIMIT, maximum: 20, entitlement: 'plan_slots' },
  history: { base: WORKSPACE_RESULT_HISTORY_LIMIT, maximum: 50, entitlement: 'history_slots' },
  archive: { base: 0, maximum: 20, entitlement: 'archive_slots' },
})

export async function getProfileCapacityLimits(profileId: string): Promise<{ plan: number; history: number; archive: number }> {
  await ensureSchema()
  const balances = await query<{ entitlement_type: string; units: number }>(
    'select entitlement_type, units from profile_entitlement_balances where profile_id = $1', [profileId],
  )
  const units = new Map(balances.rows.map((row) => [row.entitlement_type, Number(row.units)]))
  return {
    plan: Math.min(PROFILE_CAPACITY_LIMITS.plan.maximum, PROFILE_CAPACITY_LIMITS.plan.base + (units.get(PROFILE_CAPACITY_LIMITS.plan.entitlement) ?? 0)),
    history: Math.min(PROFILE_CAPACITY_LIMITS.history.maximum, PROFILE_CAPACITY_LIMITS.history.base + (units.get(PROFILE_CAPACITY_LIMITS.history.entitlement) ?? 0)),
    archive: Math.min(PROFILE_CAPACITY_LIMITS.archive.maximum, PROFILE_CAPACITY_LIMITS.archive.base + (units.get(PROFILE_CAPACITY_LIMITS.archive.entitlement) ?? 0)),
  }
}

export async function consumeInventoryItemImmediately(input: {
  userId: string
  itemCode: string
  profileId: string | null
  idempotencyKey: string
  requestHash: string
  operationType: string
  response: Record<string, unknown>
}): Promise<Record<string, unknown>> {
  await ensureSchema()
  return withTransaction(async (client) => {
    const existing = await client.query<{ request_hash: string; response_json: Record<string, unknown> | null }>(
      'select request_hash, response_json from inventory_operations where user_id = $1 and idempotency_key = $2 for update',
      [input.userId, input.idempotencyKey],
    )
    if (existing.rows[0]) {
      if (existing.rows[0].request_hash !== input.requestHash) throw new InventoryError('idempotency_conflict', '幂等键已被其他请求使用。', 409)
      if (!existing.rows[0].response_json) throw new InventoryError('operation_in_progress', '道具操作正在处理中。', 409)
      return existing.rows[0].response_json
    }
    const operationId = randomUUID()
    const now = new Date().toISOString()
    await client.query(
      `insert into inventory_operations (id, user_id, idempotency_key, operation_type, request_hash, created_at)
       values ($1, $2, $3, $4, $5, $6)`,
      [operationId, input.userId, input.idempotencyKey, input.operationType, input.requestHash, now],
    )
    await reserveItemsInTransaction(client, input.userId, [input.itemCode], 'inventory_operation', operationId, input.profileId, now)
    await commitReservedItemsInTransaction(client, 'inventory_operation', operationId, now)
    const response = { ...input.response, operation_id: operationId }
    await client.query(
      'update inventory_operations set response_json = $3::jsonb, completed_at = $4 where id = $1 and user_id = $2',
      [operationId, input.userId, JSON.stringify(response), now],
    )
    return response
  })
}

export class InventoryError extends Error {
  constructor(readonly code: string, message: string, readonly status: 400 | 403 | 404 | 409 = 409) {
    super(message)
    this.name = 'InventoryError'
  }
}

export class ItemUnavailableError extends InventoryError {
  constructor(readonly itemCode: string) {
    super('item_unavailable', `没有可用的${itemCode}。`, 409)
  }
}

type GrantInput = {
  userId: string
  itemCode: string
  quantity: number
  expiry: ExpiryPolicy
  sourceType: string
  sourceId: string
  recipientRole: string
  giftPackVersionId?: string | null
  metadata?: Record<string, unknown>
  allowHistoricalSnapshot?: boolean
  now?: string
}

let schemaReady: Promise<void> | null = null

export async function listInventory(userId: string, now = new Date()): Promise<InventoryResponse> {
  await ensureSchema()
  const nowIso = now.toISOString()
  const [rows, events, capacities] = await Promise.all([
    query<{
      reward_type: string
      gift_pack_version_id: string | null
      quantity: string
      permanent: string
      next_expiry_at: string | null
      expiry_buckets: Array<{ quantity: number; expires_at: string | null }>
      definition_json: ItemDefinition
    }>(
      `select grants.reward_type,
              grants.gift_pack_version_id,
              sum(grants.remaining_quantity)::text as quantity,
              sum(grants.remaining_quantity) filter (where grants.expires_at is null)::text as permanent,
              min(grants.expires_at) filter (where grants.expires_at > $2) as next_expiry_at,
              jsonb_agg(jsonb_build_object('quantity', grants.remaining_quantity, 'expires_at', grants.expires_at)
                order by grants.expires_at asc nulls last, grants.created_at asc) as expiry_buckets,
              jsonb_build_object(
                'code', definition.code,
                'kind', definition.kind,
                'effect_code', definition.effect_code,
                'name', definition.name,
                'description', definition.description,
                'icon_key', definition.icon_key,
                'system_owned', definition.system_owned,
                'issuance_enabled', definition.issuance_enabled,
                'created_at', definition.created_at,
                'updated_at', definition.updated_at
              ) as definition_json
         from reward_grants grants
         join item_definitions definition on definition.code = grants.reward_type
        where grants.user_id = $1 and grants.remaining_quantity > 0
          and (grants.expires_at is null or grants.expires_at > $2)
        group by grants.reward_type, grants.gift_pack_version_id, definition.code`,
      [userId, nowIso],
    ),
    query<{
      id: string; item_code: string; event_type: InventoryLedgerEvent['event_type']; quantity: number
      reference_type: string; reference_id: string; created_at: string; metadata_json: Record<string, unknown>
    }>(
      `select id, item_code, event_type, quantity, reference_type, reference_id, created_at, metadata_json
         from inventory_ledger where user_id = $1 order by created_at desc limit 30`,
      [userId],
    ),
    getProfileCapacities(userId),
  ])

  const stacks: InventoryStack[] = rows.rows.map((row) => {
    const item = normalizeDefinition(row.definition_json)
    return {
      stack_id: stackId(row.reward_type, row.gift_pack_version_id),
      item,
      gift_pack_version_id: row.gift_pack_version_id,
      quantity: Number(row.quantity),
      permanent: Number(row.permanent),
      next_expiry_at: row.next_expiry_at,
      expiry_buckets: Array.isArray(row.expiry_buckets) ? row.expiry_buckets : [],
      actions: item.kind === 'gift_pack'
        ? ['open']
        : item.kind === 'capacity_upgrade' ? ['use'] : ['context_only'],
    }
  })

  return {
    stacks,
    capacities,
    reorder_quotas: [],
    recent_events: events.rows.map((event) => ({
      id: event.id,
      item_code: event.item_code,
      event_type: event.event_type,
      quantity: Number(event.quantity),
      reference_type: event.reference_type,
      reference_id: event.reference_id,
      created_at: event.created_at,
      metadata: event.metadata_json ?? {},
    })),
  }
}

export async function getItemBalance(userId: string, itemCode: string, now = new Date()): Promise<number> {
  await ensureSchema()
  const result = await query<{ available: string }>(
    `select coalesce(sum(remaining_quantity), 0)::text as available from reward_grants
      where user_id = $1 and reward_type = $2 and remaining_quantity > 0
        and (expires_at is null or expires_at > $3)`,
    [userId, itemCode, now.toISOString()],
  )
  return Number(result.rows[0]?.available ?? 0)
}

export async function grantItem(input: GrantInput): Promise<string | null> {
  await ensureSchema()
  return withTransaction((client) => grantItemInTransaction(client, input))
}

export async function grantItemInTransaction(client: PoolClient, input: GrantInput): Promise<string | null> {
  const quantity = normalizeQuantity(input.quantity)
  const now = input.now ?? new Date().toISOString()
  const validityDays = input.expiry.mode === 'relative_days' ? input.expiry.days : 0
  const expiresAt = validityDays > 0 ? new Date(Date.parse(now) + validityDays * 86_400_000).toISOString() : null
  const definition = await client.query<{ kind: string; issuance_enabled: boolean }>(
    'select kind, issuance_enabled from item_definitions where code = $1',
    [input.itemCode],
  )
  const item = definition.rows[0]
  const historicalInvitationSnapshot = input.allowHistoricalSnapshot === true
    && input.sourceType === 'invitation'
    && input.metadata?.invitation_snapshot === true
  if (!item) throw new InventoryError('item_unknown', '道具不存在。', 404)
  if (!item.issuance_enabled && !historicalInvitationSnapshot) throw new InventoryError('item_issuance_disabled', '该道具当前不可发放。', 409)
  if (item.kind === 'gift_pack' && !input.giftPackVersionId) {
    throw new InventoryError('gift_pack_version_required', '礼包发放必须指定已发布版本。', 400)
  }
  if (input.giftPackVersionId) {
    const version = await client.query<{ status: string; item_code: string }>(
      'select status, item_code from gift_pack_versions where id = $1',
      [input.giftPackVersionId],
    )
    const versionAvailable = version.rows[0]?.status === 'published'
      || (historicalInvitationSnapshot && version.rows[0]?.status === 'retired')
    if (!versionAvailable || version.rows[0]?.item_code !== input.itemCode) {
      throw new InventoryError('gift_pack_version_unavailable', '礼包版本不可发放。', 409)
    }
  }

  const grantId = randomUUID()
  const inserted = await client.query<{ id: string }>(
    `insert into reward_grants
      (id, user_id, reward_type, source_type, source_id, recipient_role, original_quantity, remaining_quantity,
       validity_days, expires_at, metadata_json, gift_pack_version_id, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9, $10::jsonb, $11, $12)
     on conflict (user_id, reward_type, source_type, source_id, recipient_role) do nothing
     returning id`,
    [grantId, input.userId, input.itemCode, input.sourceType, input.sourceId, input.recipientRole, quantity,
      validityDays, expiresAt, JSON.stringify(input.metadata ?? {}), input.giftPackVersionId ?? null, now],
  )
  const actualId = inserted.rows[0]?.id ?? null
  if (!actualId) return null
  await insertLedger(client, {
    userId: input.userId,
    itemCode: input.itemCode,
    eventType: 'grant',
    quantity,
    grantId: actualId,
    referenceType: input.sourceType,
    referenceId: input.sourceId,
    metadata: input.metadata ?? {},
    now,
  })
  return actualId
}

export async function reserveItemsInTransaction(
  client: PoolClient,
  userId: string,
  itemCodes: string[],
  referenceType: string,
  referenceId: string,
  profileId: string | null,
  now = new Date().toISOString(),
): Promise<void> {
  for (const itemCode of [...new Set(itemCodes)]) {
    const existing = await client.query(
      `select 1 from reward_consumptions
        where reference_type = $1 and reference_id = $2 and reward_type = $3`,
      [referenceType, referenceId, itemCode],
    )
    if (existing.rowCount) continue
    const grant = await client.query<{ id: string; validity_days: number }>(
      `select id, validity_days from reward_grants
        where user_id = $1 and reward_type = $2 and remaining_quantity > 0
          and (expires_at is null or expires_at > $3)
        order by expires_at asc nulls last, created_at asc
        for update skip locked limit 1`,
      [userId, itemCode, now],
    )
    const row = grant.rows[0]
    if (!row) throw new ItemUnavailableError(itemCode)
    const consumptionId = randomUUID()
    await client.query('update reward_grants set remaining_quantity = remaining_quantity - 1 where id = $1', [row.id])
    await client.query(
      `insert into reward_consumptions
        (id, user_id, reward_type, grant_id, optimization_job_id, reference_type, reference_id, profile_id,
         status, validity_days, consumed_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'reserved', $9, $10)`,
      [consumptionId, userId, itemCode, row.id, referenceType === 'optimization_job' ? referenceId : null,
        referenceType, referenceId, profileId, row.validity_days, now],
    )
    await insertLedger(client, {
      userId, itemCode, eventType: 'reserve', quantity: 1, grantId: row.id,
      referenceType, referenceId, metadata: profileId ? { profile_id: profileId } : {}, now,
    })
  }
}

export async function commitReservedItemsInTransaction(
  client: PoolClient,
  referenceType: string,
  referenceId: string,
  now = new Date().toISOString(),
): Promise<void> {
  const reserved = await client.query<{ id: string; user_id: string; reward_type: string; grant_id: string }>(
    `select id, user_id, reward_type, grant_id from reward_consumptions
      where reference_type = $1 and reference_id = $2 and status = 'reserved' for update`,
    [referenceType, referenceId],
  )
  for (const item of reserved.rows) {
    await client.query("update reward_consumptions set status = 'committed', committed_at = $2 where id = $1 and status = 'reserved'", [item.id, now])
    await insertLedger(client, {
      userId: item.user_id, itemCode: item.reward_type, eventType: 'consume', quantity: 1,
      grantId: item.grant_id, referenceType, referenceId, metadata: {}, now,
    })
  }
}

export async function refundReservedItemsInTransaction(
  client: PoolClient,
  referenceType: string,
  referenceId: string,
  now = new Date().toISOString(),
): Promise<void> {
  const reserved = await client.query<{
    id: string; user_id: string; reward_type: string; validity_days: number; grant_id: string
  }>(
    `select id, user_id, reward_type, validity_days, grant_id from reward_consumptions
      where reference_type = $1 and reference_id = $2 and status = 'reserved' for update`,
    [referenceType, referenceId],
  )
  for (const item of reserved.rows) {
    const expiresAt = item.validity_days > 0
      ? new Date(Date.parse(now) + item.validity_days * 86_400_000).toISOString()
      : null
    const refundGrantId = randomUUID()
    const inserted = await client.query<{ id: string }>(
      `insert into reward_grants
        (id, user_id, reward_type, source_type, source_id, recipient_role, original_quantity, remaining_quantity,
         validity_days, expires_at, metadata_json, created_at)
       values ($1, $2, $3, 'operation_refund', $4, $5, 1, 1, $6, $7, $8::jsonb, $9)
       on conflict (user_id, reward_type, source_type, source_id, recipient_role) do update
         set remaining_quantity = reward_grants.remaining_quantity
       returning id`,
      [refundGrantId, item.user_id, item.reward_type, referenceId, `refund:${item.reward_type}`,
        item.validity_days, expiresAt, JSON.stringify({ refunded_consumption_id: item.id }), now],
    )
    const actualGrantId = inserted.rows[0]?.id ?? refundGrantId
    await client.query(
      `update reward_consumptions set status = 'refunded', refunded_at = $2, refunded_grant_id = $3
        where id = $1 and status = 'reserved'`,
      [item.id, now, actualGrantId],
    )
    await insertLedger(client, {
      userId: item.user_id, itemCode: item.reward_type, eventType: 'refund', quantity: 1,
      grantId: actualGrantId, referenceType, referenceId, metadata: { consumption_id: item.id }, now,
    })
  }
}

export async function useInventoryItem(userId: string, input: ItemUseRequest): Promise<Record<string, unknown>> {
  await ensureSchema()
  const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex')
  return withTransaction(async (client) => {
    const existing = await client.query<{ request_hash: string; response_json: Record<string, unknown> | null }>(
      'select request_hash, response_json from inventory_operations where user_id = $1 and idempotency_key = $2 for update',
      [userId, input.idempotency_key],
    )
    if (existing.rows[0]) {
      if (existing.rows[0].request_hash !== requestHash) throw new InventoryError('idempotency_conflict', '幂等键已被其他请求使用。', 409)
      if (!existing.rows[0].response_json) throw new InventoryError('operation_in_progress', '道具操作正在处理中。', 409)
      return existing.rows[0].response_json
    }
    const operationId = randomUUID()
    const now = new Date().toISOString()
    await client.query(
      `insert into inventory_operations (id, user_id, idempotency_key, operation_type, request_hash, created_at)
       values ($1, $2, $3, 'use_item', $4, $5)`,
      [operationId, userId, input.idempotency_key, requestHash, now],
    )
    const definition = await client.query<{ kind: string; effect_code: string | null }>(
      'select kind, effect_code from item_definitions where code = $1', [input.item_code],
    )
    const item = definition.rows[0]
    if (!item) throw new InventoryError('item_unknown', '道具不存在。', 404)
    let response: Record<string, unknown>
    if (item.kind === 'gift_pack') {
      response = await openGiftPackInTransaction(client, userId, input, operationId, now)
    } else if (item.kind === 'capacity_upgrade') {
      if (!input.profile_id) throw new InventoryError('profile_required', '请选择要扩容的账号档案。', 400)
      response = await applyCapacityUpgradeInTransaction(client, userId, input.item_code, item.effect_code, input.profile_id, operationId, now)
    } else {
      throw new InventoryError('context_only_item', '该道具只能在对应功能中使用。', 409)
    }
    await client.query(
      'update inventory_operations set response_json = $3::jsonb, completed_at = $4 where id = $1 and user_id = $2',
      [operationId, userId, JSON.stringify(response), now],
    )
    return response
  })
}

export async function markOnboardingTaskComplete(userId: string, taskCode: OnboardingTaskCode, now = new Date().toISOString()): Promise<void> {
  await ensureSchema()
  await query(
    `insert into user_onboarding_tasks (user_id, task_code, version_id, completed_at)
     select $1, current.task_code, current.version_id, $3
       from onboarding_task_current current
       join onboarding_task_versions version on version.id = current.version_id and version.enabled = true
      where current.task_code = $2
     on conflict (user_id, task_code) do nothing`,
    [userId, taskCode, now],
  )
}

export async function listOnboardingTasks(userId: string): Promise<OnboardingTaskView[]> {
  await ensureSchema()
  await backfillOnboardingProgress(userId)
  const result = await query<{
    task_code: OnboardingTaskCode; enabled: boolean; rewards_json: GiftPackContentInput[]
    completed_at: string | null; claimed_at: string | null
  }>(
    `select current.task_code, version.enabled, version.rewards_json,
            progress.completed_at, progress.claimed_at
       from onboarding_task_current current
       join onboarding_task_versions version on version.id = current.version_id
       left join user_onboarding_tasks progress on progress.user_id = $1 and progress.task_code = current.task_code
      order by case current.task_code when 'welcome_inventory' then 1 when 'bind_skland' then 2 else 3 end`,
    [userId],
  )
  return result.rows.map((row) => ({
    code: row.task_code,
    ...taskCopy(row.task_code),
    enabled: row.enabled,
    status: !row.enabled ? 'disabled' : row.claimed_at ? 'claimed' : row.completed_at ? 'claimable' : 'incomplete',
    completed_at: row.completed_at,
    claimed_at: row.claimed_at,
    rewards: Array.isArray(row.rewards_json) ? row.rewards_json : [],
  }))
}

export async function claimOnboardingTask(userId: string, taskCode: OnboardingTaskCode, idempotencyKey: string): Promise<Record<string, unknown>> {
  await ensureSchema()
  return withTransaction(async (client) => {
    const requestHash = createHash('sha256').update(JSON.stringify({ task_code: taskCode })).digest('hex')
    const existingOperation = await client.query<{ request_hash: string; response_json: Record<string, unknown> | null }>(
      'select request_hash, response_json from inventory_operations where user_id = $1 and idempotency_key = $2 for update',
      [userId, idempotencyKey],
    )
    if (existingOperation.rows[0]) {
      if (existingOperation.rows[0].request_hash !== requestHash) throw new InventoryError('idempotency_conflict', '幂等键已被其他请求使用。', 409)
      if (!existingOperation.rows[0].response_json) throw new InventoryError('operation_in_progress', '任务领取正在处理中。', 409)
      return existingOperation.rows[0].response_json
    }
    const operationId = randomUUID()
    const operationStartedAt = new Date().toISOString()
    await client.query(
      `insert into inventory_operations (id, user_id, idempotency_key, operation_type, request_hash, created_at)
       values ($1, $2, $3, 'onboarding_claim', $4, $5)`,
      [operationId, userId, idempotencyKey, requestHash, operationStartedAt],
    )
    const progress = await client.query<{
      version_id: string; completed_at: string; claimed_at: string | null; rewards_json: GiftPackContentInput[]; enabled: boolean
    }>(
      `select progress.version_id, progress.completed_at, progress.claimed_at, version.rewards_json, version.enabled
         from user_onboarding_tasks progress
         join onboarding_task_versions version on version.id = progress.version_id
        where progress.user_id = $1 and progress.task_code = $2 for update`,
      [userId, taskCode],
    )
    const row = progress.rows[0]
    if (!row || !row.enabled) throw new InventoryError('task_not_claimable', '任务尚未完成或未启用。', 409)
    if (row.claimed_at) {
      const response = { claimed: true, replayed: true, task_code: taskCode }
      await client.query(
        'update inventory_operations set response_json = $3::jsonb, completed_at = $4 where id = $1 and user_id = $2',
        [operationId, userId, JSON.stringify(response), operationStartedAt],
      )
      return response
    }
    if (!Array.isArray(row.rewards_json) || row.rewards_json.length === 0) throw new InventoryError('task_rewards_missing', '任务奖励尚未配置。', 409)
    const now = new Date().toISOString()
    const grants: Array<{ item_code: string; quantity: number }> = []
    for (const reward of row.rewards_json) {
      const grantId = await grantItemInTransaction(client, {
        userId,
        itemCode: reward.item_code,
        quantity: reward.quantity,
        expiry: reward.expiry,
        sourceType: 'onboarding_task',
        sourceId: `${taskCode}:${row.version_id}`,
        recipientRole: 'participant',
        giftPackVersionId: reward.gift_pack_version_id ?? null,
        metadata: { task_code: taskCode, idempotency_key: idempotencyKey },
        now,
      })
      if (grantId) grants.push({ item_code: reward.item_code, quantity: reward.quantity })
    }
    await client.query(
      `update user_onboarding_tasks set claimed_at = $3, claim_operation_id = $4
        where user_id = $1 and task_code = $2 and claimed_at is null`,
      [userId, taskCode, now, operationId],
    )
    const response = { claimed: true, replayed: false, task_code: taskCode, rewards: grants }
    await client.query(
      'update inventory_operations set response_json = $3::jsonb, completed_at = $4 where id = $1 and user_id = $2',
      [operationId, userId, JSON.stringify(response), now],
    )
    return response
  })
}

async function getProfileCapacities(userId: string): Promise<ProfileCapacitySummary[]> {
  const profiles = (await listProfilesForUser(userId)).filter(
    (profile) => profile.status === 'active' && !isDepotValueProfile(profile),
  )
  const balances = await query<{ profile_id: string; entitlement_type: string; units: number }>(
    `select balances.profile_id, balances.entitlement_type, balances.units
       from profile_entitlement_balances balances
       join user_game_accounts profile on profile.id = balances.profile_id
      where profile.user_id = $1`,
    [userId],
  )
  const byProfile = new Map<string, Map<string, number>>()
  for (const row of balances.rows) {
    const current = byProfile.get(row.profile_id) ?? new Map<string, number>()
    current.set(row.entitlement_type, Number(row.units))
    byProfile.set(row.profile_id, current)
  }
  return Promise.all(profiles.map(async (profile) => {
    const workspace = await getProfileWorkspace(profile.id)
    const units = byProfile.get(profile.id) ?? new Map<string, number>()
    return {
      profile_id: profile.id,
      display_name: profile.display_name,
      plan_slots: capacity(workspace?.saved_configs.length ?? 0, PROFILE_CAPACITY_LIMITS.plan, units),
      history_slots: capacity(workspace?.result_history.length ?? 0, PROFILE_CAPACITY_LIMITS.history, units),
      archive_slots: capacity(workspace?.archived_results.length ?? 0, PROFILE_CAPACITY_LIMITS.archive, units),
    }
  }))
}

async function openGiftPackInTransaction(
  client: PoolClient,
  userId: string,
  input: ItemUseRequest,
  operationId: string,
  now: string,
): Promise<Record<string, unknown>> {
  const grant = await client.query<{ id: string; gift_pack_version_id: string | null }>(
    `select id, gift_pack_version_id from reward_grants
      where user_id = $1 and reward_type = $2 and remaining_quantity > 0
        and (expires_at is null or expires_at > $3)
        and ($4::text is null or gift_pack_version_id = $4)
      order by expires_at asc nulls last, created_at asc for update skip locked limit 1`,
    [userId, input.item_code, now, input.gift_pack_version_id ?? null],
  )
  const source = grant.rows[0]
  if (!source) throw new ItemUnavailableError(input.item_code)
  if (!source.gift_pack_version_id) throw new InventoryError('gift_pack_version_missing', '礼包没有绑定可开启的内容版本。', 409)
  const contents = await client.query<{ item_code: string; quantity: number; validity_days: number }>(
    `select content.item_code, content.quantity, content.validity_days
       from gift_pack_version_contents content
       join gift_pack_versions version on version.id = content.gift_pack_version_id
      where content.gift_pack_version_id = $1 and version.item_code = $2
        and version.status in ('published', 'retired')`,
    [source.gift_pack_version_id, input.item_code],
  )
  if (contents.rows.length === 0) throw new InventoryError('gift_pack_empty', '礼包内容为空或版本不可用。', 409)
  await client.query('update reward_grants set remaining_quantity = remaining_quantity - 1 where id = $1', [source.id])
  await insertLedger(client, {
    userId, itemCode: input.item_code, eventType: 'gift_open', quantity: 1, grantId: source.id,
    referenceType: 'gift_opening', referenceId: operationId,
    metadata: { gift_pack_version_id: source.gift_pack_version_id }, now,
  })
  const rewards: Array<{ item_code: string; quantity: number; expires_at: string | null }> = []
  for (const content of contents.rows) {
    const expiry: ExpiryPolicy = content.validity_days > 0
      ? { mode: 'relative_days', days: content.validity_days }
      : { mode: 'never' }
    const grantId = await grantItemInTransaction(client, {
      userId,
      itemCode: content.item_code,
      quantity: Number(content.quantity),
      expiry,
      sourceType: 'gift_opening',
      sourceId: operationId,
      recipientRole: `content:${content.item_code}`,
      metadata: { gift_pack_version_id: source.gift_pack_version_id },
      now,
    })
    if (grantId) rewards.push({
      item_code: content.item_code,
      quantity: Number(content.quantity),
      expires_at: content.validity_days > 0 ? new Date(Date.parse(now) + content.validity_days * 86_400_000).toISOString() : null,
    })
  }
  return { operation_id: operationId, opened: input.item_code, gift_pack_version_id: source.gift_pack_version_id, rewards }
}

async function applyCapacityUpgradeInTransaction(
  client: PoolClient,
  userId: string,
  itemCode: string,
  effectCode: string | null,
  profileId: string,
  operationId: string,
  now: string,
): Promise<Record<string, unknown>> {
  const config = effectCode === 'plan_capacity' ? PROFILE_CAPACITY_LIMITS.plan
    : effectCode === 'history_capacity' ? PROFILE_CAPACITY_LIMITS.history
      : effectCode === 'result_archive_capacity' ? PROFILE_CAPACITY_LIMITS.archive : null
  if (!config) throw new InventoryError('capacity_item_invalid', '该道具不是有效的扩容道具。', 409)
  const profile = await client.query<{ status: string }>(
    'select status from user_game_accounts where id = $1 and user_id = $2 for update', [profileId, userId],
  )
  if (!profile.rows[0]) throw new InventoryError('profile_missing', '账号档案不存在。', 404)
  if (profile.rows[0].status !== 'active') throw new InventoryError('profile_inactive', '账号档案状态不可用。', 403)
  const balance = await client.query<{ units: number }>(
    'select units from profile_entitlement_balances where profile_id = $1 and entitlement_type = $2 for update',
    [profileId, config.entitlement],
  )
  const units = Number(balance.rows[0]?.units ?? 0)
  if (config.base + units >= config.maximum) throw new InventoryError('capacity_limit_reached', `该档案已达到 ${config.maximum} 个槽位上限。`, 409)
  await reserveItemsInTransaction(client, userId, [itemCode], 'inventory_operation', operationId, profileId, now)
  await client.query(
    `insert into profile_entitlement_balances (profile_id, entitlement_type, units, updated_at)
     values ($1, $2, 1, $3)
     on conflict (profile_id, entitlement_type) do update
       set units = profile_entitlement_balances.units + 1, updated_at = excluded.updated_at`,
    [profileId, config.entitlement, now],
  )
  await client.query(
    `insert into entitlement_ledger
      (id, profile_id, entitlement_type, status, units, reference_type, reference_id, created_at, settled_at)
     values ($1, $2, $3, 'consumed', 1, 'inventory_operation', $4, $5, $5)`,
    [randomUUID(), profileId, config.entitlement, operationId, now],
  )
  await commitReservedItemsInTransaction(client, 'inventory_operation', operationId, now)
  await insertLedger(client, {
    userId, itemCode, eventType: 'entitlement', quantity: 1, grantId: null,
    referenceType: 'profile', referenceId: profileId,
    metadata: { entitlement_type: config.entitlement, operation_id: operationId }, now,
  })
  return {
    operation_id: operationId,
    item_code: itemCode,
    profile_id: profileId,
    entitlement_type: config.entitlement,
    previous_limit: config.base + units,
    next_limit: config.base + units + 1,
    maximum: config.maximum,
  }
}

async function backfillOnboardingProgress(userId: string): Promise<void> {
  const now = new Date().toISOString()
  await markOnboardingTaskComplete(userId, 'welcome_inventory', now)
  const facts = await query<{ has_skland: boolean; has_schedule: boolean }>(
    `select exists (
       select 1 from user_game_accounts profile
        where profile.user_id = $1 and profile.record_json->'skland_binding' is not null
     ) as has_skland,
     exists (
       select 1 from usage_events usage
       join user_game_accounts profile on profile.id = coalesce(usage.profile_id, usage.record_json->>'profile_id')
        where profile.user_id = $1 and usage.event = 'schedule_generate'
          and coalesce(usage.record_json->>'status', 'success') = 'success'
          and coalesce(usage.record_json->>'source', '') <> 'scenario_comparison'
     ) as has_schedule`,
    [userId],
  )
  if (facts.rows[0]?.has_skland) await markOnboardingTaskComplete(userId, 'bind_skland', now)
  if (facts.rows[0]?.has_schedule) await markOnboardingTaskComplete(userId, 'first_main_schedule', now)
}

async function insertLedger(client: PoolClient, input: {
  userId: string; itemCode: string; eventType: InventoryLedgerEvent['event_type']; quantity: number
  grantId: string | null; referenceType: string; referenceId: string; metadata: Record<string, unknown>; now: string
}): Promise<void> {
  await client.query(
    `insert into inventory_ledger
      (id, user_id, item_code, event_type, quantity, grant_id, reference_type, reference_id, metadata_json, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
     on conflict (user_id, item_code, event_type, reference_type, reference_id) do nothing`,
    [randomUUID(), input.userId, input.itemCode, input.eventType, input.quantity, input.grantId,
      input.referenceType, input.referenceId, JSON.stringify(input.metadata), input.now],
  )
}

function normalizeDefinition(row: ItemDefinition): ItemDefinition {
  return {
    ...row,
    icon_key: ITEM_ICON_PATHS[row.icon_key] ? row.icon_key : 'placeholder',
    system_owned: row.system_owned === true,
    issuance_enabled: row.issuance_enabled === true,
  }
}

function capacity(
  used: number,
  config: { base: number; maximum: number; entitlement: string },
  units: Map<string, number>,
): { used: number; limit: number; maximum: number } {
  return { used, limit: Math.min(config.maximum, config.base + (units.get(config.entitlement) ?? 0)), maximum: config.maximum }
}

function stackId(itemCode: string, versionId: string | null): string {
  return versionId ? `${itemCode}:${versionId}` : itemCode
}

function normalizeQuantity(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 10000) throw new InventoryError('quantity_invalid', '道具数量必须是 1 到 10000 之间的整数。', 400)
  return value
}

function taskCopy(code: OnboardingTaskCode): { title: string; description: string } {
  if (code === 'welcome_inventory') return { title: '认识网站', description: '了解网站的主要功能并领取管理员配置的欢迎奖励。' }
  if (code === 'bind_skland') return { title: '绑定森空岛', description: '为任意排班档案成功绑定一次森空岛。' }
  return { title: '完成首次主排班', description: '成功完成任意账号档案的一次主排班。' }
}

function ensureSchema(): Promise<void> {
  schemaReady ??= ensureDatabaseSchema().catch((error) => {
    schemaReady = null
    throw error
  })
  return schemaReady
}
