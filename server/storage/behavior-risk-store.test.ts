import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  clientQuery: vi.fn(),
  connect: vi.fn(),
  ensureDatabaseSchema: vi.fn(),
  release: vi.fn(),
}))

vi.mock('./schema', () => ({ ensureDatabaseSchema: mocks.ensureDatabaseSchema }))
vi.mock('./postgres', () => ({
  getPool: () => ({ connect: mocks.connect }),
  query: vi.fn(),
  withTransaction: vi.fn(),
}))

import { runBehaviorRiskEvaluation } from './behavior-risk-store'

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.BEHAVIOR_RISK_STATEMENT_TIMEOUT_MS
  delete process.env.BEHAVIOR_RISK_LOCK_TIMEOUT_MS
  mocks.ensureDatabaseSchema.mockResolvedValue(undefined)
  mocks.connect.mockResolvedValue({ query: mocks.clientQuery, release: mocks.release })
})

describe('behavior risk evaluation maintenance limits', () => {
  it('applies bounded query timeouts and restores pooled connection settings', async () => {
    process.env.BEHAVIOR_RISK_STATEMENT_TIMEOUT_MS = '1200'
    process.env.BEHAVIOR_RISK_LOCK_TIMEOUT_MS = '300'
    mockSuccessfulEvaluation()

    await expect(runBehaviorRiskEvaluation(new Date('2026-07-27T00:00:00.000Z')))
      .resolves.toEqual({ cases: 0, purgedEvents: 0 })

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
    mocks.clientQuery
      .mockResolvedValueOnce({ rows: [{ statement_timeout: '0', lock_timeout: '0' }] })
      .mockResolvedValueOnce({ rows: [{}] })
      .mockResolvedValueOnce({ rows: [{ locked: true }] })
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce({ rows: [{ unlocked: true }] })
      .mockResolvedValueOnce({ rows: [{}] })

    await expect(runBehaviorRiskEvaluation()).rejects.toBe(timeout)

    expect(mocks.clientQuery).toHaveBeenNthCalledWith(
      5,
      'select pg_advisory_unlock($1) as unlocked',
      [1_743_861_291],
    )
    expect(mocks.clientQuery).toHaveBeenNthCalledWith(
      6,
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
