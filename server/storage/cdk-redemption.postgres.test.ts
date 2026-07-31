import { randomUUID } from 'node:crypto'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closePool, query, withTransaction } from './postgres'
import { ensureDatabaseSchema } from './schema'
import { CdkAlreadyRedeemedError, createRequestHash, redeemCdkAtomically, saveProfileInTransaction, saveWorkspaceInTransaction } from './cdk-redemption'
import { createPostgresCdkRecordStore } from './cdk-store'
import { createPostgresUsageEventStore } from './usage-store'
import { emptyWorkspace, type UserGameAccountRecord } from './user-store'
import { isProfileCdkRecord, type CdkRecord, type LegacyProfileCdkRecord } from '../handlers/license-utils'
import { adjustBalance, applyBalanceChangeInTransaction, BalanceError, createBalanceRequestHash, getBalanceSummary, releaseScheduleBalanceInTransaction, reserveScheduleBalanceInTransaction, reverseQualificationCredit, settleScheduleBalanceInTransaction } from './balance-store'
import { getMeteredScheduleQuote } from '../../src/lib/metered-billing'
import { createCommercialProfile, createOrConvertMeteredPersonal, deleteCommercialProfile, patchCommercialProfile, updateCommercialAccount } from './metered-profile-store'
import { getItemBalance, grantItemInTransaction } from './inventory-store'

let container: StartedPostgreSqlContainer

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  process.env.DATABASE_URL = container.getConnectionUri()
  await ensureDatabaseSchema()
})

afterAll(async () => {
  await closePool()
  if (container) await container.stop()
})

describe('CDK redemption PostgreSQL concurrency', () => {
  it('allows only one concurrent claimant and persists exactly one authorization record', async () => {
    const key = await seedCdk()
    const attempt = (orderHash: string) => redeemCdkAtomically({
      key,
      idempotencyScope: `concurrent:${orderHash}`,
      requestHash: orderHash,
      complete: async (_client, record) => ({
        record: { ...record, status: 'used' as const, used_at: new Date().toISOString(), license_order_hash: orderHash },
        response: { orderHash },
      }),
    })
    const results = await Promise.allSettled([attempt('order-a'), attempt('order-b')])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected' && result.reason instanceof CdkAlreadyRedeemedError)).toHaveLength(1)
    const row = await query<{ status: string; license_order_hash: string }>('select status, license_order_hash from cdk_records where key = $1', [key])
    expect(row.rows[0]).toMatchObject({ status: 'used' })
    expect(['order-a', 'order-b']).toContain(row.rows[0]?.license_order_hash)
  })

  it('builds dashboard account additions from CDK redemptions and free preview claims', async () => {
    const date = new Date().toISOString().slice(0, 10)
    const store = createPostgresUsageEventStore()
    const before = await store.getStats([date])

    await seedUsedCdk()
    const claimedAt = new Date().toISOString()
    const claim = {
      uid_hash: randomUUID().replaceAll('-', ''),
      user_id: randomUUID(),
      profile_id: randomUUID(),
      claimed_at: claimedAt,
    }
    await query(
      `insert into free_preview_claims (uid_hash, user_id, profile_id, claimed_at, record_json)
       values ($1, $2, $3, $4, $5::jsonb)`,
      [claim.uid_hash, claim.user_id, claim.profile_id, claim.claimed_at, JSON.stringify(claim)],
    )

    const after = await store.getStats([date])
    expect(after.totals.cdk_redeems - before.totals.cdk_redeems).toBe(1)
    expect(after.totals.free_previews - before.totals.free_previews).toBe(1)
    expect(after.totals.account_additions - before.totals.account_additions).toBe(2)
    expect(after.days[0]).toMatchObject({
      cdk_redeems: after.totals.cdk_redeems,
      free_previews: after.totals.free_previews,
      account_additions: after.totals.account_additions,
    })
  })

  it('replays a completed idempotent request and rejects a mismatched key reuse', async () => {
    const key = await seedCdk()
    const run = (requestHash: string) => redeemCdkAtomically({
      key,
      idempotencyKey: 'same-key',
      idempotencyScope: 'license-file',
      requestHash,
      complete: async (_client, record) => ({
        record: { ...record, status: 'used' as const, used_at: new Date().toISOString(), license_order_hash: 'order-replay' },
        response: { profile_id: 'profile-a' },
      }),
    })
    expect((await run('request-a')).replayed).toBe(false)
    expect(await run('request-a')).toEqual({ response: { profile_id: 'profile-a' }, replayed: true })
    await expect(run('request-b')).rejects.toMatchObject({ name: 'IdempotencyConflictError' })
  })

  it('rolls back profile and workspace when completion fails', async () => {
    const key = await seedCdk()
    const profileId = randomUUID()
    const userId = randomUUID()
    await query(
      `insert into user_accounts (id,email,password_hash,salt,iterations,permission,status,record_json,created_at,updated_at)
       values ($1,$2,'hash','salt',1,'growth','active',$3::jsonb,now(),now())`,
      [userId, `${userId}@example.test`, JSON.stringify({ version: 1, id: userId, email: `${userId}@example.test` })],
    )
    await expect(redeemCdkAtomically({
      key,
      idempotencyScope: 'rollback',
      requestHash: createRequestHash({ profileId }),
      complete: async (client, record) => {
        const profile: UserGameAccountRecord = {
          version: 1, id: profileId, user_id: userId, kind: 'cdk', cdk_key: key, cdk_code_hash: record.code_hash,
          cdk_order_hash: 'order-rollback', permission: 'growth', status: 'active', display_name: 'Account', note: '', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }
        await saveProfileInTransaction(client, profile)
        await saveWorkspaceInTransaction(client, emptyWorkspace(profile.id))
        throw new Error('injected failure')
      },
    })).rejects.toThrow('injected failure')
    expect((await query('select 1 from user_game_accounts where id = $1', [profileId])).rowCount).toBe(0)
    expect((await query<{ status: string }>('select status from cdk_records where key = $1', [key])).rows[0]?.status).toBe('unused')
  })

  it('does not increment a stale job snapshot after the CDK is revoked or frozen', async () => {
    const store = createPostgresCdkRecordStore()
    const revokedKey = await seedUsedCdk({ schedule_generate_count: 3, permission: 'growth' })
    const staleRevoked = await store.get(revokedKey)
    await store.mutate(revokedKey, (current) => ({ ...current, status: 'revoked', revoked_at: new Date().toISOString() }), { allowedStatuses: ['used', 'frozen'] })
    expect(await store.incrementScheduleGenerateCount(revokedKey)).toBe(false)
    expect(await store.get(revokedKey)).toMatchObject({
      status: 'revoked',
      permission: 'growth',
      schedule_generate_count: staleRevoked?.schedule_generate_count,
    })

    const frozenKey = await seedUsedCdk({ schedule_generate_count: 7, freeze_reason: 'risk event', risk_events: [{ at: new Date().toISOString(), type: 'risk', reason: 'risk event' }] })
    await store.mutate(frozenKey, (current) => ({ ...current, status: 'frozen', frozen_at: new Date().toISOString() }), { allowedStatuses: ['used'] })
    expect(await store.incrementScheduleGenerateCount(frozenKey)).toBe(false)
    expect(await store.get(frozenKey)).toMatchObject({
      status: 'frozen',
      freeze_reason: 'risk event',
      schedule_generate_count: 7,
    })
  })

  it('atomically counts concurrent schedule completions and preserves the revoked terminal state', async () => {
    const store = createPostgresCdkRecordStore()
    const key = await seedUsedCdk({ schedule_generate_count: 0 })
    const increments = await Promise.all(Array.from({ length: 24 }, () => store.incrementScheduleGenerateCount(key)))
    expect(increments.every(Boolean)).toBe(true)
    expect(await store.get(key)).toMatchObject({ status: 'used', schedule_generate_count: 24 })

    await Promise.all([
      store.mutate(key, (current) => isProfileCdkRecord(current) ? { ...current, permission: 'ultimate' } : current),
      store.mutate(key, (current) => ({
        ...current,
        risk_events: [...(current.risk_events ?? []), { at: new Date().toISOString(), type: 'concurrent_risk', reason: 'captured' }],
      })),
    ])
    await store.mutate(key, (current) => ({ ...current, status: 'revoked', revoked_at: new Date().toISOString() }), { allowedStatuses: ['used', 'frozen'] })
    const result = await store.mutate(key, (current) => isProfileCdkRecord(current) ? { ...current, status: 'used', permission: 'growth' } : current)
    expect(result).toMatchObject({ status: 'revoked', permission: 'ultimate' })
    expect(result?.risk_events?.some((event) => event.type === 'concurrent_risk')).toBe(true)
    expect((await query<{ record_revision: number }>('select record_revision from cdk_records where key = $1', [key])).rows[0]?.record_revision).toBeGreaterThan(0)
  })

  it('increments a schedule completion only once for the same optimization job', async () => {
    const store = createPostgresCdkRecordStore()
    const key = await seedUsedCdk({ schedule_generate_count: 0 })
    const jobId = randomUUID()
    await query(
      `insert into optimize_jobs
        (id, status, priority, owner_key, permission, source, payload_json, created_at, updated_at)
       values ($1, 'running', 10, $2, 'growth', 'account_profile', '{}'::jsonb, now(), now())`,
      [jobId, `license:${randomUUID()}`],
    )

    const results = await Promise.all(Array.from({ length: 8 }, () => store.incrementScheduleGenerateCount(key, jobId)))

    expect(results.every(Boolean)).toBe(true)
    expect(await store.get(key)).toMatchObject({ schedule_generate_count: 1 })
    expect((await query<{ count: string }>(
      `select count(*)::text as count from optimization_job_effects
       where job_id = $1 and effect_type = 'cdk_schedule_generate'`,
      [jobId],
    )).rows[0]?.count).toBe('1')
  })

  it('credits a balance CDK exactly once under concurrent redemption', async () => {
    const userId = await seedUser()
    const { key, codeHash } = await seedBalanceCdk('12.30')
    const attempt = () => redeemCdkAtomically({
      key,
      idempotencyScope: `balance:${userId}`,
      requestHash: createRequestHash({ codeHash, userId }),
      complete: async (client, record) => {
        if (record.cdk_type !== 'balance') throw new Error('expected balance CDK')
        const change = await applyBalanceChangeInTransaction(client, {
          userId,
          kind: 'cdk_credit',
          amount: record.balance_amount,
          referenceType: 'balance_cdk',
          referenceId: codeHash,
        })
        return {
          record: { ...record, status: 'used' as const, used_at: new Date().toISOString(), account_id: userId },
          response: { available: change.transaction.balance_after },
        }
      },
    })

    const results = await Promise.allSettled([attempt(), attempt()])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected' && result.reason instanceof CdkAlreadyRedeemedError)).toHaveLength(1)
    expect((await query<{ available: string }>('select available::text from user_balance_accounts where user_id = $1', [userId])).rows[0]?.available).toBe('12.30')
    expect((await query<{ count: string }>('select count(*)::text as count from user_balance_transactions where user_id = $1', [userId])).rows[0]?.count).toBe('1')
  })

  it('rolls back the balance ledger and CDK claim when completion fails', async () => {
    const userId = await seedUser()
    const { key, codeHash } = await seedBalanceCdk('5.00')
    await expect(redeemCdkAtomically({
      key,
      idempotencyScope: `balance-rollback:${userId}`,
      requestHash: createRequestHash({ codeHash, userId }),
      complete: async (client, record) => {
        if (record.cdk_type !== 'balance') throw new Error('expected balance CDK')
        await applyBalanceChangeInTransaction(client, {
          userId,
          kind: 'cdk_credit',
          amount: record.balance_amount,
          referenceType: 'balance_cdk',
          referenceId: codeHash,
        })
        throw new Error('injected balance failure')
      },
    })).rejects.toThrow('injected balance failure')

    expect((await query('select 1 from user_balance_accounts where user_id = $1', [userId])).rowCount).toBe(0)
    expect((await query('select 1 from user_balance_transactions where user_id = $1', [userId])).rowCount).toBe(0)
    expect((await query<{ status: string }>('select status from cdk_records where key = $1', [key])).rows[0]?.status).toBe('unused')
  })

  it('grants exactly one item under concurrent redemption of the same item CDK', async () => {
    const userId = await seedUser()
    const { key, codeHash } = await seedItemCdk('lifetime_profile_voucher', null)
    const attempt = () => redeemCdkAtomically({
      key,
      idempotencyScope: `item:${userId}`,
      requestHash: createRequestHash({ codeHash, userId }),
      complete: async (client, record) => {
        if (record.cdk_type !== 'item' || record.version !== 3) throw new Error('expected item CDK')
        await grantItemInTransaction(client, {
          userId, itemCode: record.item_code, quantity: 1, expiry: { mode: 'never' }, expiresAt: record.item_expires_at,
          sourceType: 'item_cdk', sourceId: codeHash, recipientRole: 'redeemer',
        })
        return {
          record: { ...record, status: 'used' as const, used_at: new Date().toISOString(), account_id: userId },
          response: { item_code: record.item_code },
        }
      },
    })

    const results = await Promise.allSettled([attempt(), attempt()])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected' && result.reason instanceof CdkAlreadyRedeemedError)).toHaveLength(1)
    expect(await getItemBalance(userId, 'lifetime_profile_voucher')).toBe(1)
    expect((await query<{ count: string }>(
      `select count(*)::text as count from inventory_ledger
        where user_id = $1 and item_code = 'lifetime_profile_voucher' and event_type = 'grant'`, [userId],
    )).rows[0]?.count).toBe('1')
  })

  it('rolls back an item grant when item CDK completion fails', async () => {
    const userId = await seedUser()
    const { key, codeHash } = await seedItemCdk('lifetime_profile_voucher', null)
    await expect(redeemCdkAtomically({
      key,
      idempotencyScope: `item-rollback:${userId}`,
      requestHash: createRequestHash({ codeHash, userId }),
      complete: async (client, record) => {
        if (record.cdk_type !== 'item' || record.version !== 3) throw new Error('expected item CDK')
        await grantItemInTransaction(client, {
          userId, itemCode: record.item_code, quantity: 1, expiry: { mode: 'never' },
          sourceType: 'item_cdk', sourceId: codeHash, recipientRole: 'redeemer',
        })
        throw new Error('injected item failure')
      },
    })).rejects.toThrow('injected item failure')
    expect(await getItemBalance(userId, 'lifetime_profile_voucher')).toBe(0)
    expect((await query<{ status: string }>('select status from cdk_records where key = $1', [key])).rows[0]?.status).toBe('unused')
  })

  it('serializes concurrent admin adjustments and preserves idempotent responses', async () => {
    const userId = await seedUser()
    const initial = await adjustBalance({
      userId,
      kind: 'admin_credit',
      amount: '10.00',
      referenceType: 'admin_adjustment',
      referenceId: randomUUID(),
      idempotencyKey: 'initial-credit',
      adminUsername: 'root',
      reason: 'initial',
    })
    expect(initial.balance.available).toBe('10.00')

    await Promise.all(Array.from({ length: 20 }, (_, index) => adjustBalance({
      userId,
      kind: 'admin_credit',
      amount: '0.50',
      referenceType: 'admin_adjustment',
      referenceId: randomUUID(),
      idempotencyKey: `concurrent-credit-${index}`,
      adminUsername: 'root',
      reason: 'concurrency test',
    })))
    expect((await query<{ available: string }>('select available::text from user_balance_accounts where user_id = $1', [userId])).rows[0]?.available).toBe('20.00')

    const replayHash = createBalanceRequestHash({ userId, operation: 'credit', amount: '1.00', reason: 'retry', adminUsername: 'root' })
    const replayInput = {
      userId,
      kind: 'admin_credit' as const,
      amount: '1.00',
      referenceType: 'admin_adjustment',
      idempotencyKey: 'retry-key',
      adminUsername: 'root',
      reason: 'retry',
      requestHash: replayHash,
    }
    const first = await adjustBalance({ ...replayInput, referenceId: randomUUID() })
    const replay = await adjustBalance({ ...replayInput, referenceId: randomUUID() })
    expect(replay).toEqual({ ...first, replayed: true })
    await expect(adjustBalance({
      ...replayInput,
      amount: '2.00',
      requestHash: createBalanceRequestHash({ userId, operation: 'credit', amount: '2.00', reason: 'retry', adminUsername: 'root' }),
      referenceId: randomUUID(),
    })).rejects.toMatchObject({ code: 'idempotency_conflict' })

    const transactionCount = (await query<{ count: string }>('select count(*)::text as count from user_balance_transactions where user_id = $1', [userId])).rows[0]?.count
    await expect(adjustBalance({
      userId,
      kind: 'admin_debit',
      amount: '100.00',
      referenceType: 'admin_adjustment',
      referenceId: randomUUID(),
      idempotencyKey: 'overdraft',
      adminUsername: 'root',
      reason: 'must fail',
    })).rejects.toBeInstanceOf(BalanceError)
    expect((await query<{ count: string }>('select count(*)::text as count from user_balance_transactions where user_id = $1', [userId])).rows[0]?.count).toBe(transactionCount)
    expect((await query<{ available: string }>('select available::text from user_balance_accounts where user_id = $1', [userId])).rows[0]?.available).toBe('21.00')
  })

  it('tracks post-launch qualification credits, admin reversals, debt, and automatic repayment', async () => {
    const userId = await seedUser()
    const credited = await adjustBalance({
      userId, kind: 'admin_credit', amount: '10000.00', referenceType: 'admin_adjustment',
      referenceId: randomUUID(), idempotencyKey: 'qualification-credit', adminUsername: 'root', reason: 'commercial activation',
    })
    expect(credited.balance.commercial).toMatchObject({ eligible: true, level: 1, charge_points: '900.00' })
    await adjustBalance({
      userId, kind: 'admin_debit', amount: '10000.00', referenceType: 'admin_adjustment',
      referenceId: randomUUID(), idempotencyKey: 'normal-spend', adminUsername: 'root', reason: 'normal debit does not affect tier',
    })
    expect((await getBalanceSummary(userId)).commercial.level).toBe(1)

    const reversed = await reverseQualificationCredit({
      userId, originalTransactionId: credited.transaction.id, amount: '1000.00',
      reason: 'fraud correction', idempotencyKey: 'qualification-reversal', adminUsername: 'root',
    })
    expect(reversed.balance).toMatchObject({ available: '0.00', debt: '1000.00', lifetime_credited: '9000.00' })
    expect(reversed.balance.commercial.eligible).toBe(false)
    const partiallyReversedAgain = await reverseQualificationCredit({
      userId, originalTransactionId: credited.transaction.id, amount: '500.00',
      reason: 'second fraud correction', idempotencyKey: 'qualification-second-reversal', adminUsername: 'root',
    })
    expect(partiallyReversedAgain.balance).toMatchObject({ available: '0.00', debt: '1500.00', lifetime_credited: '8500.00' })
    await expect(reverseQualificationCredit({
      userId, originalTransactionId: credited.transaction.id, amount: '9000.00',
      reason: 'too much', idempotencyKey: 'qualification-over-reversal', adminUsername: 'root',
    })).rejects.toMatchObject({ code: 'reversal_exceeds_credit' })

    await adjustBalance({
      userId, kind: 'admin_credit', amount: '400.00', referenceType: 'admin_adjustment',
      referenceId: randomUUID(), idempotencyKey: 'debt-repayment-credit', adminUsername: 'root', reason: 'future credit',
    })
    expect(await getBalanceSummary(userId)).toMatchObject({ available: '0.00', debt: '1100.00', lifetime_credited: '8900.00' })
    expect((await query<{ count: string }>("select count(*)::text as count from user_balance_transactions where user_id = $1 and kind = 'debt_repayment'", [userId])).rows[0]?.count).toBe('1')
    expect((await query<{ count: string }>("select count(*)::text as count from user_balance_qualification_ledger where user_id = $1 and delta < 0", [userId])).rows[0]?.count).toBe('2')
  })

  it('serializes schedule reservations and settles or releases each job exactly once', async () => {
    const userId = await seedUser()
    await adjustBalance({
      userId, kind: 'admin_credit', amount: '1200.00', referenceType: 'admin_adjustment',
      referenceId: randomUUID(), idempotencyKey: 'reservation-funding', adminUsername: 'root', reason: 'reservation test',
    })
    const quote = getMeteredScheduleQuote('metered_personal')
    const jobIds = [randomUUID(), randomUUID(), randomUUID()]
    const reserve = (jobId: string) => withTransaction((client) => reserveScheduleBalanceInTransaction(client, {
      jobId, userId, profileId: 'metered-profile', quote,
    }))
    const firstTwo = await Promise.all([reserve(jobIds[0]!), reserve(jobIds[1]!)])
    expect(firstTwo.map((item) => item.status)).toEqual(['reserved', 'reserved'])
    await expect(reserve(jobIds[2]!)).rejects.toMatchObject({ code: 'insufficient_balance' })
    expect(await getBalanceSummary(userId)).toMatchObject({ available: '0.00', reserved: '1200.00' })

    await withTransaction((client) => settleScheduleBalanceInTransaction(client, jobIds[0]!))
    await withTransaction((client) => settleScheduleBalanceInTransaction(client, jobIds[0]!))
    await withTransaction((client) => releaseScheduleBalanceInTransaction(client, jobIds[1]!))
    await withTransaction((client) => releaseScheduleBalanceInTransaction(client, jobIds[1]!))
    expect(await getBalanceSummary(userId)).toMatchObject({ available: '600.00', reserved: '0.00' })
    expect((await query<{ count: string }>("select count(*)::text as count from user_balance_transactions where user_id = $1 and kind = 'schedule_debit'", [userId])).rows[0]?.count).toBe('1')
  })

  it('enforces lifetime personal and transactional commercial profile limits', async () => {
    const personalUserId = await seedUser()
    const personalAttempts = await Promise.allSettled([
      createOrConvertMeteredPersonal({ userId: personalUserId, displayName: '个人 A' }),
      createOrConvertMeteredPersonal({ userId: personalUserId, displayName: '个人 B' }),
    ])
    expect(personalAttempts.filter((item) => item.status === 'fulfilled')).toHaveLength(2)
    expect((await query<{ count: string }>("select count(*)::text as count from user_game_accounts where user_id = $1 and kind = 'metered_personal'", [personalUserId])).rows[0]?.count).toBe('1')
    expect((await query<{ count: string }>("select count(*)::text as count from user_profile_workspaces where profile_id = (select profile_id from metered_personal_claims where user_id = $1)", [personalUserId])).rows[0]?.count).toBe('1')

    const commercialUserId = await seedUser()
    await adjustBalance({
      userId: commercialUserId, kind: 'admin_credit', amount: '10000.00', referenceType: 'admin_adjustment',
      referenceId: randomUUID(), idempotencyKey: 'commercial-profile-funding', adminUsername: 'root', reason: 'activate commercial',
    })
    await updateCommercialAccount({ userId: commercialUserId, activeLimit: 1, totalLimit: 2 })
    const first = await createCommercialProfile({ userId: commercialUserId, displayName: '商用一号' })
    expect((await query<{ count: string }>('select count(*)::text as count from user_profile_workspaces where profile_id = $1', [first.profile.id])).rows[0]?.count).toBe('1')
    await expect(createCommercialProfile({ userId: commercialUserId, displayName: '并发越限' })).rejects.toMatchObject({ code: 'active_profile_limit' })
    await patchCommercialProfile({ userId: commercialUserId, profileId: first.profile.id, action: 'archive' })
    const second = await createCommercialProfile({ userId: commercialUserId, displayName: '商用二号' })
    await expect(createCommercialProfile({ userId: commercialUserId, displayName: '总量越限' })).rejects.toMatchObject({ code: 'total_profile_limit' })
    await deleteCommercialProfile({ userId: commercialUserId, profileId: first.profile.id, confirmed: true })
    await expect(patchCommercialProfile({ userId: commercialUserId, profileId: second.profile.id, action: 'archive' })).resolves.toBeTruthy()
    await expect(createCommercialProfile({ userId: commercialUserId, displayName: '删除释放总量' })).resolves.toBeTruthy()
  })

  it('deletes balance accounts and transactions with the user', async () => {
    const userId = await seedUser()
    await adjustBalance({
      userId,
      kind: 'admin_credit',
      amount: '1.00',
      referenceType: 'admin_adjustment',
      referenceId: randomUUID(),
      idempotencyKey: 'cascade-credit',
      adminUsername: 'root',
      reason: 'cascade test',
    })
    await query('delete from user_accounts where id = $1', [userId])
    expect((await query('select 1 from user_balance_accounts where user_id = $1', [userId])).rowCount).toBe(0)
    expect((await query('select 1 from user_balance_transactions where user_id = $1', [userId])).rowCount).toBe(0)
  })
})

async function seedCdk(): Promise<string> {
  const codeHash = randomUUID().replaceAll('-', '')
  const key = `cdk/${codeHash}.json`
  const record: LegacyProfileCdkRecord = {
    version: 1, code_hash: codeHash, permission: 'growth', status: 'unused', created_at: new Date().toISOString(), used_at: null,
    order_note: null, license_order_hash: null, operator_count: null, config_desc: null,
  }
  await query(
    `insert into cdk_records (key, code_hash, status, permission, license_order_hash, record_json, created_at, updated_at)
     values ($1,$2,$3,$4,$5,$6::jsonb,now(),now())`,
    [key, record.code_hash, record.status, record.permission, null, JSON.stringify(record)],
  )
  return key
}

async function seedUsedCdk(overrides: Partial<LegacyProfileCdkRecord> = {}): Promise<string> {
  const key = await seedCdk()
  const stored = await query<{ record_json: CdkRecord }>('select record_json from cdk_records where key = $1', [key])
  if (stored.rows[0]!.record_json.version !== 1) throw new Error('expected legacy profile CDK fixture')
  const record: LegacyProfileCdkRecord = {
    ...stored.rows[0]!.record_json,
    ...overrides,
    status: 'used',
    used_at: new Date().toISOString(),
    license_order_hash: overrides.license_order_hash ?? randomUUID(),
  }
  await query(
    `update cdk_records
     set status = $2, permission = $3, license_order_hash = $4, record_json = $5::jsonb, updated_at = now()
     where key = $1`,
    [key, record.status, record.permission, record.license_order_hash, JSON.stringify(record)],
  )
  return key
}

async function seedUser(): Promise<string> {
  const userId = randomUUID()
  await query(
    `insert into user_accounts (id,email,password_hash,salt,iterations,permission,status,record_json,created_at,updated_at)
     values ($1,$2,'hash','salt',1,'growth','active',$3::jsonb,now(),now())`,
    [userId, `${userId}@example.test`, JSON.stringify({ version: 1, id: userId, email: `${userId}@example.test` })],
  )
  return userId
}

async function seedBalanceCdk(amount: string): Promise<{ key: string; codeHash: string }> {
  const codeHash = randomUUID().replaceAll('-', '')
  const key = `cdk/${codeHash}.json`
  const record: CdkRecord = {
    version: 2,
    cdk_type: 'balance',
    code_hash: codeHash,
    permission: null,
    balance_amount: amount,
    status: 'unused',
    created_at: new Date().toISOString(),
    used_at: null,
    order_note: null,
    license_order_hash: null,
    operator_count: null,
    config_desc: null,
  }
  await query(
    `insert into cdk_records (key, code_hash, cdk_type, status, permission, balance_amount, license_order_hash, record_json, created_at, updated_at)
     values ($1,$2,'balance',$3,null,$4::numeric,null,$5::jsonb,now(),now())`,
    [key, codeHash, record.status, amount, JSON.stringify(record)],
  )
  return { key, codeHash }
}

async function seedItemCdk(
  itemCode: 'lifetime_profile_voucher' | 'limited_profile_voucher',
  itemExpiresAt: string | null,
): Promise<{ key: string; codeHash: string }> {
  const codeHash = randomUUID().replaceAll('-', '')
  const key = `cdk/${codeHash}.json`
  const record: CdkRecord = {
    version: 3,
    cdk_type: 'item',
    code_hash: codeHash,
    permission: null,
    balance_amount: null,
    item_code: itemCode,
    item_expires_at: itemExpiresAt,
    status: 'unused',
    created_at: new Date().toISOString(),
    used_at: null,
    order_note: null,
    license_order_hash: null,
    operator_count: null,
    config_desc: null,
  }
  await createPostgresCdkRecordStore().create(key, record)
  return { key, codeHash }
}
