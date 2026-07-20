import { randomUUID } from 'node:crypto'
import type {
  BrevoEmailDailyStat,
  BrevoEmailPurpose,
  BrevoEmailStats,
  BrevoOfficialQuotaStatus,
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

export interface BrevoOfficialQuotaSnapshot {
  quotaDate: string
  reportedRemainingCount: number | null
  reportedUsedCount: number | null
  localUsedAtSync: number
  externalUsedOffset: number
  syncStatus: 'success' | 'error'
  lastAttemptAt: string
  syncedAt: string | null
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

interface BrevoOfficialQuotaSnapshotRow {
  quota_date: string
  reported_remaining_count: number | null
  reported_used_count: number | null
  local_used_at_sync: number
  external_used_offset: number
  sync_status: 'success' | 'error'
  last_attempt_at: string
  synced_at: string | null
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
    await lockQuotaDate(client, quotaDate)
    const localUsedCount = await countActiveDeliveries(client, quotaDate)
    const snapshot = await client.query<{ external_used_offset: number }>(
      'select external_used_offset from brevo_email_quota_snapshots where quota_date = $1::date',
      [quotaDate],
    )
    const externalUsedOffset = numberValue(snapshot.rows[0]?.external_used_offset)
    if (localUsedCount + externalUsedOffset >= BREVO_DAILY_EMAIL_LIMIT) {
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

export async function getBrevoOfficialQuotaSnapshot(
  now = new Date(),
): Promise<BrevoOfficialQuotaSnapshot | null> {
  await ensureSchema()
  const result = await query<BrevoOfficialQuotaSnapshotRow>(
    `select quota_date::text, reported_remaining_count, reported_used_count,
            local_used_at_sync, external_used_offset, sync_status,
            last_attempt_at::text, synced_at::text
       from brevo_email_quota_snapshots
      where quota_date = $1::date`,
    [getUtcDate(now)],
  )
  return result.rows[0] ? toOfficialSnapshot(result.rows[0]) : null
}

export async function saveBrevoOfficialQuotaSnapshot(
  reportedRemainingCount: number,
  now = new Date(),
): Promise<BrevoOfficialQuotaSnapshot> {
  await ensureSchema()
  const quotaDate = getUtcDate(now)
  const remainingCount = clampInteger(reportedRemainingCount, 0, BREVO_DAILY_EMAIL_LIMIT)
  const reportedUsedCount = BREVO_DAILY_EMAIL_LIMIT - remainingCount

  return withTransaction(async (client) => {
    await lockQuotaDate(client, quotaDate)
    const localUsedAtSync = await countActiveDeliveries(client, quotaDate)
    const previous = await client.query<{ external_used_offset: number }>(
      'select external_used_offset from brevo_email_quota_snapshots where quota_date = $1::date',
      [quotaDate],
    )
    const externalUsedOffset = Math.min(
      BREVO_DAILY_EMAIL_LIMIT,
      Math.max(
        numberValue(previous.rows[0]?.external_used_offset),
        reportedUsedCount - localUsedAtSync,
        0,
      ),
    )
    const result = await client.query<BrevoOfficialQuotaSnapshotRow>(
      `insert into brevo_email_quota_snapshots
        (quota_date, reported_remaining_count, reported_used_count, local_used_at_sync,
         external_used_offset, sync_status, last_attempt_at, synced_at)
       values ($1::date, $2, $3, $4, $5, 'success', $6, $6)
       on conflict (quota_date) do update set
         reported_remaining_count = excluded.reported_remaining_count,
         reported_used_count = excluded.reported_used_count,
         local_used_at_sync = excluded.local_used_at_sync,
         external_used_offset = excluded.external_used_offset,
         sync_status = 'success',
         last_attempt_at = excluded.last_attempt_at,
         synced_at = excluded.synced_at
       returning quota_date::text, reported_remaining_count, reported_used_count,
                 local_used_at_sync, external_used_offset, sync_status,
                 last_attempt_at::text, synced_at::text`,
      [quotaDate, remainingCount, reportedUsedCount, localUsedAtSync, externalUsedOffset, now.toISOString()],
    )
    return toOfficialSnapshot(result.rows[0]!)
  })
}

export async function recordBrevoOfficialQuotaSyncFailure(now = new Date()): Promise<void> {
  await ensureSchema()
  await query(
    `insert into brevo_email_quota_snapshots
      (quota_date, reported_remaining_count, reported_used_count, local_used_at_sync,
       external_used_offset, sync_status, last_attempt_at, synced_at)
     values ($1::date, null, null, 0, 0, 'error', $2, null)
     on conflict (quota_date) do update set
       sync_status = 'error',
       last_attempt_at = excluded.last_attempt_at`,
    [getUtcDate(now), now.toISOString()],
  )
}

export async function getBrevoEmailStats(now = new Date(), days = 7): Promise<BrevoEmailStats> {
  await ensureSchema()
  const safeDays = Math.max(1, Math.min(31, Math.trunc(days)))
  const today = getUtcDate(now)
  const dates = buildDateRange(today, safeDays)
  const [result, officialSnapshot] = await Promise.all([
    query<BrevoEmailStatsRow>(
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
    ),
    getBrevoOfficialQuotaSnapshot(now),
  ])
  const rowsByDate = new Map(result.rows.map((row) => [row.quota_date, row]))
  const dailyStats = dates.map((date) => toDailyStat(date, rowsByDate.get(date)))
  const localToday = dailyStats[dailyStats.length - 1]
  const externalUsedOffset = officialSnapshot?.externalUsedOffset ?? 0
  const effectiveUsedCount = Math.min(
    BREVO_DAILY_EMAIL_LIMIT,
    localToday.local_quota_used_count + externalUsedOffset,
  )
  dailyStats[dailyStats.length - 1] = {
    ...localToday,
    quota_used_count: effectiveUsedCount,
    remaining_count: Math.max(0, BREVO_DAILY_EMAIL_LIMIT - effectiveUsedCount),
    limit_reached: effectiveUsedCount >= BREVO_DAILY_EMAIL_LIMIT,
  }

  return {
    timezone: BREVO_QUOTA_TIMEZONE,
    daily_limit: BREVO_DAILY_EMAIL_LIMIT,
    official_quota: toOfficialQuotaStatus(officialSnapshot),
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

async function lockQuotaDate(client: { query: (text: string, values?: unknown[]) => Promise<unknown> }, quotaDate: string): Promise<void> {
  await client.query(
    'select pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`brevo-email-quota:${quotaDate}`],
  )
}

async function countActiveDeliveries(
  client: { query: <T>(text: string, values?: unknown[]) => Promise<{ rows: T[] }> },
  quotaDate: string,
): Promise<number> {
  const result = await client.query<{ count: string }>(
    `select count(*)::text as count
       from brevo_email_deliveries
      where quota_date = $1::date
        and status = any($2::text[])`,
    [quotaDate, ACTIVE_STATUSES],
  )
  return numberValue(result.rows[0]?.count)
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
  const localQuotaUsedCount = sentCount + reservedCount + uncertainCount
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
    local_quota_used_count: localQuotaUsedCount,
    quota_used_count: localQuotaUsedCount,
    remaining_count: Math.max(0, BREVO_DAILY_EMAIL_LIMIT - localQuotaUsedCount),
    limit_reached: localQuotaUsedCount >= BREVO_DAILY_EMAIL_LIMIT,
    by_purpose: byPurpose,
  }
}

function toOfficialSnapshot(row: BrevoOfficialQuotaSnapshotRow): BrevoOfficialQuotaSnapshot {
  return {
    quotaDate: row.quota_date,
    reportedRemainingCount: nullableNumber(row.reported_remaining_count),
    reportedUsedCount: nullableNumber(row.reported_used_count),
    localUsedAtSync: numberValue(row.local_used_at_sync),
    externalUsedOffset: numberValue(row.external_used_offset),
    syncStatus: row.sync_status,
    lastAttemptAt: row.last_attempt_at,
    syncedAt: row.synced_at,
  }
}

function toOfficialQuotaStatus(snapshot: BrevoOfficialQuotaSnapshot | null): BrevoOfficialQuotaStatus {
  const hasReportedQuota = snapshot?.reportedRemainingCount !== null && snapshot?.reportedUsedCount !== null
  return {
    status: !snapshot || !hasReportedQuota
      ? 'unavailable'
      : snapshot.syncStatus === 'success' ? 'fresh' : 'stale',
    reported_remaining_count: snapshot?.reportedRemainingCount ?? null,
    reported_used_count: snapshot?.reportedUsedCount ?? null,
    external_used_offset: snapshot?.externalUsedOffset ?? 0,
    synced_at: snapshot?.syncedAt ?? null,
    last_attempt_at: snapshot?.lastAttemptAt ?? null,
  }
}

function nullableNumber(value: number | null): number | null {
  return value === null ? null : numberValue(value)
}

function numberValue(value: string | number | undefined): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) throw new Error('Brevo remaining credits must be a finite number')
  return Math.max(min, Math.min(max, Math.trunc(value)))
}

async function ensureSchema(): Promise<void> {
  schemaReady ??= ensureDatabaseSchema().catch((error) => {
    schemaReady = null
    throw error
  })
  await schemaReady
}
