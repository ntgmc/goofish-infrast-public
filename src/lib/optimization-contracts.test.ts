import { describe, expect, it } from 'vitest'
import {
  isOptimizationJobActive,
  isOptimizationJobTerminal,
  type OptimizationJobSnapshot,
} from './optimization-contracts'

const base = {
  id: 'job-1',
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
      error: { code: 'optimization_failed', message: 'failed' },
    }
    expect(isOptimizationJobActive(job)).toBe(false)
    expect(isOptimizationJobTerminal(job)).toBe(true)
  })
})
