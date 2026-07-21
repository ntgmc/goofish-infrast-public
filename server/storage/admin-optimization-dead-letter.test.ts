import { beforeEach, describe, expect, it, vi } from 'vitest'

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }))

vi.mock('./schema', () => ({ ensureDatabaseSchema: vi.fn(async () => undefined) }))
vi.mock('./postgres', () => ({
  query: queryMock,
  withTransaction: vi.fn(),
}))

import { getOptimizationDeadLetterDetail } from './optimize-job-store'

describe('admin optimization dead-letter detail', () => {
  beforeEach(() => {
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
