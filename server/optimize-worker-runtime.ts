import { parentPort, workerData, type MessagePort } from 'node:worker_threads'
import type { OptimizeCalculationStage } from '../src/lib/types'
import {
  assertCompatibleOptimizerPort,
  toOptimizerFailure,
  type OptimizeExecutionContext,
  type OptimizerPort,
} from './optimization/jobs/optimizer-port'
import type { OptimizerFailure } from './optimization/jobs/optimizer-port'
import { executeOptimizationJobWithPort } from './optimization/jobs/optimizer-dispatcher'
import { closePool } from './storage/postgres'
import type { OptimizeJobRecord } from './storage/optimize-job-store'

export type OptimizeWorkerData = {
  job: OptimizeJobRecord
  context: OptimizeExecutionContext
}

type OptimizeWorkerResultMessage =
  | { type: 'succeeded'; result: unknown }
  | { type: 'failed'; failure: OptimizerFailure }
  | { type: 'progress'; stage: OptimizeCalculationStage }

type OptimizeWorkerRuntimeOptions = {
  optimizerPort: OptimizerPort
  data?: OptimizeWorkerData
  messagePort?: Pick<MessagePort, 'postMessage'> | null
  closeDatabase?: () => Promise<void>
}

export async function runOptimizeWorkerThread(options: OptimizeWorkerRuntimeOptions): Promise<void> {
  assertCompatibleOptimizerPort(options.optimizerPort)
  const data = options.data ?? workerData as OptimizeWorkerData
  const messagePort = options.messagePort === undefined ? parentPort : options.messagePort
  const closeDatabase = options.closeDatabase ?? closePool
  const context: OptimizeExecutionContext = {
    ...data.context,
    reportStage: (stage) => messagePort?.postMessage({ type: 'progress', stage }),
  }

  let message: Exclude<OptimizeWorkerResultMessage, { type: 'progress' }>
  try {
    const result = await executeOptimizationJobWithPort(data.job, context, options.optimizerPort)
    message = { type: 'succeeded', result }
  } catch (error) {
    message = {
      type: 'failed',
      failure: toOptimizerFailure(error),
    }
  }

  try {
    await closeDatabase()
  } catch (error) {
    console.warn('optimize worker pool close skipped:', error)
  }
  messagePort?.postMessage(message)
}
