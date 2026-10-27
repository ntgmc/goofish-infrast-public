import { performance } from 'node:perf_hooks'
import type { OptimizeCalculationStage } from '../../../src/lib/types'
import type { OptimizeJobRecord } from '../../storage/optimize-job-store'
import { logPerformanceEvent, recordPerformanceDuration, withPerformanceContext } from '../../performance-observation'
import type { OptimizeExecutionContext } from './optimizer-port'

export function observeOptimizationClaim(job: OptimizeJobRecord): void {
  // Later attempts include retry delays and previous execution; they are not queue-wait samples.
  const queueMs = Date.parse(job.started_at ?? '') - Date.parse(job.created_at)
  if (job.attempt_count !== 1 || !Number.isFinite(queueMs) || queueMs < 0) return
  const kind = job.source === 'scenario_comparison' ? 'scenario_comparison' : 'schedule'
  recordPerformanceDuration('optimization.queue', queueMs, { kind })
  logPerformanceEvent('optimization.claimed', {
    job_id: job.id, attempt_no: job.attempt_count, worker_id: job.worker_id, kind, queue_ms: queueMs,
  }, {})
}

export function observeOptimizationExecution<T>(
  job: OptimizeJobRecord,
  context: OptimizeExecutionContext,
  work: (observedContext: OptimizeExecutionContext) => Promise<T>,
): Promise<T> {
  return withPerformanceContext({ job_id: job.id, attempt_no: context.attemptNo, worker_id: context.workerId }, async () => {
    const kind = job.source === 'scenario_comparison' ? 'scenario_comparison' : 'schedule'
    const started = performance.now()
    const cpuStarted = process.threadCpuUsage()
    let stageCpuStarted = cpuStarted
    let stageStarted = started
    let stage: OptimizeCalculationStage = 'starting'
    let outcome = 'error'
    const finishStage = (stageOutcome: string) => {
      const durationMs = performance.now() - stageStarted
      const cpu = process.threadCpuUsage(stageCpuStarted)
      recordPerformanceDuration('optimization.stage', durationMs, { kind, stage, outcome: stageOutcome })
      logPerformanceEvent('optimization.stage', {
        kind, stage, outcome: stageOutcome, duration_ms: durationMs, thread_cpu_ms: (cpu.user + cpu.system) / 1000,
      })
    }
    logPerformanceEvent('optimization.stage_started', { kind, stage })
    try {
      const result = await work({
        ...context,
        reportStage: (next) => {
          if (next !== stage) {
            finishStage('success')
            stage = next
            stageStarted = performance.now()
            stageCpuStarted = process.threadCpuUsage()
            logPerformanceEvent('optimization.stage_started', { kind, stage })
          }
          return context.reportStage?.(next)
        },
      })
      outcome = 'success'
      return result
    } finally {
      finishStage(outcome)
      const durationMs = performance.now() - started
      recordPerformanceDuration('optimization.execution', durationMs, { kind, outcome })
      const cpu = process.threadCpuUsage(cpuStarted)
      logPerformanceEvent('optimization.execution', {
        kind, outcome, duration_ms: durationMs, thread_cpu_ms: (cpu.user + cpu.system) / 1000,
      })
    }
  })
}
