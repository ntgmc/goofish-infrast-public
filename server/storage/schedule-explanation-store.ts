import { randomUUID } from 'node:crypto'
import type { ScheduleExplanationState } from '../../src/lib/schedule-explanation'
import type { AiGenerationAccounting, AiPriceSnapshot } from '../../src/lib/ai-usage'
import type { ScheduleExplanationConfig } from './ai-settings-store'
import { query, withTransaction, type QueryClient } from './postgres'
import type { AiCreditService } from '../../src/lib/ai-credits'
import { normalizeStoredPoints, pointsToMinor } from '../../src/lib/balance-contracts'
import { reserveAiCredits, settleAiCredits } from './ai-credit-store'

interface ExplanationInput {
  userId: string
  profileId: string
  resultId: string | null
  cacheKey: string
  config: ScheduleExplanationConfig
  service?: AiCreditService
  acceptedPoints?: string
}

export async function readScheduleExplanation(input: ExplanationInput) {
  return readState({ query }, input)
}

export async function reserveScheduleExplanation(input: ExplanationInput) {
  return withTransaction(async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext('schedule-explanation-budget'))")
    // Keep supplier expenses after a crash, but return unused credits.
    await releaseInterruptedRequests(client)
    const state = await readState(client, input)
    if (!state.available) return { state, attemptId: null }
    const charge = state.credits.charge
    if (pointsToMinor(charge) > pointsToMinor(input.acceptedPoints ?? '0.00')) {
      return { state: { ...state, available: false, reason: 'pricing_changed' as const }, attemptId: null }
    }
    await reserveAiCredits(client, input.userId, charge)
    const attemptId = randomUUID()
    const { provider, protocol, model, inputPrice, outputPrice, cachedInputPrice, cacheWritePrice, cacheWrite1hPrice } = input.config
    const pricing: AiPriceSnapshot = { provider, protocol, model, inputPrice, outputPrice, cachedInputPrice, cacheWritePrice, cacheWrite1hPrice }
    await client.query(`insert into ai_schedule_usage (id, user_id, cache_key, status, cost_micro_cny, created_at,
      profile_id, result_id, pricing, cost_basis, reserved_micro_cny, credit_service, points_amount)
      values ($1, $2, $3, 'pending', $4, now(), $5, $6, $7::jsonb, 'reserved', $4, $8, $9::numeric)`,
    [attemptId, input.userId, input.cacheKey, input.config.reservation,
      input.resultId ? input.profileId : null, input.resultId, JSON.stringify(pricing), input.service ?? 'schedule_explanation', charge])
    return { state: { ...state, available: false, pending: true }, attemptId }
  })
}

export async function settleScheduleExplanation(input: ExplanationInput, attemptId: string, result: AiGenerationAccounting & { text: string | null; durationMs: number }) {
  const { text, cost, costBasis, usage, breakdown, providerRequestId, errorCode, durationMs } = result
  await withTransaction(async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext('schedule-explanation-budget'))")
    const settled = await client.query<{ user_id: string | null; credit_service: AiCreditService; points_amount: string }>(`update ai_schedule_usage set status = $2, cost_micro_cny = $3,
      cost_basis = $4, usage = $5::jsonb, cost_breakdown = $6::jsonb, provider_request_id = $7, error_code = $8,
      duration_ms = $9, settled_at = now()
      where id = $1 and status = 'pending' returning user_id, credit_service, points_amount::text`, [attemptId, text ? 'succeeded' : 'failed', cost,
      costBasis, usage ? JSON.stringify(usage) : null, breakdown ? JSON.stringify(breakdown) : null, providerRequestId, errorCode, durationMs])
    const attempt = settled.rows[0]
    if (!attempt) return
    await settleAiCredits(client, { attemptId, userId: attempt.user_id, service: attempt.credit_service,
      amount: attempt.points_amount, succeeded: Boolean(text) })
    if (!text || !attempt.user_id || !input.resultId) return
    await client.query(`insert into ai_schedule_explanations (cache_key, user_id, profile_id, result_id, explanation, created_at)
      select $1, $2, history.profile_id, history.id, $5, now() from optimization_result_history history
      join user_game_accounts profile on profile.id = history.profile_id and profile.user_id = $2
      where history.profile_id = $3 and history.id = $4
      on conflict (cache_key) do nothing`, [input.cacheKey, input.userId, input.profileId, input.resultId, text])
  })
}

async function readState(client: QueryClient, input: ExplanationInput): Promise<ScheduleExplanationState> {
  const cached = input.resultId ? await client.query<{ explanation: string; created_at: Date }>(
    'select explanation, created_at from ai_schedule_explanations where cache_key = $1 and user_id = $2 and profile_id = $3 and result_id = $4',
    [input.cacheKey, input.userId, input.profileId, input.resultId],
  ) : { rows: [] }
  const config = input.config
  const stats = await client.query<{
    daily_attempts: number; pending: boolean; running: number
    daily_cost: string; monthly_cost: string
  }>(`select
    count(*) filter (where user_id = $1 and created_at >= date_trunc('day', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai')::int as daily_attempts,
    coalesce(bool_or(cache_key = $2 and status = 'pending' and created_at > now() - interval '2 minutes'), false) as pending,
    count(*) filter (where user_id = $1 and status = 'pending' and created_at > now() - interval '2 minutes')::int as running,
    coalesce(sum(cost_micro_cny) filter (where created_at >= date_trunc('day', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai'), 0)::text as daily_cost,
    coalesce(sum(cost_micro_cny) filter (where created_at >= date_trunc('month', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai'), 0)::text as monthly_cost
    from ai_schedule_usage
    where user_id = $1 or created_at >= date_trunc('month', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai'`,
  [input.userId, input.cacheKey])
  const row = stats.rows[0]
  const explanation = cached.rows[0] ? { text: cached.rows[0].explanation, created_at: cached.rows[0].created_at.toISOString() } : null
  const balance = await client.query<{ available: string; debt: string }>(
    `select (available - reserved + coalesce((select sum(points_amount) from ai_schedule_usage
       where user_id = $1 and status = 'pending' and created_at <= now() - interval '2 minutes'), 0))::text as available,
       debt::text from user_balance_accounts where user_id = $1`, [input.userId])
  const available = normalizeStoredPoints(balance.rows[0]?.available ?? '0')
  const price = config.creditsEnabled ? config.creditPrices[input.service ?? 'schedule_explanation'] : null
  const charge = !explanation && price ? price : '0.00'
  const paymentReason = !price ? 'unpriced'
    : pointsToMinor(normalizeStoredPoints(balance.rows[0]?.debt ?? '0')) > 0n ? 'debt'
      : pointsToMinor(available) < pointsToMinor(charge) ? 'balance' : null
  const reason: ScheduleExplanationState['reason'] = !config.enabled || !config.creditsEnabled ? 'disabled' : row.pending || row.running >= config.concurrencyLimit ? 'busy' : paymentReason
    ? paymentReason : row.daily_attempts >= config.dailyAttemptLimit ? 'daily_limit'
      : Number(row.daily_cost) + config.reservation > config.dailyBudget || Number(row.monthly_cost) + config.reservation > config.monthlyBudget ? 'budget' : null
  return {
    explanation, pending: !explanation && row.pending, available: !explanation && reason === null,
    reason: explanation ? null : reason,
    provider: config.provider || null,
    credits: { service: input.service ?? 'schedule_explanation', price, charge, available },
  }
}

async function releaseInterruptedRequests(client: QueryClient) {
  const interrupted = await client.query<{ id: string; user_id: string | null; credit_service: AiCreditService; points_amount: string }>(
    `update ai_schedule_usage set status = 'failed', settled_at = now(), error_code = 'interrupted'
     where status = 'pending' and created_at <= now() - interval '2 minutes'
     returning id, user_id, credit_service, points_amount::text`)
  for (const attempt of interrupted.rows) {
    await settleAiCredits(client, { attemptId: attempt.id, userId: attempt.user_id, service: attempt.credit_service,
      amount: attempt.points_amount, succeeded: false })
  }
}
