import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import type { QqBotCampaign } from '../../src/lib/qqbot-reward-contracts'
import type { QqBotActivity, QqBotVerification, QqBotVerificationAction, QqBotVerificationProof } from '../../src/lib/qqbot-verification-contracts'
import { query, withTransaction } from './postgres'
import { ensureDatabaseSchema } from './schema'
import { QqBotError } from './qqbot-store'
import { InventoryError } from './inventory-store'
import { deliverQqBotRewardInTransaction } from './qqbot-reward-store'

type Verification = Omit<QqBotVerification, 'error_message'> & {
  user_id: string; binding_id: string | null; joined_at: string | null; error_message: string | null
}
const TTL_MS = 10 * 60_000

export async function getUserQqBotVerification(userId: string, id: string | null = null): Promise<QqBotVerification | null> {
  await ensureDatabaseSchema()
  const result = await query<Verification>(
    'select * from qqbot_web_verifications where user_id = $1 and ($2::text is null or id = $2) order by created_at desc, id desc limit 1', [userId, id],
  )
  return result.rows[0] ? publicVerification(result.rows[0]) : null
}

export async function listUserQqBotActivities(userId: string, groupId: string | null, campaignId: string | null): Promise<QqBotActivity[]> {
  await ensureDatabaseSchema()
  const result = await query<QqBotActivity>(
    `select campaign.group_id, campaign.campaign_id, campaign.item_code, campaign.quantity, campaign.validity_days,
       campaign.min_join_days, campaign.joined_before, campaign.ends_at, campaign.enabled, item.name as item_name, item.icon_key,
       coalesce(receipt.response_json->>'user_id' = $1, false) as claimed,
       coalesce(receipt.response_json->>'user_id' <> $1, false) as claimed_elsewhere
     from qqbot_reward_campaigns campaign
     join item_definitions item on item.code = campaign.item_code
     left join qqbot_account_bindings binding on binding.user_id = $1
     left join qqbot_reward_deliveries receipt on receipt.delivery_id = 'claim:' || campaign.group_id || ':' || campaign.campaign_id || ':' || binding.qq_number
     where ($2::text is null or campaign.group_id = $2) and ($3::text is null or campaign.campaign_id = $3)
     order by campaign.created_at desc, campaign.group_id, campaign.campaign_id limit 100`, [userId, groupId, campaignId],
  )
  return result.rows
}

export async function actOnQqBotVerification(userId: string, input: QqBotVerificationAction) {
  await ensureDatabaseSchema()
  return withTransaction(async (client) => {
    await lockActiveUser(client, userId)
    if (input.action === 'confirm') return confirm(client, userId, input.verification_id)
    const binding = (await client.query<{ id: string; qq_number: string }>(
      'select id, qq_number from qqbot_account_bindings where user_id = $1', [userId],
    )).rows[0]
    if (input.action === 'start' && binding) throw new QqBotError('already_bound', '已绑定 QQ，可直接领取。', 409)
    if (input.action === 'claim' && !binding) throw new QqBotError('account_not_bound', '请先验证并绑定 QQ。', 409)
    const qq = input.action === 'start' ? input.qq_number : binding!.qq_number
    if (input.action === 'claim') {
      const receipt = await previousClaim(client, userId, input.group_id, input.campaign_id, qq)
      if (receipt) return { status: 'completed' as const }
      const pending = await client.query<Verification>(
        `select * from qqbot_web_verifications where user_id = $1 and group_id = $2 and campaign_id = $3
         and binding_id = $4 and kind = 'membership' and status = 'pending' and expires_at > now()
         order by created_at desc limit 1`, [userId, input.group_id, input.campaign_id, binding!.id],
      )
      if (pending.rows[0]) return { verification: publicVerification(pending.rows[0]) }
    }
    if (input.campaign_id) await availableCampaign(client, input.group_id, input.campaign_id)
    const code = input.action === 'start' ? randomBytes(6).toString('hex').toUpperCase().replace(/(.{6})(.{6})/, '$1-$2') : null
    await client.query("update qqbot_web_verifications set status = 'expired' where user_id = $1 and status in ('pending', 'verified')", [userId])
    const id = randomUUID()
    const expiresAt = new Date(Date.now() + TTL_MS).toISOString()
    const inserted = await client.query<Verification>(
      `insert into qqbot_web_verifications (id, user_id, qq_number, group_id, campaign_id, kind, code_hash, binding_id, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
      [id, userId, qq, input.group_id, input.campaign_id, input.action === 'start' ? 'message' : 'membership',
        code ? hash(code) : null, binding?.id ?? null, expiresAt],
    )
    return { verification: publicVerification(inserted.rows[0]), ...(code ? { code } : {}) }
  })
}

export async function listQqBotMembershipChecks() {
  await ensureDatabaseSchema()
  const result = await query<Pick<Verification, 'id' | 'qq_number' | 'group_id'>>(
    `select id, qq_number, group_id from qqbot_web_verifications
     where kind = 'membership' and status = 'pending' and expires_at > now() order by created_at limit 25`,
  )
  return result.rows
}

export async function recordQqBotVerification(input: QqBotVerificationProof) {
  await ensureDatabaseSchema()
  return withTransaction(async (client) => {
    const matched = await client.query<Verification>(
      `select * from qqbot_web_verifications where ${input.action === 'message' ? 'code_hash = $1' : 'id = $1'}
       and qq_number = $2 and group_id = $3 and kind = $4`,
      [input.action === 'message' ? hash(input.code) : input.verification_id, input.qq_number, input.group_id, input.action],
    )
    const candidate = matched.rows[0]
    if (!candidate) throw new QqBotError('verification_missing', '验证申请不存在或与当前 QQ、群号不匹配。', 404)
    // Use the same user -> verification lock order as website confirmation and unbinding.
    await lockActiveUser(client, candidate.user_id)
    const row = (await client.query<Verification>('select * from qqbot_web_verifications where id = $1 for update', [candidate.id])).rows[0]
    if (row.status !== 'pending') return { status: publicVerification(row).status }
    if (Date.parse(row.expires_at) <= Date.now()) throw new QqBotError('verification_expired', '验证已过期，请重新生成。', 409)
    if (input.action === 'membership' && !input.member) {
      await reject(client, row.id, '未能确认当前群成员身份，请确认仍在活动群后重试。')
      return { status: 'rejected' }
    }
    await client.query("update qqbot_web_verifications set status = 'verified', joined_at = $2, verified_at = now() where id = $1", [row.id, input.joined_at])
    if (input.action === 'membership') {
      const verified = { ...row, status: 'verified' as const, joined_at: String(input.joined_at) }
      try {
        // A savepoint keeps a failed reward from leaving a partial binding or inventory change.
        await client.query('savepoint website_reward')
        await finishClaim(client, verified)
        await client.query("update qqbot_web_verifications set status = 'completed' where id = $1", [row.id])
        await client.query('release savepoint website_reward')
      } catch (error) {
        await client.query('rollback to savepoint website_reward')
        if (!(error instanceof QqBotError) && !(error instanceof InventoryError)) throw error
        await reject(client, row.id, error.message)
        return { status: 'rejected' }
      }
      return { status: 'completed' }
    }
    return { status: 'verified' }
  })
}

async function confirm(client: PoolClient, userId: string, id: string) {
  const row = (await client.query<Verification>('select * from qqbot_web_verifications where id = $1 and user_id = $2 for update', [id, userId])).rows[0]
  if (!row) throw new QqBotError('verification_missing', '验证申请不存在。', 404)
  if (row.status === 'completed') return { status: 'completed' as const }
  if (row.kind !== 'message' || row.status !== 'verified') throw new QqBotError('verification_pending', '请先在指定群发送验证消息，再返回本页确认。', 409)
  if (Date.parse(row.expires_at) <= Date.now()) throw new QqBotError('verification_expired', '验证已过期，请重新生成。', 409)
  const result = await client.query(
    `insert into qqbot_account_bindings (id, user_id, qq_number, notifications_enabled, created_at)
     values ($1, $2, $3, false, now()) on conflict do nothing returning id`, [randomUUID(), userId, row.qq_number],
  )
  if (!result.rowCount) throw new QqBotError('binding_conflict', 'QQ 或网站账号已绑定，请先解除原绑定。', 409)
  if (row.campaign_id) await finishClaim(client, row)
  await client.query("update qqbot_web_verifications set status = 'completed' where id = $1", [row.id])
  return { status: 'completed' as const }
}

async function finishClaim(client: PoolClient, row: Verification) {
  if (!row.campaign_id) return
  const binding = (await client.query<{ id: string; qq_number: string }>('select id, qq_number from qqbot_account_bindings where user_id = $1', [row.user_id])).rows[0]
  if (!binding || binding.qq_number !== row.qq_number || (row.binding_id && binding.id !== row.binding_id)) {
    throw new QqBotError('binding_changed', 'QQ 绑定已变化，请重新领取。', 409)
  }
  if (await previousClaim(client, row.user_id, row.group_id, row.campaign_id, row.qq_number)) return
  const campaign = await availableCampaign(client, row.group_id, row.campaign_id)
  const joined = Number(row.joined_at)
  const now = Math.floor(Date.now() / 1000)
  if ((campaign.min_join_days || campaign.joined_before) && (!joined || joined > now)) throw new QqBotError('join_time_missing', '暂时无法确认入群时间，请稍后重试。', 409)
  if (campaign.min_join_days && now - joined < campaign.min_join_days * 86400) throw new QqBotError('not_eligible', `需入群满 ${campaign.min_join_days} 天才能领取。`, 403)
  if (campaign.joined_before && joined * 1000 >= Date.parse(campaign.joined_before)) throw new QqBotError('not_eligible', '你的入群时间不符合本活动要求。', 403)
  await deliverQqBotRewardInTransaction(client, {
    delivery_id: `claim:${row.group_id}:${row.campaign_id}:${row.qq_number}`,
    qq_number: row.qq_number, group_id: row.group_id, actor_qq: row.qq_number,
    item_code: campaign.item_code, quantity: campaign.quantity, validity_days: campaign.validity_days,
    gift_pack_version_id: campaign.gift_pack_version_id, reason: `群活动 ${row.campaign_id}`,
  })
}

async function previousClaim(client: PoolClient, userId: string, group: string, campaign: string, qq: string) {
  await client.query("select pg_advisory_xact_lock(hashtextextended('qqbot-reward:' || $1, 0))", [`claim:${group}:${campaign}:${qq}`])
  const receipt = (await client.query<{ response_json: { user_id: string } }>('select response_json from qqbot_reward_deliveries where delivery_id = $1', [`claim:${group}:${campaign}:${qq}`])).rows[0]
  if (receipt && receipt.response_json.user_id !== userId) throw new QqBotError('already_claimed', '该 QQ 已领取过本活动，奖励保留在原网站账号。', 409)
  return receipt
}

async function availableCampaign(client: PoolClient, group: string, campaignId: string) {
  const campaign = (await client.query<QqBotCampaign>('select * from qqbot_reward_campaigns where group_id = $1 and campaign_id = $2 for share', [group, campaignId])).rows[0]
  if (!campaign) throw new QqBotError('campaign_missing', '活动不存在，请核对活动链接。', 404)
  if (!campaign.enabled || (campaign.ends_at && Date.parse(campaign.ends_at) <= Date.now())) throw new QqBotError('campaign_closed', '活动已停用或结束。', 409)
  return campaign
}

async function lockActiveUser(client: PoolClient, userId: string) {
  const result = await client.query('select id from user_accounts where id = $1 and status = $2 for update', [userId, 'active'])
  if (!result.rowCount) throw new QqBotError('account_unavailable', '网站账号暂时不可用。', 403)
}
async function reject(client: PoolClient, id: string, message: string) {
  await client.query("update qqbot_web_verifications set status = 'rejected', error_message = $2 where id = $1", [id, message])
}
function publicVerification(row: Verification): QqBotVerification {
  const { id, qq_number, group_id, campaign_id, kind, error_message, expires_at } = row
  const status = ['pending', 'verified'].includes(row.status) && Date.parse(expires_at) <= Date.now() ? 'expired' : row.status
  return { id, qq_number, group_id, campaign_id, kind, status, expires_at, error_message }
}
function hash(code: string) { return createHash('sha256').update(code).digest('hex') }
