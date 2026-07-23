import { beforeEach, describe, expect, it, vi } from 'vitest'

const { clientQueryMock, queryMock } = vi.hoisted(() => ({
  clientQueryMock: vi.fn(),
  queryMock: vi.fn(),
}))

vi.mock('./schema', () => ({ ensureDatabaseSchema: vi.fn(async () => undefined) }))
vi.mock('./postgres', () => ({
  query: queryMock,
  withTransaction: vi.fn(async (work: (client: { query: typeof clientQueryMock }) => Promise<unknown>) => work({ query: clientQueryMock })),
}))

import { getOptimizationDeadLetterDetail, OptimizeJobAdmissionError, replayOptimizationDeadLetter } from './optimize-job-store'

describe('admin optimization dead-letter detail', () => {
  beforeEach(() => {
    clientQueryMock.mockReset()
    queryMock.mockReset()
  })

  it('joins the original job and returns its complete persisted payload', async () => {
    queryMock.mockResolvedValue({ rows: [deadLetterDetailRow()] })

    const detail = await getOptimizationDeadLetterDetail('letter-1')

    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('inner join optimize_jobs'), ['letter-1'])
    expect(detail).toMatchObject({
      id: 'letter-1',
      job_id: 'job-1',
      attempt_count: 2,
      replay_count: 0,
      payload_json: {
        effectiveConfig: { controlCenterLevel: 5 },
        operators: [{ name: '能天使', elite: 2 }],
      },
    })
  })

  it('returns null when the dead-letter record does not exist', async () => {
    queryMock.mockResolvedValue({ rows: [] })

    await expect(getOptimizationDeadLetterDetail('missing')).resolves.toBeNull()
  })

  it.each([
    ['the historical source', 'optimize_suggestions', { version: 3, request: {} }],
    ['the legacy payload marker', 'account_profile', { version: 3, request: { suggestions_only: true } }],
  ])('does not replay standalone suggestion jobs identified by %s', async (_case, source, payloadJson) => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [deadLetterDetailRow()] })
      .mockResolvedValueOnce({ rows: [deadLetteredJobRow(source, payloadJson)] })

    await expect(replayOptimizationDeadLetter('letter-1', 'ops')).resolves.toBeNull()
    expect(clientQueryMock).toHaveBeenCalledTimes(2)
    expect(clientQueryMock.mock.calls.some(([sql]) => String(sql).includes('insert into optimize_jobs'))).toBe(false)
  })

  it('checks current-month quota and reserves it when replaying a reorder job', async () => {
    clientQueryMock.mockImplementation(async (sql: unknown) => {
      const text = String(sql)
      if (text.includes('from optimization_dead_letters')) return { rows: [deadLetterDetailRow()] }
      if (text.includes('select * from optimize_jobs')) return { rows: [deadLetteredJobRow('reorder_check', { version: 3, kind: 'reorder_check' })] }
      if (text.includes('select count(*)::text as count from entitlement_ledger')) return { rows: [{ count: '0' }] }
      if (text.includes('insert into optimize_jobs')) {
        return { rows: [{ ...deadLetteredJobRow('reorder_check', { version: 3, kind: 'reorder_check' }), id: 'job-replayed', status: 'queued' }] }
      }
      return { rows: [] }
    })

    await expect(replayOptimizationDeadLetter('letter-1', 'ops')).resolves.toMatchObject({
      id: 'job-replayed',
      status: 'queued',
    })
    expect(clientQueryMock.mock.calls.some(([sql]) => String(sql).includes("'reorder_check', 'reserved', 'optimization_job'"))).toBe(true)
  })

  it('rejects reorder dead-letter replay when the current-month quota is full', async () => {
    clientQueryMock
      .mockResolvedValueOnce({ rows: [deadLetterDetailRow()] })
      .mockResolvedValueOnce({ rows: [deadLetteredJobRow('reorder_check', { version: 3, kind: 'reorder_check' })] })
      .mockResolvedValueOnce({ rows: [{ count: '2' }] })

    await expect(replayOptimizationDeadLetter('letter-1', 'ops')).rejects.toEqual(
      new OptimizeJobAdmissionError('reorder_check_quota_exceeded', 429, '本月重排检测次数已用完。'),
    )
    expect(clientQueryMock.mock.calls.some(([sql]) => String(sql).includes('insert into optimize_jobs'))).toBe(false)
  })
})

function deadLetterDetailRow() {
  return {
    id: 'letter-1',
    job_id: 'job-1',
    owner_key: 'profile:profile-1',
    profile_id: 'profile-1',
    source: 'account_profile',
    failure_kind: 'worker_crash',
    public_error_code: 'execution_retries_exhausted',
    internal_error_message: 'worker exited unexpectedly',
    diagnostic_json: { payload_version: 3 },
    attempt_count: '2',
    status: 'pending_review',
    replay_count: '0',
    replayed_job_id: null,
    replayed_by: null,
    replayed_at: null,
    resolved_at: null,
    created_at: '2026-07-19T10:00:00.000Z',
    updated_at: '2026-07-19T10:00:00.000Z',
    payload_json: {
      version: 3,
      submittedAt: 1_753_002_000_000,
      effectiveConfig: { controlCenterLevel: 5 },
      operators: [{ name: '能天使', elite: 2 }],
    },
  }
}

function deadLetteredJobRow(source: string, payloadJson: unknown) {
  return {
    id: 'job-1',
    status: 'dead_lettered',
    priority: 10,
    owner_key: 'profile:profile-1',
    profile_id: 'profile-1',
    permission: 'advanced',
    source,
    payload_json: payloadJson,
    result_json: null,
    error_message: 'failed',
    failure_kind: 'worker_crash',
    public_error_code: 'execution_retries_exhausted',
    attempt_count: 2,
    failure_count: 2,
    worker_id: null,
    heartbeat_at: null,
    lock_token: null,
    lock_expires_at: null,
    next_attempt_at: null,
    expires_at: null,
    cancel_requested_at: null,
    created_at: '2026-07-19T10:00:00.000Z',
    started_at: '2026-07-19T10:00:01.000Z',
    finished_at: '2026-07-19T10:10:01.000Z',
    updated_at: '2026-07-19T10:10:01.000Z',
  }
}
