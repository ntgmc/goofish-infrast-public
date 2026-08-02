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
  type OnboardingTaskRewardView,
  type OnboardingTaskView,
  type ProfileCapacitySummary,
} from '../../src/lib/inventory-contracts'
import { WORKSPACE_ARCHIVED_RESULT_MAX_LIMIT, WORKSPACE_RESULT_HISTORY_LIMIT, WORKSPACE_SAVED_CONFIG_LIMIT } from '../../src/lib/workspace-limits'
import { ensureDatabaseSchema } from './schema'
import { query, withTransaction } from './postgres'
import { emptyWorkspace, isDepotValueProfile, listProfilesForUser, updateProfileWorkspaceInTransaction, type UserGameAccountRecord } from './user-store'
import { FREE_PREVIEW_LIMITED_CDK_ACTIVITY, isFreePreviewLimitedCdkActivityActive } from '../free-preview-trial'
import { upsertItemGrantNotificationGroupInTransaction, upsertItemGrantNotificationInTransaction } from './notification-store'
import { createLifetimeVoucherProfileAuthorizationInTransaction } from './cdk-redemption'

const PROFILE_CAPACITY_LIMITS = Object.freeze({
  plan: { base: WORKSPACE_SAVED_CONFIG_LIMIT, maximum: 20, entitlement: 'plan_slots' },
  history: { base: WORKSPACE_RESULT_HISTORY_LIMIT, maximum: 50, entitlement: 'history_slots' },
  archive: { base: 0, maximum: WORKSPACE_ARCHIVED_RESULT_MAX_LIMIT, entitlement: 'archive_slots' },
})

export async function getProfileCapacityLimits(profileId: string): Promise<{ plan: number; history: number; archive: number }> {
  await ensureSchema()
  return getProfileCapacityLimitsInTransaction({ query }, profileId)
}

export async function getProfileCapacityLimitsInTransaction(
  client: Pick<PoolClient, 'query'>,
  profileId: string,
): Promise<{ plan: number; history: number; archive: number }> {
  const balances = await client.query<{ entitlement_type: string; units: number }>(
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

export async function createLifetimeProfileForJsonImport(input: {
  userId: string
  idempotencyKey: string
  displayName?: string
  note?: string
  now?: Date
}): Promise<{ profileId: string; replayed: boolean }> {
  await ensureSchema()
  const displayName = normalizeProfileText(input.displayName, 40) || '终身档案'
  const note = normalizeProfileText(input.note, 500)
  const requestHash = createHash('sha256').update(JSON.stringify({
    action: 'create_lifetime_profile_for_json_import',
    displayName,
    note,
  })).digest('hex')

  return withTransaction(async (client) => {
    const operationId = randomUUID()
    const now = (input.now ?? new Date()).toISOString()
    const inserted = await client.query(
      `insert into inventory_operations (id, user_id, idempotency_key, operation_type, request_hash, created_at)
       values ($1, $2, $3, 'create_lifetime_profile', $4, $5)
       on conflict (user_id, idempotency_key) do nothing`,
      [operationId, input.userId, input.idempotencyKey, requestHash, now],
    )
    if (!inserted.rowCount) {
      const existing = await client.query<{ request_hash: string; response_json: { profile_id?: unknown } | null }>(
        'select request_hash, response_json from inventory_operations where user_id = $1 and idempotency_key = $2 for update',
        [input.userId, input.idempotencyKey],
      )
      const previous = existing.rows[0]
      if (!previous || previous.request_hash !== requestHash) {
        throw new InventoryError('idempotency_conflict', '幂等键已被其他请求使用。', 409)
      }
      if (!previous.response_json || typeof previous.response_json.profile_id !== 'string') {
        throw new InventoryError('operation_in_progress', '终身版档案正在创建中。', 409)
      }
      return { profileId: previous.response_json.profile_id, replayed: true }
    }

    const profileId = randomUUID()
    const authorization = await createLifetimeVoucherProfileAuthorizationInTransaction(client, {
      operationId,
      userId: input.userId,
      profileId,
      authorizedAt: now,
    })
    const profile: UserGameAccountRecord = {
      version: 1,
      id: profileId,
      user_id: input.userId,
      kind: 'cdk',
      cdk_key: authorization.cdkKey,
      cdk_code_hash: authorization.codeHash,
      cdk_order_hash: authorization.orderHash,
      permission: 'advanced',
      status: 'active',
      display_name: displayName,
      note,
      created_at: now,
      updated_at: now,
    }
    await client.query(
      `insert into user_game_accounts
        (id, user_id, cdk_key, cdk_code_hash, cdk_order_hash, permission, status, display_name, note,
         kind, archived_at, record_json, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, null, $11::jsonb, $12, $12)`,
      [profile.id, profile.user_id, profile.cdk_key, profile.cdk_code_hash, profile.cdk_order_hash,
        profile.permission, profile.status, profile.display_name, profile.note, profile.kind,
        JSON.stringify(profile), profile.created_at],
    )
    await updateProfileWorkspaceInTransaction(client, profileId, () => emptyWorkspace(profileId))
    await reserveItemsInTransaction(
      client,
      input.userId,
      ['lifetime_profile_voucher'],
      'inventory_operation',
      operationId,
      profileId,
      now,
    )
    await commitReservedItemsInTransaction(client, 'inventory_operation', operationId, now)
    const response = {
      operation_id: operationId,
      item_code: 'lifetime_profile_voucher',
      profile_id: profileId,
      import_mode: 'json',
    }
    await client.query(
      'update inventory_operations set response_json = $3::jsonb, completed_at = $4 where id = $1 and user_id = $2',
      [operationId, input.userId, JSON.stringify(response), now],
    )
    return { profileId, replayed: false }
  })
}

type GrantInput = {
  userId: string
  itemCode: string
  quantity: number
  expiry: ExpiryPolicy
  expiresAt?: string | null
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
      item_name: string; icon_key: string
    }>(
      `select ledger.id, ledger.item_code, ledger.event_type, ledger.quantity, ledger.reference_type,
              ledger.reference_id, ledger.created_at, ledger.metadata_json,
              definition.name as item_name, definition.icon_key
         from inventory_ledger ledger
         join item_definitions definition on definition.code = ledger.item_code
        where ledger.user_id = $1 order by ledger.created_at desc limit 30`,
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
        : item.kind === 'capacity_upgrade'
          ? ['use']
          : item.kind === 'license_voucher' && item.effect_code === 'bind_lifetime_profile'
            ? ['bind']
            : item.kind === 'license_voucher' && item.effect_code === 'activate_limited_profile'
              ? ['use']
              : ['context_only'],
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
      item_name: event.item_name,
      icon_key: event.icon_key,
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
  const definition = await client.query<{ kind: string; issuance_enabled: boolean; name: string; icon_key: string }>(
    'select kind, issuance_enabled, name, icon_key from item_definitions where code = $1',
    [input.itemCode],
  )
  const item = definition.rows[0]
  const version = input.giftPackVersionId
    ? (await client.query<{ status: string; item_code: string }>(
      'select status, item_code from gift_pack_versions where id = $1',
      [input.giftPackVersionId],
    )).rows[0] ?? null
    : null
  return grantItemWithSnapshot(client, input, item ?? null, version)
}

export async function grantItemsInTransaction(client: PoolClient, inputs: GrantInput[]): Promise<Array<string | null>> {
  if (inputs.length === 0) return []
  const itemCodes = [...new Set(inputs.map((input) => input.itemCode))]
  const definitions = await client.query<{
    code: string
    kind: string
    issuance_enabled: boolean
    name: string
    icon_key: string
  }>(
    'select code, kind, issuance_enabled, name, icon_key from item_definitions where code = any($1::text[])',
    [itemCodes],
  )
  const definitionsByCode = new Map(definitions.rows.map((definition) => [definition.code, definition]))
  const versionIds = [...new Set(inputs.flatMap((input) => input.giftPackVersionId ? [input.giftPackVersionId] : []))]
  const versions = versionIds.length === 0
    ? { rows: [] as Array<{ id: string; status: string; item_code: string }> }
    : await client.query<{ id: string; status: string; item_code: string }>(
      'select id, status, item_code from gift_pack_versions where id = any($1::text[])',
      [versionIds],
    )
  const versionsById = new Map(versions.rows.map((version) => [version.id, version]))
  const prepared = inputs.map((input) => {
    const item = definitionsByCode.get(input.itemCode) ?? null
    const version = input.giftPackVersionId ? versionsById.get(input.giftPackVersionId) ?? null : null
    const quantity = normalizeQuantity(input.quantity)
    const now = input.now ?? new Date().toISOString()
    const validityDays = input.expiry.mode === 'relative_days' ? input.expiry.days : 0
    const expiresAt = input.expiresAt !== undefined
      ? normalizeAbsoluteExpiry(input.expiresAt, now)
      : validityDays > 0 ? new Date(Date.parse(now) + validityDays * 86_400_000).toISOString() : null
    const historicalInvitationSnapshot = input.allowHistoricalSnapshot === true
      && input.sourceType === 'invitation'
      && input.metadata?.invitation_snapshot === true
    if (!item) throw new InventoryError('item_unknown', '道具不存在。', 404)
    if (!item.issuance_enabled && !historicalInvitationSnapshot) throw new InventoryError('item_issuance_disabled', '该道具当前不可发放。', 409)
    if (item.kind === 'gift_pack' && !input.giftPackVersionId) {
      throw new InventoryError('gift_pack_version_required', '礼包发放必须指定已发布版本。', 400)
    }
    if (input.giftPackVersionId) {
      const versionAvailable = version?.status === 'published'
        || (historicalInvitationSnapshot && version?.status === 'retired')
      if (!versionAvailable || version?.item_code !== input.itemCode) {
        throw new InventoryError('gift_pack_version_unavailable', '礼包版本不可发放。', 409)
      }
    }
    return {
      id: randomUUID(),
      user_id: input.userId,
      reward_type: input.itemCode,
      source_type: input.sourceType,
      source_id: input.sourceId,
      recipient_role: input.recipientRole,
      original_quantity: quantity,
      remaining_quantity: quantity,
      validity_days: validityDays,
      expires_at: expiresAt,
      metadata_json: input.metadata ?? {},
      gift_pack_version_id: input.giftPackVersionId ?? null,
      created_at: now,
      item_name: item.name,
      icon_key: item.icon_key,
    }
  })
  const inserted = await client.query<{
    id: string
    user_id: string
    reward_type: string
    source_type: string
    source_id: string
    recipient_role: string
    original_quantity: number
    expires_at: string | null
    metadata_json: Record<string, unknown>
    created_at: string
  }>(
    `with input as (
       select * from jsonb_to_recordset($1::jsonb) as item(
         id text, user_id text, reward_type text, source_type text, source_id text, recipient_role text,
         original_quantity integer, remaining_quantity integer, validity_days integer, expires_at text,
         metadata_json jsonb, gift_pack_version_id text, created_at text
       )
     )
     insert into reward_grants
       (id, user_id, reward_type, source_type, source_id, recipient_role, original_quantity, remaining_quantity,
        validity_days, expires_at, metadata_json, gift_pack_version_id, created_at)
     select id, user_id, reward_type, source_type, source_id, recipient_role, original_quantity, remaining_quantity,
            validity_days, expires_at::timestamptz, metadata_json, gift_pack_version_id, created_at::timestamptz
       from input
     on conflict (user_id, reward_type, source_type, source_id, recipient_role) do nothing
     returning id, user_id, reward_type, source_type, source_id, recipient_role,
               original_quantity, expires_at::text, metadata_json, created_at::text`,
    [JSON.stringify(prepared.map(({ item_name: _itemName, icon_key: _iconKey, ...row }) => row))],
  )
  if (inserted.rows.length > 0) {
    await client.query(
      `insert into inventory_ledger
        (id, user_id, item_code, event_type, quantity, grant_id, reference_type, reference_id, metadata_json, created_at)
       select ledger.id, ledger.user_id, ledger.item_code, 'grant', ledger.quantity, ledger.grant_id,
              ledger.reference_type, ledger.reference_id, ledger.metadata_json, ledger.created_at::timestamptz
         from jsonb_to_recordset($1::jsonb) as ledger(
           id text, user_id text, item_code text, quantity integer, grant_id text,
           reference_type text, reference_id text, metadata_json jsonb, created_at text
         )
       on conflict (user_id, item_code, event_type, reference_type, reference_id) do nothing`,
      [JSON.stringify(inserted.rows.map((row) => ({
        id: randomUUID(),
        user_id: row.user_id,
        item_code: row.reward_type,
        quantity: Number(row.original_quantity),
        grant_id: row.id,
        reference_type: row.source_type,
        reference_id: row.source_id,
        metadata_json: row.metadata_json ?? {},
        created_at: row.created_at,
      })))],
    )
  }
  const preparedByKey = new Map(prepared.map((row) => [grantKey(row), row]))
  const notificationGroups = new Map<string, {
    userId: string
    sourceType: string
    sourceId: string
    now: string
    items: Array<{
      grantId: string
      itemCode: string
      itemName: string
      iconKey: string
      quantity: number
      expiresAt: string | null
    }>
  }>()
  for (const row of inserted.rows) {
    const source = preparedByKey.get(grantKey(row))!
    const groupKey = JSON.stringify([row.user_id, row.source_type, row.source_id])
    const group = notificationGroups.get(groupKey) ?? {
      userId: row.user_id,
      sourceType: row.source_type,
      sourceId: row.source_id,
      now: row.created_at,
      items: [],
    }
    group.items.push({
      grantId: row.id,
      itemCode: row.reward_type,
      itemName: source.item_name,
      iconKey: source.icon_key,
      quantity: Number(row.original_quantity),
      expiresAt: row.expires_at,
    })
    notificationGroups.set(groupKey, group)
  }
  for (const group of notificationGroups.values()) {
    await upsertItemGrantNotificationGroupInTransaction(client, group)
  }
  const insertedByKey = new Map(inserted.rows.map((row) => [grantKey(row), row.id]))
  return prepared.map((row) => insertedByKey.get(grantKey(row)) ?? null)
}

function grantKey(row: {
  user_id: string
  reward_type: string
  source_type: string
  source_id: string
  recipient_role: string
}): string {
  return JSON.stringify([row.user_id, row.reward_type, row.source_type, row.source_id, row.recipient_role])
}

async function grantItemWithSnapshot(
  client: PoolClient,
  input: GrantInput,
  item: { kind: string; issuance_enabled: boolean; name: string; icon_key: string } | null,
  version: { status: string; item_code: string } | null,
): Promise<string | null> {
  const quantity = normalizeQuantity(input.quantity)
  const now = input.now ?? new Date().toISOString()
  const validityDays = input.expiry.mode === 'relative_days' ? input.expiry.days : 0
  const expiresAt = input.expiresAt !== undefined
    ? normalizeAbsoluteExpiry(input.expiresAt, now)
    : validityDays > 0 ? new Date(Date.parse(now) + validityDays * 86_400_000).toISOString() : null
  const historicalInvitationSnapshot = input.allowHistoricalSnapshot === true
    && input.sourceType === 'invitation'
    && input.metadata?.invitation_snapshot === true
  if (!item) throw new InventoryError('item_unknown', '道具不存在。', 404)
  if (!item.issuance_enabled && !historicalInvitationSnapshot) throw new InventoryError('item_issuance_disabled', '该道具当前不可发放。', 409)
  if (item.kind === 'gift_pack' && !input.giftPackVersionId) {
    throw new InventoryError('gift_pack_version_required', '礼包发放必须指定已发布版本。', 400)
  }
  if (input.giftPackVersionId) {
    const versionAvailable = version?.status === 'published'
      || (historicalInvitationSnapshot && version?.status === 'retired')
    if (!versionAvailable || version?.item_code !== input.itemCode) {
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
  await upsertItemGrantNotificationInTransaction(client, {
    userId: input.userId,
    grantId: actualId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    itemCode: input.itemCode,
    itemName: item.name,
    iconKey: item.icon_key,
    quantity,
    expiresAt,
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
    await lockInventoryItemInTransaction(client, userId, itemCode)
    const existing = await client.query(
      `select 1 from reward_consumptions
        where reference_type = $1 and reference_id = $2 and reward_type = $3`,
      [referenceType, referenceId, itemCode],
    )
    if (existing.rowCount) continue
    const grant = await client.query<{ id: string; validity_days: number; expires_at: string | null }>(
      `select id, validity_days, expires_at from reward_grants
        where user_id = $1 and reward_type = $2 and remaining_quantity > 0
          and (expires_at is null or expires_at > $3)
        order by expires_at asc nulls last, created_at asc
        for update limit 1`,
      [userId, itemCode, now],
    )
    const row = grant.rows[0]
    if (!row) throw new ItemUnavailableError(itemCode)
    const consumptionId = randomUUID()
    await client.query('update reward_grants set remaining_quantity = remaining_quantity - 1 where id = $1', [row.id])
    await client.query(
      `insert into reward_consumptions
        (id, user_id, reward_type, grant_id, optimization_job_id, reference_type, reference_id, profile_id,
         status, validity_days, original_expires_at, consumed_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'reserved', $9, $10, $11)`,
      [consumptionId, userId, itemCode, row.id, referenceType === 'optimization_job' ? referenceId : null,
        referenceType, referenceId, profileId, row.validity_days, row.expires_at, now],
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
    id: string; user_id: string; reward_type: string; validity_days: number
    original_expires_at: string | null; grant_id: string
  }>(
    `select id, user_id, reward_type, validity_days, original_expires_at, grant_id from reward_consumptions
      where reference_type = $1 and reference_id = $2 and status = 'reserved' for update`,
    [referenceType, referenceId],
  )
  for (const item of reserved.rows) {
    const expiresAt = item.original_expires_at ? new Date(item.original_expires_at).toISOString() : null
    const canRestore = expiresAt === null || Date.parse(expiresAt) > Date.parse(now)
    let actualGrantId: string | null = null
    if (canRestore) {
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
      actualGrantId = inserted.rows[0]?.id ?? refundGrantId
    }
    await client.query(
      `update reward_consumptions set status = 'refunded', refunded_at = $2, refunded_grant_id = $3
        where id = $1 and status = 'reserved'`,
      [item.id, now, actualGrantId],
    )
    await insertLedger(client, {
      userId: item.user_id, itemCode: item.reward_type, eventType: 'refund', quantity: 1,
      grantId: actualGrantId ?? item.grant_id,
      referenceType,
      referenceId,
      metadata: { consumption_id: item.id, restored: canRestore, original_expires_at: expiresAt },
      now,
    })
  }
}

export async function useInventoryItem(userId: string, input: ItemUseRequest, operationNow = new Date()): Promise<Record<string, unknown>> {
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
    const now = operationNow.toISOString()
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
    } else if (item.kind === 'license_voucher' && item.effect_code === 'activate_limited_profile') {
      response = await activateLimitedProfileInTransaction(client, userId, input.item_code, operationId, now)
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

export async function grantFreePreviewLimitedVoucher(userId: string, now = new Date()): Promise<string | null> {
  if (!isFreePreviewLimitedCdkActivityActive(now)) return null
  await ensureSchema()
  return withTransaction(async (client) => {
    const eligible = await client.query(
      `select 1 from user_game_accounts
        where user_id = $1 and status = 'active'
          and record_json->>'kind' = 'free_preview'
          and record_json->'skland_binding' is not null
        limit 1`,
      [userId],
    )
    if (!eligible.rowCount) return null
    return grantItemInTransaction(client, {
      userId,
      itemCode: 'limited_profile_voucher',
      quantity: 1,
      expiry: { mode: 'never' },
      expiresAt: FREE_PREVIEW_LIMITED_CDK_ACTIVITY.endsAt,
      sourceType: 'free_preview_activity',
      sourceId: FREE_PREVIEW_LIMITED_CDK_ACTIVITY.id,
      recipientRole: 'participant',
      metadata: { activity_id: FREE_PREVIEW_LIMITED_CDK_ACTIVITY.id },
      now: now.toISOString(),
    })
  })
}

async function activateLimitedProfileInTransaction(
  client: PoolClient,
  userId: string,
  itemCode: string,
  operationId: string,
  now: string,
): Promise<Record<string, unknown>> {
  const nowDate = new Date(now)
  if (!isFreePreviewLimitedCdkActivityActive(nowDate)) {
    throw new InventoryError('limited_cdk_activity_inactive', '限时 CDK 活动尚未开始或已经结束。', 409)
  }
  const selected = await client.query<{ id: string; record_json: import('./user-store').UserGameAccountRecord }>(
    `select id, record_json from user_game_accounts
      where user_id = $1 and status = 'active'
        and record_json->>'kind' = 'free_preview'
        and record_json->'skland_binding' is not null
      order by created_at asc
      for update limit 1`,
    [userId],
  )
  const row = selected.rows[0]
  if (!row) throw new InventoryError('free_preview_profile_required', '没有可使用限时 CDK 的已绑定免费预览档案。', 409)
  const current = row.record_json
  if (current.temporary_permission
    && new Date(current.temporary_permission.ends_at).getTime() > nowDate.getTime()) {
    throw new InventoryError('limited_permission_already_active', '当前免费预览档案已经激活限时高级权限。', 409)
  }
  await reserveItemsInTransaction(client, userId, [itemCode], 'inventory_operation', operationId, row.id, now)
  const next = {
    ...current,
    temporary_permission: {
      source: 'limited_profile_voucher' as const,
      activity_id: FREE_PREVIEW_LIMITED_CDK_ACTIVITY.id,
      permission: 'advanced' as const,
      starts_at: now,
      ends_at: FREE_PREVIEW_LIMITED_CDK_ACTIVITY.endsAt,
      operation_id: operationId,
    },
    updated_at: now,
  }
  await client.query(
    `update user_game_accounts set record_json = $3::jsonb, updated_at = $4
      where id = $1 and user_id = $2`,
    [row.id, userId, JSON.stringify(next), now],
  )
  await commitReservedItemsInTransaction(client, 'inventory_operation', operationId, now)
  return {
    operation_id: operationId,
    item_code: itemCode,
    profile_id: row.id,
    permission: 'advanced',
    starts_at: now,
    ends_at: FREE_PREVIEW_LIMITED_CDK_ACTIVITY.endsAt,
  }
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
    task_code: OnboardingTaskCode; version_id: string; version: number
    enabled: boolean; rewards_json: GiftPackContentInput[]
    completed_at: string | null; claimed_at: string | null
  }>(
    `select current.task_code,
            coalesce(progress_version.id, current_version.id) as version_id,
            coalesce(progress_version.version, current_version.version) as version,
            coalesce(progress_version.enabled, current_version.enabled) as enabled,
            coalesce(progress_version.rewards_json, current_version.rewards_json) as rewards_json,
            progress.completed_at, progress.claimed_at
       from onboarding_task_current current
       join onboarding_task_versions current_version on current_version.id = current.version_id
       left join user_onboarding_tasks progress on progress.user_id = $1 and progress.task_code = current.task_code
       left join onboarding_task_versions progress_version on progress_version.id = progress.version_id
      order by case current.task_code when 'welcome_inventory' then 1 when 'bind_skland' then 2 else 3 end`,
    [userId],
  )
  const itemCodes = [...new Set(result.rows.flatMap((row) => (
    Array.isArray(row.rewards_json) ? row.rewards_json.map((reward) => reward.item_code) : []
  )))]
  const definitions = itemCodes.length > 0
    ? await query<{ code: string; name: string; icon_key: string }>(
        'select code, name, icon_key from item_definitions where code = any($1::text[])',
        [itemCodes],
      )
    : { rows: [] }
  const definitionByCode = new Map(definitions.rows.map((definition) => [definition.code, definition]))
  return result.rows.map((row) => ({
    code: row.task_code,
    version_id: row.version_id,
    version: Number(row.version),
    ...taskCopy(row.task_code),
    enabled: row.enabled,
    status: !row.enabled ? 'disabled' : row.claimed_at ? 'claimed' : row.completed_at ? 'claimable' : 'incomplete',
    completed_at: row.completed_at,
    claimed_at: row.claimed_at,
    rewards: (Array.isArray(row.rewards_json) ? row.rewards_json : []).map((reward): OnboardingTaskRewardView => {
      const definition = definitionByCode.get(reward.item_code)
      return {
        ...reward,
        name: definition?.name ?? reward.item_code,
        icon_key: definition?.icon_key ?? 'placeholder',
      }
    }),
  }))
}

async function lockInventoryItemInTransaction(client: PoolClient, userId: string, itemCode: string): Promise<void> {
  await client.query(
    "select pg_advisory_xact_lock(hashtextextended('inventory-item:' || $1 || ':' || $2, 0))",
    [userId, itemCode],
  )
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
  const [balances, usageRows] = await Promise.all([
    query<{ profile_id: string; entitlement_type: string; units: number }>(
      `select balances.profile_id, balances.entitlement_type, balances.units
         from profile_entitlement_balances balances
         join user_game_accounts profile on profile.id = balances.profile_id
        where profile.user_id = $1`,
      [userId],
    ),
    query<{
      profile_id: string
      plan_used: number
      history_used: number
      archive_used: number
    }>(
      `select profile_id,
              case when jsonb_typeof(record_json->'saved_configs') = 'array'
                then jsonb_array_length(record_json->'saved_configs') else 0 end as plan_used,
              case when jsonb_typeof(record_json->'result_history') = 'array'
                then jsonb_array_length(record_json->'result_history') else 0 end as history_used,
              case when jsonb_typeof(record_json->'archived_results') = 'array'
                then jsonb_array_length(record_json->'archived_results') else 0 end as archive_used
         from user_profile_workspaces
        where profile_id = any($1::text[])`,
      [profiles.map((profile) => profile.id)],
    ),
  ])
  const byProfile = new Map<string, Map<string, number>>()
  for (const row of balances.rows) {
    const current = byProfile.get(row.profile_id) ?? new Map<string, number>()
    current.set(row.entitlement_type, Number(row.units))
    byProfile.set(row.profile_id, current)
  }
  const usageByProfile = new Map(usageRows.rows.map((row) => [row.profile_id, row]))
  return profiles.map((profile) => {
    const usage = usageByProfile.get(profile.id)
    const units = byProfile.get(profile.id) ?? new Map<string, number>()
    return {
      profile_id: profile.id,
      display_name: profile.display_name,
      plan_slots: capacity(Number(usage?.plan_used ?? 0), PROFILE_CAPACITY_LIMITS.plan, units),
      history_slots: capacity(Number(usage?.history_used ?? 0), PROFILE_CAPACITY_LIMITS.history, units),
      archive_slots: capacity(Number(usage?.archive_used ?? 0), PROFILE_CAPACITY_LIMITS.archive, units),
    }
  })
}

async function openGiftPackInTransaction(
  client: PoolClient,
  userId: string,
  input: ItemUseRequest,
  operationId: string,
  now: string,
): Promise<Record<string, unknown>> {
  await lockInventoryItemInTransaction(client, userId, input.item_code)
  const grant = await client.query<{ id: string; gift_pack_version_id: string | null }>(
    `select id, gift_pack_version_id from reward_grants
      where user_id = $1 and reward_type = $2 and remaining_quantity > 0
        and (expires_at is null or expires_at > $3)
        and ($4::text is null or gift_pack_version_id = $4)
      order by expires_at asc nulls last, created_at asc for update limit 1`,
    [userId, input.item_code, now, input.gift_pack_version_id ?? null],
  )
  const source = grant.rows[0]
  if (!source) throw new ItemUnavailableError(input.item_code)
  if (!source.gift_pack_version_id) throw new InventoryError('gift_pack_version_missing', '礼包没有绑定可开启的内容版本。', 409)
  const contents = await client.query<{ item_code: string; quantity: number; validity_days: number; name: string; icon_key: string }>(
    `select content.item_code, content.quantity, content.validity_days, definition.name, definition.icon_key
       from gift_pack_version_contents content
       join gift_pack_versions version on version.id = content.gift_pack_version_id
       join item_definitions definition on definition.code = content.item_code
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
  const rewards: Array<{ item_code: string; name: string; icon_key: string; quantity: number; expires_at: string | null }> = []
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
      name: content.name,
      icon_key: content.icon_key,
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

function normalizeProfileText(value: string | undefined, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}

function normalizeQuantity(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 10000) throw new InventoryError('quantity_invalid', '道具数量必须是 1 到 10000 之间的整数。', 400)
  return value
}

function normalizeAbsoluteExpiry(value: string | null, now: string): string | null {
  if (value === null) return null
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp) || timestamp <= Date.parse(now)) {
    throw new InventoryError('expiry_invalid', '道具绝对到期时间无效或已经过期。', 400)
  }
  return new Date(timestamp).toISOString()
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
