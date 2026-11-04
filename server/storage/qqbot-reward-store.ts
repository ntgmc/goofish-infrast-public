import { createHash } from 'node:crypto'
import { query, withTransaction } from './postgres'
import { ensureDatabaseSchema } from './schema'
import { grantItemInTransaction } from './inventory-store'
import { QqBotError } from './qqbot-store'

export type QqBotRewardInput = {
  delivery_id: string
  qq_number: string
  group_id: string
  actor_qq: string
  item_code: string
  quantity: number
  validity_days: number
  gift_pack_version_id: string | null
  reason: string
}

type DeliveryResponse = { schema_version: 1; delivery_id: string; user_id: string; grant_id: string }

export async function listQqBotRewardItems() {
  await ensureDatabaseSchema()
  const result = await query<{ code: string; name: string; gift_pack_version_id: string | null }>(
    `select item.code, item.name, version.id as gift_pack_version_id
       from item_definitions item
       left join lateral (
         select id from gift_pack_versions where item_code = item.code and status = 'published'
         order by version desc limit 1
       ) version on true
      where item.issuance_enabled and item.kind not in ('cosmetic', 'badge')
        and (item.kind <> 'gift_pack' or version.id is not null)
      order by item.code`,
  )
  return result.rows
}

export async function deliverQqBotReward(input: QqBotRewardInput): Promise<DeliveryResponse> {
  await ensureDatabaseSchema()
  // Hash the QQ and reward snapshot, so rebinding cannot redirect a committed delivery.
  const requestHash = createHash('sha256').update(JSON.stringify([
    input.qq_number, input.group_id, input.actor_qq, input.item_code, input.quantity,
    input.validity_days, input.gift_pack_version_id, input.reason,
  ])).digest('hex')
  return withTransaction(async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtextextended('qqbot-reward:' || $1, 0))", [input.delivery_id])
    const existing = await client.query<{ request_hash: string; response_json: DeliveryResponse }>(
      'select request_hash, response_json from qqbot_reward_deliveries where delivery_id = $1', [input.delivery_id],
    )
    const previous = existing.rows[0]
    if (previous) {
      if (previous.request_hash !== requestHash) throw new QqBotError('idempotency_conflict', '发放编号已用于其他奖励。', 409)
      return previous.response_json
    }
    const binding = await client.query<{ user_id: string }>(
      'select user_id from qqbot_account_bindings where qq_number = $1', [input.qq_number],
    )
    const userId = binding.rows[0]?.user_id
    if (!userId) throw new QqBotError('account_not_bound', '奖励已保留，绑定网站账号后自动补发。', 404)
    // Binding changes and inventory operations also lock the user first.
    const account = await client.query<{ status: string }>('select status from user_accounts where id = $1 for update', [userId])
    const current = await client.query('select id from qqbot_account_bindings where qq_number = $1 and user_id = $2 for share', [input.qq_number, userId])
    if (!current.rowCount) throw new QqBotError('binding_changed', '网站绑定已变化，请重试。', 409)
    if (account.rows[0]?.status !== 'active') throw new QqBotError('account_unavailable', '网站账号暂时不可用。', 403)
    const definition = await client.query<{ kind: string }>('select kind from item_definitions where code = $1', [input.item_code])
    if (['cosmetic', 'badge'].includes(definition.rows[0]?.kind)) {
      throw new QqBotError('reward_item_unavailable', '该道具尚未开放。', 400)
    }
    const now = new Date().toISOString()
    const grantId = await grantItemInTransaction(client, {
      userId, itemCode: input.item_code, quantity: input.quantity,
      expiry: input.validity_days ? { mode: 'relative_days', days: input.validity_days } : { mode: 'never' },
      giftPackVersionId: input.gift_pack_version_id,
      sourceType: 'qqbot_reward', sourceId: input.delivery_id, recipientRole: 'recipient',
      metadata: { group_id: input.group_id, actor_qq: input.actor_qq, qq_number: input.qq_number, reason: input.reason }, now,
    })
    if (!grantId) throw new QqBotError('reward_delivery_conflict', '发放记录不一致，请联系维护者核查。', 409)
    const response: DeliveryResponse = { schema_version: 1, delivery_id: input.delivery_id, user_id: userId, grant_id: grantId }
    await client.query(
      `insert into qqbot_reward_deliveries (delivery_id, request_hash, response_json, created_at)
       values ($1, $2, $3::jsonb, $4)`, [input.delivery_id, requestHash, JSON.stringify(response), now],
    )
    return response
  })
}
