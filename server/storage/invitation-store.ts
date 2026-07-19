import { randomBytes, randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { saveUserAccountInTransaction } from './cdk-redemption'
import { query, withTransaction } from './postgres'
import { ensureDatabaseSchema } from './schema'
import type { UserAccountRecord } from './user-store'

const PRIORITY_COMPUTE_COUPON = 'priority_compute_coupon' as const
const INVITATION_SETTINGS_KEY = 'global'
const INVITE_CODE_LENGTH = 10
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

type InvitationRewardType = typeof PRIORITY_COMPUTE_COUPON
type InvitationRewardRecipient = 'inviter' | 'invitee'

interface InvitationRewardRule {
  recipient: InvitationRewardRecipient
  type: InvitationRewardType
  quantity: number
  validity_days: number
}

export interface InvitationSettingsV1 {
  version: 1
  enabled: boolean
  activation_rule: 'first_active_profile'
  daily_inviter_reward_limit: number
  rewards: InvitationRewardRule[]
  updated_at: string | null
}

export type InvitationSettingsPatch = Partial<Pick<InvitationSettingsV1, 'enabled' | 'daily_inviter_reward_limit' | 'rewards'>>

export interface ValidatedInvitationCode {
  code: string
  inviter_user_id: string
}

export interface RewardBalance {
  type: InvitationRewardType
  available: number
  permanent: number
  next_expiry_at: string | null
}

export interface InvitationSummary {
  can_invite: boolean
  code: string | null
  share_url: string | null
  stats: {
    registered: number
    activated: number
    rewards_earned: number
  }
  settings: InvitationSettingsV1
}

export class InvitationCodeError extends Error {
  constructor(readonly code: 'invalid_invite_code' | 'invitation_campaign_paused', message: string) {
    super(message)
    this.name = 'InvitationCodeError'
  }
}

export class PriorityCouponUnavailableError extends Error {
  constructor() {
    super('没有可用的优先计算券。')
    this.name = 'PriorityCouponUnavailableError'
  }
}

export const DEFAULT_INVITATION_SETTINGS: InvitationSettingsV1 = {
  version: 1,
  enabled: true,
  activation_rule: 'first_active_profile',
  daily_inviter_reward_limit: 10,
  rewards: [
    { recipient: 'inviter', type: PRIORITY_COMPUTE_COUPON, quantity: 1, validity_days: 0 },
    { recipient: 'invitee', type: PRIORITY_COMPUTE_COUPON, quantity: 0, validity_days: 0 },
  ],
  updated_at: null,
}

let schemaReady: Promise<void> | null = null

export function normalizeInvitationCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim().toUpperCase()
  return /^[0-9A-HJKMNP-TV-Z]{10}$/.test(code) ? code : null
}

export function normalizeInvitationSettings(value: unknown): InvitationSettingsV1 {
  const source = value && typeof value === 'object' ? value as Partial<InvitationSettingsV1> : {}
  const rewards = Array.isArray(source.rewards) ? source.rewards : DEFAULT_INVITATION_SETTINGS.rewards
  const normalizedRewards: InvitationRewardRule[] = []
  for (const recipient of ['inviter', 'invitee'] as const) {
    const candidate = rewards.find((item) => item?.recipient === recipient && item?.type === PRIORITY_COMPUTE_COUPON)
    const fallback = DEFAULT_INVITATION_SETTINGS.rewards.find((item) => item.recipient === recipient)!
    normalizedRewards.push({
      recipient,
      type: PRIORITY_COMPUTE_COUPON,
      quantity: integerInRange(candidate?.quantity, 0, 100, fallback.quantity),
      validity_days: integerInRange(candidate?.validity_days, 0, 3650, fallback.validity_days),
    })
  }
  return {
    version: 1,
    enabled: source.enabled !== false,
    activation_rule: 'first_active_profile',
    daily_inviter_reward_limit: integerInRange(source.daily_inviter_reward_limit, 1, 1000, 10),
    rewards: normalizedRewards,
    updated_at: typeof source.updated_at === 'string' ? source.updated_at : null,
  }
}

export function validateInvitationSettingsPatch(value: unknown): InvitationSettingsPatch {
  if (!value || typeof value !== 'object') throw new Error('邀请设置必须是对象。')
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
    const seen = new Set<string>()
    patch.rewards = source.rewards.map((item) => {
      if (!item || typeof item !== 'object') throw new Error('奖励配置项必须是对象。')
      const reward = item as Record<string, unknown>
      if (reward.recipient !== 'inviter' && reward.recipient !== 'invitee') throw new Error('奖励对象无效。')
      if (reward.type !== PRIORITY_COMPUTE_COUPON) throw new Error('不支持的奖励类型。')
      const key = `${reward.recipient}:${reward.type}`
      if (seen.has(key)) throw new Error('同一奖励对象和类型不能重复。')
      seen.add(key)
      return {
        recipient: reward.recipient,
        type: PRIORITY_COMPUTE_COUPON,
        quantity: requireInteger(reward.quantity, 0, 100, '奖励数量'),
        validity_days: requireInteger(reward.validity_days, 0, 3650, '有效天数'),
      }
    })
    if (patch.rewards.length !== 2 || !patch.rewards.some((item) => item.recipient === 'inviter') || !patch.rewards.some((item) => item.recipient === 'invitee')) {
      throw new Error('必须同时提供邀请人和新用户的奖励配置。')
    }
  }
  if (Object.keys(patch).length === 0) throw new Error('没有需要保存的邀请设置。')
  return patch
}

export async function getInvitationSettings(): Promise<InvitationSettingsV1> {
  await ensureSchema()
  const result = await query<{ record_json: InvitationSettingsV1 }>('select record_json from invitation_settings where key = $1', [INVITATION_SETTINGS_KEY])
  return normalizeInvitationSettings(result.rows[0]?.record_json)
}

export async function saveInvitationSettings(patch: InvitationSettingsPatch): Promise<InvitationSettingsV1> {
  await ensureSchema()
  const current = await getInvitationSettings()
  const saved = normalizeInvitationSettings({ ...current, ...patch, updated_at: new Date().toISOString() })
  await query(
    `insert into invitation_settings (key, record_json, updated_at)
     values ($1, $2::jsonb, now())
     on conflict (key) do update set record_json = excluded.record_json, updated_at = now()`,
    [INVITATION_SETTINGS_KEY, JSON.stringify(saved)],
  )
  return saved
}

export async function validateInvitationCode(value: unknown): Promise<ValidatedInvitationCode | null> {
  if (value === undefined || value === null || value === '') return null
  const code = normalizeInvitationCode(value)
  if (!code) throw new InvitationCodeError('invalid_invite_code', '邀请码无效。')
  const settings = await getInvitationSettings()
  if (!settings.enabled) throw new InvitationCodeError('invitation_campaign_paused', '邀请活动暂停，可移除邀请码继续注册。')
  await ensureSchema()
  const result = await query<{ user_id: string }>(
    `select code.user_id
       from invitation_codes code
       join user_accounts account on account.id = code.user_id and account.status = 'active'
      where code.code = $1
        and exists (
          select 1 from user_game_accounts profile
           where profile.user_id = code.user_id and profile.status = 'active'
             and coalesce(profile.record_json->>'kind', 'cdk') in ('cdk', 'free_preview')
        )`,
    [code],
  )
  const row = result.rows[0]
  if (!row) throw new InvitationCodeError('invalid_invite_code', '邀请码无效或邀请人当前不可参与活动。')
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
  if (invitation.inviter_user_id === inviteeUserId) throw new InvitationCodeError('invalid_invite_code', '不能使用自己的邀请码。')
  const now = new Date().toISOString()
  await client.query(
    `insert into invitations
      (id, inviter_user_id, invitee_user_id, invitation_code, status, registered_at, updated_at)
     values ($1, $2, $3, $4, 'registered', $5, $5)`,
    [randomUUID(), invitation.inviter_user_id, inviteeUserId, invitation.code, now],
  )
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

export async function ensureInvitationCode(userId: string): Promise<string> {
  await ensureSchema()
  if (!(await userCanInvite(userId))) throw new InvitationCodeError('invalid_invite_code', '完成账号激活后才能生成邀请码。')
  const existing = await query<{ code: string }>('select code from invitation_codes where user_id = $1', [userId])
  if (existing.rows[0]) return existing.rows[0].code
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = createInviteCode()
    const inserted = await query<{ code: string }>(
      `insert into invitation_codes (user_id, code, created_at)
       values ($1, $2, now()) on conflict do nothing returning code`,
      [userId, code],
    )
    if (inserted.rows[0]) return inserted.rows[0].code
    const concurrent = await query<{ code: string }>('select code from invitation_codes where user_id = $1', [userId])
    if (concurrent.rows[0]) return concurrent.rows[0].code
  }
  throw new Error('生成邀请码失败，请稍后重试。')
}

export async function getInvitationSummary(userId: string): Promise<InvitationSummary> {
  await ensureSchema()
  const [settings, canInvite, codeResult, statsResult] = await Promise.all([
    getInvitationSettings(),
    userCanInvite(userId),
    query<{ code: string }>('select code from invitation_codes where user_id = $1', [userId]),
    query<{ registered: string; activated: string; rewards_earned: string }>(
      `select count(*)::text as registered,
              count(*) filter (where activated_at is not null)::text as activated,
              coalesce((select sum(original_quantity)::text from reward_grants
                where user_id = $1 and source_type = 'invitation' and recipient_role = 'inviter'
                  and reward_type = $2), '0') as rewards_earned
         from invitations where inviter_user_id = $1`,
      [userId, PRIORITY_COMPUTE_COUPON],
    ),
  ])
  const code = codeResult.rows[0]?.code ?? null
  const stats = statsResult.rows[0]
  return {
    can_invite: canInvite && settings.enabled,
    code,
    share_url: code ? `/tool/profiles?invite=${encodeURIComponent(code)}` : null,
    stats: {
      registered: Number(stats?.registered ?? 0),
      activated: Number(stats?.activated ?? 0),
      rewards_earned: Number(stats?.rewards_earned ?? 0),
    },
    settings,
  }
}

export async function getRewardBalances(userId: string, now = new Date()): Promise<RewardBalance[]> {
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

export async function settleInvitationForActivatedUser(userId: string): Promise<void> {
  await ensureSchema()
  await withTransaction(async (client) => {
    const invitationResult = await client.query<{
      id: string; inviter_user_id: string | null; status: string
    }>('select id, inviter_user_id, status from invitations where invitee_user_id = $1 for update', [userId])
    const invitation = invitationResult.rows[0]
    if (!invitation || invitation.status === 'settled') return
    const active = await client.query<{ active: boolean }>(
      `select exists (select 1 from user_game_accounts
        where user_id = $1 and status = 'active'
          and coalesce(record_json->>'kind', 'cdk') in ('cdk', 'free_preview')) as active`,
      [userId],
    )
    if (!active.rows[0]?.active) return
    const settingsResult = await client.query<{ record_json: InvitationSettingsV1 }>('select record_json from invitation_settings where key = $1', [INVITATION_SETTINGS_KEY])
    const settings = normalizeInvitationSettings(settingsResult.rows[0]?.record_json)
    const now = new Date()
    const settlement: Record<string, unknown> = { enabled: settings.enabled, rewards: {} }
    let inviterApplied = 0
    let inviteeApplied = 0

    if (settings.enabled) {
      const inviterRule = settings.rewards.find((item) => item.recipient === 'inviter')!
      const inviteeRule = settings.rewards.find((item) => item.recipient === 'invitee')!
      const inviterEligible = invitation.inviter_user_id ? await client.query<{ eligible: boolean }>(
        `select exists (select 1 from user_accounts account
          where account.id = $1 and account.status = 'active'
            and exists (select 1 from user_game_accounts profile
              where profile.user_id = account.id and profile.status = 'active'
                and coalesce(profile.record_json->>'kind', 'cdk') in ('cdk', 'free_preview'))) as eligible`,
        [invitation.inviter_user_id],
      ) : null
      let inviterReason: string | null = null
      if (!invitation.inviter_user_id || !inviterEligible?.rows[0]?.eligible) {
        inviterReason = 'inviter_ineligible'
      } else {
        const daily = await client.query<{ count: string }>(
          `select count(*)::text as count from reward_grants
            where user_id = $1 and source_type = 'invitation' and recipient_role = 'inviter'
              and reward_type = $2
              and (created_at at time zone 'Asia/Shanghai')::date = ($3::timestamptz at time zone 'Asia/Shanghai')::date`,
          [invitation.inviter_user_id, PRIORITY_COMPUTE_COUPON, now.toISOString()],
        )
        if (Number(daily.rows[0]?.count ?? 0) >= settings.daily_inviter_reward_limit) inviterReason = 'daily_limit'
      }
      if (!inviterReason && invitation.inviter_user_id && inviterRule.quantity > 0) {
        await insertRewardGrant(client, invitation.inviter_user_id, invitation.id, 'inviter', inviterRule, now)
        inviterApplied = inviterRule.quantity
      }
      if (inviteeRule.quantity > 0) {
        await insertRewardGrant(client, userId, invitation.id, 'invitee', inviteeRule, now)
        inviteeApplied = inviteeRule.quantity
      }
      settlement.rewards = {
        inviter: { planned: inviterRule.quantity, applied: inviterApplied, reason: inviterReason },
        invitee: { planned: inviteeRule.quantity, applied: inviteeApplied, reason: null },
      }
    }
    await client.query(
      `update invitations set status = 'settled', activated_at = $2, settled_at = $2,
       settings_snapshot = $3::jsonb, settlement_json = $4::jsonb, updated_at = $2 where id = $1`,
      [invitation.id, now.toISOString(), JSON.stringify(settings), JSON.stringify(settlement)],
    )
  })
}

export async function consumePriorityCouponInTransaction(client: PoolClient, userId: string, jobId: string, nowIso: string): Promise<void> {
  const existing = await client.query('select 1 from reward_consumptions where optimization_job_id = $1 and reward_type = $2', [jobId, PRIORITY_COMPUTE_COUPON])
  if (existing.rowCount) return
  const grant = await client.query<{ id: string; validity_days: number }>(
    `select id, validity_days from reward_grants
      where user_id = $1 and reward_type = $2 and remaining_quantity > 0
        and (expires_at is null or expires_at > $3)
      order by expires_at asc nulls last, created_at asc
      for update skip locked limit 1`,
    [userId, PRIORITY_COMPUTE_COUPON, nowIso],
  )
  const row = grant.rows[0]
  if (!row) throw new PriorityCouponUnavailableError()
  await client.query('update reward_grants set remaining_quantity = remaining_quantity - 1 where id = $1', [row.id])
  await client.query(
    `insert into reward_consumptions
      (id, user_id, reward_type, grant_id, optimization_job_id, status, validity_days, consumed_at)
     values ($1, $2, $3, $4, $5, 'consumed', $6, $7)`,
    [randomUUID(), userId, PRIORITY_COMPUTE_COUPON, row.id, jobId, row.validity_days, nowIso],
  )
}

export async function refundPriorityCouponInTransaction(client: PoolClient, jobId: string, nowIso: string): Promise<void> {
  const result = await client.query<{ id: string; user_id: string; validity_days: number }>(
    `select id, user_id, validity_days from reward_consumptions
      where optimization_job_id = $1 and reward_type = $2 for update`,
    [jobId, PRIORITY_COMPUTE_COUPON],
  )
  const consumption = result.rows[0]
  if (!consumption) return
  const status = await client.query<{ status: string }>('select status from reward_consumptions where id = $1', [consumption.id])
  if (status.rows[0]?.status !== 'consumed') return
  const expiresAt = consumption.validity_days > 0
    ? new Date(Date.parse(nowIso) + consumption.validity_days * 24 * 60 * 60_000).toISOString()
    : null
  await client.query(
    `insert into reward_grants
      (id, user_id, reward_type, source_type, source_id, recipient_role, original_quantity, remaining_quantity,
       validity_days, expires_at, metadata_json, created_at)
     values ($1, $2, $3, 'optimization_refund', $4, 'refund', 1, 1, $5, $6, $7::jsonb, $8)
     on conflict (user_id, reward_type, source_type, source_id, recipient_role) do nothing`,
    [randomUUID(), consumption.user_id, PRIORITY_COMPUTE_COUPON, jobId, consumption.validity_days, expiresAt, JSON.stringify({ refunded_consumption_id: consumption.id }), nowIso],
  )
  await client.query("update reward_consumptions set status = 'refunded', refunded_at = $2 where id = $1 and status = 'consumed'", [consumption.id, nowIso])
}

async function insertRewardGrant(
  client: PoolClient,
  userId: string,
  invitationId: string,
  recipient: InvitationRewardRecipient,
  rule: InvitationRewardRule,
  now: Date,
): Promise<void> {
  const expiresAt = rule.validity_days > 0 ? new Date(now.getTime() + rule.validity_days * 24 * 60 * 60_000).toISOString() : null
  await client.query(
    `insert into reward_grants
      (id, user_id, reward_type, source_type, source_id, recipient_role, original_quantity, remaining_quantity,
       validity_days, expires_at, metadata_json, created_at)
     values ($1, $2, $3, 'invitation', $4, $5, $6, $6, $7, $8, '{}'::jsonb, $9)
     on conflict (user_id, reward_type, source_type, source_id, recipient_role) do nothing`,
    [randomUUID(), userId, rule.type, invitationId, recipient, rule.quantity, rule.validity_days, expiresAt, now.toISOString()],
  )
}

function createInviteCode(): string {
  const bytes = randomBytes(INVITE_CODE_LENGTH)
  let code = ''
  for (const value of bytes) code += CROCKFORD_ALPHABET[value % CROCKFORD_ALPHABET.length]
  return code
}

function integerInRange(value: unknown, min: number, max: number, fallback: number): number {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max ? Number(value) : fallback
}

function requireInteger(value: unknown, min: number, max: number, label: string): number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new Error(`${label}必须是 ${min} 到 ${max} 之间的整数。`)
  return Number(value)
}

function ensureSchema(): Promise<void> {
  schemaReady ??= ensureDatabaseSchema()
  return schemaReady
}
