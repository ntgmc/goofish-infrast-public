import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiJson } from '../../../lib/api-client'
import { submitReorderCheckJob } from './optimization-api'

vi.mock('../../../lib/api-client', () => ({ apiJson: vi.fn() }))

afterEach(() => {
  vi.useRealTimers()
  vi.mocked(apiJson).mockReset()
})

describe('submitReorderCheckJob', () => {
  it('submits with the caller-owned idempotency key and returns the accepted snapshot', async () => {
    const accepted = { job: snapshot('queued') }
    vi.mocked(apiJson).mockResolvedValueOnce(accepted)

    const response = await submitReorderCheckJob({
      profileId: 'profile-1',
      config: {} as never,
      baselineHistoryId: 'history-1',
    }, 'failed', 'reorder-key-1')

    expect(response).toBe(accepted)
    expect(apiJson).toHaveBeenCalledWith('/api/optimization/reorder-checks', expect.objectContaining({
      method: 'POST',
      headers: { 'Idempotency-Key': 'reorder-key-1' },
    }))
  })
})

function snapshot(status: 'queued' | 'running' | 'succeeded' | 'failed', result?: unknown, errorMessage?: string) {
  const base = {
    id: 'job-1',
    kind: 'reorder_check',
    source: 'reorder_check',
    priority: { kind: 'standard', label: '普通队列' },
    queuePosition: status === 'queued' ? 1 : null,
    pollAfterMs: 1,
    timestamps: { submittedAt: '2026-07-23T00:00:00.000Z' },
    estimate: {
      durationMs: 1,
      bucket: 'maa_plain',
      source: 'fallback_p95',
      sampleCount: 0,
      remainingMs: status === 'succeeded' || status === 'failed' ? null : 1,
      totalMs: 1,
      phase: status === 'failed' ? 'failed' : status === 'succeeded' ? 'completed' : status,
      updatedAt: '2026-07-23T00:00:00.000Z',
    },
    executionPhase: status === 'queued' ? 'initial_queue' : status === 'running' ? 'executing' : 'terminal',
    calculationStage: null,
    upgradeSuggestions: { requested: false, allowed: false },
    attemptCount: status === 'queued' ? 0 : 1,
    failureCount: status === 'failed' ? 1 : 0,
    cancellationRequested: false,
    canCancel: status === 'queued' || status === 'running',
    canRetry: status === 'failed',
  }
  if (status === 'succeeded') return { ...base, status, result }
  if (status === 'failed') {
    return {
      ...base,
      status,
      error: {
        code: 'application_error',
        message: errorMessage,
        retryable: false,
        recoveryAction: 'review_input',
        attemptCount: 1,
        supportReference: 'OPT-JOB1',
      },
    }
  }
  return { ...base, status }
}
