import { randomUUID } from 'node:crypto'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closePool, query } from './postgres'
import { migrateDatabaseSchema } from './schema'
import {
  insertBehaviorRiskEvent,
  listBehaviorRiskCases,
  reviewBehaviorRiskCase,
  runBehaviorRiskEvaluation,
} from './behavior-risk-store'

let container: PostgreSqlContainer

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  process.env.DATABASE_URL = container.getConnectionUri()
  await migrateDatabaseSchema()
})

afterAll(async () => {
  await closePool()
  if (container) await container.stop()
})

describe('behavior risk PostgreSQL store', () => {
  it('creates a masked review case and applies only selected member actions with audit', async () => {
    const first = await seedAccount('first')
    const second = await seedAccount('second')
    const now = new Date('2026-07-25T12:00:00.000Z')
    try {
      await Promise.all([
        insert('register:first', 'register', first, now, 29),
        insert('bind:first', 'bind', first, now, 25, { uidHmac: 'uid-hmac-first' }),
        insert('register:second', 'register', second, now, 28),
        insert('bind:second', 'bind', second, now, 24, { uidHmac: 'uid-hmac-second' }),
      ])
      await runBehaviorRiskEvaluation(now)

      const pending = await listBehaviorRiskCases({ status: 'pending' })
      expect(pending.cases).toHaveLength(1)
      const riskCase = pending.cases[0] as {
        id: string
        members: Array<{ user_id: string; account_label: string; uid_prefixes: string[] }>
      }
      expect(riskCase.members).toHaveLength(2)
      expect(JSON.stringify(riskCase)).not.toContain(first.email)
      expect(JSON.stringify(riskCase)).not.toContain('raw-uid')
      expect(riskCase.members.every((member) => member.account_label.endsWith('…'))).toBe(true)

      await expect(reviewBehaviorRiskCase({
        caseId: riskCase.id,
        outcome: 'restrict',
        note: '不应允许同一成员同时执行两种限制操作。',
        adminUsername: 'reviewer',
        now,
        actions: [
          { userId: first.userId, action: 'freeze_account' },
          { userId: first.userId, action: 'freeze_profile', profileId: first.profileId },
        ],
      })).rejects.toThrow('每个复核单成员只能选择一种处置操作。')

      const unchangedAccount = await query<{ status: string }>('select status from user_accounts where id = $1', [first.userId])
      const unchangedProfile = await query<{ status: string }>('select status from user_game_accounts where id = $1', [first.profileId])
      const auditBeforeReview = await query<{ total: string }>('select count(*)::text as total from behavior_risk_review_audit where case_id = $1', [riskCase.id])
      expect(unchangedAccount.rows[0]?.status).toBe('active')
      expect(unchangedProfile.rows[0]?.status).toBe('active')
      expect(Number(auditBeforeReview.rows[0]?.total)).toBe(0)

      await reviewBehaviorRiskCase({
        caseId: riskCase.id,
        outcome: 'restrict',
        note: '人工核验后确认两个成员需要分别限制。',
        adminUsername: 'reviewer',
        now,
        actions: [
          { userId: first.userId, action: 'freeze_profile', profileId: first.profileId },
          { userId: second.userId, action: 'freeze_account' },
        ],
      })

      const firstStatus = await query<{ status: string }>('select status from user_game_accounts where id = $1', [first.profileId])
      const secondStatus = await query<{ status: string }>('select status from user_accounts where id = $1', [second.userId])
      const sessions = await query<{ total: string }>('select count(*)::text as total from user_sessions where user_id = $1', [second.userId])
      const audits = await query<{ total: string }>('select count(*)::text as total from behavior_risk_review_audit where case_id = $1', [riskCase.id])
      expect(firstStatus.rows[0]?.status).toBe('frozen')
      expect(secondStatus.rows[0]?.status).toBe('frozen')
      expect(Number(sessions.rows[0]?.total)).toBe(0)
      expect(Number(audits.rows[0]?.total)).toBe(1)

      await runBehaviorRiskEvaluation(new Date(now.getTime() + 60_000))
      const reopened = await listBehaviorRiskCases({ status: 'pending' })
      expect(reopened.cases).toHaveLength(0)
    } finally {
      await query('delete from behavior_risk_cases')
      await query('delete from behavior_risk_events')
      await query('delete from user_accounts where id = any($1::text[])', [[first.userId, second.userId]])
    }
  })

  it('deduplicates server-authoritative events by event key', async () => {
    const account = await seedAccount('dedupe')
    try {
      const first = await insert('same-event', 'login', account, new Date(), 0)
      const second = await insert('same-event', 'login', account, new Date(), 0)
      expect(first).toBe(true)
      expect(second).toBe(false)
    } finally {
      await query('delete from behavior_risk_events where user_id = $1', [account.userId])
      await query('delete from user_accounts where id = $1', [account.userId])
    }
  })

  it('creates an operator anomaly review case without automatically freezing the account or profile', async () => {
    const account = await seedAccount('operator-anomaly')
    const now = new Date('2026-07-25T12:00:00.000Z')
    try {
      await query('alter table behavior_risk_events drop constraint behavior_risk_events_event_type_check')
      await query(`alter table behavior_risk_events
        add constraint behavior_risk_events_event_type_check
        check (event_type in ('register', 'activation', 'login', 'bind', 'job_submit', 'generate', 'export', 'workspace_save', 'page_view', 'account_deleted'))`)
      await migrateDatabaseSchema()

      await Promise.all([
        insert('operator-anomaly:1', 'operator_data_anomaly', account, now, 20, {
          structureSummary: {
            anomaly_type: 'operator_ownership_regression',
            operator_fingerprint_hash: 'a'.repeat(64),
            owned_count: 120,
          },
        }),
        insert('operator-anomaly:2', 'operator_data_anomaly', account, now, 10, {
          structureSummary: {
            anomaly_type: 'operator_count_regression',
            operator_fingerprint_hash: 'b'.repeat(64),
            owned_count: 112,
          },
        }),
        insert('operator-anomaly:3', 'operator_data_anomaly', account, now, 5, {
          structureSummary: {
            anomaly_type: 'operator_count_regression',
            operator_fingerprint_hash: 'b'.repeat(64),
            owned_count: 112,
          },
        }),
      ])
      await runBehaviorRiskEvaluation(now)

      const pending = await listBehaviorRiskCases({ status: 'pending' })
      expect(pending.cases).toHaveLength(1)
      const riskCase = pending.cases[0] as {
        score: number
        members: Array<{ operator_fingerprint_prefixes: string[] }>
      }
      expect(riskCase.score).toBe(70)
      expect(riskCase.members[0]?.operator_fingerprint_prefixes).toEqual(['aaaaaaaaaaaa', 'bbbbbbbbbbbb'])

      const userStatus = await query<{ status: string }>('select status from user_accounts where id = $1', [account.userId])
      const profileStatus = await query<{ status: string }>('select status from user_game_accounts where id = $1', [account.profileId])
      expect(userStatus.rows[0]?.status).toBe('active')
      expect(profileStatus.rows[0]?.status).toBe('active')
    } finally {
      await query('delete from behavior_risk_cases')
      await query('delete from behavior_risk_events where user_id = $1', [account.userId])
      await query('delete from user_accounts where id = $1', [account.userId])
    }
  })
})

function insert(
  eventKey: string,
  eventType: Parameters<typeof insertBehaviorRiskEvent>[0]['eventType'],
  account: SeededAccount,
  now: Date,
  minutesAgo: number,
  patch: Partial<Parameters<typeof insertBehaviorRiskEvent>[0]> = {},
): Promise<boolean> {
  return insertBehaviorRiskEvent({
    eventKey,
    eventType,
    userId: account.userId,
    profileId: account.profileId,
    browserHmac: 'browser-hmac-shared',
    networkHmac: 'network-hmac-shared',
    uaHmac: 'ua-hmac-shared',
    keyVersion: 'test-v1',
    occurredAt: new Date(now.getTime() - minutesAgo * 60_000),
    ...patch,
  })
}

type SeededAccount = { userId: string; profileId: string; email: string }

async function seedAccount(label: string): Promise<SeededAccount> {
  const userId = randomUUID()
  const profileId = randomUUID()
  const sessionId = randomUUID()
  const email = `${label}-${userId}@example.test`
  const now = new Date().toISOString()
  await query(
    `insert into user_accounts
      (id, email, password_hash, salt, iterations, permission, status, record_json, created_at, updated_at)
     values ($1, $2, 'hash', 'salt', 1, 'growth', 'active', $3::jsonb, $4, $4)`,
    [userId, email, JSON.stringify({ version: 1, id: userId, email, status: 'active' }), now],
  )
  await query(
    `insert into user_game_accounts
      (id, user_id, permission, status, display_name, note, record_json, created_at, updated_at)
     values ($1, $2, 'growth', 'active', $3, '', $4::jsonb, $5, $5)`,
    [profileId, userId, label, JSON.stringify({ version: 1, id: profileId, user_id: userId, status: 'active' }), now],
  )
  await query(
    `insert into user_sessions (id, user_id, token_hash, record_json, created_at, last_seen_at, expires_at)
     values ($1, $2, $3, $4::jsonb, $5, $5, $6)`,
    [sessionId, userId, `token-${sessionId}`, JSON.stringify({ id: sessionId, user_id: userId }), now, new Date(Date.now() + 86_400_000).toISOString()],
  )
  return { userId, profileId, email }
}
