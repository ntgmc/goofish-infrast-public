import type { ScenarioComparisonResult } from '../../../src/lib/scenario-comparison'
import type { OptimizeResult, ReorderCheckResult } from '../../../src/lib/types'
import type { OptimizeJobRecord } from '../../storage/optimize-job-store'
import {
  requireRegisteredOptimizerPort,
  type OptimizeExecutionContext,
  type OptimizerPort,
} from './optimizer-port'
import {
  normalizePersistedOptimizationJobPayload,
  type OptimizationJobPayload,
} from './shared'

export type OptimizationJobExecutionResult = OptimizeResult | ScenarioComparisonResult | ReorderCheckResult

export async function executeOptimizationJobWithPort(
  job: OptimizeJobRecord,
  context: OptimizeExecutionContext,
  port: OptimizerPort,
): Promise<OptimizationJobExecutionResult> {
  const payload = normalizePersistedOptimizationJobPayload(job.payload_json)
  return dispatchOptimizationJobPayload(payload, context, port)
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
