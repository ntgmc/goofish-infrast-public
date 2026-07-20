import { randomUUID } from 'node:crypto'
import type {
  BrevoEmailDailyStat,
  BrevoEmailPurpose,
  BrevoEmailStats,
} from '../../src/lib/types'
import { withTransaction, query } from './postgres'
import { ensureDatabaseSchema } from './schema'

export const BREVO_DAILY_EMAIL_LIMIT = 300
export const BREVO_QUOTA_TIMEZONE = 'UTC' as const

const ACTIVE_STATUSES = ['reserved', 'sent', 'uncertain'] as const
const PURPOSES: BrevoEmailPurpose[] = [
  'email_verification',
  'password_reset',
  'account_deletion_cancellation',
  'account_deletion_receipt',
]

export interface BrevoEmailReservation {
  id: string
  quotaDate: string
  purpose: BrevoEmailPurpose
}

interface BrevoEmailStatsRow {
  quota_date: string
  sent_count: string
  reserved_count: string
  uncertain_count: string
  failed_count: string
  email_verification_count: string
  password_reset_count: string
  account_deletion_cancellation_count: string
  account_deletion_receipt_count: string
}

export class BrevoDailyQuotaExceededError extends Error {
  readonly code = 'brevo_daily_limit_reached'

  constructor(
    readonly quotaDate: string,
    readonly retryAfterSeconds: number,
  ) {
    super('Brevo daily email quota reached')
    this.name = 'BrevoDailyQuotaExceededError'
  }
}

let schemaReady: Promise<void> | null = null

export async function reserveBrevoEmail(
  purpose: BrevoEmailPurpose,
  now = new Date(),
): Promise<BrevoEmailReservation> {
  await ensureSchema()
  const quotaDate = getUtcDate(now)
  const reservation: BrevoEmailReservation = { id: randomUUID(), quotaDate, purpose }

  await withTransaction(async (client) => {
    await client.query(
      'select pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`brevo-email-quota:${quotaDate}`],
    )
    const used = await client.query<{ count: string }>(
      `select count(*)::text as count
         from brevo_email_deliveries
        where quota_date = $1::date
          and status = any($2::text[])`,
      [quotaDate, ACTIVE_STATUSES],
    )
    if (Number(used.rows[0]?.count ?? 0) >= BREVO_DAILY_EMAIL_LIMIT) {
      throw new BrevoDailyQuotaExceededError(quotaDate, secondsUntilNextUtcDay(now))
    }
    await client.query(
      `insert into brevo_email_deliveries
        (id, quota_date, purpose, status, reserved_at, completed_at)
       values ($1, $2::date, $3, 'reserved', $4, null)`,
      [reservation.id, quotaDate, purpose, now.toISOString()],
    )
  })

  return reservation
}

export async function markBrevoEmailSent(reservation: BrevoEmailReservation): Promise<void> {
  await completeReservation(reservation.id, 'sent')
}

export async function markBrevoEmailFailed(reservation: BrevoEmailReservation): Promise<void> {
  await completeReservation(reservation.id, 'failed')
}

export async function markBrevoEmailUncertain(reservation: BrevoEmailReservation): Promise<void> {
  await completeReservation(reservation.id, 'uncertain')
}

export async function releaseBrevoEmailReservation(reservation: BrevoEmailReservation): Promise<void> {
  await markBrevoEmailFailed(reservation)
}

export async function getBrevoEmailStats(now = new Date(), days = 7): Promise<BrevoEmailStats> {
  await ensureSchema()
  const safeDays = Math.max(1, Math.min(31, Math.trunc(days)))
  const today = getUtcDate(now)
  const dates = buildDateRange(today, safeDays)
  const result = await query<BrevoEmailStatsRow>(
    `select quota_date::text,
            count(*) filter (where status = 'sent')::text as sent_count,
            count(*) filter (where status = 'reserved')::text as reserved_count,
            count(*) filter (where status = 'uncertain')::text as uncertain_count,
            count(*) filter (where status = 'failed')::text as failed_count,
            count(*) filter (where status = 'sent' and purpose = 'email_verification')::text as email_verification_count,
            count(*) filter (where status = 'sent' and purpose = 'password_reset')::text as password_reset_count,
            count(*) filter (where status = 'sent' and purpose = 'account_deletion_cancellation')::text as account_deletion_cancellation_count,
            count(*) filter (where status = 'sent' and purpose = 'account_deletion_receipt')::text as account_deletion_receipt_count
       from brevo_email_deliveries
      where quota_date between $1::date and $2::date
      group by quota_date
      order by quota_date asc`,
    [dates[0], dates[dates.length - 1]],
  )
  const rowsByDate = new Map(result.rows.map((row) => [row.quota_date, row]))
  const dailyStats = dates.map((date) => toDailyStat(date, rowsByDate.get(date)))

  return {
    timezone: BREVO_QUOTA_TIMEZONE,
    daily_limit: BREVO_DAILY_EMAIL_LIMIT,
    today: dailyStats[dailyStats.length - 1],
    days: dailyStats,
  }
}

export function getUtcDate(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

export function secondsUntilNextUtcDay(now = new Date()): number {
  const nextMidnightUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  )
  return Math.max(1, Math.ceil((nextMidnightUtc - now.getTime()) / 1000))
}

async function completeReservation(
  id: string,
  status: 'sent' | 'failed' | 'uncertain',
): Promise<void> {
  await ensureSchema()
  await query(
    `update brevo_email_deliveries
        set status = $2, completed_at = now()
      where id = $1 and status = 'reserved'`,
    [id, status],
  )
}

function buildDateRange(today: string, days: number): string[] {
  const todayUtc = Date.parse(`${today}T00:00:00.000Z`)
  return Array.from({ length: days }, (_, index) => (
    new Date(todayUtc - (days - index - 1) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  ))
}

function toDailyStat(date: string, row?: BrevoEmailStatsRow): BrevoEmailDailyStat {
  const sentCount = numberValue(row?.sent_count)
  const reservedCount = numberValue(row?.reserved_count)
  const uncertainCount = numberValue(row?.uncertain_count)
  const failedCount = numberValue(row?.failed_count)
  const quotaUsedCount = sentCount + reservedCount + uncertainCount
  const byPurpose = Object.fromEntries(PURPOSES.map((purpose) => [purpose, 0])) as Record<BrevoEmailPurpose, number>
  byPurpose.email_verification = numberValue(row?.email_verification_count)
  byPurpose.password_reset = numberValue(row?.password_reset_count)
  byPurpose.account_deletion_cancellation = numberValue(row?.account_deletion_cancellation_count)
  byPurpose.account_deletion_receipt = numberValue(row?.account_deletion_receipt_count)
  return {
    date,
    sent_count: sentCount,
    reserved_count: reservedCount,
    uncertain_count: uncertainCount,
    failed_count: failedCount,
    quota_used_count: quotaUsedCount,
    remaining_count: Math.max(0, BREVO_DAILY_EMAIL_LIMIT - quotaUsedCount),
    limit_reached: quotaUsedCount >= BREVO_DAILY_EMAIL_LIMIT,
    by_purpose: byPurpose,
  }
}

function numberValue(value: string | undefined): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

async function ensureSchema(): Promise<void> {
  schemaReady ??= ensureDatabaseSchema().catch((error) => {
    schemaReady = null
    throw error
  })
  await schemaReady
}
