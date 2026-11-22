import { randomUUID } from 'node:crypto'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { closePool, query, withTransaction } from './postgres'
import { migrateDatabaseSchema } from './schema'
import { getPublicValueClock } from './value-clock-store'
import { syncValueClockHistory } from './value-clock-sync'

let container: StartedPostgreSqlContainer
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  process.env.DATABASE_URL = container.getConnectionUri()
  await migrateDatabaseSchema()
})
afterAll(async () => { await closePool(); if (container) await container.stop() })
beforeEach(async () => {
  await query('delete from user_accounts')
  await query('delete from value_clock_pending')
  await query('delete from value_clock_daily_totals')
  await query("update value_clock_series set started_at = null, revision = 0 where id = 'production-v1'")
})
async function fixture(uid: string | null = null, userId = randomUUID()) {
  const profileId = randomUUID()
  await query(`insert into user_accounts(id, email, password_hash, salt, iterations, permission, status, record_json, created_at, updated_at)
    values ($1, $2, 'hash', 'salt', 1, 'recommended', 'active', '{}'::jsonb, now(), now()) on conflict(id) do nothing`, [userId, `${userId}@example.test`])
  const profile = { id: profileId, user_id: userId, status: 'active', skland_binding: uid ? { uid, last_imported_at: null } : null }
  await query(`insert into user_game_accounts(id, user_id, permission, status, display_name, note, record_json, created_at, updated_at, kind)
    values ($1, $2, 'recommended', 'active', '价值时钟', '', $3, now(), now(), 'cdk')`, [profileId, userId, JSON.stringify(profile)])
  const save = async (id: string, secondsAgo: number, lmd = 240000, config: unknown = null, hours = 24) => {
    const result = { plans: [{ rooms: { manufacture: [{}] } }], daily_production: { hours, manufacturing: {}, consumption: {}, trading: { LMD: lmd } } }
    await query(`insert into optimization_result_history(profile_id, id, name, created_at, config_json, result_json, source)
      values ($1, $2, $2, (now() - $3 * interval '1 second')::text, $4, $5, 'generated')`, [profileId, id, secondsAgo, config, JSON.stringify(result)])
  }
  return { profileId, userId, save }
}

it('backfills old history before seven days, includes unbound accounts, and switches by saved timestamps', async () => {
  expect((await getPublicValueClock()).status).toBe('not_started')
  const a = await fixture()
  await a.save('old', 10 * 86400)
  await a.save('new', 100, 480000)
  await withTransaction(syncValueClockHistory)
  const snapshot = await getPublicValueClock()
  expect(snapshot.active_accounts).toBe(1)
  expect(snapshot.rates_per_second?.sanity).toBeCloseTo(.02)
  expect(snapshot.totals?.sanity).toBeCloseTo(8640 + 1, 1)
  expect(Date.parse(snapshot.tracking_started_at!)).toBeLessThan(Date.now() - 9 * 86400000)
  const intervals = await query('select started_at, ends_at from value_clock_intervals order by started_at')
  expect(intervals.rows).toHaveLength(2)
  expect(intervals.rows[0].ends_at).toEqual(intervals.rows[1].started_at)
  expect(intervals.rows[1].ends_at).toBeNull()
  const revision = snapshot.revision
  await withTransaction(syncValueClockHistory)
  expect((await getPublicValueClock()).revision).toBe(revision)
})

it('automatically processes new results and deduplicates bound aliases across concurrent reads', async () => {
  const uid = randomUUID(), a = await fixture(uid), alias = await fixture(uid, a.userId)
  await a.save('old', 200)
  await alias.save('current', 100, 480000)
  const snapshots = await Promise.all([getPublicValueClock(), getPublicValueClock()])
  expect(snapshots[0]).toEqual(snapshots[1])
  expect(snapshots[0].active_accounts).toBe(1)
  expect(snapshots[0].totals?.sanity).toBeCloseTo(3, 2)
  expect(snapshots[0].rates_per_second?.sanity).toBeCloseTo(.02)
  await a.save('latest', 0)
  expect((await getPublicValueClock()).rates_per_second?.sanity).toBeCloseTo(.01)
  expect(JSON.stringify(snapshots[0])).not.toContain(uid)
})

it('integrates 864/day over 100 seconds, normalizes older cycles, and handles Beijing midnight', async () => {
  const a = await fixture()
  await a.save('first', 100, 120000, null, 12)
  expect((await getPublicValueClock()).totals?.sanity).toBeCloseTo(1, 2)
  await query(`update optimization_result_history set created_at = (((now() at time zone 'Asia/Shanghai')::date - 1)::timestamp at time zone 'Asia/Shanghai')::text where profile_id = $1`, [a.profileId])
  const snapshot = await getPublicValueClock()
  expect(snapshot.totals!.sanity - snapshot.today_totals!.sanity).toBeCloseTo(864, 5)
  expect(Date.parse(snapshot.valid_until!) - Date.parse(snapshot.as_of)).toBeLessThanOrEqual(120000)
  expect(Date.parse(snapshot.valid_until!)).toBeLessThanOrEqual(Date.parse(snapshot.day_ends_at))
})

it('retains archived history and corrects aggregates after source edits, deletion, and binding changes', async () => {
  const a = await fixture(), alias = await fixture('same-uid', a.userId)
  await a.save('first', 100)
  await alias.save('second', 100)
  expect((await getPublicValueClock()).active_accounts).toBe(2)
  await query("update optimization_result_history set archived_at = now(), name = '重命名' where profile_id = $1", [a.profileId])
  expect((await getPublicValueClock()).totals?.sanity).toBeCloseTo(2, 2)
  await query("update user_game_accounts set record_json = jsonb_set(record_json, '{skland_binding}', '{\"uid\":\"same-uid\"}'::jsonb) where id = $1", [a.profileId])
  expect((await getPublicValueClock()).active_accounts).toBe(1)
  expect((await getPublicValueClock()).totals?.sanity).toBeCloseTo(1, 2)
  await query('delete from user_accounts where id = $1', [a.userId])
  const deleted = await getPublicValueClock()
  expect(deleted.active_accounts).toBe(0)
  expect(deleted.totals).toBeNull()
})

it('never refreshes the same inventory deadline when a later result reuses it', async () => {
  const a = await fixture()
  const config = { intermediate_inventory: { LMD: 1000 } }
  await a.save('first', 2 * 86400, 0, config)
  await a.save('second', 100, 0, config)
  await query(`update optimization_result_history set result_json = jsonb_set(result_json, '{daily_production,consumption}', '{"LMD":1000}'::jsonb) where profile_id = $1`, [a.profileId])
  const snapshot = await getPublicValueClock()
  expect(snapshot.active_accounts).toBe(0)
  expect(snapshot.totals?.lmd_net).toBeCloseTo(-1000)
  expect(snapshot.rates_per_second?.lmd_net).toBe(0)
  expect(snapshot.status).toBe('empty')
})

it('ends the previous interval at an unusable result and counts explicit zero as data', async () => {
  const a = await fixture()
  await a.save('good', 200)
  await a.save('bad', 100)
  await query("update optimization_result_history set result_json = '{}'::jsonb where profile_id = $1 and id = 'bad'", [a.profileId])
  const snapshot = await getPublicValueClock()
  expect(snapshot.totals?.sanity).toBeCloseTo(1, 2)
  expect(snapshot.active_accounts).toBe(0)
  await a.save('zero', 0, 0)
  expect((await getPublicValueClock()).active_accounts).toBe(1)
  expect((await getPublicValueClock()).rates_per_second?.sanity).toBe(0)
})
