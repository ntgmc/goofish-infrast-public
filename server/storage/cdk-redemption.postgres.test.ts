import { randomUUID } from 'node:crypto'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closePool, query } from './postgres'
import { ensureDatabaseSchema } from './schema'
import { CdkAlreadyRedeemedError, createRequestHash, redeemCdkAtomically, saveProfileInTransaction, saveWorkspaceInTransaction } from './cdk-redemption'
import { createPostgresCdkRecordStore } from './cdk-store'
import { emptyWorkspace, type UserGameAccountRecord } from './user-store'
import type { CdkRecord } from '../handlers/license-utils'

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

  it('replays a completed idempotent request and rejects a mismatched key reuse', async () => {
    const key = await seedCdk()
    const run = (requestHash: string) => redeemCdkAtomically({
      key,
      idempotencyKey: 'same-key',
      idempotencyScope: 'license-file',
      requestHash,
      complete: async (_client, record) => ({
        record: { ...record, status: 'used' as const, used_at: new Date().toISOString(), license_order_hash: 'order-replay' },
        response: { license_file_content: 'original-content' },
      }),
    })
    expect((await run('request-a')).replayed).toBe(false)
    expect(await run('request-a')).toEqual({ response: { license_file_content: 'original-content' }, replayed: true })
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
      store.mutate(key, (current) => ({ ...current, permission: 'ultimate' })),
      store.mutate(key, (current) => ({
        ...current,
        risk_events: [...(current.risk_events ?? []), { at: new Date().toISOString(), type: 'concurrent_risk', reason: 'captured' }],
      })),
    ])
    await store.mutate(key, (current) => ({ ...current, status: 'revoked', revoked_at: new Date().toISOString() }), { allowedStatuses: ['used', 'frozen'] })
    const result = await store.mutate(key, (current) => ({ ...current, status: 'used', permission: 'growth' }))
    expect(result).toMatchObject({ status: 'revoked', permission: 'ultimate' })
    expect(result?.risk_events?.some((event) => event.type === 'concurrent_risk')).toBe(true)
    expect((await query<{ record_revision: number }>('select record_revision from cdk_records where key = $1', [key])).rows[0]?.record_revision).toBeGreaterThan(0)
  })
})

async function seedCdk(): Promise<string> {
  const codeHash = randomUUID().replaceAll('-', '')
  const key = `cdk/${codeHash}.json`
  const record: CdkRecord = {
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

async function seedUsedCdk(overrides: Partial<CdkRecord> = {}): Promise<string> {
  const key = await seedCdk()
  const stored = await query<{ record_json: CdkRecord }>('select record_json from cdk_records where key = $1', [key])
  const record: CdkRecord = {
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
