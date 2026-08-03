import { createHash, randomUUID } from 'node:crypto'
import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BEHAVIOR_RISK_MODEL_VERSION } from '../behavior-risk/scoring'
import { closePool, getPool, query } from './postgres'
import { migrateDatabaseSchema } from './schema'
import {
  insertBehaviorRiskEvent,
  listBehaviorRiskCases,
  purgeExpiredBehaviorRiskData,
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
  it('returns searchable member identities and applies only selected member actions with audit', async () => {
    const first = await seedAccount('first')
    const second = await seedAccount('second')
    const third = await seedAccount('third')
    const now = new Date('2026-07-25T12:00:00.000Z')
    try {
      await Promise.all([
        insert('register:first', 'register', first, now, 29),
        insert('bind:first', 'bind', first, now, 25, { uidHmac: 'uid-hmac-first' }),
        insert('register:second', 'register', second, now, 28),
        insert('bind:second', 'bind', second, now, 24, { uidHmac: 'uid-hmac-second' }),
        insert('register:third', 'register', third, now, 27),
        insert('bind:third', 'bind', third, now, 23, { uidHmac: 'uid-hmac-third' }),
        insert('operator:first:1', 'operator_data_anomaly', first, now, 20, { structureSummary: operatorAnomaly('a') }),
        insert('operator:first:2', 'operator_data_anomaly', first, now, 10, { structureSummary: operatorAnomaly('b') }),
        insert('operator:first:3', 'operator_data_anomaly', first, now, 5, { structureSummary: operatorAnomaly('b') }),
      ])
      await runBehaviorRiskEvaluation(now)

      const pending = await listBehaviorRiskCases({ status: 'pending' })
      expect(pending.cases).toHaveLength(1)
      const riskCase = pending.cases[0] as {
        id: string
        model_version: string
        members: Array<{
          user_id: string
          account_email: string | null
          uid_prefixes: string[]
          profiles: Array<{ profile_id: string; profile_label: string }>
        }>
      }
      expect(riskCase.model_version).toBe(BEHAVIOR_RISK_MODEL_VERSION)
      expect(riskCase.members).toHaveLength(3)
      expect(riskCase.members.find((member) => member.user_id === first.userId)).toMatchObject({
        account_email: first.email,
        profiles: [{ profile_id: first.profileId, profile_label: 'first' }],
      })
      expect(riskCase.members.find((member) => member.user_id === second.userId)?.account_email).toBe(second.email)
      expect(riskCase.members.find((member) => member.user_id === third.userId)?.account_email).toBe(third.email)
      expect(JSON.stringify(riskCase)).not.toContain('raw-uid')

      await query('delete from user_accounts where id = $1', [third.userId])
      const afterDeletion = await listBehaviorRiskCases({ status: 'pending' })
      const deletedMember = (afterDeletion.cases[0] as typeof riskCase).members.find((member) => member.user_id === third.userId)
      expect(deletedMember).toMatchObject({ account_email: null, profiles: [] })

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
      const thirdStatus = await query<{ status: string }>('select status from user_accounts where id = $1', [third.userId])
      const sessions = await query<{ total: string }>('select count(*)::text as total from user_sessions where user_id = $1', [second.userId])
      const audits = await query<{ total: string }>('select count(*)::text as total from behavior_risk_review_audit where case_id = $1', [riskCase.id])
      expect(firstStatus.rows[0]?.status).toBe('frozen')
      expect(secondStatus.rows[0]?.status).toBe('frozen')
      expect(thirdStatus.rows).toHaveLength(0)
      expect(Number(sessions.rows[0]?.total)).toBe(0)
      expect(Number(audits.rows[0]?.total)).toBe(1)

      await runBehaviorRiskEvaluation(new Date(now.getTime() + 60_000))
      const reopened = await listBehaviorRiskCases({ status: 'pending' })
      expect(reopened.cases).toHaveLength(0)
    } finally {
      await query('delete from behavior_risk_cases')
      await query('delete from behavior_risk_events')
      await query('delete from user_accounts where id = any($1::text[])', [[first.userId, second.userId, third.userId]])
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

  it('archives legacy pending cases with audit before recalculating qualifying v1.2 risk', async () => {
    const first = await seedAccount('legacy-first')
    const second = await seedAccount('legacy-second')
    const third = await seedAccount('legacy-third')
    const stale = await seedAccount('legacy-stale')
    const now = new Date('2026-07-25T12:00:00.000Z')
    const legacyCaseId = randomUUID()
    const staleCaseId = randomUUID()
    try {
      await seedLegacyPendingCase(legacyCaseId, first.userId, now)
      await seedLegacyPendingCase(staleCaseId, stale.userId, now)
      await Promise.all([
        insert('legacy:bind:first', 'bind', first, now, 30, { uidHmac: 'legacy-uid-first' }),
        insert('legacy:bind:second', 'bind', second, now, 20, { uidHmac: 'legacy-uid-second' }),
        insert('legacy:bind:third', 'bind', third, now, 10, { uidHmac: 'legacy-uid-third' }),
        insert('legacy:operator:first:1', 'operator_data_anomaly', first, now, 9, { structureSummary: operatorAnomaly('a') }),
        insert('legacy:operator:first:2', 'operator_data_anomaly', first, now, 8, { structureSummary: operatorAnomaly('b') }),
        insert('legacy:operator:first:3', 'operator_data_anomaly', first, now, 7, { structureSummary: operatorAnomaly('b') }),
      ])

      await runBehaviorRiskEvaluation(now)

      const pending = await listBehaviorRiskCases({ status: 'pending' })
      const dismissed = await listBehaviorRiskCases({ status: 'dismissed' })
      expect(pending.cases).toHaveLength(1)
      expect(pending.cases[0]).toMatchObject({ model_version: BEHAVIOR_RISK_MODEL_VERSION, score: 75 })
      expect(JSON.stringify(pending.cases[0])).not.toContain(stale.userId)
      expect(dismissed.cases.find((riskCase) => riskCase.id === legacyCaseId)).toMatchObject({
        status: 'dismissed',
        model_version: 'behavior-risk-v1.1.0',
        reviewed_by: `system:${BEHAVIOR_RISK_MODEL_VERSION}`,
      })
      expect(dismissed.cases.find((riskCase) => riskCase.id === staleCaseId)).toMatchObject({
        status: 'dismissed',
        model_version: 'behavior-risk-v1.1.0',
        reviewed_by: `system:${BEHAVIOR_RISK_MODEL_VERSION}`,
      })

      const audit = await query<{
        admin_username: string
        outcome: string
        note: string
        actions_json: unknown[]
        case_snapshot_json: { model_version: string; members: Array<{ user_id: string }> }
      }>(
        `select admin_username, outcome, note, actions_json, case_snapshot_json
           from behavior_risk_review_audit where case_id = $1`,
        [legacyCaseId],
      )
      expect(audit.rows).toHaveLength(1)
      expect(audit.rows[0]).toMatchObject({
        admin_username: `system:${BEHAVIOR_RISK_MODEL_VERSION}`,
        outcome: 'dismiss',
        actions_json: [],
        case_snapshot_json: {
          model_version: 'behavior-risk-v1.1.0',
          members: [{ user_id: first.userId }],
        },
      })
      expect(audit.rows[0]?.note).toContain(BEHAVIOR_RISK_MODEL_VERSION)
    } finally {
      await query('delete from behavior_risk_cases')
      await query('delete from behavior_risk_events')
      await query('delete from user_accounts where id = any($1::text[])', [[first.userId, second.userId, third.userId, stale.userId]])
    }
  })

  it('rolls back legacy-case archival when the audit write fails', async () => {
    const account = await seedAccount('legacy-rollback')
    const now = new Date('2026-07-25T12:00:00.000Z')
    const legacyCaseId = randomUUID()
    try {
      await seedLegacyPendingCase(legacyCaseId, account.userId, now)
      await query(`create function fail_behavior_risk_recalibration_audit() returns trigger as $$
        begin
          if new.admin_username like 'system:behavior-risk-%' then
            raise exception 'forced recalibration audit failure';
          end if;
          return new;
        end;
      $$ language plpgsql`)
      await query(`create trigger fail_behavior_risk_recalibration_audit
        before insert on behavior_risk_review_audit
        for each row execute function fail_behavior_risk_recalibration_audit()`)

      await expect(runBehaviorRiskEvaluation(now)).rejects.toThrow('forced recalibration audit failure')

      const legacyCase = await query<{ status: string; reviewed_at: Date | null; reviewed_by: string | null }>(
        'select status, reviewed_at, reviewed_by from behavior_risk_cases where id = $1',
        [legacyCaseId],
      )
      const audits = await query<{ total: string }>(
        'select count(*)::text as total from behavior_risk_review_audit where case_id = $1',
        [legacyCaseId],
      )
      expect(legacyCase.rows[0]).toMatchObject({ status: 'pending', reviewed_at: null, reviewed_by: null })
      expect(Number(audits.rows[0]?.total)).toBe(0)
    } finally {
      await query('drop trigger if exists fail_behavior_risk_recalibration_audit on behavior_risk_review_audit')
      await query('drop function if exists fail_behavior_risk_recalibration_audit()')
      await query('delete from behavior_risk_cases')
      await query('delete from behavior_risk_events where user_id = $1', [account.userId])
      await query('delete from user_accounts where id = $1', [account.userId])
    }
  })

  it('creates an operator anomaly review case without automatically freezing the account or profile', async () => {
    const account = await seedAccount('operator-anomaly')
    const now = new Date('2026-07-25T12:00:00.000Z')
    try {
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
      expect(riskCase.score).toBe(55)
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

  it('does not mutate reviewed member evidence when evaluation races with the audit transaction', async () => {
    const account = await seedAccount('review-race')
    const now = new Date('2026-07-25T12:00:00.000Z')
    const auditLockHolder = await getPool().connect()
    try {
      await Promise.all([
        insert('review-race:1', 'operator_data_anomaly', account, now, 20, { structureSummary: operatorAnomaly('a') }),
        insert('review-race:2', 'operator_data_anomaly', account, now, 10, { structureSummary: operatorAnomaly('b') }),
        insert('review-race:3', 'operator_data_anomaly', account, now, 5, { structureSummary: operatorAnomaly('b') }),
      ])
      await runBehaviorRiskEvaluation(now)
      const pending = await listBehaviorRiskCases({ status: 'pending' })
      const caseId = pending.cases[0]?.id
      expect(caseId).toBeTruthy()
      await insert('review-race:4', 'operator_data_anomaly', account, now, 1, { structureSummary: operatorAnomaly('c') })

      await auditLockHolder.query('begin')
      await auditLockHolder.query('select pg_advisory_xact_lock($1)', [1_743_861_293])
      const review = reviewBehaviorRiskCase({
        caseId: caseId!,
        outcome: 'dismiss',
        note: '并发复核栅栏测试。',
        actions: [],
        adminUsername: 'race-reviewer',
        now,
      })
      await waitForBlockedAdvisoryLock()
      const evaluation = runBehaviorRiskEvaluation(new Date(now.getTime() + 60_000))
      await new Promise((resolve) => setTimeout(resolve, 100))
      await auditLockHolder.query('commit')
      await Promise.all([review, evaluation])

      const member = await query<{ evidence_json: { counts?: Record<string, number> } }>(
        'select evidence_json from behavior_risk_case_members where case_id = $1 and user_id = $2',
        [caseId, account.userId],
      )
      const audit = await query<{ case_snapshot_json: { members: Array<{ evidence_json: { counts?: Record<string, number> } }> } }>(
        `select case_snapshot_json from behavior_risk_review_audit
          where case_id = $1 and admin_username = 'race-reviewer'`,
        [caseId],
      )
      expect(member.rows[0]?.evidence_json.counts?.operator_data_anomaly).toBe(3)
      expect(audit.rows[0]?.case_snapshot_json.members[0]?.evidence_json.counts?.operator_data_anomaly).toBe(3)
    } finally {
      await auditLockHolder.query('rollback').catch(() => undefined)
      auditLockHolder.release()
      await query('delete from behavior_risk_cases')
      await query('delete from behavior_risk_events where user_id = $1', [account.userId])
      await query('delete from user_accounts where id = $1', [account.userId])
    }
  })

  it('retains chained review audit after its hot case expires', async () => {
    const account = await seedAccount('audit-retention')
    const now = new Date('2026-07-25T12:00:00.000Z')
    const caseId = randomUUID()
    try {
      await seedLegacyPendingCase(caseId, account.userId, now)
      await reviewBehaviorRiskCase({
        caseId,
        outcome: 'dismiss',
        note: '长期保留复核记录。',
        actions: [],
        adminUsername: 'retention-reviewer',
        now,
      })
      await query('update behavior_risk_cases set expires_at = $2 where id = $1', [caseId, now.toISOString()])
      await purgeExpiredBehaviorRiskData(new Date(now.getTime() + 1_000))

      const audit = await query<{ case_id: string | null; entry_hash: string; expires_at: Date }>(
        `select case_id, entry_hash, expires_at from behavior_risk_review_audit
          where admin_username = 'retention-reviewer' order by created_at desc limit 1`,
      )
      expect(audit.rows[0]?.case_id).toBeNull()
      expect(audit.rows[0]?.entry_hash).toMatch(/^[a-f0-9]{64}$/)
      expect(audit.rows[0]!.expires_at.getTime()).toBeGreaterThan(now.getTime() + 6 * 365 * 86_400_000)
    } finally {
      await query("delete from behavior_risk_review_audit where admin_username = 'retention-reviewer'")
      await query('delete from behavior_risk_cases where id = $1', [caseId])
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
    keyVersion: 'test-v1',
    occurredAt: new Date(now.getTime() - minutesAgo * 60_000),
    ...patch,
    browserHmac: normalizeDigest(patch.browserHmac ?? digest('browser-hmac-shared')),
    sessionHmac: normalizeDigest(patch.sessionHmac),
    networkHmac: normalizeDigest(patch.networkHmac ?? digest('network-hmac-shared')),
    uaHmac: normalizeDigest(patch.uaHmac ?? digest('ua-hmac-shared')),
    uidHmac: normalizeDigest(patch.uidHmac),
    outputHash: normalizeDigest(patch.outputHash),
  })
}

function normalizeDigest(value: string | null | undefined): string | null | undefined {
  if (value === null || value === undefined) return value
  return /^[a-f0-9]{64}$/.test(value) ? value : digest(value)
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function operatorAnomaly(fingerprint: string): Record<string, unknown> {
  return {
    anomaly_type: 'operator_count_regression',
    operator_fingerprint_hash: fingerprint.repeat(64),
    owned_count: 100,
  }
}

async function waitForBlockedAdvisoryLock(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const waiting = await query<{ total: string }>(
      `select count(*)::text as total from pg_locks
        where locktype = 'advisory' and granted = false`,
    )
    if (Number(waiting.rows[0]?.total) > 0) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for review audit advisory lock.')
}

type SeededAccount = { userId: string; profileId: string; email: string }

async function seedLegacyPendingCase(caseId: string, userId: string, now: Date): Promise<void> {
  const expiresAt = new Date(now.getTime() + 30 * 86_400_000).toISOString()
  const rules = [{
    code: 'export_velocity',
    category: 'export',
    score: 20,
    explanation: '旧模型导出速度证据。',
    evidence: { distinct_output_count: 2 },
  }]
  await query(
    `insert into behavior_risk_cases
      (id, group_key, evidence_key, status, score, categories_json, rules_json, model_version,
       first_seen_at, last_seen_at, expires_at, created_at, updated_at)
     values ($1, $2, $3, 'pending', 20, $4::jsonb, $5::jsonb, 'behavior-risk-v1.1.0', $6, $6, $7, $6, $6)`,
    [caseId, `legacy-group:${caseId}`, `legacy-evidence:${caseId}`, JSON.stringify(['export']), JSON.stringify(rules), now.toISOString(), expiresAt],
  )
  await query(
    `insert into behavior_risk_case_members (case_id, user_id, evidence_json, created_at, updated_at)
     values ($1, $2, $3::jsonb, $4, $4)`,
    [caseId, userId, JSON.stringify({ account_label: `${userId.slice(0, 8)}…`, output_prefixes: ['legacy-output'] }), now.toISOString()],
  )
}

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
