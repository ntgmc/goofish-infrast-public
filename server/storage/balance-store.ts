import { createHash, randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import {
  POINTS_CURRENCY,
  type AdminBalanceTransaction,
  type BalancePage,
  type BalanceTransactionKind,
  type PublicBalanceTransaction,
  normalizeStoredPoints,
} from '../../src/lib/balance-contracts'
import { ensureDatabaseSchema } from './schema'
import { query, withTransaction } from './postgres'

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

export class BalanceError extends Error {
  constructor(
    readonly code: 'invalid_cursor' | 'invalid_limit' | 'insufficient_balance' | 'idempotency_conflict' | 'user_not_found',
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

export async function adjustBalance(input: BalanceChangeInput): Promise<{
  balance: { currency: typeof POINTS_CURRENCY; available: string }
  transaction: AdminBalanceTransaction
  replayed: boolean
}> {
  await ensureSchema()
  return withTransaction(async (client) => {
    const result = await applyBalanceChangeInTransaction(client, input)
    return {
      balance: { currency: POINTS_CURRENCY, available: result.transaction.balance_after },
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
  await client.query(
    `insert into user_balance_accounts (user_id, available, updated_at)
     values ($1, 0, now()) on conflict (user_id) do nothing`,
    [input.userId],
  )
  const signedAmount = input.kind === 'admin_debit' ? `-${input.amount}` : input.amount
  const now = input.now ?? new Date().toISOString()
  const updated = await client.query<{ available: string }>(
    `update user_balance_accounts
        set available = available + $2::numeric, updated_at = $3
      where user_id = $1 and available + $2::numeric >= 0
      returning available::text`,
    [input.userId, signedAmount, now],
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
  return { transaction: normalizeTransaction(inserted.rows[0]!), replayed: false }
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
    query<{ available: string }>('select available::text from user_balance_accounts where user_id = $1', [userId]),
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
    balance: { currency: POINTS_CURRENCY, available: normalizeStoredPoints(account.rows[0]?.available ?? '0') },
    transactions: rows,
    next_cursor: transactions.rows.length > limit && rows.length > 0 ? encodeCursor(rows.at(-1)!) : null,
  }
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
