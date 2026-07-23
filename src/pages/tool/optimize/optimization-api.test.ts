import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiJson } from '../../../lib/api-client'
import { requestReorderCheck } from './optimization-api'

vi.mock('../../../lib/api-client', () => ({ apiJson: vi.fn() }))

afterEach(() => {
  vi.useRealTimers()
  vi.mocked(apiJson).mockReset()
})

describe('requestReorderCheck', () => {
  it('polls queued and running jobs until the worker result succeeds', async () => {
    vi.useFakeTimers()
    const result = { recommendation: 'no_need' }
    vi.mocked(apiJson)
      .mockResolvedValueOnce({ job: snapshot('queued') })
      .mockResolvedValueOnce(snapshot('running'))
      .mockResolvedValueOnce(snapshot('succeeded', result))

    const request = requestReorderCheck({
      profileId: 'profile-1',
      config: {} as never,
      baselineHistoryId: 'history-1',
    }, 'failed')
    await vi.runAllTimersAsync()

    await expect(request).resolves.toBe(result)
    expect(apiJson).toHaveBeenCalledTimes(3)
    expect(vi.mocked(apiJson).mock.calls[1]?.[0]).toBe('/api/optimization/jobs/job-1')
  })

  it('surfaces the terminal worker error', async () => {
    vi.mocked(apiJson).mockResolvedValueOnce({
      job: snapshot('failed', undefined, 'worker failed'),
    })

    await expect(requestReorderCheck({
      profileId: 'profile-1',
      config: {} as never,
      baselineHistoryId: 'history-1',
    }, 'fallback')).rejects.toThrow('worker failed')
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
