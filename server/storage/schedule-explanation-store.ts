import { randomUUID } from 'node:crypto'
import type { ScheduleExplanationState } from '../../src/lib/schedule-explanation'
import type { AiGenerationAccounting, AiPriceSnapshot } from '../../src/lib/ai-usage'
import type { ScheduleExplanationConfig } from './ai-settings-store'
import { query, withTransaction, type QueryClient } from './postgres'

interface ExplanationInput {
  userId: string
  profileId: string
  resultId: string
  cacheKey: string
  monthly: boolean
  config: ScheduleExplanationConfig
}

export async function readScheduleExplanation(input: ExplanationInput) {
  return readState({ query }, input)
}

export async function reserveScheduleExplanation(input: ExplanationInput) {
  return withTransaction(async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext('schedule-explanation-budget'))")
    // A crashed request keeps its reserved expense but releases the user's unused allowance.
    await client.query("update ai_schedule_usage set status = 'failed', settled_at = now(), error_code = 'interrupted' where status = 'pending' and created_at <= now() - interval '2 minutes'")
    const state = await readState(client, input)
    if (!state.available) return { state, attemptId: null }
    const attemptId = randomUUID()
    const { provider, protocol, model, inputPrice, outputPrice, cachedInputPrice, cacheWritePrice, cacheWrite1hPrice } = input.config
    const pricing: AiPriceSnapshot = { provider, protocol, model, inputPrice, outputPrice, cachedInputPrice, cacheWritePrice, cacheWrite1hPrice }
    await client.query(`insert into ai_schedule_usage (id, user_id, cache_key, quota_period, status, cost_micro_cny, created_at,
      profile_id, result_id, pricing, cost_basis, reserved_micro_cny)
      values ($1, $2, $3, $4, 'pending', $5, now(), $6, $7, $8::jsonb, 'reserved', $5)`,
    [attemptId, input.userId, input.cacheKey, input.monthly ? await currentMonth(client) : 'trial', input.config.reservation,
      input.profileId, input.resultId, JSON.stringify(pricing)])
    return { state: { ...state, available: false, pending: true, quota: { ...state.quota, remaining: state.quota.remaining - 1 } }, attemptId }
  })
}

export async function settleScheduleExplanation(input: ExplanationInput, attemptId: string, result: AiGenerationAccounting & { text: string | null; durationMs: number }) {
  const { text, cost, costBasis, usage, breakdown, providerRequestId, errorCode, durationMs } = result
  await withTransaction(async (client) => {
    const settled = await client.query<{ user_id: string | null }>(`update ai_schedule_usage set status = $2, cost_micro_cny = $3,
      cost_basis = $4, usage = $5::jsonb, cost_breakdown = $6::jsonb, provider_request_id = $7, error_code = $8,
      duration_ms = $9, settled_at = now()
      where id = $1 and status = 'pending' returning user_id`, [attemptId, text ? 'succeeded' : 'failed', cost,
      costBasis, usage ? JSON.stringify(usage) : null, breakdown ? JSON.stringify(breakdown) : null, providerRequestId, errorCode, durationMs])
    if (!text || !settled.rows[0]?.user_id) return
    await client.query(`insert into ai_schedule_explanations (cache_key, user_id, profile_id, result_id, explanation, created_at)
      select $1, $2, history.profile_id, history.id, $5, now() from optimization_result_history history
      join user_game_accounts profile on profile.id = history.profile_id and profile.user_id = $2
      where history.profile_id = $3 and history.id = $4
      on conflict (cache_key) do nothing`, [input.cacheKey, input.userId, input.profileId, input.resultId, text])
  })
}

async function readState(client: QueryClient, input: ExplanationInput): Promise<ScheduleExplanationState> {
  const cached = await client.query<{ explanation: string; created_at: Date }>(
    'select explanation, created_at from ai_schedule_explanations where cache_key = $1 and user_id = $2 and profile_id = $3 and result_id = $4',
    [input.cacheKey, input.userId, input.profileId, input.resultId],
  )
  const config = input.config
  const stats = await client.query<{
    used: number; daily_attempts: number; pending: boolean; running: number
    daily_cost: string; monthly_cost: string; resets_at: Date; month: string
  }>(`select
    count(*) filter (where user_id = $1 and quota_period = case when $3 then to_char(now() at time zone 'Asia/Shanghai', 'YYYY-MM') else 'trial' end
      and (status = 'succeeded' or (status = 'pending' and created_at > now() - interval '2 minutes')))::int as used,
    count(*) filter (where user_id = $1 and created_at >= date_trunc('day', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai')::int as daily_attempts,
    coalesce(bool_or(cache_key = $2 and status = 'pending' and created_at > now() - interval '2 minutes'), false) as pending,
    count(*) filter (where user_id = $1 and status = 'pending' and created_at > now() - interval '2 minutes')::int as running,
    coalesce(sum(cost_micro_cny) filter (where created_at >= date_trunc('day', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai'), 0)::text as daily_cost,
    coalesce(sum(cost_micro_cny) filter (where created_at >= date_trunc('month', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai'), 0)::text as monthly_cost,
    (date_trunc('month', now() at time zone 'Asia/Shanghai') + interval '1 month') at time zone 'Asia/Shanghai' as resets_at,
    to_char(now() at time zone 'Asia/Shanghai', 'YYYY-MM') as month
    from ai_schedule_usage
    where user_id = $1 or created_at >= date_trunc('month', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai'`,
  [input.userId, input.cacheKey, input.monthly])
  const row = stats.rows[0]
  const limit = input.monthly ? config.monthlyLimit : config.trialLimit
  const remaining = Math.max(0, limit - row.used)
  const explanation = cached.rows[0] ? { text: cached.rows[0].explanation, created_at: cached.rows[0].created_at.toISOString() } : null
  const reason: ScheduleExplanationState['reason'] = !config.enabled ? 'disabled' : row.pending || row.running >= config.concurrencyLimit ? 'busy' : remaining === 0 ? 'quota'
    : row.daily_attempts >= config.dailyAttemptLimit ? 'daily_limit'
      : Number(row.daily_cost) + config.reservation > config.dailyBudget || Number(row.monthly_cost) + config.reservation > config.monthlyBudget ? 'budget' : null
  return {
    explanation, pending: !explanation && row.pending, available: !explanation && reason === null,
    reason: explanation ? null : reason,
    quota: { kind: input.monthly ? 'monthly' : 'trial', limit, remaining, resets_at: input.monthly ? row.resets_at.toISOString() : null },
    provider: config.provider || null,
  }
}

async function currentMonth(client: QueryClient) {
  const result = await client.query<{ month: string }>("select to_char(now() at time zone 'Asia/Shanghai', 'YYYY-MM') as month")
  return result.rows[0].month
}
