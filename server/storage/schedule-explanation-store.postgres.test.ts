import { randomUUID } from 'node:crypto'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { DEFAULT_AI_SETTINGS } from '../../src/lib/ai-settings'
import type { AiGenerationAccounting } from '../../src/lib/ai-usage'
import { getAiUsage, listAiUsage } from './ai-usage-store'
import { closePool, query } from './postgres'
import { migrateDatabaseSchema } from './schema'
import { readScheduleExplanation, reserveScheduleExplanation, settleScheduleExplanation } from './schedule-explanation-store'

let container: StartedPostgreSqlContainer
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  process.env.DATABASE_URL = container.getConnectionUri()
  await migrateDatabaseSchema()
})
afterAll(async () => { await closePool(); if (container) await container.stop() })

const config = { ...DEFAULT_AI_SETTINGS, enabled: true, apiKey: 'test', baseURL: 'https://example.test/v1',
  model: 'chat', provider: '测试', inputPrice: 1, outputPrice: 2, reservation: 9600, dailyBudget: 10e6, monthlyBudget: 200e6 }

function accounted(text: string | null, cost: number): AiGenerationAccounting & { text: string | null; durationMs: number } {
  return { text, cost, costBasis: text ? 'usage' : 'reserved', usage: text ? { input_tokens: 500, output_tokens: 50,
    cached_input_tokens: 0, cache_write_tokens: 0, cache_write_5m_tokens: 0, cache_write_1h_tokens: 0 } : null,
  breakdown: text ? { input: 500, cached_input: 0, cache_write_5m: 0, cache_write_1h: 0, output: cost - 500 } : null,
  providerRequestId: 'req-test', errorCode: text ? null : 'provider_error', durationMs: 1250 }
}

async function fixture(monthly = false) {
  const userId = randomUUID(), profileId = randomUUID(), resultId = randomUUID()
  await query(`insert into user_accounts (id, email, password_hash, salt, iterations, permission, status, record_json, created_at, updated_at)
    values ($1, $2, 'hash', 'salt', 1, 'recommended', 'active', '{}'::jsonb, now(), now())`, [userId, `${userId}@example.test`])
  await query(`insert into user_game_accounts (id, user_id, permission, status, display_name, note, record_json, created_at, updated_at, kind)
    values ($1, $2, 'recommended', 'active', '测试', '', '{}'::jsonb, now(), now(), 'cdk')`, [profileId, userId])
  await query(`insert into optimization_result_history (profile_id, id, name, created_at, result_json, source)
    values ($1, $2, '测试', now()::text, '{}'::jsonb, 'generated')`, [profileId, resultId])
  return { userId, profileId, resultId, cacheKey: randomUUID(), config, monthly }
}

it('deduplicates simultaneous requests and reuses a saved answer even when generation is disabled', async () => {
  const input = await fixture()
  const requests = await Promise.all(Array.from({ length: 8 }, () => reserveScheduleExplanation(input)))
  const successful = requests.filter((request) => request.attemptId)
  expect(successful).toHaveLength(1)
  expect(requests.filter((request) => !request.attemptId).every((request) => request.state.pending)).toBe(true)
  await settleScheduleExplanation(input, successful[0].attemptId!, accounted('解读正文', 600))
  const state = await readScheduleExplanation({ ...input, config: { ...config, enabled: false } })
  expect(state).toMatchObject({ explanation: { text: '解读正文' }, quota: { remaining: 2 }, pending: false, reason: null })
  expect((await reserveScheduleExplanation(input)).attemptId).toBeNull()
  expect((await query('select * from ai_schedule_usage where user_id = $1', [input.userId])).rows).toHaveLength(1)
})

it('shares trial allowance across profiles and atomically stops at the account limit', async () => {
  const first = await fixture()
  const other = await fixture()
  await query('update user_game_accounts set user_id = $1 where id = $2', [first.userId, other.profileId])
  const second = { ...other, userId: first.userId }
  for (let index = 0; index < 3; index++) {
    const input = { ...(index % 2 ? first : second), cacheKey: randomUUID() }
    const reserved = await reserveScheduleExplanation(input)
    expect(reserved.attemptId).not.toBeNull()
    await settleScheduleExplanation(input, reserved.attemptId!, accounted('已完成', 600))
  }
  expect(await readScheduleExplanation({ ...first, cacheKey: randomUUID() })).toMatchObject({ reason: 'quota', quota: { remaining: 0 } })
  expect((await reserveScheduleExplanation({ ...second, cacheKey: randomUUID() })).attemptId).toBeNull()
})

it('returns unused quota after failure or a crashed request while keeping uncertain expenses in the budget', async () => {
  const input = await fixture()
  const first = await reserveScheduleExplanation(input)
  await settleScheduleExplanation(input, first.attemptId!, accounted(null, config.reservation))
  expect(await readScheduleExplanation(input)).toMatchObject({ available: true, quota: { remaining: 3 } })
  const crashed = await reserveScheduleExplanation(input)
  await query("update ai_schedule_usage set created_at = now() - interval '3 minutes' where id = $1", [crashed.attemptId])
  const retry = await reserveScheduleExplanation(input)
  expect(retry.attemptId).not.toBeNull()
  const rows = await query<{ status: string; cost_micro_cny: string }>('select status, cost_micro_cny from ai_schedule_usage where user_id = $1', [input.userId])
  expect(rows.rows.filter((row) => row.status === 'failed')).toHaveLength(2)
  expect(rows.rows.every((row) => Number(row.cost_micro_cny) === config.reservation)).toBe(true)
  await settleScheduleExplanation(input, retry.attemptId!, accounted('成功', 500))
})

it('refreshes monthly allowance at the Shanghai month boundary and counts all current pending reservations', async () => {
  const input = await fixture(true)
  await query(`insert into ai_schedule_usage (id, user_id, cache_key, quota_period, status, cost_micro_cny, created_at)
    select $1, $2, $3, to_char((now() at time zone 'Asia/Shanghai') - interval '1 month', 'YYYY-MM'), 'succeeded', 1, now() - interval '1 month'`,
  [randomUUID(), input.userId, randomUUID()])
  const reserved = await reserveScheduleExplanation({ ...input, config: { ...config, monthlyLimit: 1 } })
  expect(reserved.state.quota).toMatchObject({ kind: 'monthly', remaining: 0 })
  expect(reserved.state.quota.resets_at).toMatch(/T16:00:00.000Z$/)
  expect(await readScheduleExplanation({ ...input, cacheKey: randomUUID() })).toMatchObject({ reason: 'busy' })
  await settleScheduleExplanation(input, reserved.attemptId!, accounted('完成', 600))
  expect(await readScheduleExplanation({ ...input, cacheKey: randomUUID(), config: { ...config, monthlyLimit: 1 } })).toMatchObject({ reason: 'quota' })
})

it('serializes reservations from different users against the same global budget', async () => {
  const inputs = await Promise.all(Array.from({ length: 6 }, () => fixture()))
  const expense = await query<{ total: string }>(`select coalesce(sum(cost_micro_cny),0)::text as total from ai_schedule_usage
    where created_at >= date_trunc('day', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai'`)
  const dailyBudget = Number(expense.rows[0].total) + config.reservation
  const requests = await Promise.all(inputs.map((input) => reserveScheduleExplanation({ ...input, config: { ...config, dailyBudget } })))
  expect(requests.filter((request) => request.attemptId)).toHaveLength(1)
  expect(requests.filter((request) => request.state.reason === 'budget')).toHaveLength(5)
  for (const [index, request] of requests.entries()) if (request.attemptId) await settleScheduleExplanation(inputs[index], request.attemptId, accounted(null, config.reservation))
})

it('honors administrator changes to concurrency, daily attempts and disabled quotas', async () => {
  const input = await fixture()
  const policy = { ...config, concurrencyLimit: 2, trialLimit: 8, dailyAttemptLimit: 2 }
  const first = await reserveScheduleExplanation({ ...input, config: policy })
  const secondInput = { ...input, cacheKey: randomUUID(), config: policy }
  const second = await reserveScheduleExplanation(secondInput)
  expect(first.attemptId).not.toBeNull()
  expect(second.attemptId).not.toBeNull()
  const thirdInput = { ...input, cacheKey: randomUUID(), config: policy }
  expect((await reserveScheduleExplanation(thirdInput)).state.reason).toBe('busy')
  await settleScheduleExplanation(input, first.attemptId!, accounted('完成', 600))
  await settleScheduleExplanation(secondInput, second.attemptId!, accounted(null, policy.reservation))
  expect((await reserveScheduleExplanation(thirdInput)).state.reason).toBe('daily_limit')
  expect((await readScheduleExplanation({ ...thirdInput, config: { ...policy, enabled: false } }))).toMatchObject({
    reason: 'disabled', quota: { limit: 8, remaining: 7 }, available: false,
  })
})

it('caps failed attempts per account as well as successful allowance', async () => {
  const input = await fixture()
  await query(`insert into ai_schedule_usage (id, user_id, cache_key, quota_period, status, cost_micro_cny, created_at)
    select $1 || item::text, $2, $1 || item::text, 'trial', 'failed', 1, now() from generate_series(1,20) item`, [randomUUID(), input.userId])
  const request = await reserveScheduleExplanation(input)
  expect(request.attemptId).toBeNull()
  expect(request.state).toMatchObject({ reason: 'daily_limit', quota: { remaining: 3 } })
})

it('preserves pricing and token details, summarizes filtered records, and keeps incomplete historical rows visible', async () => {
  const input = await fixture()
  input.config = { ...config, cachedInputPrice: 0.1 }
  const first = await reserveScheduleExplanation(input)
  expect(await getAiUsage(first.attemptId!)).toMatchObject({ item: { cost_basis: 'reserved', usage: null,
    pricing: { model: 'chat', cachedInputPrice: 0.1 }, reserved_micro_cny: 9600, profile_id: input.profileId } })
  const answer = { ...accounted('已保存的分析', 380), usage: { input_tokens: 1000, output_tokens: 50,
    cached_input_tokens: 800, cache_write_tokens: 0, cache_write_5m_tokens: 0, cache_write_1h_tokens: 0 },
  breakdown: { input: 200, cached_input: 80, cache_write_5m: 0, cache_write_1h: 0, output: 100 } }
  await settleScheduleExplanation(input, first.attemptId!, answer)
  await settleScheduleExplanation(input, first.attemptId!, accounted(null, 9600))
  input.config = { ...config, inputPrice: 99, cachedInputPrice: 9 }
  const detail = await getAiUsage(first.attemptId!)
  expect(detail).toMatchObject({ item: { status: 'succeeded', cost_micro_cny: 380, duration_ms: 1250,
    pricing: { inputPrice: 1, cachedInputPrice: 0.1 }, usage: { input_tokens: 1000, cached_input_tokens: 800 },
    breakdown: { cached_input: 80 }, provider_request_id: 'req-test' }, explanation: { text: '已保存的分析' } })
  expect(JSON.stringify(detail)).not.toMatch(/apiKey|api_key|cache_key|example.test/)
  const second = await reserveScheduleExplanation({ ...input, cacheKey: randomUUID() })
  await settleScheduleExplanation(input, second.attemptId!, { ...accounted(null, 640), costBasis: 'estimated',
    usage: { input_tokens: 500, output_tokens: 70, cached_input_tokens: null, cache_write_tokens: 0, cache_write_5m_tokens: 0, cache_write_1h_tokens: 0 } })
  await query("update ai_schedule_usage set created_at = '2026-11-16T15:59:59Z' where id = $1", [first.attemptId])
  await query("update ai_schedule_usage set created_at = '2026-11-16T16:00:00Z' where id = $1", [second.attemptId])
  const legacyId = randomUUID()
  await query(`insert into ai_schedule_usage (id, user_id, cache_key, quota_period, status, cost_micro_cny, created_at)
    values ($1, $2, $1, 'trial', 'failed', 900, '2026-11-16T16:00:00Z')`, [legacyId, input.userId])
  const filters = { user_id: input.userId, from: '2026-11-16T00:00:00Z', to: '2026-11-17T00:00:00Z' }
  const result = await listAiUsage(999, 25, filters)
  expect(result.pagination).toMatchObject({ page: 1, total: 3 })
  expect(result.totals).toMatchObject({ requests: 3, succeeded: 1, failed: 2, metered_requests: 2, cache_reported_requests: 1,
    input_tokens: 1500, output_tokens: 120, cached_input_tokens: 800, cost_micro_cny: 1920,
    usage_cost_micro_cny: 380, estimated_cost_micro_cny: 640, reserved_cost_micro_cny: 900,
    input_cost_micro_cny: 200, cached_input_cost_micro_cny: 80, cache_write_cost_micro_cny: 0, output_cost_micro_cny: 100 })
  expect(result.daily).toMatchObject([{ day: '2026-11-17', requests: 2, cost_micro_cny: 1540 }, { day: '2026-11-16', requests: 1, cost_micro_cny: 380 }])
  expect(result.models).toHaveLength(2)
  expect((await getAiUsage(legacyId))?.item).toMatchObject({ usage: null, pricing: null, cost_basis: 'legacy', breakdown: null })
  expect((await listAiUsage(1, 25, { ...filters, status: 'succeeded', provider: '测试', model: 'chat' })).totals.requests).toBe(1)
  expect((await listAiUsage(1, 25, { ...filters, model: "chat' OR true --" })).totals).toMatchObject({ requests: 0, cached_input_cost_micro_cny: null, cache_write_cost_micro_cny: null })
  expect(await getAiUsage(randomUUID())).toBeNull()
  await query('delete from optimization_result_history where profile_id = $1', [input.profileId])
  expect(await getAiUsage(first.attemptId!)).toMatchObject({ item: { profile_id: null, result_id: null, cost_micro_cny: 380 }, explanation: null })
  await query('delete from user_accounts where id = $1', [input.userId])
  expect(await getAiUsage(first.attemptId!)).toMatchObject({ item: { user_id: null, usage: { cached_input_tokens: 800 }, cost_micro_cny: 380 } })
})

it('enforces both budgets before spending, and deleting an account removes explanations without erasing expenses', async () => {
  const input = await fixture()
  const expense = await query<{ daily: string; monthly: string }>(`select
    coalesce(sum(cost_micro_cny) filter (where created_at >= date_trunc('day', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai'),0)::text as daily,
    coalesce(sum(cost_micro_cny) filter (where created_at >= date_trunc('month', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai'),0)::text as monthly
    from ai_schedule_usage`)
  for (const restriction of [{ dailyBudget: Number(expense.rows[0].daily) + config.reservation - 1 },
    { monthlyBudget: Number(expense.rows[0].monthly) + config.reservation - 1 }]) {
    expect((await reserveScheduleExplanation({ ...input, config: { ...config, ...restriction } })).state).toMatchObject({ reason: 'budget' })
  }
  const reserved = await reserveScheduleExplanation(input)
  await settleScheduleExplanation(input, reserved.attemptId!, accounted('私人的解读', 600))
  await query('delete from user_accounts where id = $1', [input.userId])
  expect((await query('select * from ai_schedule_explanations where cache_key = $1', [input.cacheKey])).rows).toHaveLength(0)
  expect((await query('select user_id, cost_micro_cny from ai_schedule_usage where id = $1', [reserved.attemptId])).rows[0]).toMatchObject({ user_id: null, cost_micro_cny: '600' })
})
