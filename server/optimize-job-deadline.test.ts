import { describe, expect, it } from 'vitest'
import {
  calculateOptimizeExecutionDeadlineAtMs,
  remainingOptimizeExecutionMs,
} from './optimize-job-deadline'

describe('optimize job execution deadline', () => {
  it('uses the persisted attempt start time as the shared absolute deadline', () => {
    const startedAt = '2026-07-24T08:00:00.000Z'
    const deadlineAtMs = calculateOptimizeExecutionDeadlineAtMs(startedAt, 123, 600_000)

    expect(deadlineAtMs).toBe(Date.parse(startedAt) + 600_000)
    expect(remainingOptimizeExecutionMs(deadlineAtMs, Date.parse(startedAt) + 10_000)).toBe(590_000)
  })

  it('uses the context creation time when the persisted start time is invalid', () => {
    expect(calculateOptimizeExecutionDeadlineAtMs('invalid', 50_000, 30_000)).toBe(80_000)
  })

  it('never schedules a zero or negative timeout', () => {
    expect(remainingOptimizeExecutionMs(10_000, 20_000)).toBe(1)
  })
})
