import { randomUUID } from 'node:crypto'
import type { AiCreditService } from '../../src/lib/ai-credits'
import type { QueryClient } from './postgres'
import { BalanceError } from './balance-store'

export async function reserveAiCredits(client: QueryClient, userId: string, amount: string) {
  if (amount === '0.00') return
  await client.query(`insert into user_balance_accounts (user_id, updated_at)
    values ($1, now()) on conflict (user_id) do nothing`, [userId])
  const reserved = await client.query(`update user_balance_accounts set reserved = reserved + $2::numeric, updated_at = now()
    where user_id = $1 and available - reserved >= $2::numeric and debt = 0`, [userId, amount])
  if (!reserved.rowCount) throw new BalanceError('insufficient_balance', '积分余额不足，请刷新余额后重试。', 409)
}

export async function settleAiCredits(client: QueryClient, input: {
  attemptId: string; userId: string | null; service: AiCreditService; amount: string; succeeded: boolean
}) {
  if (!input.userId || Number(input.amount) === 0) return
  const account = await client.query<{ available: string }>(`update user_balance_accounts
    set reserved = reserved - $2::numeric, available = available - $3::numeric, updated_at = now()
    where user_id = $1 and reserved >= $2::numeric and available >= $3::numeric
    returning available::text`, [input.userId, input.amount, input.succeeded ? input.amount : '0.00'])
  if (!account.rows[0]) throw new BalanceError('reservation_conflict', 'AI 暂扣积分与账户余额不一致。', 409)
  if (!input.succeeded) return
  await client.query(`insert into user_balance_transactions
    (id, user_id, kind, amount, balance_after, reference_type, reference_id, idempotency_key, reason, created_at)
    values ($1, $2, 'ai_debit', -$3::numeric, $4::numeric, 'ai_service', $5, $6, $7, now())`,
  [randomUUID(), input.userId, input.amount, account.rows[0].available, input.attemptId, `ai:${input.attemptId}`, input.service])
}
