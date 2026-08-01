import type { ScenarioComparisonResult } from '../../../src/lib/scenario-comparison'
import type { OptimizeResult, ReorderCheckResult } from '../../../src/lib/types'
import type { OptimizeJobRecord } from '../../storage/optimize-job-store'
import {
  requireRegisteredOptimizerPort,
  OptimizerExecutionError,
  type OptimizeExecutionContext,
  type OptimizerPort,
} from './optimizer-port'
import {
  normalizePersistedOptimizationJobPayload,
  type OptimizationJobPayload,
} from './shared'
import { parseOptimizationJobResult } from './runtime-contracts'

export type OptimizationJobExecutionResult = OptimizeResult | ScenarioComparisonResult | ReorderCheckResult

export async function executeOptimizationJobWithPort(
  job: OptimizeJobRecord,
  context: OptimizeExecutionContext,
  port: OptimizerPort,
): Promise<OptimizationJobExecutionResult> {
  let payload: OptimizationJobPayload
  try {
    payload = normalizePersistedOptimizationJobPayload(job.payload_json)
  } catch (error) {
    throw new OptimizerExecutionError({
      code: 'invalid_job_payload',
      kind: 'validation',
      retryable: false,
      publicMessage: '任务数据版本无效，请重新提交任务。',
      internalMessage: error instanceof Error ? error.message : String(error),
    })
  }
  const result = await dispatchOptimizationJobPayload(payload, context, port)
  try {
    return parseOptimizationJobResult(payload, result)
  } catch (error) {
    throw new OptimizerExecutionError({
      code: 'invalid_optimizer_result',
      kind: 'validation',
      retryable: false,
      publicMessage: '优化器返回了无效结果，请联系支持并提供任务编号。',
      internalMessage: error instanceof Error ? error.message : String(error),
    })
  }
}

export async function executeRegisteredOptimizationJob(
  job: OptimizeJobRecord,
  context: OptimizeExecutionContext,
): Promise<OptimizationJobExecutionResult> {
  return executeOptimizationJobWithPort(job, context, requireRegisteredOptimizerPort())
}

function dispatchOptimizationJobPayload(
  payload: OptimizationJobPayload,
  context: OptimizeExecutionContext,
  port: OptimizerPort,
): Promise<OptimizationJobExecutionResult> {
  if (!('kind' in payload)) return port.executeSchedule(payload, context)
  switch (payload.kind) {
    case 'scenario_comparison':
      return port.executeScenarioComparison(payload, context)
    case 'reorder_check':
      return port.executeReorderCheck(payload, context)
  }
}
