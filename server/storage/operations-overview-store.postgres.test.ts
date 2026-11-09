import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closePool, query } from './postgres'
import { migrateDatabaseSchema } from './schema'
import { getOperationsOverview } from './operations-overview-store'
import { createPostgresUsageEventStore } from './usage-store'
import { listAdminUserAccountsPage } from './user-store'
import type { OperationsCohort } from '../../src/lib/operations-drilldown'

let container: PostgreSqlContainer
const now = new Date('2030-02-01T08:00:00Z')

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  process.env.DATABASE_URL = container.getConnectionUri()
  await migrateDatabaseSchema()
  for (const [id, created, verified] of [
    ['a', '2030-01-20T00:00:00Z', true], ['b', '2030-01-21T00:00:00Z', true],
    ['c', '2030-01-29T00:00:00Z', true], ['pending', '2030-01-28T00:00:00Z', false],
    ['old', '2030-01-01T00:00:00Z', true],
  ] as const) {
    await query(`insert into user_accounts (id, email, password_hash, salt, iterations, permission, status, record_json, created_at, updated_at, email_verified_at)
      values ($1, $1 || '@example.test', 'fixture', 'fixture', 1, 'recommended', 'active', jsonb_build_object('id', $1::text), $2, $2, $3)`, [id, created, verified ? created : null])
    await query(`insert into user_game_accounts (id, user_id, permission, status, kind, display_name, note, record_json, created_at, updated_at)
      values ($1 || '-profile', $1, 'recommended', 'active', 'free_preview', 'fixture', '', '{}', $2, $2)`, [id, created])
  }
  await query(`insert into user_game_accounts (id, user_id, permission, status, kind, display_name, note, record_json, created_at, updated_at)
    values ('a-second', 'a', 'recommended', 'active', 'free_preview', 'fixture', '', '{}', '2030-01-20T00:00:00Z', '2030-01-20T00:00:00Z')`)
  await event('tracking', 'business_metrics_started', '2030-01-18T00:00:00Z')
  await event('a1', 'schedule_generate', '2030-01-20T01:00:00Z', 'a-profile', { duration_ms: 700_000, compute_duration_ms: 1_000 })
  await event('a2', 'schedule_generate', '2030-01-20T02:00:00Z', 'a-second', { duration_ms: 2_000 })
  await event('a-return', 'schedule_generate', '2030-01-27T00:00:00Z', 'a-profile', { duration_ms: 3_000 })
  await event('b-late', 'schedule_generate', '2030-01-31T01:00:00Z', 'b-profile', { duration_ms: 4_000, schedule_mode: 'rotation' })
  await event('c1', 'schedule_generate', '2030-01-30T01:00:00Z', 'c-profile', { duration_ms: 'bad' })
  await event('old1', 'schedule_generate', '2030-01-21T16:05:00Z', 'old-profile', { duration_ms: 1_000 })
  await event('old-previous', 'schedule_generate', '2030-01-10T00:00:00Z', 'old-profile', { duration_ms: 1_000 })
  await event('future', 'schedule_generate', '2030-02-02T00:00:00Z', 'c-profile', { duration_ms: 1_000 })
  await event('failure', 'schedule_generate', '2030-01-25T00:00:00Z', 'a-profile', { status: 'failure', reason_code: 'optimizer_runtime_error', duration_ms: 99_000_000 })
  await event('export-a', 'maa_export', '2030-01-20T03:00:00Z', 'a-profile', { generation_id: 'a1' })
  await event('export-a-again', 'maa_export', '2030-01-20T04:00:00Z', 'a-profile', { generation_id: 'a1' })
  await event('export-old', 'maa_export', '2030-01-22T00:00:00Z', 'old-profile', { generation_id: 'old1' })
  await event('import-ok', 'skland_import', '2030-01-21T00:00:00Z', 'a-profile')
  await event('import-fail', 'skland_import', '2030-01-22T00:00:00Z', 'a-profile', { status: 'failure' })
  await query(`insert into service_status_cost_config (component_id, resident_hourly_price_cny, hourly_price_cny, updated_at)
    values ('optimization', 0.1, 0.2, $1)`, [now.toISOString()])
  await query(`insert into service_status_hourly (component_id, bucket_start, status, sample_count, available_samples, worker_instances_sum, last_sample_at, updated_at)
    select 'optimization', hour, 'available', 2, 2, 2, hour, hour
    from generate_series('2030-01-19T16:00:00Z'::timestamptz, '2030-01-31T15:00:00Z'::timestamptz, interval '1 hour') hour`)
})

afterAll(async () => { await closePool(); await container?.stop() })

describe('business operations aggregates', () => {
  it('aggregates page visitors and tool quality across users, outcomes and Shanghai boundaries', async () => {
    const store = createPostgresUsageEventStore()
    await store.set('tools-start', { id: 'tools-start', event: 'tool_metrics_started', visitor_id: null, created_at: '2030-01-19T00:00:00Z', date: '2030-01-19' })
    for (const [id, user, at, outcome, duration] of [
      ['one', 'a', '2030-01-20T00:00:00Z', 'success', 1_000],
      ['two', 'a', '2030-01-21T00:00:00Z', 'success', 3_000],
      ['fail', 'b', '2030-01-21T00:00:00Z', 'failure', 900_000],
      ['cancel', 'b', '2030-01-21T00:00:00Z', 'cancelled', 900_000],
      ['bad-duration', 'b', '2030-01-21T00:00:00Z', 'success', Number.NaN],
      ['previous', 'a', '2030-01-10T00:00:00Z', 'success', 5_000],
      ['after-range', 'c', '2030-01-31T16:00:00Z', 'success', 1_000],
    ] as const) await store.set(`tool-${id}`, { id, event: 'tool_run', tool: 'cultivation_projects', visitor_id: null, user_id: user,
      tool_outcome: outcome, duration_ms: duration, created_at: at, date: at.slice(0, 10) })
    await store.set('anonymous-tool', { id: 'anonymous', event: 'tool_run', tool: 'depot_value', visitor_id: 'browser-a', tool_outcome: 'success',
      duration_ms: 200, created_at: '2030-01-21T00:00:00Z', date: '2030-01-21' })
    for (const [id, visitor, at] of [['visit-a', 'browser-a', '2030-01-19T16:00:00Z'], ['visit-a2', 'browser-a', '2030-01-20T00:00:00Z'],
      ['visit-b', 'browser-b', '2030-01-20T00:00:00Z'], ['visit-before', 'browser-c', '2030-01-19T15:59:59Z']] as const) {
      await store.set(id, { id, event: 'page_view', visitor_id: visitor, page: 'cultivation', created_at: at, date: at.slice(0, 10) })
    }
    const data = await getOperationsOverview('2030-01-20', '2030-01-31', now)
    expect(data.tools?.pages).toEqual([{ page: 'cultivation', visitors: 2, views: 3 }])
    expect(data.tools?.current.find((row) => row.tool === 'cultivation_projects')).toEqual({ tool: 'cultivation_projects', users: 2,
      anonymous_visitors: 0, attempts: 5, successful: 3, failed: 1, cancelled: 1, success_rate: 75, latency_samples: 2, p50_ms: 2_000, p95_ms: 2_900 })
    expect(data.tools?.previous.find((row) => row.tool === 'cultivation_projects')).toMatchObject({ users: 1, attempts: 1, p95_ms: 5_000 })
    expect(data.tools?.current.find((row) => row.tool === 'depot_value')).toMatchObject({ users: 0, anonymous_visitors: 1 })
    expect(data.tools?.tracking_started_at).toBe('2030-01-19T00:00:00+00:00')
    expect(JSON.stringify(data.tools)).not.toContain('browser-a')
    expect(JSON.stringify(data.tools)).not.toContain('user_id')
  })

  it('preserves the original tracking start across refreshes and event retention', async () => {
    const store = createPostgresUsageEventStore()
    const base = { id: 'start', event: 'business_metrics_started' as const, visitor_id: null, date: '2030-01-19', created_at: '2030-01-19T00:00:00Z' }
    await store.set('tracking-retention-test', base)
    await store.set('tracking-retention-test', { ...base, created_at: '2030-01-20T00:00:00Z' })
    const result = await query<{ created_at: Date; expires_at: string }>(`select created_at, expires_at::text from usage_events where key = 'tracking-retention-test'`)
    expect(result.rows[0]?.created_at.toISOString()).toBe(base.created_at.replace('Z', '.000Z'))
    expect(result.rows[0]?.expires_at).toBe('infinity')
  })

  it('counts people across profiles, measures full waits and uses mature, shared cohorts', async () => {
    const data = await getOperationsOverview('2030-01-20', '2030-01-31', now)
    expect(data.current).toMatchObject({
      successful_users: 4, registered_users: 4, successful_generations: 6, failed_requests: 1, success_rate: 85.7,
      latency_samples: 5,
      activation: { eligible: 2, activated: 1, pending: 2, with_profile: 2, rate: 50 },
      reuse: { eligible: 2, reused: 1, pending: 2, rate: 50 },
      maa: { eligible: 5, exported: 2, rate: 40, complete: true },
      cost: { estimated_cny: 86.4, per_success_cny: 14.4, recorded_hours: 288, expected_hours: 288, successful_generations: 6 },
    })
    expect(data.current.p95_wait_ms).toBeGreaterThan(500_000)
    expect(data.previous).toMatchObject({ from: '2030-01-08', to: '2030-01-19', successful_users: 1, registered_users: 0, activation: { rate: null } })
    expect(data.days.find((day) => day.date === '2030-01-22')).toMatchObject({ successful_users: 1, successful_generations: 1 })
    expect(data.days.find((day) => day.date === '2030-01-21')).toMatchObject({ successful_users: 0 })
    expect(data.skland).toEqual({ successful: 1, failed: 1, success_rate: 50 })
    expect(data.failure_reasons).toEqual([{ reason_code: 'optimizer_runtime_error', count: 1 }])
    expect(data.coverage.complete).toBe(true)
    expect(data.current.deleted_users).toBe(0)
    expect(data.deletions).toEqual({ total_deleted: 0, pending: 0, failed: 0, reasons: [], recent_feedback: [] })
    expect(JSON.stringify(data)).not.toContain('@example.test')
    expect(JSON.stringify(data)).not.toContain('a-profile')
  })

  it('opens the same cohorts as the report with pagination, progress and failure attribution', async () => {
    const report = await getOperationsOverview('2030-01-20', '2030-01-31', now)
    const cohorts: Array<[OperationsCohort, string[]]> = [
      ['registered', ['a', 'b', 'c', 'pending']], ['successful', ['a', 'b', 'c', 'old']],
      ['activation_missing_profile', []], ['activation_no_generation', ['b']], ['activated', ['a']],
      ['reuse_missing', ['old']], ['reused', ['a']], ['maa_missing', ['a', 'c']], ['maa_exported', ['a', 'old']], ['failed', ['a']],
    ]
    for (const [cohort, ids] of cohorts) {
      const page = await listAdminUserAccountsPage({ page: 1, pageSize: 100, search: '', operations: {
        cohort, from: report.current.from, to: report.current.to, observed_at: report.generated_at,
      } })
      expect(page.users.map((user) => user.id).sort(), cohort).toEqual(ids)
      expect(page.total, cohort).toBe(ids.length)
      if (cohort === 'activated') expect(page.users[0]?.operations_progress).toMatchObject({ stage: 'activated', failure_reason: 'optimizer_runtime_error' })
      if (cohort === 'activation_no_generation') expect(page.users[0]?.operations_progress).toMatchObject({ stage: 'no_generation', failure_reason: null })
    }
    const second = await listAdminUserAccountsPage({ page: 2, pageSize: 1, search: '', operations: {
      cohort: 'registered', from: report.current.from, to: report.current.to, observed_at: report.generated_at,
    } })
    expect(second).toMatchObject({ total: report.current.registered_users, page: 2, totalPages: 4 })
    expect(second.users).toHaveLength(1)
    const noFailure = await listAdminUserAccountsPage({ page: 1, pageSize: 25, search: '', operations: {
      cohort: 'failed', from: report.current.from, to: report.current.to, observed_at: report.generated_at, reason: 'validation_failed',
    } })
    expect(noFailure.total).toBe(0)
  })

  it('keeps Shanghai ranges and fixed observation durations independent of the database session timezone', async () => {
    const expected = await getOperationsOverview('2030-01-20', '2030-01-31', now)
    try {
      await query(`set time zone 'Asia/Kathmandu'`)
      const data = await getOperationsOverview('2030-01-20', '2030-01-31', now)
      expect(data.current.cost.recorded_hours).toBe(expected.current.cost.recorded_hours)
      expect(data.current.cost.expected_hours).toBe(expected.current.cost.expected_hours)
      expect(data.current.cost.per_success_cny).toBe(expected.current.cost.per_success_cny)
      expect(data.current.activation).toEqual(expected.current.activation)
      expect(data.current.reuse).toEqual(expected.current.reuse)
      expect(data.days).toEqual(expected.days)
      expect(new Date(data.previous.observed_until).toISOString()).toBe(new Date(expected.previous.observed_until).toISOString())
    } finally { await query(`set time zone 'UTC'`) }
  })

  it('waits for exactly seven days of activation and seven complete later calendar days of reuse', async () => {
    const data = await getOperationsOverview('2030-01-20', '2030-01-21', new Date('2030-01-27T00:00:00Z'))
    expect(data.current.activation).toMatchObject({ eligible: 1, pending: 1, activated: 1 })
    expect(data.current.reuse).toMatchObject({ eligible: 0, pending: 1, rate: null })
    const mature = await getOperationsOverview('2030-01-20', '2030-01-21', new Date('2030-01-27T16:00:00Z'))
    expect(mature.current.reuse).toMatchObject({ eligible: 1, pending: 0, reused: 1, rate: 100 })
    const before = await listAdminUserAccountsPage({ page: 1, pageSize: 25, search: '', operations: {
      cohort: 'reused', from: data.current.from, to: data.current.to, observed_at: data.generated_at,
    } })
    const after = await listAdminUserAccountsPage({ page: 1, pageSize: 25, search: '', operations: {
      cohort: 'reused', from: mature.current.from, to: mature.current.to, observed_at: mature.generated_at,
    } })
    expect(before.total).toBe(data.current.reuse.reused)
    expect(after.total).toBe(mature.current.reuse.reused)
  })

  it('preserves completed activation when the account verification timestamp later changes', async () => {
    await query(`update user_accounts set email_verified_at = $1 where id = 'a'`, [now.toISOString()])
    const data = await getOperationsOverview('2030-01-20', '2030-01-31', now)
    expect(data.current.activation).toMatchObject({ eligible: 2, activated: 1, with_profile: 2, rate: 50 })
  })

  it('calculates export rates from tracked plans and waits for mature observations, with equal elapsed comparisons', async () => {
    const data = await getOperationsOverview('2030-01-17', '2030-02-01', now)
    expect(data.current.maa).toMatchObject({ eligible: 5, exported: 2, complete: false, rate: 40 })
    expect(data.previous.observed_until).toBe('2030-01-16T08:00:00+00:00')
    const untracked = await getOperationsOverview('2030-01-08', '2030-01-17', now)
    expect(untracked.current.maa).toMatchObject({ eligible: 0, exported: 0, complete: false, rate: null })
    const recent = await getOperationsOverview('2030-01-29', '2030-01-31', now)
    expect(recent.current.activation).toMatchObject({ eligible: 0, pending: 1, rate: null })
    expect(recent.current.reuse).toMatchObject({ eligible: 0, pending: 2, rate: null })
  })

  it('counts completed deletions by Shanghai dates and current requests separately, retaining no expired survey answers', async () => {
    try {
      for (const [id, at, reason, detail] of [
        ['previous', '2030-01-19T15:59:59Z', 'privacy', '上期反馈'],
        ['start', '2030-01-19T16:00:00Z', 'privacy', '本期隐私反馈'],
        ['middle', '2030-01-25T12:00:00Z', 'results_unsatisfactory', '本期排班反馈'],
        ['legacy', '2030-01-31T15:59:59Z', null, ''],
        ['end', '2030-01-31T16:00:00Z', 'other', '范围外反馈'],
        ['future', '2030-02-02T00:00:00Z', 'other', '未来反馈'],
        ['expired', '2028-01-01T00:00:00Z', 'privacy', '已经到期的反馈'],
      ] as const) {
        await query('insert into account_deletion_records (email_hash, deleted_at, reason, reason_detail) values ($1, $2, $3, $4)',
          [`deletion-test-${id}`, at, reason, detail])
      }
      for (const [id, status, at, reason] of [
        ['pending', 'pending', '2030-01-01T00:00:00Z', 'privacy'],
        ['processing', 'processing', '2030-01-30T00:00:00Z', 'results_unsatisfactory'],
        ['failed', 'failed', '2030-01-31T00:00:00Z', 'other'],
        ['future-request', 'pending', '2030-02-02T00:00:00Z', 'other'],
      ] as const) {
        const userId = `deletion-test-${id}`
        await query(`insert into user_accounts (id, email, password_hash, salt, iterations, permission, status, record_json, created_at, updated_at)
          values ($1, $1 || '@example.test', 'fixture', 'fixture', 1, 'growth', 'pending_deletion', '{}', '2020-01-01', '2020-01-01')`, [userId])
        await query(`insert into account_deletion_requests (id, user_id, cancel_token_hash, scheduled_for, status, created_at, reason, reason_detail)
          values ($1, $1, $1, $2::timestamptz + interval '7 days', $3, $2, $4, $5)`,
        [userId, at, status, reason, `${id}申请反馈`])
      }
      const data = await getOperationsOverview('2030-01-20', '2030-01-31', now)
      expect(data.current.deleted_users).toBe(3)
      expect(data.previous.deleted_users).toBe(1)
      expect(data.deletions).toMatchObject({ total_deleted: 6, pending: 3, failed: 1 })
      expect(data.deletions.reasons).toEqual(expect.arrayContaining([
        { reason: 'privacy', deleted: 1, pending: 1 },
        { reason: 'results_unsatisfactory', deleted: 1, pending: 1 },
        { reason: 'unrecorded', deleted: 1, pending: 0 },
        { reason: 'other', deleted: 0, pending: 1 },
      ]))
      expect(data.deletions.reasons.reduce((sum, item) => sum + item.deleted, 0)).toBe(data.current.deleted_users)
      expect(data.deletions.reasons.reduce((sum, item) => sum + item.pending, 0)).toBe(data.deletions.pending)
      expect(data.deletions.recent_feedback).toHaveLength(5)
      expect(JSON.stringify(data.deletions)).not.toMatch(/email_hash|deletion-test-|范围外反馈|未来反馈|上期反馈|已经到期的反馈/)
      const expired = await getOperationsOverview('2028-01-01', '2028-01-01', now)
      expect(expired.current.deleted_users).toBe(1)
      expect(expired.deletions.reasons).toContainEqual({ reason: 'unrecorded', deleted: 1, pending: 0 })
      expect(JSON.stringify(expired.deletions)).not.toContain('已经到期的反馈')
      await query(`insert into account_deletion_records (email_hash, deleted_at, reason, reason_detail)
        select 'deletion-test-bulk-' || n, '2030-01-26T00:00:00Z'::timestamptz + n * interval '1 hour', 'other', '批量反馈' || n
        from generate_series(1, 25) n`)
      const bounded = await getOperationsOverview('2030-01-20', '2030-01-31', now)
      expect(bounded.deletions.recent_feedback).toHaveLength(20)
      const dates = bounded.deletions.recent_feedback!.map((item) => Date.parse(item.at))
      expect(dates).toEqual([...dates].sort((a, b) => b - a))
      await query("delete from account_deletion_requests where id = 'deletion-test-pending'")
      const cancelled = await getOperationsOverview('2030-01-20', '2030-01-31', now)
      expect(cancelled.deletions.pending).toBe(2)
      expect(cancelled.current.deleted_users).toBe(bounded.current.deleted_users)
    } finally {
      await query("delete from user_accounts where id like 'deletion-test-%'")
      await query("delete from account_deletion_records where email_hash like 'deletion-test-%'")
    }
  })

  it('does not turn missing cost hours, expired records or unknown outcomes into complete metrics', async () => {
    await query(`delete from service_status_hourly where bucket_start = '2030-01-20T00:00:00Z'`)
    await event('unattributed', 'schedule_generate', '2030-01-25T02:00:00Z')
    await event('unknown', 'schedule_generate', '2030-01-25T03:00:00Z', 'a-profile', { status: null })
    await event('expired', 'schedule_generate', '2030-01-25T04:00:00Z', 'a-profile')
    await query(`update usage_events set expires_at = '2030-01-26T00:00:00Z' where key = 'expired'`)
    const data = await getOperationsOverview('2030-01-20', '2030-01-31', now)
    expect(data.current.successful_generations).toBe(7)
    expect(data.current.cost).toMatchObject({ recorded_hours: 287, estimated_cny: null, per_success_cny: null })
    expect(data.coverage).toMatchObject({ complete: false, unattributed_successes: 1, unknown_outcomes: 1 })
    expect(data.current.activation).toMatchObject({ eligible: 2, activated: 1, rate: 50 })
    expect(data.current.reuse).toMatchObject({ eligible: 2, reused: 1, rate: 50 })
    expect(data.current.maa).toMatchObject({ eligible: 6, exported: 2, rate: 33.3 })
    const historical = await getOperationsOverview('2029-01-01', '2029-01-07', now)
    expect(historical.coverage.complete).toBe(false)
    expect(historical.current.activation.rate).toBeNull()
  })
})

async function event(id: string, name: string, at: string, profile: string | null = null, extra: Record<string, unknown> = {}) {
  await query(`insert into usage_events (key, event, visitor_id, date, created_at, expires_at, profile_id, record_json)
    values ($1, $2, null, $3, $4, '2031-01-01T00:00:00Z', $5, $6::jsonb)`,
  [id, name, at.slice(0, 10), at, profile, JSON.stringify({ id, status: 'success', schedule_mode: 'maa', ...extra })])
}
