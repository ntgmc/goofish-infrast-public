import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { closePool, query } from './postgres'
import { ensureDatabaseSchema } from './schema'
import {
  BrevoDailyQuotaExceededError,
  getBrevoEmailStats,
  markBrevoEmailFailed,
  markBrevoEmailSent,
  markBrevoEmailUncertain,
  reserveBrevoEmail,
} from './brevo-email-store'

let container: PostgreSqlContainer

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  process.env.DATABASE_URL = container.getConnectionUri()
  await ensureDatabaseSchema()
})

beforeEach(async () => {
  await query('delete from brevo_email_deliveries')
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

  it('releases definite failures and retains uncertain deliveries', async () => {
    const now = new Date('2026-07-21T04:00:00.000Z')
    const failed = await reserveBrevoEmail('password_reset', now)
    const uncertain = await reserveBrevoEmail('account_deletion_receipt', now)
    await markBrevoEmailFailed(failed)
    await markBrevoEmailUncertain(uncertain)
    await reserveBrevoEmail('email_verification', now)

    const stats = await getBrevoEmailStats(now)
    expect(stats.today).toMatchObject({
      sent_count: 0,
      reserved_count: 1,
      uncertain_count: 1,
      failed_count: 1,
      quota_used_count: 2,
      remaining_count: 298,
    })
  })

  it('returns seven zero-filled days with sent-purpose breakdowns', async () => {
    const now = new Date('2026-07-21T04:00:00.000Z')
    const verification = await reserveBrevoEmail('email_verification', now)
    const reset = await reserveBrevoEmail('password_reset', new Date('2026-07-20T04:00:00.000Z'))
    await markBrevoEmailSent(verification)
    await markBrevoEmailSent(reset)

    const stats = await getBrevoEmailStats(now)
    expect(stats.days).toHaveLength(7)
    expect(stats.days.map((day) => day.date)).toEqual([
      '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18', '2026-07-19', '2026-07-20', '2026-07-21',
    ])
    expect(stats.days[5]).toMatchObject({ sent_count: 1, by_purpose: { password_reset: 1 } })
    expect(stats.today).toMatchObject({ sent_count: 1, by_purpose: { email_verification: 1 } })
    expect(stats.days[0]?.quota_used_count).toBe(0)
  })
})
