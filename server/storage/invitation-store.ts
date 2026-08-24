import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { z } from 'zod'
import type {
  InvitationExpiryPolicy,
  InvitationGiftPackSummary,
  InvitationRecordSummary,
  InvitationRewardCatalogItem,
  InvitationRewardPreviewItem,
  InvitationRewardRecipient,
  InvitationRewardRule,
  InvitationSettings,
  InvitationSummary,
  InviterRewardStatus,
} from '../../src/lib/types'
import { saveUserAccountInTransaction } from './cdk-redemption'
import { grantItemsInTransaction, InventoryError } from './inventory-store'
import { query, withTransaction } from './postgres'
import { ensureDatabaseSchema } from './schema'
import { SettingsConflictError } from './settings-conflict'
import type { UserAccountRecord } from './user-store'

const PRIORITY_COMPUTE_COUPON = 'priority_compute_coupon' as const
const INVITATION_SETTINGS_KEY = 'global'
const INVITE_CODE_LENGTH = 10
const MAX_REWARDS_PER_RECIPIENT = 16
const MAX_REWARDS = 32
const MAX_SETTLEMENT_ATTEMPTS = 5
const SETTLEMENT_LEASE_MS = 5 * 60 * 1000
const INVITE_CODE_ROTATION_COOLDOWN_MS = 24 * 60 * 60 * 1000
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export type InvitationSettingsPatch = Partial<Pick<InvitationSettings, 'enabled' | 'daily_inviter_reward_limit' | 'rewards'>>

export interface ValidatedInvitationCode {
  code: string
  inviter_user_id: string
}

export interface PriorityCouponBalance {
  type: typeof PRIORITY_COMPUTE_COUPON
  available: number
  permanent: number
  next_expiry_at: string | null
}

export class InvitationCodeError extends Error {
  constructor(
    readonly code: 'invalid_invite_code' | 'invitation_campaign_paused' | 'invalid_cursor' | 'rotation_cooldown',
    message: string,
  ) {
    super(message)
    this.name = 'InvitationCodeError'
  }
}

export const DEFAULT_INVITATION_SETTINGS: InvitationSettings = {
  version: 2,
  revision: 0,
  enabled: true,
  activation_rule: 'first_active_profile',
  daily_inviter_reward_limit: 10,
  rewards: [{
    recipient: 'inviter',
    item_code: PRIORITY_COMPUTE_COUPON,
    quantity: 1,
    expiry: { mode: 'never' },
    gift_pack_version_id: null,
  }],
  updated_at: null,
}

const invitationExpirySnapshotSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('never') }),
  z.strictObject({ mode: z.literal('relative_days'), days: z.number().int().min(1).max(3650) }),
])
const invitationRewardSnapshotSchema = z.strictObject({
  recipient: z.enum(['inviter', 'invitee']),
  item_code: z.string().trim().min(1).max(128),
  quantity: z.number().int().min(1).max(10_000),
  expiry: invitationExpirySnapshotSchema,
  gift_pack_version_id: z.string().trim().min(1).max(128).nullable(),
})
const invitationSettingsSnapshotSchema = z.strictObject({
  version: z.literal(2),
  revision: z.number().int().nonnegative(),
  enabled: z.boolean(),
  activation_rule: z.literal('first_active_profile'),
  daily_inviter_reward_limit: z.number().int().min(1).max(1000),
  rewards: z.array(invitationRewardSnapshotSchema).max(MAX_REWARDS),
  updated_at: z.string().datetime().nullable(),
})

function parseInvitationSettingsSnapshot(value: unknown): InvitationSettings {
  const parsed = invitationSettingsSnapshotSchema.safeParse(value)
  if (!parsed.success) throw new Error(`Invitation settings snapshot is invalid: ${parsed.error.issues[0]?.message ?? 'unknown schema error'}`)
  return parsed.data
}

let schemaReady: Promise<void> | null = null

export function normalizeInvitationCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim().toUpperCase()
  return /^[0-9A-HJKMNP-TV-Z]{10}$/.test(code) ? code : null
}

export function normalizeInvitationSettings(value: unknown): InvitationSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return cloneSettings(DEFAULT_INVITATION_SETTINGS)
  const source = value as Record<string, unknown>
  const rewards = source.version === 2
    ? normalizeStoredV2Rewards(source.rewards)
    : normalizeLegacyRewards(source.rewards)
  return {
    version: 2,
    revision: integerInRange(source.revision, 0, Number.MAX_SAFE_INTEGER, 0),
    enabled: source.enabled !== false,
    activation_rule: 'first_active_profile',
    daily_inviter_reward_limit: integerInRange(source.daily_inviter_reward_limit, 1, 1000, 10),
    rewards,
    updated_at: typeof source.updated_at === 'string' ? source.updated_at : null,
  }
}

export function validateInvitationSettingsPatch(value: unknown): InvitationSettingsPatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('邀请设置必须是对象。')
  const source = value as Record<string, unknown>
  const patch: InvitationSettingsPatch = {}
  if ('enabled' in source) {
    if (typeof source.enabled !== 'boolean') throw new Error('启用状态必须是布尔值。')
    patch.enabled = source.enabled
  }
  if ('daily_inviter_reward_limit' in source) {
    patch.daily_inviter_reward_limit = requireInteger(source.daily_inviter_reward_limit, 1, 1000, '每日邀请奖励上限')
  }
  if ('rewards' in source) {
    if (!Array.isArray(source.rewards)) throw new Error('奖励配置必须是数组。')
    if (source.rewards.length > MAX_REWARDS) throw new Error(`奖励配置最多包含 ${MAX_REWARDS} 项。`)
    const seen = new Set<string>()
    const counts = new Map<InvitationRewardRecipient, number>([['inviter', 0], ['invitee', 0]])
    patch.rewards = source.rewards.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('奖励配置项必须是对象。')
      const reward = item as Record<string, unknown>
      if (reward.recipient !== 'inviter' && reward.recipient !== 'invitee') throw new Error('奖励对象无效。')
      const itemCode = requireString(reward.item_code, 1, 128, '道具代码')
      const key = `${reward.recipient}:${itemCode}`
      if (seen.has(key)) throw new Error('同一奖励对象和道具不能重复。')
      seen.add(key)
      const recipientCount = (counts.get(reward.recipient) ?? 0) + 1
      counts.set(reward.recipient, recipientCount)
      if (recipientCount > MAX_REWARDS_PER_RECIPIENT) throw new Error(`每个奖励对象最多配置 ${MAX_REWARDS_PER_RECIPIENT} 项道具。`)
      return {
        recipient: reward.recipient,
        item_code: itemCode,
        quantity: requireInteger(reward.quantity, 1, 10_000, '奖励数量'),
        expiry: requireExpiry(reward.expiry),
        gift_pack_version_id: reward.gift_pack_version_id === null || reward.gift_pack_version_id === undefined
          ? null
          : requireString(reward.gift_pack_version_id, 1, 128, '礼包版本'),
      }
    })
  }
  if (Object.keys(patch).length === 0) throw new Error('没有需要保存的邀请设置。')
  return patch
}

async function getInvitationSettings(): Promise<InvitationSettings> {
  await ensureSchema()
  const result = await query<{ record_json: unknown; revision: number }>(
    'select record_json, revision from invitation_settings where key = $1',
    [INVITATION_SETTINGS_KEY],
  )
  const row = result.rows[0]
  return { ...normalizeInvitationSettings(row?.record_json), revision: row?.revision ?? 0 }
}

async function getInvitationSettingsInTransaction(client: PoolClient): Promise<InvitationSettings> {
  const result = await client.query<{ record_json: unknown; revision: number }>(
    'select record_json, revision from invitation_settings where key = $1',
    [INVITATION_SETTINGS_KEY],
  )
  const row = result.rows[0]
  return { ...normalizeInvitationSettings(row?.record_json), revision: row?.revision ?? 0 }
}

async function getInvitationRewardCatalog(): Promise<InvitationRewardCatalogItem[]> {
  await ensureSchema()
  const result = await query<{
    item_code: string
    name: string
    description: string
    kind: InvitationRewardCatalogItem['kind']
    icon_key: string
    issuance_enabled: boolean
    version_id: string | null
    version: number | null
    version_status: 'published' | null
    contents: InvitationGiftPackSummary['contents'] | null
  }>(catalogQuery())
  return result.rows.map(catalogRow)
}

async function getInvitationRewardCatalogInTransaction(client: PoolClient): Promise<InvitationRewardCatalogItem[]> {
  const result = await client.query<{
    item_code: string
    name: string
    description: string
    kind: InvitationRewardCatalogItem['kind']
    icon_key: string
    issuance_enabled: boolean
    version_id: string | null
    version: number | null
    version_status: 'published' | null
    contents: InvitationGiftPackSummary['contents'] | null
  }>(catalogQuery())
  return result.rows.map(catalogRow)
}

export async function getAdminInvitationSettingsOverview(): Promise<{
  settings: InvitationSettings
  catalog: InvitationRewardCatalogItem[]
  configured_gift_pack_versions: InvitationGiftPackSummary[]
}> {
  const [settings, catalog] = await Promise.all([getInvitationSettings(), getInvitationRewardCatalog()])
  const configuredGiftPackVersions = await loadGiftPackSummaries(settings.rewards.flatMap((reward) => reward.gift_pack_version_id ? [reward.gift_pack_version_id] : []))
  return { settings, catalog, configured_gift_pack_versions: [...configuredGiftPackVersions.values()] }
}

export async function saveInvitationSettings(
  adminUsername: string,
  patch: InvitationSettingsPatch,
  expectedRevision: number,
): Promise<InvitationSettings> {
  await ensureSchema()
  return withTransaction(async (client) => {
    const currentResult = await client.query<{ record_json: unknown; revision: number }>(
      'select record_json, revision from invitation_settings where key = $1 for update',
      [INVITATION_SETTINGS_KEY],
    )
    const currentRow = currentResult.rows[0]
    const currentRevision = currentRow?.revision ?? 0
    if (currentRevision !== expectedRevision) throw new SettingsConflictError()
    const current = { ...normalizeInvitationSettings(currentRow?.record_json), revision: currentRevision }
    const rewards = patch.rewards === undefined ? current.rewards : await snapshotRewardRules(client, patch.rewards)
    const next: InvitationSettings = {
      version: 2,
      revision: currentRevision + 1,
      enabled: patch.enabled ?? current.enabled,
      activation_rule: 'first_active_profile',
      daily_inviter_reward_limit: patch.daily_inviter_reward_limit ?? current.daily_inviter_reward_limit,
      rewards,
      updated_at: new Date().toISOString(),
    }
    if (next.enabled && next.rewards.length === 0) throw new InventoryError('invitation_rewards_missing', '启用邀请活动前至少要为一方配置一项奖励。', 409)
    const saved = await client.query(
      `insert into invitation_settings (key, record_json, updated_at, revision)
       values ($1, $2::jsonb, $3, $4)
       on conflict (key) do update
         set record_json = excluded.record_json, updated_at = excluded.updated_at, revision = excluded.revision
       where invitation_settings.revision = $5`,
      [INVITATION_SETTINGS_KEY, JSON.stringify(next), next.updated_at, next.revision, expectedRevision],
    )
    if (saved.rowCount !== 1) throw new SettingsConflictError()
    await client.query(
      `insert into inventory_admin_audit
        (id, admin_username, action, target_type, target_id, reason, before_json, after_json, created_at)
       values ($1, $2, 'update_invitation_settings', 'invitation_settings', $3, $4, $5::jsonb, $6::jsonb, $7)`,
      [randomUUID(), adminUsername, INVITATION_SETTINGS_KEY, '更新邀请活动与奖励配置。', JSON.stringify(current), JSON.stringify(next), next.updated_at],
    )
    return next
  })
}

export async function assertInvitationItemCanBeDisabled(client: PoolClient, itemCode: string): Promise<void> {
  const settingsResult = await client.query<{ record_json: unknown }>(
    'select record_json from invitation_settings where key = $1 for update', [INVITATION_SETTINGS_KEY],
  )
  const settings = normalizeInvitationSettings(settingsResult.rows[0]?.record_json)
  if (settings.enabled && settings.rewards.some((reward) => reward.item_code === itemCode)) {
    throw new InventoryError('item_used_by_invitation', '该道具正在被启用的邀请活动使用，请先暂停或修改邀请配置。', 409)
  }
}

export async function assertInvitationGiftVersionCanBeRetired(client: PoolClient, versionId: string): Promise<void> {
  const settingsResult = await client.query<{ record_json: unknown }>(
    'select record_json from invitation_settings where key = $1 for update', [INVITATION_SETTINGS_KEY],
  )
  const settings = normalizeInvitationSettings(settingsResult.rows[0]?.record_json)
  if (settings.enabled && settings.rewards.some((reward) => reward.gift_pack_version_id === versionId)) {
    throw new InventoryError('gift_pack_used_by_invitation', '该礼包版本正在被启用的邀请活动使用，请先暂停或修改邀请配置。', 409)
  }
}

export async function validateInvitationCode(value: unknown): Promise<ValidatedInvitationCode | null> {
  if (value === undefined || value === null || value === '') return null
  const code = normalizeInvitationCode(value)
  if (!code) throw new InvitationCodeError('invalid_invite_code', '邀请码无效，请检查后重试。')
  const settings = await getInvitationSettings()
  if (!settings.enabled) throw new InvitationCodeError('invitation_campaign_paused', '邀请活动暂时暂停，请稍后再试。')
  await ensureSchema()
  const result = await query<{ user_id: string }>(
    `select code.user_id
       from invitation_codes code
       join user_accounts account on account.id = code.user_id and account.status = 'active'
      where code.code = $1
        and code.status = 'active'
        and exists (
          select 1 from user_game_accounts profile
           where profile.user_id = code.user_id and profile.status = 'active'
             and coalesce(profile.record_json->>'kind', 'cdk') in ('cdk', 'free_preview')
        )`,
    [code],
  )
  const row = result.rows[0]
  if (!row) throw new InvitationCodeError('invalid_invite_code', '这个邀请码当前无法使用，请联系分享者获取新的邀请链接。')
  return { code, inviter_user_id: row.user_id }
}

export async function saveRegistrationWithInvitation(user: UserAccountRecord, invitation: ValidatedInvitationCode): Promise<void> {
  await ensureSchema()
  await withTransaction(async (client) => {
    await saveUserAccountInTransaction(client, user)
    await saveInvitationInTransaction(client, user.id, invitation)
  })
}

export async function saveInvitationInTransaction(client: PoolClient, inviteeUserId: string, invitation: ValidatedInvitationCode): Promise<void> {
  if (invitation.inviter_user_id === inviteeUserId) throw new InvitationCodeError('invalid_invite_code', '不能使用自己的邀请码，请填写好友的邀请码。')
  const now = new Date().toISOString()
  await client.query(
    `insert into invitations
      (id, inviter_user_id, invitee_user_id, invitation_code, status, registered_at, updated_at)
     values ($1, $2, $3, $4, 'registered', $5, $5)`,
    [randomUUID(), invitation.inviter_user_id, inviteeUserId, invitation.code, now],
  )
}

export async function ensureInvitationCode(userId: string): Promise<string> {
  await ensureSchema()
  if (!(await userCanInvite(userId))) throw new InvitationCodeError('invalid_invite_code', '请先兑换 CDK，或绑定森空岛并激活免费档案，再生成邀请链接。')
  return withTransaction(async (client) => {
    const existing = await client.query<{ code: string }>('select code from invitation_codes where user_id = $1 for update', [userId])
    if (existing.rows[0]) return existing.rows[0].code
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = createInviteCode()
      const now = new Date().toISOString()
      const inserted = await client.query<{ code: string }>(
        `insert into invitation_codes (user_id, code, status, created_at, updated_at)
         values ($1, $2, 'active', $3, $3) on conflict do nothing returning code`,
        [userId, code, now],
      )
      if (inserted.rows[0]) {
        await insertInvitationCodeAudit(client, userId, 'create', null, code, now)
        return inserted.rows[0].code
      }
      const concurrent = await client.query<{ code: string }>('select code from invitation_codes where user_id = $1 for update', [userId])
      if (concurrent.rows[0]) return concurrent.rows[0].code
    }
    throw new Error('生成邀请码失败，请稍后重试。')
  })
}

export async function manageInvitationCode(
  userId: string,
  action: 'rotate' | 'pause' | 'resume',
  now = new Date(),
): Promise<{ code: string; status: 'active' | 'paused' }> {
  await ensureSchema()
  if (action !== 'pause' && !(await userCanInvite(userId))) {
    throw new InvitationCodeError('invalid_invite_code', '请先兑换 CDK，或绑定森空岛并激活免费档案，再管理邀请码。')
  }
  return withTransaction(async (client) => {
    const currentResult = await client.query<{
      code: string
      status: 'active' | 'paused'
      rotated_at: string | null
    }>('select code, status, rotated_at::text from invitation_codes where user_id = $1 for update', [userId])
    const current = currentResult.rows[0]
    if (!current) throw new InvitationCodeError('invalid_invite_code', '还没有邀请码，请先生成邀请链接。')
    const nowIso = now.toISOString()
    if (action === 'pause' || action === 'resume') {
      const status = action === 'pause' ? 'paused' : 'active'
      if (current.status !== status) {
        await client.query(
          `update invitation_codes
              set status = $2,
                  revoked_at = case when $2 = 'paused' then $3::timestamptz else null end,
                  updated_at = $3::timestamptz
            where user_id = $1`,
          [userId, status, nowIso],
        )
        await insertInvitationCodeAudit(client, userId, action, current.code, current.code, nowIso)
      }
      return { code: current.code, status }
    }
    if (current.rotated_at && now.getTime() - Date.parse(current.rotated_at) < INVITE_CODE_ROTATION_COOLDOWN_MS) {
      throw new InvitationCodeError('rotation_cooldown', '每 24 小时只能更换一次邀请码，请稍后再试。')
    }
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const nextCode = createInviteCode()
      await client.query('savepoint invitation_code_rotation')
      let updated: { rows: Array<{ code: string }> }
      try {
        updated = await client.query<{ code: string }>(
          `update invitation_codes
              set code = $2, status = 'active', rotated_at = $3, revoked_at = null, updated_at = $3
            where user_id = $1
            returning code`,
          [userId, nextCode, nowIso],
        )
        await client.query('release savepoint invitation_code_rotation')
      } catch (error) {
        await client.query('rollback to savepoint invitation_code_rotation')
        await client.query('release savepoint invitation_code_rotation')
        if (!isUniqueViolation(error)) throw error
        continue
      }
      if (updated.rows[0]) {
        await insertInvitationCodeAudit(client, userId, 'rotate', current.code, nextCode, nowIso)
        return { code: nextCode, status: 'active' }
      }
    }
    throw new Error('更换邀请码失败，请稍后重试。')
  })
}

async function insertInvitationCodeAudit(
  client: PoolClient,
  userId: string,
  action: 'create' | 'rotate' | 'pause' | 'resume',
  previousCode: string | null,
  nextCode: string | null,
  now: string,
): Promise<void> {
  await client.query(
    `insert into invitation_code_audit
      (id, user_id, action, previous_code_hash, next_code_hash, created_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), userId, action, hashInviteCode(previousCode), hashInviteCode(nextCode), now],
  )
}

export async function getInvitationSummary(
  userId: string,
  options: { cursor?: string | null; limit?: number } = {},
): Promise<InvitationSummary> {
  await ensureSchema()
  const limit = integerInRange(options.limit, 1, 50, 20)
  const cursor = decodeCursor(options.cursor)
  const now = new Date()
  const nowIso = now.toISOString()
  return withTransaction(async (client) => {
    await client.query('set transaction isolation level repeatable read read only')
    const settings = await getInvitationSettingsInTransaction(client)
    const canInvite = await userCanInviteInTransaction(client, userId)
    const codeResult = await client.query<{ code: string; status: 'active' | 'paused' }>(
      'select code, status from invitation_codes where user_id = $1', [userId],
    )
    const catalog = await getInvitationRewardCatalogInTransaction(client)
    const statsResult = await client.query<{ registered: string; activated: string; rewarded: string; today_rewarded: string }>(
        `select count(*)::text as registered,
                count(*) filter (where activated_at is not null)::text as activated,
                count(*) filter (where inviter_rewarded_at is not null)::text as rewarded,
                count(*) filter (where inviter_rewarded_at is not null
                  and (inviter_rewarded_at at time zone 'Asia/Shanghai')::date = ($2::timestamptz at time zone 'Asia/Shanghai')::date)::text as today_rewarded
           from invitations where inviter_user_id = $1`,
      [userId, nowIso],
    )
    const recordsResult = await client.query<{
        id: string
        registered_at: string
        activated_at: string | null
        status: InvitationRow['status']
        settings_snapshot: unknown
        settlement_json: unknown
        attempt_count: number
        next_retry_at: string | null
        last_error: string | null
      }>(
        `select id, registered_at, activated_at, status, settings_snapshot, settlement_json,
                attempt_count, next_retry_at::text, last_error
           from invitations
          where inviter_user_id = $1
            and ($2::timestamptz is null or (registered_at, id) < ($2::timestamptz, $3::text))
          order by registered_at desc, id desc limit $4`,
      [userId, cursor?.registered_at ?? null, cursor?.id ?? null, limit + 1],
    )
    const codeRow = codeResult.rows[0]
    const code = codeRow?.code ?? null
    const stats = statsResult.rows[0]
    const rows = recordsResult.rows.slice(0, limit)
    const recordSnapshots = rows.map((row) => normalizeInvitationSettings(row.settings_snapshot))
    const giftPackVersions = await loadGiftPackSummariesInTransaction(client, [
      ...settings.rewards,
      ...recordSnapshots.flatMap((snapshot) => snapshot.rewards),
    ].flatMap((reward) => reward.gift_pack_version_id ? [reward.gift_pack_version_id] : []))
    const used = Number(stats?.today_rewarded ?? 0)
    const previews = previewRewards(settings.rewards, catalog, giftPackVersions)
    return {
      as_of: nowIso,
      can_invite: canInvite && settings.enabled,
      campaign_enabled: settings.enabled,
      code,
      code_status: codeRow?.status ?? null,
      share_url: code && codeRow?.status === 'active' ? `/tool/profiles?invite=${encodeURIComponent(code)}` : null,
      reward_preview: {
        inviter: previews.filter((item) => item.recipient === 'inviter').map(({ recipient: _recipient, ...item }) => item),
        invitee: previews.filter((item) => item.recipient === 'invitee').map(({ recipient: _recipient, ...item }) => item),
      },
      stats: {
        registered: Number(stats?.registered ?? 0),
        activated: Number(stats?.activated ?? 0),
        rewarded_invitations: Number(stats?.rewarded ?? 0),
        today_rewarded: used,
      },
      daily_limit: {
        used,
        limit: settings.daily_inviter_reward_limit,
        remaining: Math.max(0, settings.daily_inviter_reward_limit - used),
        reset_at: nextShanghaiMidnight(now),
      },
      records: rows.map((row) => invitationRecord(row, settings.enabled, catalog, giftPackVersions)),
      next_cursor: recordsResult.rows.length > limit && rows.length > 0
        ? encodeCursor({ registered_at: rows.at(-1)!.registered_at, id: rows.at(-1)!.id })
        : null,
    }
  })
}

export async function getPriorityCouponBalances(userId: string, now = new Date()): Promise<PriorityCouponBalance[]> {
  await ensureSchema()
  const result = await query<{ available: string; permanent: string; next_expiry_at: string | null }>(
    `select coalesce(sum(remaining_quantity), 0)::text as available,
            coalesce(sum(remaining_quantity) filter (where expires_at is null), 0)::text as permanent,
            min(expires_at) filter (where expires_at > $3) as next_expiry_at
       from reward_grants
      where user_id = $1 and reward_type = $2 and remaining_quantity > 0
        and (expires_at is null or expires_at > $3)`,
    [userId, PRIORITY_COMPUTE_COUPON, now.toISOString()],
  )
  const row = result.rows[0]
  return [{
    type: PRIORITY_COMPUTE_COUPON,
    available: Number(row?.available ?? 0),
    permanent: Number(row?.permanent ?? 0),
    next_expiry_at: row?.next_expiry_at ?? null,
  }]
}

export async function activateInvitationForUser(userId: string): Promise<boolean> {
  await ensureSchema()
  return withTransaction(async (client) => {
    const invitationResult = await client.query<InvitationRow>(
      `select id, inviter_user_id, invitee_user_id, status, activated_at, settings_snapshot,
              attempt_count, next_retry_at, processing_started_at, last_error, dead_lettered_at
         from invitations where invitee_user_id = $1 for update`,
      [userId],
    )
    const invitation = invitationResult.rows[0]
    if (!invitation || invitation.status !== 'registered') return false
    if (!(await userHasActiveSklandProfile(client, userId))) return false
    const snapshot = await getInvitationSettingsInTransaction(client)
    const activatedAt = new Date().toISOString()
    await client.query(
      `update invitations
          set status = 'activated', activated_at = $2, settings_snapshot = $3::jsonb,
              next_retry_at = $2, updated_at = $2
        where id = $1 and status = 'registered'`,
      [invitation.id, activatedAt, JSON.stringify(snapshot)],
    )
    return true
  })
}

export async function processInvitationSettlementBatch(limit = 100): Promise<number> {
  await ensureSchema()
  const batchLimit = Math.max(1, Math.min(limit, 100))
  await reconcileRegisteredInvitations(batchLimit)
  const settings = await getInvitationSettings()
  if (!settings.enabled) return 0
  let processed = 0
  for (let index = 0; index < batchLimit; index += 1) {
    const claimed = await claimInvitationSettlement()
    if (!claimed) break
    try {
      await withTransaction(async (client) => {
        const result = await client.query<InvitationRow>(
          `select id, inviter_user_id, invitee_user_id, status, activated_at, settings_snapshot,
                  attempt_count, next_retry_at, processing_started_at, last_error, dead_lettered_at
             from invitations
            where id = $1 and status = 'processing' and attempt_count = $2
            for update`,
          [claimed.id, claimed.attempt_count],
        )
        const invitation = result.rows[0]
        if (!invitation) return
        await settleInvitationInTransaction(client, invitation, parseInvitationSettingsSnapshot(invitation.settings_snapshot))
      })
    } catch (error) {
      await recordInvitationSettlementFailure(claimed, error)
    }
    processed += 1
  }
  return processed
}

export async function replayInvitationSettlement(
  adminUsername: string,
  invitationId: string,
  reason: string,
  now = new Date(),
): Promise<boolean> {
  await ensureSchema()
  return withTransaction(async (client) => {
    const before = await client.query<{
      status: InvitationRow['status']
      attempt_count: number
      last_error: string | null
      dead_lettered_at: string | null
      legacy_snapshot_unavailable: boolean
    }>(
      `select status, attempt_count, last_error, dead_lettered_at::text, legacy_snapshot_unavailable
         from invitations where id = $1 for update`,
      [invitationId],
    )
    const current = before.rows[0]
    if (!current
      || current.legacy_snapshot_unavailable
      || (current.status !== 'failed' && current.status !== 'dead_letter')) return false
    const nowIso = now.toISOString()
    await client.query(
      `update invitations
          set status = 'activated', attempt_count = 0, next_retry_at = $2,
              processing_started_at = null, last_error = null, dead_lettered_at = null, updated_at = $2
        where id = $1`,
      [invitationId, nowIso],
    )
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ action: 'replay_settlement', adminUsername, invitationId, reason }))
      .digest('hex')
    await client.query(
      `insert into admin_registration_invitation_audit
        (id, invitation_id, admin_username, action, reason, request_hash, before_json, after_json, created_at)
       values ($1, $2, $3, 'replay_settlement', $4, $5, $6::jsonb, $7::jsonb, $8)`,
      [
        randomUUID(), invitationId, adminUsername, reason, requestHash, JSON.stringify(current),
        JSON.stringify({ status: 'activated', attempt_count: 0, next_retry_at: nowIso }), nowIso,
      ],
    )
    return true
  })
}

async function reconcileRegisteredInvitations(limit: number): Promise<number> {
  return withTransaction(async (client) => {
    const snapshot = await getInvitationSettingsInTransaction(client)
    const now = new Date().toISOString()
    const result = await client.query(
      `with candidates as (
         select invitation.id
           from invitations invitation
          where invitation.status = 'registered'
            and exists (
              select 1 from user_game_accounts profile
               where profile.user_id = invitation.invitee_user_id
                 and profile.status = 'active'
                 and coalesce(profile.kind, profile.record_json->>'kind', 'cdk') in ('cdk', 'free_preview')
                 and profile.record_json->'skland_binding' is not null
            )
          order by invitation.registered_at asc, invitation.id asc
          for update skip locked
          limit $1
       )
       update invitations invitation
          set status = 'activated', activated_at = $2, settings_snapshot = $3::jsonb,
              next_retry_at = $2, updated_at = $2
         from candidates
        where invitation.id = candidates.id`,
      [limit, now, JSON.stringify(snapshot)],
    )
    return result.rowCount ?? 0
  })
}

async function claimInvitationSettlement(now = new Date()): Promise<InvitationRow | null> {
  const nowIso = now.toISOString()
  const leaseExpiredBefore = new Date(now.getTime() - SETTLEMENT_LEASE_MS).toISOString()
  return withTransaction(async (client) => {
    await client.query(
      `update invitations
          set status = 'dead_letter', dead_lettered_at = $1, processing_started_at = null,
              next_retry_at = null, last_error = coalesce(last_error, 'Settlement lease expired after the final attempt'),
              updated_at = $1
        where status = 'processing' and processing_started_at <= $2 and attempt_count >= $3`,
      [nowIso, leaseExpiredBefore, MAX_SETTLEMENT_ATTEMPTS],
    )
    const result = await client.query<InvitationRow>(
      `with candidate as (
         select id
           from invitations
          where attempt_count < $3
            and (
              status = 'activated'
              or (status = 'failed' and coalesce(next_retry_at, activated_at) <= $1)
              or (status = 'processing' and processing_started_at <= $2)
            )
          order by coalesce(next_retry_at, activated_at) asc, activated_at asc, id asc
          for update skip locked
          limit 1
       )
       update invitations invitation
          set status = 'processing', attempt_count = invitation.attempt_count + 1,
              processing_started_at = $1, next_retry_at = null, last_error = null, updated_at = $1
         from candidate
        where invitation.id = candidate.id
        returning invitation.id, invitation.inviter_user_id, invitation.invitee_user_id,
                  invitation.status, invitation.activated_at::text, invitation.settings_snapshot,
                  invitation.attempt_count, invitation.next_retry_at::text,
                  invitation.processing_started_at::text, invitation.last_error,
                  invitation.dead_lettered_at::text`,
      [nowIso, leaseExpiredBefore, MAX_SETTLEMENT_ATTEMPTS],
    )
    return result.rows[0] ?? null
  })
}

async function recordInvitationSettlementFailure(claimed: InvitationRow, error: unknown, now = new Date()): Promise<void> {
  const deadLettered = claimed.attempt_count >= MAX_SETTLEMENT_ATTEMPTS
  const nowIso = now.toISOString()
  const nextRetryAt = deadLettered
    ? null
    : new Date(now.getTime() + settlementRetryDelayMs(claimed.attempt_count)).toISOString()
  await query(
    `update invitations
        set status = $3, next_retry_at = $4::timestamptz, processing_started_at = null,
            last_error = $5, dead_lettered_at = case when $3 = 'dead_letter' then $6::timestamptz else null end,
            updated_at = $6::timestamptz
      where id = $1 and status = 'processing' and attempt_count = $2`,
    [
      claimed.id,
      claimed.attempt_count,
      deadLettered ? 'dead_letter' : 'failed',
      nextRetryAt,
      safeSettlementError(error),
      nowIso,
    ],
  )
}

function settlementRetryDelayMs(attempt: number): number {
  return Math.min(6 * 60 * 60 * 1000, 30_000 * 2 ** Math.max(0, attempt - 1))
}

function safeSettlementError(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return message.replace(/[\r\n\t]+/g, ' ').slice(0, 500)
}

async function settleInvitationInTransaction(
  client: PoolClient,
  invitation: InvitationRow,
  snapshot: InvitationSettings,
): Promise<void> {
  if (invitation.status === 'settled') return
  const now = new Date().toISOString()
  const inviterRewards = snapshot.rewards.filter((reward) => reward.recipient === 'inviter')
  const inviteeRewards = snapshot.rewards.filter((reward) => reward.recipient === 'invitee')
  let inviterStatus: InviterRewardStatus = inviterRewards.length === 0 ? 'not_configured' : 'granted'
  if (inviterRewards.length > 0) {
    if (!invitation.inviter_user_id) {
      inviterStatus = 'inviter_ineligible'
    } else {
      const inviter = await client.query<{ status: string }>('select status from user_accounts where id = $1 for update', [invitation.inviter_user_id])
      if (inviter.rows[0]?.status !== 'active' || !(await userHasActiveProfile(client, invitation.inviter_user_id))) {
        inviterStatus = 'inviter_ineligible'
      } else {
        const daily = await client.query<{ count: string }>(
          `select count(*)::text as count from invitations
            where inviter_user_id = $1 and inviter_rewarded_at is not null
              and (inviter_rewarded_at at time zone 'Asia/Shanghai')::date = ($2::timestamptz at time zone 'Asia/Shanghai')::date`,
          [invitation.inviter_user_id, now],
        )
        if (Number(daily.rows[0]?.count ?? 0) >= snapshot.daily_inviter_reward_limit) inviterStatus = 'daily_limit_skipped'
      }
    }
  }

  await grantRewardGroups(client, invitation, inviterStatus, inviterRewards, inviteeRewards, now)

  const [inviterDescriptions, inviteeDescriptions] = await Promise.all([
    describeRewardsInTransaction(client, inviterStatus === 'granted' ? inviterRewards : []),
    describeRewardsInTransaction(client, inviteeRewards),
  ])
  const settlement = {
    version: 1,
    rewards: {
      inviter: { status: inviterStatus, items: inviterDescriptions },
      invitee: { status: inviteeRewards.length > 0 ? 'granted' : 'not_configured', items: inviteeDescriptions },
    },
  }
  await client.query(
    `update invitations set status = 'settled', settled_at = $2,
       inviter_rewarded_at = case when $3 then $2 else inviter_rewarded_at end,
       settlement_json = $4::jsonb, next_retry_at = null, processing_started_at = null,
       last_error = null, dead_lettered_at = null, updated_at = $2 where id = $1`,
    [invitation.id, now, inviterStatus === 'granted' && inviterRewards.length > 0, JSON.stringify(settlement)],
  )
}

async function grantRewardGroups(
  client: PoolClient,
  invitation: InvitationRow,
  inviterStatus: InviterRewardStatus,
  inviterRewards: InvitationRewardRule[],
  inviteeRewards: InvitationRewardRule[],
  now: string,
): Promise<void> {
  const groups: Array<{
    userId: string
    recipient: InvitationRewardRecipient
    rewards: InvitationRewardRule[]
  }> = [{ userId: invitation.invitee_user_id, recipient: 'invitee', rewards: inviteeRewards }]
  if (inviterStatus === 'granted' && invitation.inviter_user_id) {
    groups.unshift({ userId: invitation.inviter_user_id, recipient: 'inviter', rewards: inviterRewards })
  }
  await grantItemsInTransaction(client, groups.flatMap((group) => group.rewards.map((reward) => ({
    userId: group.userId,
    itemCode: reward.item_code,
    quantity: reward.quantity,
    expiry: reward.expiry,
    sourceType: 'invitation',
    sourceId: invitation.id,
    recipientRole: group.recipient,
    giftPackVersionId: reward.gift_pack_version_id,
    metadata: { invitation_snapshot: true, invitation_id: invitation.id, recipient: group.recipient },
    allowHistoricalSnapshot: true,
    now,
  }))))
}

async function snapshotRewardRules(client: PoolClient, rewards: InvitationRewardRule[]): Promise<InvitationRewardRule[]> {
  if (rewards.length === 0) return []
  const result: InvitationRewardRule[] = []
  const codes = [...new Set(rewards.map((reward) => reward.item_code))]
  const definitionsResult = await client.query<{ code: string; kind: string; issuance_enabled: boolean }>(
    'select code, kind, issuance_enabled from item_definitions where code = any($1::text[])',
    [codes],
  )
  const definitions = new Map(definitionsResult.rows.map((definition) => [definition.code, definition]))
  const giftPackCodes = definitionsResult.rows
    .filter((definition) => definition.kind === 'gift_pack')
    .map((definition) => definition.code)
  const versionsResult = giftPackCodes.length === 0
    ? { rows: [] as Array<{ id: string; item_code: string }> }
    : await client.query<{ id: string; item_code: string }>(
      `select distinct on (item_code) id, item_code
         from gift_pack_versions
        where item_code = any($1::text[]) and status = 'published'
        order by item_code, version desc`,
      [giftPackCodes],
    )
  const versions = new Map(versionsResult.rows.map((version) => [version.item_code, version.id]))
  for (const reward of rewards) {
    const definition = definitions.get(reward.item_code)
    if (!definition) throw new InventoryError('item_unknown', `道具 ${reward.item_code} 不存在。`, 404)
    if (!definition.issuance_enabled) throw new InventoryError('item_issuance_disabled', `道具 ${reward.item_code} 当前不可发放。`, 409)
    if (definition.kind === 'cosmetic' || definition.kind === 'badge') throw new InventoryError('item_kind_unavailable', '当前邀请活动不能发放主题装扮或成就勋章。', 409)
    let giftPackVersionId: string | null = null
    if (definition.kind === 'gift_pack') {
      giftPackVersionId = versions.get(reward.item_code) ?? null
      if (!giftPackVersionId) throw new InventoryError('gift_pack_version_unavailable', `礼包 ${reward.item_code} 没有可发放版本。`, 409)
    }
    result.push({ ...reward, gift_pack_version_id: giftPackVersionId })
  }
  return result
}

async function describeRewardsInTransaction(
  client: PoolClient,
  rewards: InvitationRewardRule[],
): Promise<InvitationRewardPreviewItem[]> {
  if (rewards.length === 0) return []
  const codes = rewards.map((reward) => reward.item_code)
  const definitions = await client.query<{
    code: string
    name: string
    description: string
    kind: InvitationRewardPreviewItem['kind']
    icon_key: string
    issuance_enabled: boolean
  }>('select code, name, description, kind, icon_key, issuance_enabled from item_definitions where code = any($1::text[])', [codes])
  const byCode = new Map(definitions.rows.map((item) => [item.code, item]))
  const versionIds = rewards.flatMap((reward) => reward.gift_pack_version_id ? [reward.gift_pack_version_id] : [])
  const versions = versionIds.length === 0 ? [] : (await client.query<{
    id: string
    version: number
    status: 'published' | 'retired'
    contents: InvitationGiftPackSummary['contents']
  }>(
    `select version.id, version.version, version.status,
            coalesce(jsonb_agg(jsonb_build_object(
              'item_code', content.item_code,
              'name', definition.name,
              'quantity', content.quantity,
              'expiry', case when content.validity_days = 0 then jsonb_build_object('mode', 'never')
                else jsonb_build_object('mode', 'relative_days', 'days', content.validity_days) end
            ) order by content.item_code) filter (where content.item_code is not null), '[]'::jsonb) as contents
       from gift_pack_versions version
       left join gift_pack_version_contents content on content.gift_pack_version_id = version.id
       left join item_definitions definition on definition.code = content.item_code
      where version.id = any($1::text[])
      group by version.id`,
    [versionIds],
  )).rows
  const versionsById = new Map(versions.map((version) => [version.id, version]))
  return rewards.flatMap((reward) => {
    const item = byCode.get(reward.item_code)
    if (!item) return []
    const giftPackVersion = reward.gift_pack_version_id ? versionsById.get(reward.gift_pack_version_id) : null
    return [{
      item_code: reward.item_code,
      name: item.name,
      description: item.description,
      kind: item.kind,
      icon_key: item.icon_key,
      quantity: reward.quantity,
      expiry: reward.expiry,
      gift_pack_version: giftPackVersion ? {
        id: giftPackVersion.id,
        version: Number(giftPackVersion.version),
        status: giftPackVersion.status,
        contents: Array.isArray(giftPackVersion.contents) ? giftPackVersion.contents : [],
      } : null,
      available: item.issuance_enabled,
    }]
  })
}

async function userCanInvite(userId: string): Promise<boolean> {
  await ensureSchema()
  const result = await query<{ eligible: boolean }>(
    `select exists (
       select 1 from user_accounts account
       where account.id = $1 and account.status = 'active'
         and exists (
           select 1 from user_game_accounts profile
            where profile.user_id = account.id and profile.status = 'active'
              and coalesce(profile.record_json->>'kind', 'cdk') in ('cdk', 'free_preview')
         )
     ) as eligible`,
    [userId],
  )
  return result.rows[0]?.eligible === true
}

async function userCanInviteInTransaction(client: PoolClient, userId: string): Promise<boolean> {
  const result = await client.query<{ eligible: boolean }>(
    `select exists (
       select 1 from user_accounts account
       where account.id = $1 and account.status = 'active'
         and exists (
           select 1 from user_game_accounts profile
            where profile.user_id = account.id and profile.status = 'active'
              and coalesce(profile.kind, profile.record_json->>'kind', 'cdk') in ('cdk', 'free_preview')
         )
     ) as eligible`,
    [userId],
  )
  return result.rows[0]?.eligible === true
}

async function userHasActiveProfile(client: PoolClient, userId: string): Promise<boolean> {
  const active = await client.query<{ active: boolean }>(
    `select exists (select 1 from user_game_accounts
      where user_id = $1 and status = 'active'
        and coalesce(record_json->>'kind', 'cdk') in ('cdk', 'free_preview')) as active`,
    [userId],
  )
  return active.rows[0]?.active === true
}

async function userHasActiveSklandProfile(client: PoolClient, userId: string): Promise<boolean> {
  const active = await client.query<{ active: boolean }>(
    `select exists (select 1 from user_game_accounts profile
      where profile.user_id = $1
        and profile.status = 'active'
        and coalesce(profile.kind, profile.record_json->>'kind', 'cdk') in ('cdk', 'free_preview')
        and profile.record_json->'skland_binding' is not null) as active`,
    [userId],
  )
  return active.rows[0]?.active === true
}

function previewRewards(
  rewards: InvitationRewardRule[],
  catalog: InvitationRewardCatalogItem[],
  giftPackVersions = new Map<string, InvitationGiftPackSummary>(),
): Array<InvitationRewardPreviewItem & { recipient: InvitationRewardRecipient }> {
  const byCode = new Map(catalog.map((item) => [item.item_code, item]))
  return rewards.map((reward) => {
    const item = byCode.get(reward.item_code)
    return {
      recipient: reward.recipient,
      item_code: reward.item_code,
      name: item?.name ?? reward.item_code,
      description: item?.description ?? '暂时无法读取该奖励的说明。',
      kind: item?.kind ?? 'consumable',
      icon_key: item?.icon_key ?? 'placeholder',
      quantity: reward.quantity,
      expiry: reward.expiry,
      gift_pack_version: reward.gift_pack_version_id
        ? giftPackVersions.get(reward.gift_pack_version_id)
          ?? (item?.latest_gift_pack_version?.id === reward.gift_pack_version_id ? item.latest_gift_pack_version : null)
        : null,
      available: item?.selectable === true,
    }
  })
}

function invitationRecord(
  row: {
    id: string
    registered_at: string
    activated_at: string | null
    status: InvitationRow['status']
    settings_snapshot: unknown
    settlement_json: unknown
    attempt_count: number
    next_retry_at: string | null
    last_error: string | null
  },
  campaignEnabled: boolean,
  catalog: InvitationRewardCatalogItem[],
  giftPackVersions: Map<string, InvitationGiftPackSummary>,
): InvitationRecordSummary {
  const settlement = row.settlement_json && typeof row.settlement_json === 'object'
    ? row.settlement_json as { rewards?: { inviter?: {
      status?: InviterRewardStatus
      items?: InvitationRewardPreviewItem[]
      planned?: number
      applied?: number
      reason?: string | null
    } } }
    : null
  let rewardStatus: InviterRewardStatus
  if (row.status === 'registered') rewardStatus = 'pending_activation'
  else if (row.status === 'dead_letter') rewardStatus = 'settlement_failed'
  else if (row.status === 'failed') rewardStatus = 'settlement_retry'
  else if (row.status === 'activated' || row.status === 'processing') rewardStatus = campaignEnabled ? 'settlement_pending' : 'pending_campaign_resume'
  else rewardStatus = settledInviterStatus(settlement?.rewards?.inviter)
  const settledItems = settlement?.rewards?.inviter?.items
  const snapshot = normalizeInvitationSettings(row.settings_snapshot)
  const pendingItems = previewRewards(snapshot.rewards.filter((reward) => reward.recipient === 'inviter'), catalog, giftPackVersions)
    .map(({ recipient: _recipient, ...item }) => item)
  return {
    id: row.id,
    invitee_label: `受邀好友 #${row.id.replaceAll('-', '').slice(0, 6).toUpperCase()}`,
    registered_at: row.registered_at,
    activated_at: row.activated_at,
    status: row.status,
    attempt_count: row.attempt_count,
    next_retry_at: row.next_retry_at,
    last_error: row.last_error,
    inviter_reward_status: rewardStatus,
    inviter_rewards: Array.isArray(settledItems)
      ? settledItems
      : row.status !== 'registered' || rewardStatus === 'granted' ? pendingItems : [],
  }
}

function settledInviterStatus(value: {
  status?: InviterRewardStatus
  planned?: number
  applied?: number
  reason?: string | null
} | undefined): InviterRewardStatus {
  if (value?.status) return value.status
  if (Number(value?.applied ?? 0) > 0) return 'granted'
  if (value?.reason === 'daily_limit') return 'daily_limit_skipped'
  if (value?.reason === 'inviter_ineligible') return 'inviter_ineligible'
  return Number(value?.planned ?? 0) > 0 ? 'settlement_pending' : 'not_configured'
}

function normalizeStoredV2Rewards(value: unknown): InvitationRewardRule[] {
  if (!Array.isArray(value)) return cloneSettings(DEFAULT_INVITATION_SETTINGS).rewards
  const result: InvitationRewardRule[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const reward = item as Record<string, unknown>
    if (reward.recipient !== 'inviter' && reward.recipient !== 'invitee') continue
    if (typeof reward.item_code !== 'string' || !reward.item_code.trim()) continue
    const expiry = normalizeExpiry(reward.expiry)
    if (!expiry || !Number.isInteger(reward.quantity) || Number(reward.quantity) < 1) continue
    result.push({
      recipient: reward.recipient,
      item_code: reward.item_code,
      quantity: Number(reward.quantity),
      expiry,
      gift_pack_version_id: typeof reward.gift_pack_version_id === 'string' ? reward.gift_pack_version_id : null,
    })
  }
  return result
}

function normalizeLegacyRewards(value: unknown): InvitationRewardRule[] {
  const rewards = Array.isArray(value) ? value : [
    { recipient: 'inviter', type: PRIORITY_COMPUTE_COUPON, quantity: 1, validity_days: 0 },
    { recipient: 'invitee', type: PRIORITY_COMPUTE_COUPON, quantity: 0, validity_days: 0 },
  ]
  const result: InvitationRewardRule[] = []
  for (const recipient of ['inviter', 'invitee'] as const) {
    const item = rewards.find((candidate) => candidate && typeof candidate === 'object'
      && (candidate as Record<string, unknown>).recipient === recipient
      && (candidate as Record<string, unknown>).type === PRIORITY_COMPUTE_COUPON) as Record<string, unknown> | undefined
    const quantity = integerInRange(item?.quantity, 0, 10_000, recipient === 'inviter' ? 1 : 0)
    if (quantity === 0) continue
    const days = integerInRange(item?.validity_days, 0, 3650, 0)
    result.push({
      recipient,
      item_code: PRIORITY_COMPUTE_COUPON,
      quantity,
      expiry: days === 0 ? { mode: 'never' } : { mode: 'relative_days', days },
      gift_pack_version_id: null,
    })
  }
  return result
}

function catalogQuery(): string {
  return `select definition.code as item_code, definition.name, definition.description, definition.kind,
                 definition.icon_key, definition.issuance_enabled,
                 version.id as version_id, version.version, version.status as version_status,
                 coalesce((select jsonb_agg(jsonb_build_object(
                   'item_code', content.item_code,
                   'name', content_definition.name,
                   'quantity', content.quantity,
                   'expiry', case when content.validity_days = 0 then jsonb_build_object('mode', 'never')
                     else jsonb_build_object('mode', 'relative_days', 'days', content.validity_days) end
                 ) order by content.item_code)
                   from gift_pack_version_contents content
                   join item_definitions content_definition on content_definition.code = content.item_code
                  where content.gift_pack_version_id = version.id), '[]'::jsonb) as contents
            from item_definitions definition
            left join lateral (
              select id, version, status from gift_pack_versions
               where item_code = definition.code and status = 'published'
               order by version desc limit 1
            ) version on true
           where definition.kind in ('consumable', 'capacity_upgrade', 'gift_pack')
           order by case definition.kind when 'consumable' then 1 when 'capacity_upgrade' then 2 else 3 end,
                    definition.system_owned desc, definition.created_at asc, definition.code asc`
}

function catalogRow(row: {
  item_code: string
  name: string
  description: string
  kind: InvitationRewardCatalogItem['kind']
  icon_key: string
  issuance_enabled: boolean
  version_id: string | null
  version: number | null
  version_status: 'published' | null
  contents: InvitationGiftPackSummary['contents'] | null
}): InvitationRewardCatalogItem {
  const giftPackAvailable = row.kind !== 'gift_pack' || Boolean(row.version_id)
  const selectable = row.issuance_enabled && giftPackAvailable
  return {
    item_code: row.item_code,
    name: row.name,
    description: row.description,
    kind: row.kind,
    icon_key: row.icon_key,
    issuance_enabled: row.issuance_enabled,
    selectable,
    unavailable_reason: selectable ? null : !row.issuance_enabled ? '道具已停发。' : '礼包没有已发布版本。',
    latest_gift_pack_version: row.version_id ? {
      id: row.version_id,
      version: Number(row.version ?? 0),
      status: row.version_status ?? 'published',
      contents: Array.isArray(row.contents) ? row.contents : [],
    } : null,
  }
}

async function loadGiftPackSummaries(versionIds: string[]): Promise<Map<string, InvitationGiftPackSummary>> {
  const uniqueIds = [...new Set(versionIds)]
  if (uniqueIds.length === 0) return new Map()
  const result = await query<{
    id: string
    version: number
    status: 'published' | 'retired'
    contents: InvitationGiftPackSummary['contents']
  }>(
    `select version.id, version.version, version.status,
            coalesce(jsonb_agg(jsonb_build_object(
              'item_code', content.item_code,
              'name', definition.name,
              'quantity', content.quantity,
              'expiry', case when content.validity_days = 0 then jsonb_build_object('mode', 'never')
                else jsonb_build_object('mode', 'relative_days', 'days', content.validity_days) end
            ) order by content.item_code) filter (where content.item_code is not null), '[]'::jsonb) as contents
       from gift_pack_versions version
       left join gift_pack_version_contents content on content.gift_pack_version_id = version.id
       left join item_definitions definition on definition.code = content.item_code
      where version.id = any($1::text[])
      group by version.id`,
    [uniqueIds],
  )
  return new Map(result.rows.map((version) => [version.id, {
    id: version.id,
    version: Number(version.version),
    status: version.status,
    contents: Array.isArray(version.contents) ? version.contents : [],
  }]))
}

async function loadGiftPackSummariesInTransaction(
  client: PoolClient,
  versionIds: string[],
): Promise<Map<string, InvitationGiftPackSummary>> {
  const uniqueIds = [...new Set(versionIds)]
  if (uniqueIds.length === 0) return new Map()
  const result = await client.query<{
    id: string
    version: number
    status: 'published' | 'retired'
    contents: InvitationGiftPackSummary['contents']
  }>(
    `select version.id, version.version, version.status,
            coalesce(jsonb_agg(jsonb_build_object(
              'item_code', content.item_code,
              'name', definition.name,
              'quantity', content.quantity,
              'expiry', case when content.validity_days = 0 then jsonb_build_object('mode', 'never')
                else jsonb_build_object('mode', 'relative_days', 'days', content.validity_days) end
            ) order by content.item_code) filter (where content.item_code is not null), '[]'::jsonb) as contents
       from gift_pack_versions version
       left join gift_pack_version_contents content on content.gift_pack_version_id = version.id
       left join item_definitions definition on definition.code = content.item_code
      where version.id = any($1::text[])
      group by version.id`,
    [uniqueIds],
  )
  return new Map(result.rows.map((version) => [version.id, {
    id: version.id,
    version: Number(version.version),
    status: version.status,
    contents: Array.isArray(version.contents) ? version.contents : [],
  }]))
}

function createInviteCode(): string {
  const bytes = randomBytes(INVITE_CODE_LENGTH)
  let code = ''
  for (const value of bytes) code += CROCKFORD_ALPHABET[value % CROCKFORD_ALPHABET.length]
  return code
}

function hashInviteCode(code: string | null): string | null {
  return code ? createHash('sha256').update(code).digest('hex') : null
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === '23505')
}

function normalizeExpiry(value: unknown): InvitationExpiryPolicy | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const expiry = value as Record<string, unknown>
  if (expiry.mode === 'never') return { mode: 'never' }
  if (expiry.mode !== 'relative_days' || !Number.isInteger(expiry.days)) return null
  const days = Number(expiry.days)
  return days >= 1 && days <= 3650 ? { mode: 'relative_days', days } : null
}

function requireExpiry(value: unknown): InvitationExpiryPolicy {
  const expiry = normalizeExpiry(value)
  if (!expiry) throw new Error('有效期必须明确设置为永久或 1 到 3650 天。')
  return expiry
}

function integerInRange(value: unknown, min: number, max: number, fallback: number): number {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max ? Number(value) : fallback
}

function requireInteger(value: unknown, min: number, max: number, label: string): number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new Error(`${label}必须是 ${min} 到 ${max} 之间的整数。`)
  return Number(value)
}

function requireString(value: unknown, min: number, max: number, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label}格式不正确。`)
  const normalized = value.trim()
  if (normalized.length < min || normalized.length > max) throw new Error(`${label}长度必须为 ${min}-${max} 个字符。`)
  return normalized
}

function encodeCursor(value: { registered_at: string; id: string }): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decodeCursor(value: string | null | undefined): { registered_at: string; id: string } | null {
  if (!value) return null
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>
    if (typeof decoded.registered_at !== 'string' || !Number.isFinite(Date.parse(decoded.registered_at))
      || typeof decoded.id !== 'string' || decoded.id.length < 1 || decoded.id.length > 128) throw new Error('invalid')
    return { registered_at: decoded.registered_at, id: decoded.id }
  } catch {
    throw new InvitationCodeError('invalid_cursor', '邀请记录已更新，请刷新页面后重试。')
  }
}

function nextShanghaiMidnight(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day) + 1) - 8 * 60 * 60_000).toISOString()
}

function cloneSettings(settings: InvitationSettings): InvitationSettings {
  return JSON.parse(JSON.stringify(settings)) as InvitationSettings
}

function ensureSchema(): Promise<void> {
  schemaReady ??= ensureDatabaseSchema().catch((error) => {
    schemaReady = null
    throw error
  })
  return schemaReady
}

type InvitationRow = {
  id: string
  inviter_user_id: string | null
  invitee_user_id: string
  status: 'registered' | 'activated' | 'processing' | 'failed' | 'settled' | 'dead_letter'
  activated_at: string | null
  settings_snapshot: unknown
  attempt_count: number
  next_retry_at: string | null
  processing_started_at: string | null
  last_error: string | null
  dead_lettered_at: string | null
}
