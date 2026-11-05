import { randomUUID } from 'node:crypto'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closePool, query, withTransaction } from './postgres'
import { migrateDatabaseSchema } from './schema'
import { saveUserAccount, saveUserProfile } from './user-store'
import { deliverQqBotReward, listQqBotRewardItems, type QqBotRewardInput } from './qqbot-reward-store'
import { createCustomGiftPack, createGiftPackDraft, createQqBotCampaign, setQqBotCampaignStatus } from './admin-inventory-store'
import { listQqBotCampaigns } from './qqbot-reward-store'
import { actOnQqBotVerification, getUserQqBotVerification, listQqBotMembershipChecks, listUserQqBotActivities, recordQqBotVerification } from './qqbot-verification-store'
import {
  acknowledgeQqBotNotification, bindQqBotAccount, createQqBotBindingCode,
  enqueueQqBotScheduleNotificationInTransaction, getQqBotAccount, getUserQqBotBinding,
  listQqBotScheduleNotifications, setQqBotNotifications, unbindQqBotAccount,
} from './qqbot-store'

let container: PostgreSqlContainer
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  process.env.DATABASE_URL = container.getConnectionUri()
  await migrateDatabaseSchema()
})
afterAll(async () => { await closePool(); if (container) await container.stop() })

let qqSequence = 123450000
async function fixture() {
  const id = randomUUID()
  const now = new Date().toISOString()
  const user = {
    version: 1 as const, id, email: `${id}@example.test`, password_hash: 'test-hash', salt: 'test-salt',
    iterations: 1, permission: 'advanced' as const, status: 'active' as const, cdk_key: null,
    cdk_code_hash: null, cdk_order_hash: null, email_verified_at: now, created_at: now, updated_at: now,
  }
  await saveUserAccount(user)
  const profileId = randomUUID()
  await saveUserProfile({
    version: 1, id: profileId, user_id: id, kind: 'cdk', authorization_source: 'admin_grant',
    permission: 'advanced', status: 'active', cdk_key: null, cdk_code_hash: null, cdk_order_hash: null,
    display_name: '测试档案', note: '', created_at: now, updated_at: now,
  })
  const qq = String(++qqSequence)
  const code = await createQqBotBindingCode(id)
  return { user, profileId, qq, code }
}
async function enqueue(profileId: string, resultId = randomUUID()) {
  await withTransaction((client) => enqueueQqBotScheduleNotificationInTransaction(client, {
    profileId, resultId, title: '测试排班', now: new Date().toISOString(),
  }))
  return resultId
}

describe('QQ bot campaigns managed on the website', () => {
  it('creates once, scopes by group, preserves snapshots and rejects stale status updates', async () => {
    const pack = await createCustomGiftPack('qqbot-admin', { name: '群活动礼包', description: '活动奖励',
      contents: [{ item_code: 'maa_export_trial_coupon', quantity: 1, expiry: { mode: 'never' } }], publish: true })
    const input = { group_id: '7654321', campaign_id: 'website-event', item_code: pack.item_code as string,
      quantity: 2, validity_days: 30, min_join_days: 7, joined_before: '2026-10-31T16:00:00.000Z', ends_at: null,
      idempotency_key: randomUUID() }
    const responses = await Promise.all(Array.from({ length: 3 }, () => createQqBotCampaign('qqbot-admin', input)))
    expect(responses).toEqual(Array(3).fill({ group_id: input.group_id, campaign_id: input.campaign_id }))
    await expect(createQqBotCampaign('qqbot-admin', { ...input, idempotency_key: randomUUID() }))
      .rejects.toMatchObject({ code: 'campaign_exists' })
    const [campaign] = await listQqBotCampaigns(input.group_id, input.campaign_id)
    expect(campaign).toMatchObject({ enabled: true, revision: 1, gift_pack_version_id: pack.version_id, created_by: 'qqbot-admin' })
    expect(await listQqBotCampaigns('7654322', input.campaign_id)).toEqual([])
    await setQqBotCampaignStatus('qqbot-admin', { ...input, enabled: false, expected_revision: 1 })
    await expect(setQqBotCampaignStatus('qqbot-admin', { ...input, enabled: true, expected_revision: 1 }))
      .rejects.toMatchObject({ code: 'campaign_changed' })
    expect((await listQqBotCampaigns(input.group_id, input.campaign_id))[0]).toMatchObject({ enabled: false, revision: 2 })
    expect((await query("select id from inventory_admin_audit where action = 'create_qqbot_campaign' and target_id = $1", [`${input.group_id}:${input.campaign_id}`])).rows).toHaveLength(1)
    for (const changes of [{ campaign_id: 'past', ends_at: '2020-01-01T00:00:00.000Z' }, { campaign_id: 'unknown', item_code: 'missing' }]) {
      await expect(createQqBotCampaign('qqbot-admin', { ...input, ...changes, idempotency_key: randomUUID() })).rejects.toBeInstanceOf(Error)
    }
  })
})

describe('website QQ verification and claims', () => {
  async function activity(changes: Partial<Parameters<typeof createQqBotCampaign>[1]> = {}) {
    const campaign_id = randomUUID()
    await createQqBotCampaign('web-admin', { group_id: '2101', campaign_id, item_code: 'maa_export_trial_coupon', quantity: 1,
      validity_days: 30, min_join_days: 7, joined_before: null, ends_at: null, idempotency_key: randomUUID(), ...changes })
    return campaign_id
  }
  async function start(first: Awaited<ReturnType<typeof fixture>>, campaign_id: string | null) {
    const result = await actOnQqBotVerification(first.user.id, { action: 'start', qq_number: first.qq, group_id: '2101', campaign_id })
    if (!('verification' in result) || !('code' in result)) throw new Error('challenge missing')
    return { id: result.verification.id, code: result.code! }
  }
  const proof = (qq: string, code: string) => ({ action: 'message' as const, qq_number: qq, group_id: '2101', code, joined_at: Math.floor(Date.now() / 1000) - 10 * 86400 })

  it('requires the expected QQ, group and website owner, then binds and grants exactly once', async () => {
    const first = await fixture(), other = await fixture(), campaign = await activity()
    const challenge = await start(first, campaign)
    await expect(recordQqBotVerification(proof(other.qq, challenge.code))).rejects.toMatchObject({ code: 'verification_missing' })
    await expect(recordQqBotVerification({ ...proof(first.qq, challenge.code), group_id: '2102' })).rejects.toMatchObject({ code: 'verification_missing' })
    await expect(actOnQqBotVerification(first.user.id, { action: 'confirm', verification_id: challenge.id })).rejects.toMatchObject({ code: 'verification_pending' })
    await recordQqBotVerification(proof(first.qq, challenge.code))
    expect(await getUserQqBotBinding(first.user.id)).toBeNull()
    await expect(actOnQqBotVerification(other.user.id, { action: 'confirm', verification_id: challenge.id })).rejects.toMatchObject({ code: 'verification_missing' })
    await Promise.all(Array.from({ length: 4 }, () => actOnQqBotVerification(first.user.id, { action: 'confirm', verification_id: challenge.id })))
    expect(await getUserQqBotBinding(first.user.id)).toMatchObject({ qq_number: first.qq, notifications_enabled: false })
    expect((await listUserQqBotActivities(first.user.id, '2101', campaign))[0]).toMatchObject({ claimed: true, claimed_elsewhere: false })
    expect((await listUserQqBotActivities(first.user.id, '2101', campaign))[0]).not.toHaveProperty('created_by')
    expect((await query('select id from reward_grants where source_id = $1', [`claim:2101:${campaign}:${first.qq}`])).rowCount).toBe(1)
  })

  it('expires old and regenerated codes, without creating a binding', async () => {
    const first = await fixture()
    const old = await start(first, null), current = await start(first, null)
    expect(await recordQqBotVerification(proof(first.qq, old.code))).toEqual({ status: 'expired' })
    await query("update qqbot_web_verifications set expires_at = now() - interval '1 second' where id = $1", [current.id])
    await expect(recordQqBotVerification(proof(first.qq, current.code))).rejects.toMatchObject({ code: 'verification_expired' })
    expect(await getUserQqBotVerification(first.user.id)).toMatchObject({ status: 'expired' })
    expect(await getUserQqBotBinding(first.user.id)).toBeNull()
  })

  it('rolls back confirmation including binding when eligibility or the receipt fails', async () => {
    const first = await fixture(), campaign = await activity(), challenge = await start(first, campaign)
    await recordQqBotVerification({ ...proof(first.qq, challenge.code), joined_at: Math.floor(Date.now() / 1000) })
    await expect(actOnQqBotVerification(first.user.id, { action: 'confirm', verification_id: challenge.id })).rejects.toMatchObject({ code: 'not_eligible' })
    expect(await getUserQqBotBinding(first.user.id)).toBeNull()
    await query('update qqbot_web_verifications set joined_at = $2 where id = $1', [challenge.id, proof(first.qq, challenge.code).joined_at])
    await query(`create function web_verify_receipt_failure() returns trigger language plpgsql as $$ begin raise exception 'web receipt failure'; end $$`)
    await query('create trigger web_verify_fail before insert on qqbot_reward_deliveries for each row execute function web_verify_receipt_failure()')
    try {
      await expect(actOnQqBotVerification(first.user.id, { action: 'confirm', verification_id: challenge.id })).rejects.toThrow('web receipt failure')
      expect(await getUserQqBotBinding(first.user.id)).toBeNull()
      expect((await query('select id from reward_grants where source_id = $1', [`claim:2101:${campaign}:${first.qq}`])).rowCount).toBe(0)
    } finally { await query('drop trigger web_verify_fail on qqbot_reward_deliveries'); await query('drop function web_verify_receipt_failure()') }
    await actOnQqBotVerification(first.user.id, { action: 'confirm', verification_id: challenge.id })
  })

  it('checks bound users in the background and preserves claim receipts across account changes', async () => {
    const first = await fixture(), campaign = await activity()
    await bindQqBotAccount(first.qq, first.code.binding_code)
    const action = { action: 'claim' as const, group_id: '2101', campaign_id: campaign }
    const result = await actOnQqBotVerification(first.user.id, action)
    const repeated = await actOnQqBotVerification(first.user.id, action)
    expect(repeated).toEqual(result)
    if (!('verification' in result)) throw new Error('check missing')
    expect(await listQqBotMembershipChecks()).toContainEqual({ id: result.verification.id, qq_number: first.qq, group_id: '2101' })
    const membership = { action: 'membership' as const, verification_id: result.verification.id, qq_number: first.qq, group_id: '2101', member: true, joined_at: proof(first.qq, '').joined_at }
    await Promise.all(Array.from({ length: 3 }, () => recordQqBotVerification(membership)))
    expect(await actOnQqBotVerification(first.user.id, action)).toEqual({ status: 'completed' })
    await unbindQqBotAccount(first.user.id)
    const other = await fixture()
    await bindQqBotAccount(first.qq, other.code.binding_code)
    await expect(actOnQqBotVerification(other.user.id, action)).rejects.toMatchObject({ code: 'already_claimed' })
  })

  it('uses the exclusive Beijing join cutoff and checks the end time again at confirmation', async () => {
    const cutoff = Date.parse('2026-11-03T16:00:00Z') / 1000
    const campaign = await activity({ min_join_days: 0, joined_before: '2026-11-03T16:00:00.000Z' })
    for (const joined of [cutoff - 1, cutoff, 0]) {
      const first = await fixture(), challenge = await start(first, campaign)
      await recordQqBotVerification({ ...proof(first.qq, challenge.code), joined_at: joined })
      const operation = actOnQqBotVerification(first.user.id, { action: 'confirm', verification_id: challenge.id })
      if (joined === cutoff - 1) await expect(operation).resolves.toEqual({ status: 'completed' })
      else await expect(operation).rejects.toMatchObject({ code: joined ? 'not_eligible' : 'join_time_missing' })
    }
    const first = await fixture(), timed = await activity(), challenge = await start(first, timed)
    await recordQqBotVerification(proof(first.qq, challenge.code))
    await query("update qqbot_reward_campaigns set ends_at = now() - interval '1 second' where campaign_id = $1", [timed])
    await expect(actOnQqBotVerification(first.user.id, { action: 'confirm', verification_id: challenge.id })).rejects.toMatchObject({ code: 'campaign_closed' })
    expect(await getUserQqBotBinding(first.user.id)).toBeNull()
  })

  it('rejects stale binding checks and campaigns paused after the browser requested a claim', async () => {
    const first = await fixture(), campaign = await activity()
    await bindQqBotAccount(first.qq, first.code.binding_code)
    const request = await actOnQqBotVerification(first.user.id, { action: 'claim', group_id: '2101', campaign_id: campaign })
    if (!('verification' in request)) throw new Error('check missing')
    await setQqBotCampaignStatus('web-admin', { group_id: '2101', campaign_id: campaign, enabled: false, expected_revision: 1 })
    const result = await recordQqBotVerification({ action: 'membership', verification_id: request.verification.id, qq_number: first.qq, group_id: '2101', member: true, joined_at: proof(first.qq, '').joined_at })
    expect(result).toEqual({ status: 'rejected' })
    expect(await getUserQqBotVerification(first.user.id)).toMatchObject({ status: 'rejected', error_message: '活动已停用或结束。' })
    await setQqBotCampaignStatus('web-admin', { group_id: '2101', campaign_id: campaign, enabled: true, expected_revision: 2 })
    const pending = await actOnQqBotVerification(first.user.id, { action: 'claim', group_id: '2101', campaign_id: campaign })
    if (!('verification' in pending)) throw new Error('check missing')
    await unbindQqBotAccount(first.user.id)
    await recordQqBotVerification({ action: 'membership', verification_id: pending.verification.id, qq_number: first.qq, group_id: '2101', member: true, joined_at: proof(first.qq, '').joined_at })
    expect(await getUserQqBotVerification(first.user.id)).toMatchObject({ status: 'expired' })
  })
})

describe('QQ bot reward delivery in PostgreSQL', () => {
  function reward(qq: string, changes: Partial<QqBotRewardInput> = {}): QqBotRewardInput {
    return { delivery_id: `grant:123456:${randomUUID()}`, qq_number: qq, group_id: '123456', actor_qq: '987654321',
      item_code: 'maa_export_trial_coupon', quantity: 2, validity_days: 30, gift_pack_version_id: null, reason: '群奖励', ...changes }
  }

  it('commits exactly one grant, ledger entry and notification for concurrent retries', async () => {
    const first = await fixture()
    await bindQqBotAccount(first.qq, first.code.binding_code)
    const input = reward(first.qq)
    const deliveries = await Promise.all(Array.from({ length: 5 }, () => deliverQqBotReward(input)))
    expect(new Set(deliveries.map((delivery) => delivery.grant_id)).size).toBe(1)
    const grants = await query<{ id: string; original_quantity: number; expires_at: string; created_at: string }>(
      'select id, original_quantity, expires_at, created_at from reward_grants where source_type = $1 and source_id = $2', ['qqbot_reward', input.delivery_id],
    )
    expect(grants.rows).toHaveLength(1)
    expect(grants.rows[0].original_quantity).toBe(2)
    expect(Date.parse(grants.rows[0].expires_at) - Date.parse(grants.rows[0].created_at)).toBe(30 * 86_400_000)
    expect((await query('select id from inventory_ledger where grant_id = $1', [grants.rows[0].id])).rows).toHaveLength(1)
    expect((await query('select id from user_notifications where user_id = $1 and source_type = $2 and source_id = $3',
      [first.user.id, 'qqbot_reward', input.delivery_id])).rows).toHaveLength(1)
    for (const changes of [{ quantity: 3 }, { qq_number: '111111111' }, { validity_days: 0 }, { actor_qq: '111111111' }]) {
      await expect(deliverQqBotReward({ ...input, ...changes })).rejects.toMatchObject({ code: 'idempotency_conflict' })
    }
  })

  it('rolls back inventory, ledger and notification if saving the delivery receipt fails', async () => {
    const first = await fixture()
    await bindQqBotAccount(first.qq, first.code.binding_code)
    const input = reward(first.qq)
    await query(`create function qqbot_test_reject_receipt() returns trigger language plpgsql as $$
      begin raise exception 'fixture receipt failure'; end $$`)
    await query('create trigger qqbot_test_receipt_failure before insert on qqbot_reward_deliveries for each row execute function qqbot_test_reject_receipt()')
    try {
      await expect(deliverQqBotReward(input)).rejects.toThrow('fixture receipt failure')
    } finally {
      await query('drop trigger qqbot_test_receipt_failure on qqbot_reward_deliveries')
      await query('drop function qqbot_test_reject_receipt()')
    }
    expect((await query('select id from reward_grants where source_id = $1', [input.delivery_id])).rows).toEqual([])
    expect((await query('select id from inventory_ledger where reference_id = $1', [input.delivery_id])).rows).toEqual([])
    expect((await query('select id from user_notifications where source_id = $1', [input.delivery_id])).rows).toEqual([])
    expect((await deliverQqBotReward(input)).user_id).toBe(first.user.id)
  })

  it('leaves no receipt on unbound or unavailable accounts and delivers after binding', async () => {
    const first = await fixture()
    const input = reward(first.qq, { validity_days: 0 })
    await expect(deliverQqBotReward(input)).rejects.toMatchObject({ code: 'account_not_bound' })
    expect((await query('select delivery_id from qqbot_reward_deliveries where delivery_id = $1', [input.delivery_id])).rows).toEqual([])
    await bindQqBotAccount(first.qq, first.code.binding_code)
    await saveUserAccount({ ...first.user, status: 'frozen' })
    await expect(deliverQqBotReward(input)).rejects.toMatchObject({ code: 'account_unavailable' })
    await saveUserAccount(first.user)
    const result = await deliverQqBotReward(input)
    expect(result.user_id).toBe(first.user.id)
    expect((await query<{ expires_at: string | null }>('select expires_at from reward_grants where id = $1', [result.grant_id])).rows[0].expires_at).toBeNull()
  })

  it('replays the original receipt after unbinding, rebinding or deleting the original account', async () => {
    const first = await fixture()
    await bindQqBotAccount(first.qq, first.code.binding_code)
    const input = reward(first.qq)
    const original = await deliverQqBotReward(input)
    await unbindQqBotAccount(first.user.id)
    const second = await fixture()
    await bindQqBotAccount(first.qq, second.code.binding_code)
    expect(await deliverQqBotReward(input)).toEqual(original)
    await query('delete from user_accounts where id = $1', [first.user.id])
    expect(await deliverQqBotReward(input)).toEqual(original)
    expect((await query('select id from reward_grants where user_id = $1 and source_id = $2', [second.user.id, input.delivery_id])).rows).toEqual([])
  })

  it('rolls back unavailable items and excludes them from the reward catalog', async () => {
    const first = await fixture()
    await bindQqBotAccount(first.qq, first.code.binding_code)
    const input = reward(first.qq, { item_code: 'missing_reward_item' })
    await expect(deliverQqBotReward(input)).rejects.toMatchObject({ code: 'item_unknown' })
    expect((await query('select delivery_id from qqbot_reward_deliveries where delivery_id = $1', [input.delivery_id])).rows).toEqual([])
    const items = await listQqBotRewardItems()
    expect(items.some((item) => item.code === 'maa_export_trial_coupon')).toBe(true)
    const unavailable = await query<{ code: string }>("select code from item_definitions where not issuance_enabled or kind in ('cosmetic', 'badge')")
    expect(items.some((item) => unavailable.rows.some((row) => row.code === item.code))).toBe(false)
  })

  it('delivers the snapshotted published gift pack version after a newer version is published', async () => {
    const first = await fixture()
    await bindQqBotAccount(first.qq, first.code.binding_code)
    const contents = [{ item_code: 'maa_export_trial_coupon', quantity: 1, expiry: { mode: 'never' } }]
    const pack = await createCustomGiftPack('qqbot-test', { name: '群活动礼包', description: '群活动测试', contents, publish: true })
    const input = reward(first.qq, { item_code: pack.item_code as string, gift_pack_version_id: pack.version_id as string })
    const newer = await createGiftPackDraft('qqbot-test', pack.item_code as string, contents, randomUUID(), { publish: true })
    expect((await listQqBotRewardItems()).find((item) => item.code === pack.item_code)?.gift_pack_version_id).toBe(newer.version_id)
    const delivery = await deliverQqBotReward(input)
    const grant = await query<{ gift_pack_version_id: string }>('select gift_pack_version_id from reward_grants where id = $1', [delivery.grant_id])
    expect(grant.rows[0].gift_pack_version_id).toBe(pack.version_id)
    await expect(deliverQqBotReward({ ...input, delivery_id: input.delivery_id + '-missing', gift_pack_version_id: null }))
      .rejects.toMatchObject({ code: 'gift_pack_version_required' })
  })
})

describe('QQ bot binding and schedule outbox in PostgreSQL', () => {
  it('stores only a hash and rejects expired, regenerated and consumed binding codes', async () => {
    const { user, qq, code } = await fixture()
    const stored = await query<{ code_hash: string }>('select code_hash from qqbot_binding_codes where user_id = $1', [user.id])
    expect(stored.rows[0].code_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(stored.rows[0].code_hash).not.toBe(code.binding_code)
    const replacement = await createQqBotBindingCode(user.id)
    await expect(bindQqBotAccount(qq, code.binding_code)).rejects.toMatchObject({ code: 'binding_code_invalid' })
    await query("update qqbot_binding_codes set expires_at = now() - interval '1 second' where user_id = $1", [user.id])
    await expect(bindQqBotAccount(qq, replacement.binding_code)).rejects.toMatchObject({ code: 'binding_code_invalid' })
    const fresh = await createQqBotBindingCode(user.id)
    await expect(bindQqBotAccount(qq, fresh.binding_code)).resolves.toMatchObject({ user_id: user.id, notifications_enabled: false })
    await expect(bindQqBotAccount(qq, fresh.binding_code)).rejects.toMatchObject({ code: 'binding_code_invalid' })
    await expect(createQqBotBindingCode(user.id)).rejects.toMatchObject({ code: 'already_bound' })
  })

  it('allows exactly one concurrent redemption and keeps conflicting codes reusable after rollback', async () => {
    const first = await fixture()
    const attempts = await Promise.allSettled([
      bindQqBotAccount(first.qq, first.code.binding_code),
      bindQqBotAccount(String(++qqSequence), first.code.binding_code),
    ])
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1)
    const bound = await getUserQqBotBinding(first.user.id)
    const second = await fixture()
    await expect(bindQqBotAccount(bound!.qq_number, second.code.binding_code)).rejects.toMatchObject({ code: 'binding_conflict' })
    await expect(bindQqBotAccount(second.qq, second.code.binding_code)).resolves.toMatchObject({ user_id: second.user.id })
  })

  it('enqueues only opted-in schedules and applies transaction rollback and result deduplication', async () => {
    const { user, qq, code, profileId } = await fixture()
    const binding = await bindQqBotAccount(qq, code.binding_code)
    await enqueue(profileId)
    expect((await listQqBotScheduleNotifications(100)).notifications.filter((row) => row.binding_id === binding.id)).toEqual([])
    await setQqBotNotifications(user.id, true)
    const resultId = await enqueue(profileId)
    await enqueue(profileId, resultId)
    await expect(withTransaction(async (client) => {
      await enqueueQqBotScheduleNotificationInTransaction(client, {
        profileId, resultId: 'rolled-back', title: '回滚', now: new Date().toISOString(),
      })
      throw new Error('rollback')
    })).rejects.toThrow('rollback')
    const pending = (await listQqBotScheduleNotifications(100)).notifications.filter((row) => row.binding_id === binding.id)
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({ profile_id: profileId, result_id: resultId, qq_number: qq })
  })

  it('scopes acknowledgements to the recipient and makes them idempotent', async () => {
    const first = await fixture()
    await bindQqBotAccount(first.qq, first.code.binding_code)
    await setQqBotNotifications(first.user.id, true)
    const resultId = await enqueue(first.profileId)
    const second = await fixture()
    await bindQqBotAccount(second.qq, second.code.binding_code)
    const pending = (await listQqBotScheduleNotifications(100)).notifications.find((row) => row.result_id === resultId)!
    await expect(acknowledgeQqBotNotification(second.qq, pending.id)).rejects.toMatchObject({ code: 'notification_not_found' })
    await acknowledgeQqBotNotification(first.qq, pending.id)
    await acknowledgeQqBotNotification(first.qq, pending.id)
    expect((await listQqBotScheduleNotifications(100)).notifications.some((row) => row.id === pending.id)).toBe(false)
  })

  it('cancels pending notifications when disabled and prevents resurrection after rebinding', async () => {
    const { user, qq, code, profileId } = await fixture()
    const original = await bindQqBotAccount(qq, code.binding_code)
    await setQqBotNotifications(user.id, true)
    const cancelled = await enqueue(profileId)
    await setQqBotNotifications(user.id, false)
    await setQqBotNotifications(user.id, true)
    expect((await listQqBotScheduleNotifications(100)).notifications.some((row) => row.result_id === cancelled)).toBe(false)
    const oldResult = await enqueue(profileId)
    await unbindQqBotAccount(user.id)
    const fresh = await createQqBotBindingCode(user.id)
    const rebound = await bindQqBotAccount(qq, fresh.binding_code)
    expect(rebound.id).not.toBe(original.id)
    expect(rebound.notifications_enabled).toBe(false)
    await expect(setQqBotNotifications(user.id, true, original.id)).rejects.toMatchObject({ code: 'account_not_bound' })
    await expect(unbindQqBotAccount(user.id, original.id)).rejects.toMatchObject({ code: 'binding_changed' })
    expect((await listQqBotScheduleNotifications(100)).notifications.some((row) => row.result_id === oldResult)).toBe(false)
  })

  it('paginates pending failures without requiring earlier notifications to be acknowledged', async () => {
    const { user, qq, code, profileId } = await fixture()
    await bindQqBotAccount(qq, code.binding_code)
    await setQqBotNotifications(user.id, true)
    const ids = [await enqueue(profileId), await enqueue(profileId), await enqueue(profileId)]
    const collected: string[] = []
    let cursor: string | null = null
    do {
      const page = await listQqBotScheduleNotifications(1, cursor)
      collected.push(...page.notifications.map((row) => row.result_id))
      cursor = page.next_cursor
    } while (cursor)
    expect(collected.filter((id) => ids.includes(id))).toHaveLength(3)
    expect(new Set(collected).size).toBe(collected.length)
    await expect(listQqBotScheduleNotifications(1, 'malformed')).rejects.toMatchObject({ code: 'invalid_cursor' })
  })

  it('blocks frozen accounts and cascades binding and notification data on account deletion', async () => {
    const { user, qq, code, profileId } = await fixture()
    await bindQqBotAccount(qq, code.binding_code)
    await setQqBotNotifications(user.id, true)
    const resultId = await enqueue(profileId)
    await saveUserAccount({ ...user, status: 'frozen' })
    await expect(getQqBotAccount(qq)).rejects.toMatchObject({ code: 'account_unavailable' })
    expect((await listQqBotScheduleNotifications(100)).notifications.some((row) => row.result_id === resultId)).toBe(false)
    await query('delete from user_accounts where id = $1', [user.id])
    expect((await query('select id from qqbot_account_bindings where qq_number = $1', [qq])).rows).toEqual([])
    expect((await query('select id from qqbot_schedule_notifications where result_id = $1', [resultId])).rows).toEqual([])
  })
})
