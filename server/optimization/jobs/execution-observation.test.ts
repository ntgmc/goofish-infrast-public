import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPerformanceDurations, getPerformanceContext, withPerformanceContext } from '../../performance-observation'
import { createMemoryOptimizeJobStore } from '../../storage/optimize-job-store'
import type { OptimizeExecutionContext } from './optimizer-port'
import { observeOptimizationClaim, observeOptimizationExecution } from './execution-observation'

afterEach(() => {
  flushPerformanceDurations()
  vi.restoreAllMocks()
})

async function createClaimedJob() {
  const store = createMemoryOptimizeJobStore()
  await store.createJob({ id: 'test-job', owner_key: 'owner', permission: 'free', source: 'free_preview', priority: 0, payload_json: {} })
  return (await store.claimNextJob('worker', 'lock', new Date(Date.now() + 60_000).toISOString(), 3, 1))!
}

describe('optimization performance boundaries', () => {
  it('records only first-attempt queue waits and preserves job context across reported stages', async () => {
    const events: Array<Record<string, unknown>> = []
    vi.spyOn(console, 'info').mockImplementation((line: string) => { events.push(JSON.parse(line)) })
    const job = await createClaimedJob()
    observeOptimizationClaim(job)
    observeOptimizationClaim({ ...job, attempt_count: 2 })
    expect(events.filter((event) => event.event === 'optimization.claimed')).toHaveLength(1)
    const reportStage = vi.fn()
    const context: OptimizeExecutionContext = { jobId: job.id, attemptNo: 1, workerId: 'worker', lockToken: 'lock', deadlineAtMs: Date.now() + 60_000, reportStage }
    await withPerformanceContext({ request_id: 'unrelated-request' }, () => observeOptimizationExecution(job, context, async (observed) => {
      expect(getPerformanceContext()).toEqual({ job_id: job.id, attempt_no: 1, worker_id: 'worker' })
      await observed.reportStage?.('generating_schedule')
      await observed.reportStage?.('generating_schedule')
      await observed.reportStage?.('simulating_upgrades')
      return 7
    }))
    expect(reportStage.mock.calls.map(([stage]) => stage)).toEqual(['generating_schedule', 'generating_schedule', 'simulating_upgrades'])
    expect(events.filter((event) => event.event === 'optimization.stage').map((event) => event.stage)).toEqual(['starting', 'generating_schedule', 'simulating_upgrades'])
    expect(events).toContainEqual(expect.objectContaining({ event: 'optimization.execution', job_id: job.id, outcome: 'success' }))
    expect(JSON.stringify(events)).not.toContain('unrelated-request')
  })

  it('preserves failures and records the failing stage', async () => {
    const events: Array<Record<string, unknown>> = []
    vi.spyOn(console, 'info').mockImplementation((line: string) => { events.push(JSON.parse(line)) })
    const job = await createClaimedJob()
    const failure = new Error('sensitive internal message')
    await expect(observeOptimizationExecution(job, {
      jobId: job.id, attemptNo: 1, workerId: 'worker', lockToken: 'lock', deadlineAtMs: Date.now() + 60_000,
    }, async (context) => {
      await context.reportStage?.('simulating_upgrades')
      throw failure
    })).rejects.toBe(failure)
    expect(events).toContainEqual(expect.objectContaining({ event: 'optimization.stage', stage: 'simulating_upgrades', outcome: 'error' }))
    expect(events).toContainEqual(expect.objectContaining({ event: 'optimization.execution', outcome: 'error' }))
    expect(JSON.stringify(events)).not.toContain('sensitive internal message')
  })
})
