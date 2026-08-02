import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closePool, query } from './postgres'
import { ensureDatabaseSchema } from './schema'
import {
  BrevoDailyQuotaExceededError,
  getBrevoEmailStats,
  markEmailDeliveryFailed,
  markEmailDeliverySent,
  markEmailDeliveryUncertain,
  reserveBrevoEmail,
  reserveSesEmail,
  saveBrevoOfficialQuotaSnapshot,
} from './brevo-email-store'

let container: PostgreSqlContainer

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  process.env.DATABASE_URL = container.getConnectionUri()
  await ensureDatabaseSchema()
})

beforeEach(async () => {
  await query('delete from brevo_email_deliveries')
  await query('delete from brevo_email_quota_snapshots')
})

afterAll(async () => {
  await closePool()
  if (container) await container.stop()
})

describe('Brevo email quota PostgreSQL store', () => {
  it('allows exactly 300 concurrent reservations', async () => {
    const now = new Date('2026-07-21T04:00:00.000Z')
    const results = await Promise.allSettled(
      Array.from({ length: 301 }, () => reserveBrevoEmail('email_verification', now)),
    )

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(300)
    expect(results.filter((result) => (
      result.status === 'rejected' && result.reason instanceof BrevoDailyQuotaExceededError
    ))).toHaveLength(1)
  })

  it('protects admin invitation and password reset capacity with hierarchical sharing', async () => {
    const now = new Date('2026-07-21T04:00:00.000Z')
    const policy = { adminInviteReserve: 20, passwordResetReserve: 10 }
    const standard = await Promise.allSettled(
      Array.from({ length: 271 }, () => reserveBrevoEmail('email_verification', now, policy)),
    )
    expect(standard.filter((result) => result.status === 'fulfilled')).toHaveLength(270)
    expect(standard.filter((result) => (
      result.status === 'rejected'
      && result.reason instanceof BrevoDailyQuotaExceededError
      && result.reason.reason === 'reserved_capacity'
    ))).toHaveLength(1)

    const adminInvites = await Promise.allSettled(
      Array.from({ length: 21 }, () => reserveBrevoEmail('admin_invite_verification', now, policy)),
    )
    expect(adminInvites.filter((result) => result.status === 'fulfilled')).toHaveLength(20)
    expect(adminInvites.filter((result) => result.status === 'rejected')).toHaveLength(1)

    const passwordResets = await Promise.allSettled(
      Array.from({ length: 11 }, () => reserveBrevoEmail('password_reset', now, policy)),
    )
    expect(passwordResets.filter((result) => result.status === 'fulfilled')).toHaveLength(10)
    expect(passwordResets.filter((result) => (
      result.status === 'rejected'
      && result.reason instanceof BrevoDailyQuotaExceededError
      && result.reason.reason === 'daily_limit'
    ))).toHaveLength(1)

    expect((await getBrevoEmailStats(now)).today).toMatchObject({
      local_quota_used_count: 300,
      remaining_count: 0,
      limit_reached: true,
    })
  })

  it('releases definite failures and retains uncertain deliveries', async () => {
    const now = new Date('2026-07-21T04:00:00.000Z')
    const failed = await reserveBrevoEmail('password_reset', now)
    const uncertain = await reserveBrevoEmail('account_deletion_receipt', now)
    await markEmailDeliveryFailed(failed)
    await markEmailDeliveryUncertain(uncertain)
    await reserveBrevoEmail('email_verification', now)

    const stats = await getBrevoEmailStats(now)
    expect(stats.today).toMatchObject({
      sent_count: 0,
      reserved_count: 1,
      uncertain_count: 1,
      failed_count: 1,
      local_quota_used_count: 2,
      quota_used_count: 2,
      remaining_count: 298,
    })
  })

  it('returns seven zero-filled days with sent-purpose breakdowns', async () => {
    const now = new Date('2026-07-21T04:00:00.000Z')
    const verification = await reserveBrevoEmail('email_verification', now)
    const reset = await reserveBrevoEmail('password_reset', new Date('2026-07-20T04:00:00.000Z'))
    await markEmailDeliverySent(verification)
    await markEmailDeliverySent(reset)

    const stats = await getBrevoEmailStats(now)
    expect(stats.days).toHaveLength(7)
    expect(stats.days.map((day) => day.date)).toEqual([
      '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18', '2026-07-19', '2026-07-20', '2026-07-21',
    ])
    expect(stats.days[5]).toMatchObject({ sent_count: 1, by_purpose: { password_reset: 1 } })
    expect(stats.today).toMatchObject({ sent_count: 1, by_purpose: { email_verification: 1 } })
    expect(stats.days[0]?.quota_used_count).toBe(0)
  })

  it('tracks SES delivery status without consuming the Brevo quota', async () => {
    const now = new Date('2026-07-21T04:00:00.000Z')
    const reservation = await reserveSesEmail('email_verification', now)
    await markEmailDeliverySent(reservation)

    await expect(query<{ provider: string; status: string }>(
      'select provider, status from brevo_email_deliveries where id = $1',
      [reservation.id],
    )).resolves.toMatchObject({ rows: [{ provider: 'ses', status: 'sent' }] })
    expect(await getBrevoEmailStats(now)).toMatchObject({
      today: { sent_count: 0, local_quota_used_count: 0, remaining_count: 300 },
    })
  })

  it('combines official external usage with local reservations atomically', async () => {
    const now = new Date('2026-07-21T04:00:00.000Z')
    const snapshot = await saveBrevoOfficialQuotaSnapshot(2, now)
    expect(snapshot).toMatchObject({
      reportedRemainingCount: 2,
      reportedUsedCount: 298,
      externalUsedOffset: 298,
    })

    const results = await Promise.allSettled([
      reserveBrevoEmail('email_verification', now),
      reserveBrevoEmail('password_reset', now),
      reserveBrevoEmail('account_deletion_receipt', now),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)

    const stats = await getBrevoEmailStats(now)
    expect(stats.today).toMatchObject({
      local_quota_used_count: 2,
      quota_used_count: 300,
      remaining_count: 0,
      limit_reached: true,
    })
    expect(stats.official_quota).toMatchObject({
      status: 'fresh',
      reported_remaining_count: 2,
      external_used_offset: 298,
    })
  })

  it('does not reduce an existing external offset when Brevo reporting lags', async () => {
    const now = new Date('2026-07-21T04:00:00.000Z')
    await saveBrevoOfficialQuotaSnapshot(250, now)
    await reserveBrevoEmail('email_verification', now)
    const refreshed = await saveBrevoOfficialQuotaSnapshot(250, new Date(now.getTime() + 60_000))

    expect(refreshed).toMatchObject({
      localUsedAtSync: 1,
      reportedUsedCount: 50,
      externalUsedOffset: 50,
    })
    expect((await getBrevoEmailStats(now)).today).toMatchObject({
      local_quota_used_count: 1,
      quota_used_count: 51,
      remaining_count: 249,
    })
  })

  it('recalculates the external offset when the official usage counter resets', async () => {
    const now = new Date('2026-07-21T04:00:00.000Z')
    const exhausted = await saveBrevoOfficialQuotaSnapshot(0, now)
    expect(exhausted).toMatchObject({
      reportedRemainingCount: 0,
      reportedUsedCount: 300,
      externalUsedOffset: 300,
    })

    const refreshed = await saveBrevoOfficialQuotaSnapshot(300, new Date(now.getTime() + 60_000))
    expect(refreshed).toMatchObject({
      reportedRemainingCount: 300,
      reportedUsedCount: 0,
      localUsedAtSync: 0,
      externalUsedOffset: 0,
    })

    await reserveBrevoEmail('email_verification', now)
    expect((await getBrevoEmailStats(now)).today).toMatchObject({
      local_quota_used_count: 1,
      quota_used_count: 1,
      remaining_count: 299,
      limit_reached: false,
    })
  })

  it('repairs a stale external offset persisted before reset handling', async () => {
    const now = new Date('2026-07-21T04:00:00.000Z')
    await saveBrevoOfficialQuotaSnapshot(0, now)
    await query(
      `update brevo_email_quota_snapshots
          set reported_remaining_count = 300,
              reported_used_count = 0
        where quota_date = $1::date`,
      ['2026-07-21'],
    )

    const refreshed = await saveBrevoOfficialQuotaSnapshot(300, new Date(now.getTime() + 60_000))
    expect(refreshed).toMatchObject({
      reportedRemainingCount: 300,
      reportedUsedCount: 0,
      externalUsedOffset: 0,
    })
  })
})
