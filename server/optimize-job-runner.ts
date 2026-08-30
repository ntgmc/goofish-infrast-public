import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import type { OptimizeCalculationStage } from '../src/lib/types'
import { executeRegisteredOptimizationJob } from './optimization/jobs/optimizer-dispatcher'
import {
  requireRegisteredOptimizerPort,
  toOptimizerFailure,
  type OptimizeExecutionContext,
  type OptimizerFailure,
} from './optimization/jobs/optimizer-port'
import {
  formatOptimizeJobHardTimeout,
  getOptimizeGlobalWorkerConcurrency,
  getOptimizeJobMaxAttempts,
  getOptimizePaidPreemptGraceMs,
  getOptimizeQueuePollMs,
  getOptimizeWorkerClaimPriority,
  getOptimizeWorkerConfiguration,
  getOptimizeWorkerMaxOldSpaceMb,
  getOptimizeWorkerRuntimeConcurrency,
} from './optimize-job-config'
import {
  calculateOptimizeExecutionDeadlineAtMs,
  remainingOptimizeExecutionMs,
} from './optimize-job-deadline'
import { registerOptimizeJobSignalHandlers } from './optimize-job-signals'
import {
  initializeOptimizeQueueMaintenance,
  isOptimizeQueueMaintenanceInitialized,
} from './optimize-queue-maintenance'
import { canRunOptimizeWorker } from './process-role'
import {
  getOptimizeJobStore,
  type OptimizeJobFailureKind,
  type OptimizeJobRecord,
  type OptimizeJobStatus,
  type OptimizeJobStore,
} from './storage/optimize-job-store'
import { processPendingOptimizationJobEffects } from './optimization/jobs/job-effects'
import { describeServerError } from './security/error-reporting'

const DEFAULT_LOCK_TTL_MS = 60_000
const DEFAULT_HEARTBEAT_MS = 15_000
const DEFAULT_SHUTDOWN_GRACE_MS = 60_000
const FORCED_RELEASE_DEADLINE_MS = 5_000

type WorkerResultMessage =
  | { type: 'succeeded'; result: unknown }
  | { type: 'failed'; failure: OptimizerFailure }
  | { type: 'progress'; stage: OptimizeCalculationStage }

type ActiveAttempt = {
  job: OptimizeJobRecord
  worker: Worker
  lockToken: string
  leaseDeadlineMs: number
  heartbeatTimer: ReturnType<typeof setInterval>
  hardTimeout: ReturnType<typeof setTimeout>
  heartbeatBusy: boolean
  leaseRenewalEnabled: boolean
  settling: boolean
  progressUpdates: Promise<void>
}

class OptimizeJobTimeoutError extends Error {
  constructor() {
    super(optimizeJobTimeoutMessage())
    this.name = 'OptimizeJobTimeoutError'
  }
}

const processWorkerId = `${hostname()}:${process.pid}:${randomUUID()}`
const activeAttempts = new Map<string, ActiveAttempt>()
const idleWaiters = new Set<() => void>()

let inlineProcessing = false
let accepting = false
let initialized = false
let pumpPromise: Promise<void> | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null

export async function initializeOptimizeJobProcessing(): Promise<void> {
  if (!canRunOptimizeWorker() || initialized) return
  requireRegisteredOptimizerPort()
  const configuration = {
    ...getOptimizeWorkerConfiguration(),
    localConcurrency: workerConcurrency(),
  }
  console.info('[optimize-worker-config]', configuration)
  initialized = true
  accepting = true
  try {
    await initializeOptimizeQueueMaintenance()
    if (!accepting) return
    startDispatcherTimer()
    await pumpQueue()
  } catch (error) {
    accepting = false
    initialized = false
    stopDispatcherTimer()
    throw error
  }
}

function handleOptimizeJobProcessingRequest(): void {
  if (!canRunOptimizeWorker()) return
  if (!initialized) {
    void initializeOptimizeJobProcessing().catch((error) => console.error('optimize queue initialization failed:', describeServerError(error)))
    return
  }
  if (!accepting) return
  void pumpQueue().catch((error) => console.error('optimize queue pump failed:', describeServerError(error)))
}

function handleOptimizeJobCancellationRequest(jobId: string): void {
  if (!canRunOptimizeWorker()) return
  const attempt = activeAttempts.get(jobId)
  if (attempt) void stopAndCancel(attempt)
}

export async function shutdownOptimizeJobProcessing(graceMs = shutdownGraceMs()): Promise<void> {
  const boundedGraceMs = Math.max(0, graceMs)
  const gracefulDrainDeadlineAt = Date.now() + boundedGraceMs
  const deadlineAt = gracefulDrainDeadlineAt + FORCED_RELEASE_DEADLINE_MS
  accepting = false
  stopDispatcherTimer()
  if (pumpPromise) await waitUntil(pumpPromise.catch(() => undefined), gracefulDrainDeadlineAt)

  if (activeAttempts.size > 0) {
    await waitUntil(waitForIdle(), gracefulDrainDeadlineAt)
  }

  const remaining = [...activeAttempts.values()]
  if (remaining.length > 0) {
    await waitUntil(Promise.allSettled(remaining.map((attempt) => interruptForShutdown(attempt))), deadlineAt)
  }
  initialized = false
}

export function getOptimizeJobProcessingState(): {
  initialized: boolean
  accepting: boolean
  maintenanceInitialized: boolean
  activeAttempts: number
  workerId: string
} {
  return {
    initialized,
    accepting,
    maintenanceInitialized: isOptimizeQueueMaintenanceInitialized(),
    activeAttempts: activeAttempts.size,
    workerId: processWorkerId,
  }
}

function startDispatcherTimer(): void {
  pollTimer = setInterval(handleOptimizeJobProcessingRequest, getOptimizeQueuePollMs())
  pollTimer.unref?.()
}

function stopDispatcherTimer(): void {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}

function pumpQueue(): Promise<void> {
  if (pumpPromise) return pumpPromise
  pumpPromise = (shouldRunInline() ? processInlineQueue() : spawnAvailableWorkers())
    .finally(() => {
      pumpPromise = null
    })
  return pumpPromise
}

async function spawnAvailableWorkers(): Promise<void> {
  const store = getOptimizeJobStore()
  while (accepting && activeAttempts.size < workerConcurrency()) {
    const lockToken = randomUUID()
    const job = await claimNext(store, lockToken)
    if (!job) break
    try {
      spawnClaimedWorker(job, lockToken)
    } catch (error) {
      await retryAttempt(store,
        job.id,
        job.attempt_count,
        processWorkerId,
        lockToken,
        'worker_crash',
        error instanceof Error ? error.message : String(error),
      )
    }
  }
  while (accepting && await preemptLocalFreeAttemptForPaid(store)) {
    // Replace every local idle-class attempt needed by already-waiting paid work.
  }
}

async function preemptLocalFreeAttemptForPaid(store: OptimizeJobStore): Promise<boolean> {
  const candidateJobIds = [...activeAttempts.values()]
    .filter((attempt) => !attempt.settling && attempt.job.priority <= 0)
    .map((attempt) => attempt.job.id)
  if (candidateJobIds.length === 0) return false
  const lockToken = randomUUID()
  const preemption = await store.preemptFreeJobForPaid({
    workerId: processWorkerId,
    candidateJobIds,
    lockToken,
    lockExpiresAt: lockExpiresAt(),
    maxFailures: getOptimizeJobMaxAttempts(),
    maxGlobalRunning: getOptimizeGlobalWorkerConcurrency(),
    claimPriority: getOptimizeWorkerClaimPriority(),
    graceMs: getOptimizePaidPreemptGraceMs(),
  })
  if (!preemption) return false

  const victim = activeAttempts.get(preemption.interruptedJobId)
  if (victim) {
    victim.settling = true
    stopAttemptLeaseRenewal(victim)
    await victim.worker.terminate().catch(() => undefined)
    finishAttempt(victim)
  }
  try {
    spawnClaimedWorker(preemption.job, lockToken)
  } catch (error) {
    await retryAttempt(
      store,
      preemption.job.id,
      preemption.job.attempt_count,
      processWorkerId,
      lockToken,
      'worker_crash',
      error instanceof Error ? error.message : String(error),
    )
  }
  return true
}

async function processInlineQueue(): Promise<void> {
  if (inlineProcessing) return
  inlineProcessing = true
  const store = getOptimizeJobStore()
  try {
    while (accepting) {
      const lockToken = randomUUID()
      const job = await claimNext(store, lockToken)
      if (!job) return
      const context = executionContext(job, lockToken, (stage) => updateAttemptStage(store, job, lockToken, stage))
      try {
        const result = await runInlineExecutorWithTimeout(job, context)
        const current = await store.getJob(job.id)
        if (current?.cancel_requested_at) await store.cancelAttempt(job.id, job.attempt_count, processWorkerId, lockToken)
        else await completeAttempt(store, job, lockToken, result)
      } catch (error) {
        const current = await store.getJob(job.id)
        if (current?.cancel_requested_at) await store.cancelAttempt(job.id, job.attempt_count, processWorkerId, lockToken)
        else if (error instanceof OptimizeJobTimeoutError) {
          await retryAttempt(store, job.id, job.attempt_count, processWorkerId, lockToken, 'timed_out', error.message)
        }
        else await settleOptimizerFailure(store, job, lockToken, toOptimizerFailure(error))
      }
    }
  } finally {
    inlineProcessing = false
  }
}

async function runInlineExecutorWithTimeout(
  job: OptimizeJobRecord,
  context: OptimizeExecutionContext,
): Promise<unknown> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new OptimizeJobTimeoutError()), remainingOptimizeExecutionMs(context.deadlineAtMs))
    timeout.unref?.()
  })
  try {
    return await Promise.race([executeRegisteredOptimizationJob(job, context), deadline])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function spawnClaimedWorker(job: OptimizeJobRecord, lockToken: string): void {
  const context = executionContext(job, lockToken)
  const maxOldGenerationSizeMb = getOptimizeWorkerMaxOldSpaceMb()
  const worker = new Worker(workerEntryUrl(), {
    workerData: { job, context },
    ...(maxOldGenerationSizeMb > 0
      ? { resourceLimits: { maxOldGenerationSizeMb } }
      : {}),
  })
  const attempt: ActiveAttempt = {
    job,
    worker,
    lockToken,
    leaseDeadlineMs: Date.parse(job.lock_expires_at ?? lockExpiresAt()),
    heartbeatTimer: undefined as unknown as ReturnType<typeof setInterval>,
    hardTimeout: undefined as unknown as ReturnType<typeof setTimeout>,
    heartbeatBusy: false,
    leaseRenewalEnabled: true,
    settling: false,
    progressUpdates: Promise.resolve(),
  }

  attempt.heartbeatTimer = setInterval(() => void heartbeat(attempt), heartbeatMs())
  attempt.heartbeatTimer.unref?.()
  attempt.hardTimeout = setTimeout(() => {
    void stopAndRetry(attempt, 'timed_out', optimizeJobTimeoutMessage())
  }, remainingOptimizeExecutionMs(context.deadlineAtMs))
  attempt.hardTimeout.unref?.()
  activeAttempts.set(job.id, attempt)

  worker.on('message', (message: WorkerResultMessage) => {
    if (message?.type === 'progress') {
      queueWorkerProgress(attempt, message.stage)
      return
    }
    void settleWorkerMessage(attempt, message)
  })
  worker.once('error', (error) => void stopAndRetry(
    attempt,
    'worker_crash',
    error instanceof Error ? error.message : String(error),
  ))
  worker.once('exit', (code) => {
    if (!attempt.settling && activeAttempts.get(job.id) === attempt) {
      void stopAndRetry(attempt, 'worker_crash', `优化 worker 意外退出（code ${code}）。`, false)
    }
  })
}

async function heartbeat(attempt: ActiveAttempt): Promise<void> {
  if (!attempt.leaseRenewalEnabled || attempt.heartbeatBusy || activeAttempts.get(attempt.job.id) !== attempt) return
  attempt.heartbeatBusy = true
  try {
    const nextLease = lockExpiresAt()
    const owned = await heartbeatAttempt(getOptimizeJobStore(), attempt, nextLease)
    if (!owned) {
      const current = await getOptimizeJobStore().getJob(attempt.job.id)
      if (current?.cancel_requested_at) {
        await stopAndCancel(attempt)
        return
      }
      await stopAndRetry(attempt, 'lease_lost', '任务执行租约所有权已丢失。')
      return
    }
    attempt.leaseDeadlineMs = Date.parse(nextLease)
  } catch (error) {
    console.warn('optimize worker heartbeat skipped:', describeServerError(error))
    if (Date.now() + heartbeatMs() >= attempt.leaseDeadlineMs) {
      await stopAndRetry(attempt, 'lease_lost', '任务执行租约无法安全续期。')
    }
  } finally {
    attempt.heartbeatBusy = false
  }
}

function queueWorkerProgress(attempt: ActiveAttempt, stage: OptimizeCalculationStage): void {
  if (attempt.settling || activeAttempts.get(attempt.job.id) !== attempt) return
  attempt.progressUpdates = attempt.progressUpdates
    .then(async () => {
      await updateAttemptStage(getOptimizeJobStore(), attempt.job, attempt.lockToken, stage)
    })
    .catch((error) => console.warn('optimize worker progress update skipped:', describeServerError(error)))
}

async function settleWorkerMessage(
  attempt: ActiveAttempt,
  message: Exclude<WorkerResultMessage, { type: 'progress' }>,
): Promise<void> {
  if (attempt.settling || activeAttempts.get(attempt.job.id) !== attempt) return
  attempt.settling = true
  clearTimeout(attempt.hardTimeout)
  try {
    const progressFlushed = await waitUntil(
      attempt.progressUpdates,
      Date.now() + progressFlushTimeoutMs(),
    )
    if (!progressFlushed) {
      console.warn('[optimize-worker] progress flush deadline reached; continuing lock-owned settlement')
    }
    const current = await getOptimizeJobStore().getJob(attempt.job.id)
    if (current?.cancel_requested_at) {
      await attempt.worker.terminate()
      await getOptimizeJobStore().cancelAttempt(
        attempt.job.id,
        attempt.job.attempt_count,
        processWorkerId,
        attempt.lockToken,
      )
      return
    }
    if (message?.type === 'succeeded') {
      await completeAttempt(getOptimizeJobStore(), attempt.job, attempt.lockToken, message.result)
    } else {
      const failure = message?.type === 'failed'
        ? message.failure
        : toOptimizerFailure(new Error('优化 worker 返回了无效结果。'))
      await settleOptimizerFailure(getOptimizeJobStore(), attempt.job, attempt.lockToken, failure)
    }
  } finally {
    stopAttemptLeaseRenewal(attempt)
    finishAttempt(attempt)
  }
}

async function stopAndCancel(attempt: ActiveAttempt): Promise<void> {
  if (attempt.settling || activeAttempts.get(attempt.job.id) !== attempt) return
  attempt.settling = true
  stopAttemptLeaseRenewal(attempt)
  try {
    await attempt.worker.terminate()
    await getOptimizeJobStore().cancelAttempt(
      attempt.job.id,
      attempt.job.attempt_count,
      processWorkerId,
      attempt.lockToken,
    )
  } catch (error) {
    console.error('optimize worker cancellation settlement failed:', describeServerError(error))
  } finally {
    finishAttempt(attempt)
  }
}

async function stopAndRetry(
  attempt: ActiveAttempt,
  failureKind: OptimizeJobFailureKind,
  errorMessage: string,
  terminate = true,
): Promise<void> {
  if (attempt.settling || activeAttempts.get(attempt.job.id) !== attempt) return
  attempt.settling = true
  stopAttemptLeaseRenewal(attempt)
  try {
    if (terminate) await attempt.worker.terminate()
    const current = await getOptimizeJobStore().getJob(attempt.job.id)
    if (current?.cancel_requested_at) {
      await getOptimizeJobStore().cancelAttempt(
        attempt.job.id,
        attempt.job.attempt_count,
        processWorkerId,
        attempt.lockToken,
      )
      return
    }
    await retryAttempt(getOptimizeJobStore(),
      attempt.job.id,
      attempt.job.attempt_count,
      processWorkerId,
      attempt.lockToken,
      failureKind,
      errorMessage,
    )
  } catch (error) {
    console.error('optimize worker retry settlement failed:', describeServerError(error))
  } finally {
    finishAttempt(attempt)
  }
}

async function interruptForShutdown(attempt: ActiveAttempt): Promise<void> {
  if (attempt.settling || activeAttempts.get(attempt.job.id) !== attempt) return
  attempt.settling = true
  stopAttemptLeaseRenewal(attempt)
  try {
    await attempt.worker.terminate()
    const current = await getOptimizeJobStore().getJob(attempt.job.id)
    if (current?.cancel_requested_at) {
      await getOptimizeJobStore().cancelAttempt(
        attempt.job.id,
        attempt.job.attempt_count,
        processWorkerId,
        attempt.lockToken,
      )
    } else {
      await releaseInterrupted(getOptimizeJobStore(), attempt.job, attempt.lockToken)
    }
  } catch (error) {
    console.error('optimize worker shutdown release failed:', describeServerError(error))
  } finally {
    finishAttempt(attempt)
  }
}

function finishAttempt(attempt: ActiveAttempt): void {
  if (activeAttempts.get(attempt.job.id) === attempt) activeAttempts.delete(attempt.job.id)
  if (activeAttempts.size === 0) {
    for (const resolveIdle of idleWaiters) resolveIdle()
    idleWaiters.clear()
  }
  if (accepting) handleOptimizeJobProcessingRequest()
}

function stopAttemptLeaseRenewal(attempt: ActiveAttempt): void {
  attempt.leaseRenewalEnabled = false
  clearInterval(attempt.heartbeatTimer)
  clearTimeout(attempt.hardTimeout)
}

function waitForIdle(): Promise<void> {
  if (activeAttempts.size === 0) return Promise.resolve()
  return new Promise((resolveIdle) => idleWaiters.add(resolveIdle))
}

function executionContext(
  job: OptimizeJobRecord,
  lockToken: string,
  reportStage?: OptimizeExecutionContext['reportStage'],
): OptimizeExecutionContext {
  return {
    jobId: job.id,
    attemptNo: job.attempt_count,
    workerId: processWorkerId,
    lockToken,
    deadlineAtMs: calculateOptimizeExecutionDeadlineAtMs(job.started_at),
    ...(reportStage && { reportStage }),
  }
}

function shouldRunInline(): boolean {
  if (process.env.OPTIMIZE_FORCE_WORKER_THREADS_FOR_TESTING === '1' && process.env.NODE_ENV !== 'production') return false
  return process.env.NODE_ENV === 'test'
}

function workerConcurrency(): number {
  return getOptimizeWorkerRuntimeConcurrency()
}

function lockTtlMs(): number {
  return positiveInteger(process.env.OPTIMIZE_JOB_LOCK_TTL_MS, DEFAULT_LOCK_TTL_MS, 30_000)
}

function heartbeatMs(): number {
  return Math.min(
    positiveInteger(process.env.OPTIMIZE_JOB_HEARTBEAT_MS, DEFAULT_HEARTBEAT_MS, 1_000),
    Math.max(1_000, Math.floor(lockTtlMs() / 3)),
  )
}

function shutdownGraceMs(): number {
  return positiveInteger(process.env.OPTIMIZE_SHUTDOWN_GRACE_MS, DEFAULT_SHUTDOWN_GRACE_MS, 1_000)
}

function progressFlushTimeoutMs(): number {
  return Math.min(5_000, Math.max(250, Math.floor(heartbeatMs() / 3)))
}

function positiveInteger(value: string | undefined, fallback: number, minimum: number): number {
  const configured = Number(value ?? fallback)
  return Number.isFinite(configured) ? Math.max(minimum, Math.floor(configured)) : fallback
}

function lockExpiresAt(): string {
  return new Date(Date.now() + lockTtlMs()).toISOString()
}

function optimizeJobTimeoutMessage(): string {
  return `任务计算超过${formatOptimizeJobHardTimeout()}上限，请重试。`
}

function workerEntryUrl(): URL {
  const configured = process.env.OPTIMIZE_WORKER_ENTRY_FOR_TESTING?.trim()
  if (configured && process.env.NODE_ENV !== 'production') return pathToFileURL(resolve(configured))
  const entryPath = process.argv[1] ? resolve(process.argv[1]) : resolve('server/dist/index.js')
  return pathToFileURL(resolve(dirname(entryPath), 'optimize-worker.js'))
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => {
    const timer = setTimeout(resolveDelay, ms)
    timer.unref?.()
  })
}

async function waitUntil(promise: Promise<unknown>, deadlineAt: number): Promise<boolean> {
  const remainingMs = deadlineAt - Date.now()
  if (remainingMs <= 0) return false
  return Promise.race([
    promise.then(() => true, () => true),
    delay(remainingMs).then(() => false),
  ])
}

function claimNext(store: OptimizeJobStore, lockToken: string): Promise<OptimizeJobRecord | null> {
  const expiresAt = lockExpiresAt()
  return store.claimNextJob(processWorkerId, lockToken, expiresAt, getOptimizeJobMaxAttempts(), getOptimizeGlobalWorkerConcurrency(), getOptimizeWorkerClaimPriority())
}

function heartbeatAttempt(store: OptimizeJobStore, attempt: ActiveAttempt, expiresAt: string): Promise<boolean> {
  return store.heartbeatAttempt(
    attempt.job.id,
    attempt.job.attempt_count,
    processWorkerId,
    attempt.lockToken,
    expiresAt,
  )
}

async function updateAttemptStage(
  store: OptimizeJobStore,
  job: OptimizeJobRecord,
  lockToken: string,
  stage: OptimizeCalculationStage,
): Promise<boolean> {
  return store.updateAttemptStage(job.id, job.attempt_count, processWorkerId, lockToken, stage)
}

async function completeAttempt(store: OptimizeJobStore, job: OptimizeJobRecord, lockToken: string, result: unknown): Promise<boolean> {
  const completed = await store.completeAttempt(job.id, job.attempt_count, processWorkerId, lockToken, result)
  if (completed) {
    await processPendingOptimizationJobEffects(job.id).catch((error) => {
      console.warn('optimization job completion effects remain pending:', describeServerError(error))
    })
  }
  return completed
}

function failAttempt(
  store: OptimizeJobStore,
  job: OptimizeJobRecord,
  lockToken: string,
  failure: Parameters<OptimizeJobStore['failAttempt']>[4],
): Promise<boolean> {
  return store.failAttempt(job.id, job.attempt_count, processWorkerId, lockToken, failure)
}

function settleOptimizerFailure(
  store: OptimizeJobStore,
  job: OptimizeJobRecord,
  lockToken: string,
  failure: OptimizerFailure,
): Promise<boolean | OptimizeJobStatus | null> {
  if (failure.kind === 'transient' && failure.retryable) {
    return retryAttempt(
      store,
      job.id,
      job.attempt_count,
      processWorkerId,
      lockToken,
      'transient_error',
      failure.internalMessage,
    )
  }
  return failAttempt(store, job, lockToken, {
    code: failure.code,
    publicMessage: failure.publicMessage,
    internalMessage: failure.internalMessage,
    failureKind: failure.kind === 'validation' ? 'validation_error' : 'application_error',
  })
}

async function retryAttempt(
  store: OptimizeJobStore,
  id: string,
  attemptNo: number,
  workerId: string,
  lockToken: string,
  failureKind: OptimizeJobFailureKind,
  errorMessage: string,
): Promise<OptimizeJobStatus | null> {
  const maxAttempts = failureKind === 'timed_out' ? 1 : getOptimizeJobMaxAttempts()
  return store.retryFailedAttempt(id, attemptNo, workerId, lockToken, failureKind, errorMessage, maxAttempts)
}

function releaseInterrupted(store: OptimizeJobStore, job: OptimizeJobRecord, lockToken: string): Promise<boolean> {
  return store.releaseInterruptedAttempt(job.id, job.attempt_count, processWorkerId, lockToken)
}

registerOptimizeJobSignalHandlers({
  onProcessingRequested: handleOptimizeJobProcessingRequest,
  onCancellationRequested: handleOptimizeJobCancellationRequest,
})
