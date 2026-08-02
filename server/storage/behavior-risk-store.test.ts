import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clientQuery: vi.fn(),
  connect: vi.fn(),
  ensureDatabaseSchema: vi.fn(),
  query: vi.fn(),
  release: vi.fn(),
}))

vi.mock('./schema', () => ({ ensureDatabaseSchema: mocks.ensureDatabaseSchema }))
vi.mock('./postgres', () => ({
  getPool: () => ({ connect: mocks.connect }),
  query: mocks.query,
  withTransaction: vi.fn(),
}))

import { listBehaviorRiskCases, runBehaviorRiskEvaluation } from './behavior-risk-store'

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.BEHAVIOR_RISK_STATEMENT_TIMEOUT_MS
  delete process.env.BEHAVIOR_RISK_LOCK_TIMEOUT_MS
  mocks.ensureDatabaseSchema.mockResolvedValue(undefined)
  mocks.connect.mockResolvedValue({ query: mocks.clientQuery, release: mocks.release })
})

describe('behavior risk case list batching', () => {
  it('loads members, accounts, profiles, and audits in fixed batch queries', async () => {
    const caseRow = (id: string) => ({
      id,
      group_key: `${id}-group`,
      evidence_key: `${id}-evidence`,
      status: 'pending' as const,
      score: 55,
      categories_json: ['operator_data'],
      rules_json: [],
      model_version: 'behavior-risk-v1.2.0',
      first_seen_at: '2026-07-25T00:00:00.000Z',
      last_seen_at: '2026-07-25T01:00:00.000Z',
      expires_at: '2026-10-23T00:00:00.000Z',
      created_at: '2026-07-25T00:00:00.000Z',
      updated_at: '2026-07-25T01:00:00.000Z',
      reviewed_at: null,
      reviewed_by: null,
    })
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('count(*)::text as total from behavior_risk_cases')) return { rows: [{ total: '2' }] }
      if (sql.includes('select * from behavior_risk_cases')) return { rows: [caseRow('case-1'), caseRow('case-2')] }
      if (sql.includes('from behavior_risk_case_members')) return { rows: [
        { case_id: 'case-1', user_id: 'user-1', evidence_json: {} },
        { case_id: 'case-2', user_id: 'user-2', evidence_json: {} },
      ] }
      if (sql.includes('from user_accounts')) return { rows: [
        { id: 'user-1', email: 'user-1@example.test' },
        { id: 'user-2', email: 'user-2@example.test' },
      ] }
      if (sql.includes('from user_game_accounts')) return { rows: [] }
      if (sql.includes('from behavior_risk_review_audit')) return { rows: [] }
      if (sql.includes('from behavior_risk_health')) return { rows: [] }
      if (sql.includes('count(*)::text as total from behavior_risk_dirty_users')) return { rows: [{ total: '0' }] }
      throw new Error(`Unexpected query: ${sql}`)
    })

    const result = await listBehaviorRiskCases({ page: 1, pageSize: 25 })

    expect(result.cases).toHaveLength(2)
    expect(mocks.query).toHaveBeenCalledTimes(8)
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('case_id = any($1::text[])'), [['case-1', 'case-2']])
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes('case_id = $1'))).toBe(false)
  })
})

describe('behavior risk evaluation maintenance limits', () => {
  it('applies bounded query timeouts and restores pooled connection settings', async () => {
    process.env.BEHAVIOR_RISK_STATEMENT_TIMEOUT_MS = '1200'
    process.env.BEHAVIOR_RISK_LOCK_TIMEOUT_MS = '300'
    mockSuccessfulEvaluation()

    await expect(runBehaviorRiskEvaluation(new Date('2026-07-27T00:00:00.000Z')))
      .resolves.toMatchObject({ status: 'success', cases: 0, purgedEvents: 0, eventsProcessed: 0, backlog: 0 })

    expect(mocks.clientQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("set_config('statement_timeout'"),
      ['1200ms', '300ms'],
    )
    expect(mocks.clientQuery).toHaveBeenLastCalledWith(
      expect.stringContaining("set_config('statement_timeout'"),
      ['17s', '2s'],
    )
    expect(mocks.release).toHaveBeenCalledWith(false)
  })

  it('propagates query timeouts after unlocking, restoring settings, and releasing the client', async () => {
    const timeout = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' })
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("current_setting('statement_timeout')")) return { rows: [{ statement_timeout: '0', lock_timeout: '0' }] }
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] }
      if (sql === 'begin') throw timeout
      if (sql.includes('pg_advisory_unlock')) return { rows: [{ unlocked: true }] }
      return { rows: [], rowCount: 0 }
    })

    await expect(runBehaviorRiskEvaluation()).rejects.toBe(timeout)

    expect(mocks.clientQuery).toHaveBeenCalledWith(
      'select pg_advisory_unlock($1) as unlocked',
      [1_743_861_291],
    )
    expect(mocks.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("set_config('statement_timeout'"),
      ['0', '0'],
    )
    expect(mocks.release).toHaveBeenCalledWith(false)
  })
})

function mockSuccessfulEvaluation(): void {
  mocks.clientQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("current_setting('statement_timeout')")) {
      return { rows: [{ statement_timeout: '17s', lock_timeout: '2s' }] }
    }
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] }
    if (sql.includes('from behavior_risk_events where expires_at')) return { rows: [] }
    if (sql.startsWith('delete from behavior_risk_events')) return { rows: [], rowCount: 0 }
    if (sql.includes('pg_advisory_unlock')) return { rows: [{ unlocked: true }] }
    return { rows: [], rowCount: 0 }
  })
}
