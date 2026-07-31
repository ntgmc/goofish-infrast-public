import { createHash, randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import {
  POINTS_CURRENCY,
  type AdminBalanceTransaction,
  type BalanceSummary,
  type BalancePage,
  type BalanceTransactionKind,
  type PublicBalanceTransaction,
  normalizeStoredPoints,
} from '../../src/lib/balance-contracts'
import { getCommercialTierSummary, type MeteredBillingKind, type MeteredScheduleQuote } from '../../src/lib/metered-billing'
import { ensureDatabaseSchema } from './schema'
import { query, withTransaction } from './postgres'

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

export class BalanceError extends Error {
  constructor(
    readonly code: 'invalid_cursor' | 'invalid_limit' | 'insufficient_balance' | 'idempotency_conflict' | 'user_not_found' | 'reservation_conflict' | 'invalid_reversal' | 'reversal_exceeds_credit',
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message)
    this.name = 'BalanceError'
  }
}

export interface BalanceChangeInput {
  userId: string
  kind: BalanceTransactionKind
  amount: string
  referenceType: string
  referenceId: string
  idempotencyKey?: string | null
  adminUsername?: string | null
  reason?: string | null
  requestHash?: string
  now?: string
}

export interface ScheduleBalanceReservationInput {
  jobId: string
  userId: string
  profileId: string
  quote: MeteredScheduleQuote
  now?: string
}

export interface StoredScheduleBalanceReservation {
  id: string
  job_id: string
  user_id: string
  profile_id: string
  billing_kind: MeteredBillingKind
  pricing_version: string
  tier: 1 | 2 | 3 | 4 | null
  list_price: string
  discount_bps: number
  amount: string
  status: 'reserved' | 'consumed' | 'released'
  created_at: string
  settled_at: string | null
}

type BalanceAccountRow = {
  available: string
  reserved: string
  lifetime_credited: string
  qualification_reversed: string
  debt: string
}

export type StoredBalanceTransaction = {
  id: string
  kind: BalanceTransactionKind
  amount: string
  balance_after: string
  reference_type: string
  reference_id: string
  admin_username: string | null
  reason: string | null
  request_hash: string | null
  created_at: string
}

let schemaReady: Promise<void> | null = null

export function createBalanceRequestHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export async function getPublicBalancePage(
  userId: string,
  options: { cursor?: string | null; limit?: number } = {},
): Promise<BalancePage<PublicBalanceTransaction>> {
  const page = await getBalancePage(userId, options)
  return { balance: page.balance, transactions: page.transactions.map(toPublicBalanceTransaction), next_cursor: page.next_cursor }
}

export async function getAdminBalancePage(
  userId: string,
  options: { cursor?: string | null; limit?: number } = {},
): Promise<BalancePage<AdminBalanceTransaction>> {
  const page = await getBalancePage(userId, options)
  return { balance: page.balance, transactions: page.transactions.map(toAdminTransaction), next_cursor: page.next_cursor }
}

export async function getBalanceSummary(userId: string): Promise<BalanceSummary> {
  await ensureSchema()
  const result = await query<BalanceAccountRow>(
    `select available::text, reserved::text, lifetime_credited::text,
            qualification_reversed::text, debt::text
       from user_balance_accounts where user_id = $1`,
    [userId],
  )
  return toBalanceSummary(result.rows[0])
}

export async function adjustBalance(input: BalanceChangeInput): Promise<{
  balance: BalanceSummary
  transaction: AdminBalanceTransaction
  replayed: boolean
}> {
  await ensureSchema()
  return withTransaction(async (client) => {
    const result = await applyBalanceChangeInTransaction(client, input)
    return {
      balance: await getBalanceSummaryInTransaction(client, input.userId),
      transaction: toAdminTransaction(result.transaction),
      replayed: result.replayed,
    }
  })
}

export async function applyBalanceChangeInTransaction(
  client: PoolClient,
  input: BalanceChangeInput,
): Promise<{ transaction: StoredBalanceTransaction; replayed: boolean }> {
  const requestHash = input.requestHash ?? createBalanceRequestHash({
    userId: input.userId,
    kind: input.kind,
    amount: input.amount,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    adminUsername: input.adminUsername ?? null,
    reason: input.reason ?? null,
  })
  if (input.idempotencyKey) {
    const existing = await client.query<StoredBalanceTransaction>(
      `select id, kind, amount::text, balance_after::text, reference_type, reference_id,
              admin_username, reason, request_hash, created_at
         from user_balance_transactions
        where user_id = $1 and idempotency_key = $2 for update`,
      [input.userId, input.idempotencyKey],
    )
    const row = existing.rows[0]
    if (row) {
      if (row.request_hash !== requestHash) throw new BalanceError('idempotency_conflict', '当前请求标识已用于其他积分操作。', 409)
      return { transaction: normalizeTransaction(row), replayed: true }
    }
  }

  const user = await client.query('select 1 from user_accounts where id = $1', [input.userId])
  if (!user.rowCount) throw new BalanceError('user_not_found', '用户不存在。', 404)
  await ensureBalanceAccountInTransaction(client, input.userId)
  const negativeKind = input.kind === 'admin_debit' || input.kind === 'schedule_debit'
    || input.kind === 'admin_credit_reversal' || input.kind === 'debt_repayment'
  const signedAmount = negativeKind ? `-${input.amount}` : input.amount
  const qualificationCredit = input.kind === 'cdk_credit' || input.kind === 'admin_credit'
  const now = input.now ?? new Date().toISOString()
  const updated = await client.query<{ available: string }>(
    `update user_balance_accounts
        set available = available + $2::numeric,
            lifetime_credited = lifetime_credited + $4::numeric,
            updated_at = $3
      where user_id = $1 and available + $2::numeric >= reserved
      returning available::text`,
    [input.userId, signedAmount, now, qualificationCredit ? input.amount : '0.00'],
  )
  if (!updated.rowCount) throw new BalanceError('insufficient_balance', '积分余额不足。', 409)
  const inserted = await client.query<StoredBalanceTransaction>(
    `insert into user_balance_transactions
      (id, user_id, kind, amount, balance_after, reference_type, reference_id, idempotency_key,
       admin_username, reason, request_hash, created_at)
     values ($1, $2, $3, $4::numeric, $5::numeric, $6, $7, $8, $9, $10, $11, $12)
     returning id, kind, amount::text, balance_after::text, reference_type, reference_id,
               admin_username, reason, request_hash, created_at`,
    [randomUUID(), input.userId, input.kind, signedAmount, updated.rows[0]?.available, input.referenceType,
      input.referenceId, input.idempotencyKey ?? null, input.adminUsername ?? null, input.reason ?? null,
      requestHash, now],
  )
  const transaction = normalizeTransaction(inserted.rows[0]!)
  if (qualificationCredit) {
    await client.query(
      `insert into user_balance_qualification_ledger
        (id, user_id, balance_transaction_id, delta, reason, idempotency_key, created_at)
       values ($1, $2, $3, $4::numeric, 'positive_balance_credit', $5, $6)`,
      [randomUUID(), input.userId, transaction.id, input.amount, `credit:${transaction.id}`, now],
    )
    await repayDebtAfterCreditInTransaction(client, input.userId, transaction.id, now)
  }
  return { transaction, replayed: false }
}

export async function reverseQualificationCredit(input: {
  userId: string
  originalTransactionId: string
  amount: string
  reason: string
  idempotencyKey: string
  adminUsername: string
  now?: string
}): Promise<{ balance: BalanceSummary; transaction: AdminBalanceTransaction; replayed: boolean }> {
  await ensureSchema()
  return withTransaction(async (client) => {
    const requestHash = createBalanceRequestHash({
      userId: input.userId,
      originalTransactionId: input.originalTransactionId,
      amount: input.amount,
      reason: input.reason,
      adminUsername: input.adminUsername,
    })
    const replay = await client.query<StoredBalanceTransaction>(
      `select id, kind, amount::text, balance_after::text, reference_type, reference_id,
              admin_username, reason, request_hash, created_at
         from user_balance_transactions where user_id = $1 and idempotency_key = $2 for update`,
      [input.userId, input.idempotencyKey],
    )
    if (replay.rows[0]) {
      if (replay.rows[0].request_hash !== requestHash) {
        throw new BalanceError('idempotency_conflict', '当前请求标识已用于其他积分操作。', 409)
      }
      return {
        balance: await getBalanceSummaryInTransaction(client, input.userId),
        transaction: toAdminTransaction(normalizeTransaction(replay.rows[0])),
        replayed: true,
      }
    }
    const original = await client.query<{ id: string; kind: BalanceTransactionKind; amount: string }>(
      `select id, kind, amount::text from user_balance_transactions
        where id = $1 and user_id = $2 for update`,
      [input.originalTransactionId, input.userId],
    )
    const credit = original.rows[0]
    if (!credit || (credit.kind !== 'cdk_credit' && credit.kind !== 'admin_credit') || pointsMinor(credit.amount) <= 0n) {
      throw new BalanceError('invalid_reversal', '只能冲正该用户原有的正向积分入账。', 409)
    }
    const reversed = await client.query<{ total: string }>(
      `select coalesce(-sum(delta) filter (where delta < 0), 0)::text as total
         from user_balance_qualification_ledger where user_id = $1 and balance_transaction_id = $2`,
      [input.userId, input.originalTransactionId],
    )
    if (pointsMinor(reversed.rows[0]?.total ?? '0') + pointsMinor(input.amount) > pointsMinor(credit.amount)) {
      throw new BalanceError('reversal_exceeds_credit', '累计冲正金额不能超过原积分入账金额。', 409)
    }
    await ensureBalanceAccountInTransaction(client, input.userId)
    const now = input.now ?? new Date().toISOString()
    const account = await client.query<{ available: string }>(
      `update user_balance_accounts
          set available = available - least($2::numeric, available - reserved),
              debt = debt + greatest($2::numeric - (available - reserved), 0),
              qualification_reversed = qualification_reversed + $2::numeric,
              updated_at = $3
        where user_id = $1 and qualification_reversed + $2::numeric <= lifetime_credited
        returning available::text`,
      [input.userId, input.amount, now],
    )
    if (!account.rows[0]) throw new BalanceError('reversal_exceeds_credit', '冲正金额超过该用户可冲正的累计积分。', 409)
    const inserted = await client.query<StoredBalanceTransaction>(
      `insert into user_balance_transactions
        (id, user_id, kind, amount, balance_after, reference_type, reference_id, idempotency_key,
         admin_username, reason, request_hash, created_at)
       values ($1, $2, 'admin_credit_reversal', -$3::numeric, $4::numeric,
               'balance_credit_reversal', $5, $6, $7, $8, $9, $10)
       returning id, kind, amount::text, balance_after::text, reference_type, reference_id,
                 admin_username, reason, request_hash, created_at`,
      [randomUUID(), input.userId, input.amount, account.rows[0].available,
        input.originalTransactionId, input.idempotencyKey, input.adminUsername, input.reason, requestHash, now],
    )
    const transaction = normalizeTransaction(inserted.rows[0]!)
    await client.query(
      `insert into user_balance_qualification_ledger
        (id, user_id, balance_transaction_id, delta, reason, idempotency_key, created_at)
       values ($1, $2, $3, -$4::numeric, $5, $6, $7)`,
      [randomUUID(), input.userId, input.originalTransactionId, input.amount,
        input.reason, `reversal:${input.idempotencyKey}`, now],
    )
    return {
      balance: await getBalanceSummaryInTransaction(client, input.userId),
      transaction: toAdminTransaction(transaction),
      replayed: false,
    }
  })
}

async function repayDebtAfterCreditInTransaction(
  client: PoolClient,
  userId: string,
  creditTransactionId: string,
  now: string,
): Promise<void> {
  const repaid = await client.query<{ amount: string; available: string }>(
    `with repayment as (
       select least(debt, available - reserved) as amount
         from user_balance_accounts where user_id = $1 for update
     )
     update user_balance_accounts a
        set available = a.available - repayment.amount,
            debt = a.debt - repayment.amount,
            updated_at = $2
       from repayment
      where a.user_id = $1 and repayment.amount > 0
      returning repayment.amount::text, a.available::text`,
    [userId, now],
  )
  const row = repaid.rows[0]
  if (!row) return
  await client.query(
    `insert into user_balance_transactions
      (id, user_id, kind, amount, balance_after, reference_type, reference_id, idempotency_key,
       admin_username, reason, request_hash, created_at)
     values ($1, $2, 'debt_repayment', -$3::numeric, $4::numeric, 'balance_credit', $5,
             $6, null, '自动抵扣待追偿积分', null, $7)`,
    [randomUUID(), userId, row.amount, row.available, creditTransactionId, `debt:${creditTransactionId}`, now],
  )
}

export async function reserveScheduleBalanceInTransaction(
  client: PoolClient,
  input: ScheduleBalanceReservationInput,
): Promise<StoredScheduleBalanceReservation> {
  await ensureBalanceAccountInTransaction(client, input.userId)
  const existing = await client.query<StoredScheduleBalanceReservation>(
    `select id, job_id, user_id, profile_id, billing_kind, pricing_version, tier,
            list_price::text, discount_bps, amount::text, status, created_at, settled_at
       from user_balance_reservations where job_id = $1 for update`,
    [input.jobId],
  )
  if (existing.rows[0]) {
    const row = normalizeReservation(existing.rows[0])
    if (row.user_id !== input.userId || row.profile_id !== input.profileId
      || row.amount !== input.quote.charge || row.pricing_version !== input.quote.pricing_version) {
      throw new BalanceError('reservation_conflict', '当前任务已关联其他积分预留。', 409)
    }
    return row
  }
  const now = input.now ?? new Date().toISOString()
  const reserved = await client.query(
    `update user_balance_accounts set reserved = reserved + $2::numeric, updated_at = $3
      where user_id = $1 and available - reserved >= $2::numeric and debt = 0`,
    [input.userId, input.quote.charge, now],
  )
  if (!reserved.rowCount) throw new BalanceError('insufficient_balance', '积分余额不足。', 409)
  const result = await client.query<StoredScheduleBalanceReservation>(
    `insert into user_balance_reservations
      (id, job_id, user_id, profile_id, billing_kind, pricing_version, tier, list_price,
       discount_bps, amount, status, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8::numeric, $9, $10::numeric, 'reserved', $11)
     returning id, job_id, user_id, profile_id, billing_kind, pricing_version, tier,
               list_price::text, discount_bps, amount::text, status, created_at, settled_at`,
    [randomUUID(), input.jobId, input.userId, input.profileId, input.quote.billing_kind,
      input.quote.pricing_version, input.quote.tier, input.quote.list_price, input.quote.discount_bps,
      input.quote.charge, now],
  )
  return normalizeReservation(result.rows[0]!)
}

export async function settleScheduleBalanceInTransaction(
  client: PoolClient,
  jobId: string,
  now = new Date().toISOString(),
): Promise<StoredScheduleBalanceReservation | null> {
  const result = await client.query<StoredScheduleBalanceReservation>(
    `select id, job_id, user_id, profile_id, billing_kind, pricing_version, tier,
            list_price::text, discount_bps, amount::text, status, created_at, settled_at
       from user_balance_reservations where job_id = $1 for update`,
    [jobId],
  )
  const reservation = result.rows[0] ? normalizeReservation(result.rows[0]) : null
  if (!reservation || reservation.status === 'consumed') return reservation
  if (reservation.status === 'released') throw new BalanceError('reservation_conflict', '已释放的积分预留不能结算。', 409)
  const account = await client.query<{ available: string }>(
    `update user_balance_accounts
        set available = available - $2::numeric, reserved = reserved - $2::numeric, updated_at = $3
      where user_id = $1 and reserved >= $2::numeric and available >= $2::numeric
      returning available::text`,
    [reservation.user_id, reservation.amount, now],
  )
  if (!account.rowCount) throw new BalanceError('reservation_conflict', '积分预留与账户余额不一致。', 409)
  const transaction = await client.query(
    `insert into user_balance_transactions
      (id, user_id, kind, amount, balance_after, reference_type, reference_id, idempotency_key,
       admin_username, reason, request_hash, created_at)
     values ($1, $2, 'schedule_debit', -$3::numeric, $4::numeric, 'optimization_job', $5,
             $6, null, '成功主排班', null, $7)
     returning id`,
    [randomUUID(), reservation.user_id, reservation.amount, account.rows[0]!.available, jobId, `schedule:${jobId}`, now],
  )
  if (!transaction.rowCount) throw new BalanceError('reservation_conflict', '积分结算流水写入失败。', 409)
  await client.query(
    `update user_balance_reservations set status = 'consumed', settled_at = $2
      where job_id = $1 and status = 'reserved'`,
    [jobId, now],
  )
  return { ...reservation, status: 'consumed', settled_at: now }
}

export async function releaseScheduleBalanceInTransaction(
  client: PoolClient,
  jobId: string,
  now = new Date().toISOString(),
): Promise<boolean> {
  const result = await client.query<{ user_id: string; amount: string }>(
    `select user_id, amount::text from user_balance_reservations
      where job_id = $1 and status = 'reserved' for update`,
    [jobId],
  )
  const reservation = result.rows[0]
  if (!reservation) return false
  const released = await client.query(
    `update user_balance_accounts set reserved = reserved - $2::numeric, updated_at = $3
      where user_id = $1 and reserved >= $2::numeric`,
    [reservation.user_id, reservation.amount, now],
  )
  if (!released.rowCount) throw new BalanceError('reservation_conflict', '积分预留与账户余额不一致。', 409)
  await client.query(
    `update user_balance_reservations set status = 'released', settled_at = $2
      where job_id = $1 and status = 'reserved'`,
    [jobId, now],
  )
  return true
}

async function getBalancePage(
  userId: string,
  options: { cursor?: string | null; limit?: number },
): Promise<BalancePage<StoredBalanceTransaction>> {
  await ensureSchema()
  const limit = options.limit ?? DEFAULT_PAGE_SIZE
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new BalanceError('invalid_limit', '积分流水数量必须是 1 到 100 之间的整数。', 400)
  }
  const cursor = decodeCursor(options.cursor)
  const values: unknown[] = [userId, limit + 1]
  const cursorClause = cursor ? 'and (created_at, id) < ($3::timestamptz, $4)' : ''
  if (cursor) values.push(cursor.createdAt, cursor.id)
  const [account, transactions] = await Promise.all([
    query<BalanceAccountRow>(
      `select available::text, reserved::text, lifetime_credited::text,
              qualification_reversed::text, debt::text
         from user_balance_accounts where user_id = $1`, [userId],
    ),
    query<StoredBalanceTransaction>(
      `select id, kind, amount::text, balance_after::text, reference_type, reference_id,
              admin_username, reason, request_hash, created_at
         from user_balance_transactions
        where user_id = $1 ${cursorClause}
        order by created_at desc, id desc limit $2`,
      values,
    ),
  ])
  const rows = transactions.rows.slice(0, limit).map(normalizeTransaction)
  return {
    balance: toBalanceSummary(account.rows[0]),
    transactions: rows,
    next_cursor: transactions.rows.length > limit && rows.length > 0 ? encodeCursor(rows.at(-1)!) : null,
  }
}

async function ensureBalanceAccountInTransaction(client: PoolClient, userId: string): Promise<void> {
  await client.query(
    `insert into user_balance_accounts
      (user_id, available, reserved, lifetime_credited, qualification_reversed, debt, updated_at)
     values ($1, 0, 0, 0, 0, 0, now()) on conflict (user_id) do nothing`,
    [userId],
  )
}

async function getBalanceSummaryInTransaction(client: PoolClient, userId: string): Promise<BalanceSummary> {
  const result = await client.query<BalanceAccountRow>(
    `select available::text, reserved::text, lifetime_credited::text,
            qualification_reversed::text, debt::text
       from user_balance_accounts where user_id = $1`,
    [userId],
  )
  return toBalanceSummary(result.rows[0])
}

function toBalanceSummary(row: BalanceAccountRow | undefined): BalanceSummary {
  const totalMinor = pointsMinor(row?.available ?? '0')
  const reservedMinor = pointsMinor(row?.reserved ?? '0')
  const lifetimeMinor = pointsMinor(row?.lifetime_credited ?? '0')
  const reversedMinor = pointsMinor(row?.qualification_reversed ?? '0')
  const lifetime = formatPointsMinor(lifetimeMinor - reversedMinor)
  const debt = normalizeStoredPoints(row?.debt ?? '0')
  return {
    currency: POINTS_CURRENCY,
    available: formatPointsMinor(totalMinor - reservedMinor),
    reserved: normalizeStoredPoints(row?.reserved ?? '0'),
    lifetime_credited: lifetime,
    qualification_reversed: normalizeStoredPoints(row?.qualification_reversed ?? '0'),
    debt,
    commercial: getCommercialTierSummary(lifetime, debt),
  }
}

function normalizeReservation(row: StoredScheduleBalanceReservation): StoredScheduleBalanceReservation {
  return { ...row, list_price: normalizeStoredPoints(row.list_price), amount: normalizeStoredPoints(row.amount) }
}

function pointsMinor(value: string): bigint {
  const normalized = normalizeStoredPoints(value)
  const [whole, fraction] = normalized.split('.')
  return BigInt(whole!) * 100n + BigInt(fraction!)
}

function formatPointsMinor(value: bigint): string {
  if (value < 0n) throw new Error('Balance projection cannot be negative.')
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`
}

export function toPublicBalanceTransaction(row: StoredBalanceTransaction): PublicBalanceTransaction {
  return { id: row.id, kind: row.kind, amount: row.amount, balance_after: row.balance_after, created_at: row.created_at }
}

function toAdminTransaction(row: StoredBalanceTransaction): AdminBalanceTransaction {
  return { ...toPublicBalanceTransaction(row), reference_type: row.reference_type, reference_id: row.reference_id, admin_username: row.admin_username, reason: row.reason }
}

function normalizeTransaction(row: StoredBalanceTransaction): StoredBalanceTransaction {
  return { ...row, amount: normalizeStoredPoints(row.amount), balance_after: normalizeStoredPoints(row.balance_after) }
}

function encodeCursor(row: Pick<StoredBalanceTransaction, 'created_at' | 'id'>): string {
  return Buffer.from(JSON.stringify({ createdAt: row.created_at, id: row.id }), 'utf8').toString('base64url')
}

function decodeCursor(value: string | null | undefined): { createdAt: string; id: string } | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>
    if (typeof parsed.createdAt !== 'string' || Number.isNaN(Date.parse(parsed.createdAt)) || typeof parsed.id !== 'string' || !parsed.id) throw new Error('invalid cursor')
    return { createdAt: parsed.createdAt, id: parsed.id }
  } catch {
    throw new BalanceError('invalid_cursor', '积分流水游标无效。', 400)
  }
}

function ensureSchema(): Promise<void> {
  schemaReady ??= ensureDatabaseSchema().catch((error) => {
    schemaReady = null
    throw error
  })
  return schemaReady
}
