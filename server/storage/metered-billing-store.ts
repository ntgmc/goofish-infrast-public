import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import {
  getCommercialTierSummary,
  getMeteredScheduleQuote,
  pointsToMinor,
  type IssuedMeteredScheduleQuote,
  type MeteredBillingOperation,
  type MeteredBillingKind,
  type MeteredQuoteConfirmation,
  type MeteredScheduleQuote,
} from '../../src/lib/metered-billing'
import { normalizePointsAmount } from '../../src/lib/balance-contracts'
import { ensureDatabaseSchema } from './schema'
import { withTransaction } from './postgres'

const QUOTE_LIFETIME_MS = 5 * 60_000

export class MeteredBillingQuoteError extends Error {
  constructor(
    readonly code: 'profile_not_found' | 'not_metered_profile' | 'profile_archived'
      | 'commercial_not_eligible' | 'commercial_suspended' | 'debt_outstanding'
      | 'pricing_changed' | 'quote_already_used' | 'operation_not_available',
    message: string,
    readonly status: 404 | 409,
  ) {
    super(message)
    this.name = 'MeteredBillingQuoteError'
  }
}

type BillingStateRow = {
  kind: string
  archived_at: string | null
  available: string
  reserved: string
  lifetime_credited: string
  qualification_reversed: string
  debt: string
  suspended_at: string | null
}

type StoredQuoteRow = {
  id: string
  user_id: string
  profile_id: string
  billing_kind: MeteredBillingKind
  operation: MeteredBillingOperation
  pricing_version: string
  tier: 1 | 2 | 3 | 4 | null
  list_price: string
  discount_bps: number
  charge: string
  expires_at: string
  admitted_job_id: string | null
}

export async function issueMeteredScheduleQuote(
  userId: string,
  profileId: string,
  operationOrNow: MeteredBillingOperation | Date = 'main_schedule',
  now = new Date(),
): Promise<IssuedMeteredScheduleQuote> {
  const operation = operationOrNow instanceof Date ? 'main_schedule' : operationOrNow
  if (operationOrNow instanceof Date) now = operationOrNow
  await ensureDatabaseSchema()
  return withTransaction(async (client) => {
    const state = await readBillingState(client, userId, profileId, false, operation)
    const quote = quoteFromState(state, operation)
    const quoteId = randomUUID()
    const createdAt = now.toISOString()
    const expiresAt = new Date(now.getTime() + QUOTE_LIFETIME_MS).toISOString()
    await client.query(
      `insert into metered_billing_quotes
        (id, user_id, profile_id, billing_kind, operation, pricing_version, tier, list_price,
         discount_bps, charge, expires_at, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8::numeric, $9, $10::numeric, $11, $12)`,
      [quoteId, userId, profileId, quote.billing_kind, quote.operation, quote.pricing_version, quote.tier,
        quote.list_price, quote.discount_bps, quote.charge, expiresAt, createdAt],
    )
    return {
      ...quote,
      quote_id: quoteId,
      expires_at: expiresAt,
      available: minorToPoints(pointsToMinor(state.available) - pointsToMinor(state.reserved)),
      sufficient: pointsToMinor(state.debt) === 0n
        && pointsToMinor(state.available) - pointsToMinor(state.reserved) >= pointsToMinor(quote.charge),
    }
  })
}

export async function confirmMeteredQuoteInTransaction(
  client: PoolClient,
  input: {
    jobId: string
    userId: string
    profileId: string
    operation: MeteredBillingOperation
    confirmation: MeteredQuoteConfirmation
    now: string
  },
): Promise<MeteredScheduleQuote> {
  await client.query('select id from user_accounts where id = $1 for update', [input.userId])
  await client.query(
    `insert into user_balance_accounts
      (user_id, available, reserved, lifetime_credited, qualification_reversed, debt, updated_at)
     values ($1, 0, 0, 0, 0, 0, $2) on conflict (user_id) do nothing`,
    [input.userId, input.now],
  )
  await client.query('select user_id from user_balance_accounts where user_id = $1 for update', [input.userId])
  await client.query(
    `insert into commercial_account_limits
      (user_id, active_profile_limit, total_profile_limit, updated_at)
     values ($1, 100, 1000, $2) on conflict (user_id) do nothing`,
    [input.userId, input.now],
  )
  await client.query('select user_id from commercial_account_limits where user_id = $1 for update', [input.userId])
  const state = await readBillingState(client, input.userId, input.profileId, true, input.operation)
  const stored = await client.query<StoredQuoteRow>(
    `select id, user_id, profile_id, billing_kind, operation, pricing_version, tier,
            list_price::text, discount_bps, charge::text, expires_at, admitted_job_id
       from metered_billing_quotes where id = $1 for update`,
    [input.confirmation.quoteId],
  )
  const quote = stored.rows[0]
  const accepted = normalizePointsAmount(input.confirmation.acceptedMaxPoints)
  const operationMatchesProfile = input.operation === 'main_schedule'
    ? quote?.billing_kind === state.kind
    : quote?.billing_kind === 'metered_personal'
  if (!quote || quote.user_id !== input.userId || quote.profile_id !== input.profileId
    || quote.operation !== input.operation || !operationMatchesProfile || !accepted
    || quote.pricing_version !== input.confirmation.pricingVersion
    || quote.charge !== accepted || Date.parse(quote.expires_at) <= Date.parse(input.now)) {
    throw new MeteredBillingQuoteError('pricing_changed', '本次报价已变化或过期，请查看最新报价后再次确认。', 409)
  }
  if (quote.admitted_job_id) {
    throw new MeteredBillingQuoteError('quote_already_used', '本次报价已用于其他任务，请重新获取报价。', 409)
  }
  const current = quoteFromState(state, input.operation)
  if (current.pricing_version !== quote.pricing_version
    || pointsToMinor(current.charge) > pointsToMinor(accepted)) {
    throw new MeteredBillingQuoteError('pricing_changed', '本次价格已上涨，请查看最新报价后再次确认。', 409)
  }
  if (pointsToMinor(state.debt) > 0n) {
    throw new MeteredBillingQuoteError('debt_outstanding', '账户存在待追偿积分，结清前不能提交新任务。', 409)
  }
  await client.query(
    `update metered_billing_quotes
        set admitted_job_id = $2, confirmed_at = $3
      where id = $1 and admitted_job_id is null`,
    [quote.id, input.jobId, input.now],
  )
  return current
}

async function readBillingState(
  client: PoolClient,
  userId: string,
  profileId: string,
  lockProfile: boolean,
  operation: MeteredBillingOperation = 'main_schedule',
): Promise<BillingStateRow> {
  const result = await client.query<BillingStateRow>(
    `select profile.kind, profile.archived_at,
            coalesce(balance.available, 0)::text as available,
            coalesce(balance.reserved, 0)::text as reserved,
            coalesce(balance.lifetime_credited, 0)::text as lifetime_credited,
            coalesce(balance.qualification_reversed, 0)::text as qualification_reversed,
            coalesce(balance.debt, 0)::text as debt,
            limits.suspended_at
       from user_game_accounts profile
       left join user_balance_accounts balance on balance.user_id = profile.user_id
       left join commercial_account_limits limits on limits.user_id = profile.user_id
      where profile.id = $1 and profile.user_id = $2
      ${lockProfile ? 'for update of profile' : ''}`,
    [profileId, userId],
  )
  const row = result.rows[0]
  if (!row) throw new MeteredBillingQuoteError('profile_not_found', '档案不存在。', 404)
  if (operation === 'main_schedule' && row.kind !== 'metered_personal' && row.kind !== 'metered_commercial') {
    throw new MeteredBillingQuoteError('not_metered_profile', '该档案不是按次计费档案。', 409)
  }
  if (operation === 'scenario_comparison' && row.kind === 'cdk') {
    throw new MeteredBillingQuoteError('operation_not_available', '周期卡场景对比使用卡内次数，不需要积分报价。', 409)
  }
  if (operation === 'scenario_comparison' && row.kind !== 'metered_personal' && row.kind !== 'metered_commercial') {
    throw new MeteredBillingQuoteError('operation_not_available', '当前档案没有可购买的场景对比包。', 409)
  }
  if (operation !== 'main_schedule' && operation !== 'scenario_comparison'
    && row.kind !== 'cdk' && row.kind !== 'metered_personal' && row.kind !== 'metered_commercial') {
    throw new MeteredBillingQuoteError('operation_not_available', '当前档案不能使用个人增量重算。', 409)
  }
  if (operation !== 'main_schedule' && row.kind === 'depot_value') {
    throw new MeteredBillingQuoteError('operation_not_available', '仓库分析档案不能使用此增值计算。', 409)
  }
  if (row.archived_at) throw new MeteredBillingQuoteError('profile_archived', '归档档案不能提交任务。', 409)
  if (row.kind === 'metered_commercial') {
    if (row.suspended_at) throw new MeteredBillingQuoteError('commercial_suspended', '商用账户已暂停。', 409)
    const net = pointsToMinor(row.lifetime_credited) - pointsToMinor(row.qualification_reversed)
    const summary = getCommercialTierSummary(minorToPoints(net), row.debt)
    if (!summary.eligible) {
      throw new MeteredBillingQuoteError('commercial_not_eligible', '商用资格未生效或账户存在待追偿。', 409)
    }
  }
  return row
}

function quoteFromState(state: BillingStateRow, operation: MeteredBillingOperation): MeteredScheduleQuote {
  const netLifetimeCredited = pointsToMinor(state.lifetime_credited) - pointsToMinor(state.qualification_reversed)
  return getMeteredScheduleQuote(
    (state.kind === 'metered_commercial' ? 'metered_commercial' : 'metered_personal') as MeteredBillingKind,
    minorToPoints(netLifetimeCredited),
    state.debt,
    operation,
  )
}

function minorToPoints(value: bigint): string {
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`
}
