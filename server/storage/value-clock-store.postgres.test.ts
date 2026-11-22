import { randomUUID } from 'node:crypto'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { closePool, query, withTransaction } from './postgres'
import { migrateDatabaseSchema } from './schema'
import { getPublicValueClock } from './value-clock-store'
import { syncValueClockHistory } from './value-clock-sync'
import { activatePersonalValueClock, readPersonalValueClock, verifyPersonalValueClock } from './value-clock-comparison-store'
import { CONFIG_PRESETS } from '../../src/lib/config'
import { APP_BUILD_META } from '../../src/lib/build-meta'
import { createManualPlans, manualResult } from '../../src/lib/manual-schedule'
import type { OptimizeResult } from '../../src/lib/types'
import type { ValueClockComparisonRequest } from '../../src/lib/value-clock-comparison'

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
    const result = { author: 'test', title: id, description: '', buildingType: 243, planTimes: '24', raw_results: [], plans: [{ name: '全天', rooms: { manufacture: [{}] } }], daily_production: { hours, manufacturing: {}, consumption: {}, trading: { LMD: lmd } } }
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

async function comparisonFixture(currentDaily = 216, baselineDaily = 180) {
  const account = await fixture()
  await account.save('baseline', 86400, baselineDaily / .0036)
  await account.save('current', 43200, currentDaily / .0036)
  const jobs: string[] = []
  for (const id of ['current', 'baseline']) {
    const rows = await query<{ result_json: OptimizeResult }>('select result_json from optimization_result_history where profile_id = $1 and id = $2', [account.profileId, id])
    const source = rows.rows[0].result_json
    const jobId = randomUUID()
    const payload = { version: 3, submittedAt: Date.now(), operators: [{ id: '芬', name: '芬', own: true, elite: 1, rarity: 3 }], effectiveConfig: CONFIG_PRESETS['243'], scheduleUsageBase: {},
      activeProfileId: account.profileId, isPreviewProfile: false, isPreviewTrial: false, freeScheduleDecision: null, configPermission: 'advanced',
      estimate: { estimated_duration_ms: 1000, estimate_bucket: 'maa_plain', estimate_source: 'fallback_p95', estimate_sample_count: 0 },
      request: { include_upgrade_suggestions: false, upgrade_suggestions_allowed: false, manual_schedule: manualResult(source, createManualPlans(source)), manual_schedule_purpose: 'comparison' } }
    await query(`insert into optimize_jobs(id, status, priority, owner_key, profile_id, permission, source, payload_json, result_json, created_at, updated_at)
      values ($1, 'succeeded', 1, $2, $2, 'advanced', 'account_profile', $3, $4, now(), now())`, [jobId, account.profileId, JSON.stringify(payload), JSON.stringify({ ...source, build_meta: APP_BUILD_META })])
    jobs.push(jobId)
  }
  const request: Extract<ValueClockComparisonRequest, { action: 'verify' }> = { action: 'verify', profile_id: account.profileId, current_result_id: 'current', baseline_result_id: 'baseline',
    current_job_id: jobs[0], baseline_job_id: jobs[1], confirmed_previous_plan: true, request_id: randomUUID() }
  return { ...account, request, jobs }
}

it('distinguishes missing comparisons from zero and integrates positive and negative accounts together', async () => {
  const a = await comparisonFixture(), b = await comparisonFixture(168)
  const empty = await getPublicValueClock('gain')
  expect(empty).toMatchObject({ status: 'empty', totals: null, comparison: { has_recorded_comparison: false, active_production_accounts: 2 } })
  for (const account of [a, b]) {
    const verified = await verifyPersonalValueClock(account.request, null)
    expect((await getPublicValueClock('gain')).comparison.active_comparable_accounts).toBe(account === a ? 0 : 1)
    await activatePersonalValueClock({ action: 'activate', profile_id: account.profileId, comparison_id: verified.id, revision: 0 })
    await query("update value_clock_comparisons set confirmed_at = now() - interval '12 hours' where id = $1", [verified.id])
    await query('insert into value_clock_pending(identity) values ($1) on conflict do nothing', [`profile:${account.profileId}`])
  }
  const snapshot = await getPublicValueClock('gain')
  expect(snapshot.totals?.sanity).toBeCloseTo(12, 2)
  expect(snapshot.comparison).toMatchObject({ active_comparable_accounts: 2, active_production_accounts: 2, current_daily_sanity: 384, baseline_daily_sanity: 360, daily_gain_sanity: 24 })
  expect(snapshot.comparison.gain_ratio).toBeCloseTo(24 / 360)
  expect(snapshot.rates_per_second?.sanity).toBeCloseTo(24 / 86400)
  const zero = await comparisonFixture(180)
  const verified = await verifyPersonalValueClock(zero.request, null)
  await activatePersonalValueClock({ action: 'activate', profile_id: zero.profileId, comparison_id: verified.id, revision: 0 })
  expect((await getPublicValueClock('gain')).comparison.active_comparable_accounts).toBe(3)
})

it('starts at confirmation, makes retries idempotent, and retains history when the current plan is replaced', async () => {
  const a = await comparisonFixture()
  const verified = await verifyPersonalValueClock(a.request, null)
  expect(await verifyPersonalValueClock(a.request, null)).toEqual(verified)
  const input = { action: 'activate' as const, profile_id: a.profileId, comparison_id: verified.id, revision: 0 }
  const activated = await activatePersonalValueClock(input)
  expect(activated).toMatchObject({ revision: 1, comparison_state: 'active' })
  expect(await activatePersonalValueClock(input)).toEqual(activated)
  expect((await getPublicValueClock('gain')).totals?.sanity).toBeCloseTo(0, 2)
  await query("update value_clock_comparisons set confirmed_at = now() - interval '1 hour' where id = $1", [verified.id])
  await a.save('replacement', 0)
  const snapshot = await getPublicValueClock('gain')
  expect(snapshot.totals?.sanity).toBeCloseTo(1.5, 2)
  expect(snapshot.rates_per_second?.sanity).toBe(0)
  expect(snapshot.comparison.active_comparable_accounts).toBe(0)
  expect((await readPersonalValueClock(a.profileId)).comparison_state).toBe('ended')
  await query("delete from optimization_result_history where profile_id = $1 and id = 'baseline'", [a.profileId])
  expect((await getPublicValueClock('gain')).totals).toBeNull()
})

it('rejects mismatched conditions, unowned evidence, changed arrangements and stale confirmations', async () => {
  const a = await comparisonFixture()
  await query("update optimize_jobs set payload_json = jsonb_set(payload_json, '{effectiveConfig,drone_ratio}', '0.5'::jsonb) where id = $1", [a.jobs[1]])
  await expect(verifyPersonalValueClock(a.request, null)).rejects.toThrow('条件不同')
  await query("update optimize_jobs set payload_json = jsonb_set(payload_json, '{effectiveConfig}', $2::jsonb) where id = $1", [a.jobs[1], JSON.stringify(CONFIG_PRESETS['243'])])
  const other = await fixture()
  await query('update optimize_jobs set profile_id = $2 where id = $1', [a.jobs[1], other.profileId])
  await expect(verifyPersonalValueClock(a.request, null)).rejects.toThrow('核算尚未完成')
  await query('update optimize_jobs set profile_id = $2 where id = $1', [a.jobs[1], a.profileId])
  const first = await verifyPersonalValueClock(a.request, null)
  const second = await verifyPersonalValueClock({ ...a.request, request_id: randomUUID() }, null)
  await activatePersonalValueClock({ action: 'activate', profile_id: a.profileId, comparison_id: first.id, revision: 0 })
  await expect(activatePersonalValueClock({ action: 'activate', profile_id: a.profileId, comparison_id: second.id, revision: 0 })).rejects.toThrow('设置已更新')
  await query("update optimize_jobs set payload_json = jsonb_set(payload_json, '{request,manual_schedule,plans,0,drones,enable}', 'true'::jsonb) where id = $1", [a.jobs[1]])
  await expect(verifyPersonalValueClock({ ...a.request, request_id: randomUUID() }, null)).rejects.toThrow('人员安排')
})

it('expires frozen comparisons after source contents change but preserves renames and archives', async () => {
  const a = await comparisonFixture()
  const draft = await verifyPersonalValueClock(a.request, null)
  await query("update optimization_result_history set name = '重命名', archived_at = now() where profile_id = $1 and id = 'baseline'", [a.profileId])
  await activatePersonalValueClock({ action: 'activate', profile_id: a.profileId, comparison_id: draft.id, revision: 0 })
  expect((await getPublicValueClock('gain')).comparison.active_comparable_accounts).toBe(1)
  const unconfirmed = await verifyPersonalValueClock({ ...a.request, request_id: randomUUID() }, null)
  await query("update optimization_result_history set config_json = '{}'::jsonb where profile_id = $1 and id = 'baseline'", [a.profileId])
  expect((await getPublicValueClock('gain')).totals).toBeNull()
  expect((await readPersonalValueClock(a.profileId)).comparison_state).toBe('ended')
  await expect(verifyPersonalValueClock(a.request, null)).rejects.toThrow('来源排班已更改')
  await expect(activatePersonalValueClock({ action: 'activate', profile_id: a.profileId, comparison_id: unconfirmed.id, revision: 1 })).rejects.toThrow('比较已失效')
})

it('uses the earlier inventory cutoff from either side and never replenishes stock on another saved plan', async () => {
  const a = await comparisonFixture()
  const config = { ...CONFIG_PRESETS['243'], intermediate_inventory: { 'Pure Gold': 2 } }
  await query("update optimization_result_history set config_json = $2, created_at = (now() - case when id = 'baseline' then interval '90 minutes' else interval '60 minutes' end)::text where profile_id = $1", [a.profileId, JSON.stringify(config)])
  await query("update optimize_jobs set payload_json = jsonb_set(payload_json, '{effectiveConfig}', $2::jsonb) where profile_id = $1", [a.profileId, JSON.stringify(config)])
  await query("update optimize_jobs set result_json = jsonb_set(result_json, '{daily_production,consumption}', '{\"Pure Gold\":24}'::jsonb) where id = $1", [a.jobs[1]])
  const first = await verifyPersonalValueClock(a.request, null)
  expect(Date.parse(first.ends_at!) - Date.now()).toBeCloseTo(30 * 60_000, -3)
  await a.save('repeat', 0, 216 / .0036, config)
  const repeated = await verifyPersonalValueClock({ ...a.request, current_result_id: 'repeat', request_id: randomUUID() }, null)
  expect(repeated.ends_at).toBe(first.ends_at)
  await query("update optimization_result_history set created_at = (now() - interval '3 hours')::text where profile_id = $1 and id = 'baseline'", [a.profileId])
  await expect(verifyPersonalValueClock({ ...a.request, current_result_id: 'repeat', request_id: randomUUID() }, null)).rejects.toThrow('库存已耗尽')
})
