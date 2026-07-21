import { describe, expect, it } from 'vitest'
import {
  isOptimizationJobActive,
  isOptimizationJobTerminal,
  type OptimizationJobSnapshot,
} from './optimization-contracts'

const base = {
  id: 'job-1',
  kind: 'schedule' as const,
  source: 'account_profile',
  priority: { kind: 'standard' as const, label: '普通队列' },
  queuePosition: 1,
  pollAfterMs: 1_000,
  timestamps: { submittedAt: '2026-07-10T00:00:00.000Z' },
  estimate: {
    durationMs: 2_000,
    bucket: 'maa_plain' as const,
    source: 'fallback_p95' as const,
    sampleCount: 0,
    remainingMs: 2_000,
    totalMs: 2_000,
    phase: 'queued' as const,
    updatedAt: '2026-07-10T00:00:00.000Z',
  },
  executionPhase: 'initial_queue' as const,
  calculationStage: null,
  upgradeSuggestions: { requested: true, allowed: true },
  attemptCount: 0,
  failureCount: 0,
  cancellationRequested: false,
  canCancel: true,
  canRetry: false,
}

describe('optimization job contract guards', () => {
  it('distinguishes active jobs', () => {
    const job: OptimizationJobSnapshot = { ...base, status: 'queued' }
    expect(isOptimizationJobActive(job)).toBe(true)
    expect(isOptimizationJobTerminal(job)).toBe(false)
  })

  it('distinguishes failed jobs', () => {
    const job: OptimizationJobSnapshot = {
      ...base,
      status: 'failed',
      error: {
        code: 'optimization_failed',
        message: 'failed',
        retryable: false,
        recoveryAction: 'contact_support',
        attemptCount: 1,
        supportReference: 'OPT-JOB-1',
      },
    }
    expect(isOptimizationJobActive(job)).toBe(false)
    expect(isOptimizationJobTerminal(job)).toBe(true)
  })

  it.each(['cancelled', 'dead_lettered'] as const)('treats %s jobs as terminal', (status) => {
    const job: OptimizationJobSnapshot = {
      ...base,
      status,
      canCancel: false,
      canRetry: true,
      executionPhase: 'terminal',
      error: {
        code: status,
        message: status,
        retryable: true,
        recoveryAction: status === 'cancelled' ? 'retry' : 'contact_support',
        attemptCount: 1,
        supportReference: 'OPT-JOB-1',
      },
    }
    expect(isOptimizationJobActive(job)).toBe(false)
    expect(isOptimizationJobTerminal(job)).toBe(true)
  })
})
