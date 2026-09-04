import { createHash } from 'node:crypto'
import type { ScenarioComparisonResult } from '../../../src/lib/scenario-comparison'
import type { OptimizeResult } from '../../../src/lib/types'
import { attachTrainingCostsToUpgradeSuggestions } from '../../handlers/training-cost'
import type { OptimizeJobRecord } from '../../storage/optimize-job-store'
import { getProfileById } from '../../storage/user-store'
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

export type OptimizationJobExecutionResult = OptimizeResult | ScenarioComparisonResult

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
  const dispatchedResult = await dispatchOptimizationJobPayload(payload, context, port)
  const result = await enrichScheduleTrainingCosts(payload, dispatchedResult, context)
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

async function enrichScheduleTrainingCosts(
  payload: OptimizationJobPayload,
  result: OptimizationJobExecutionResult,
  context: OptimizeExecutionContext,
): Promise<OptimizationJobExecutionResult> {
  if ('kind' in payload) return result
  const scheduleResult = result as OptimizeResult
  if (!scheduleResult.upgrade_suggestions) return scheduleResult
  const suggestions = scheduleResult.upgrade_suggestions.map((suggestion) => ({
    ...suggestion,
    suggestion_id: createSuggestionId(suggestion),
  }))
  const resultWithSuggestionIds = { ...scheduleResult, upgrade_suggestions: suggestions }
  if (!payload.request.include_upgrade_suggestions || !payload.request.upgrade_suggestions_allowed) {
    return resultWithSuggestionIds
  }
  if (suggestions.length === 0) return scheduleResult

  await context.reportStage?.('enriching_training_costs')
  const profile = payload.activeProfileId
    ? await getProfileById(payload.activeProfileId).catch(() => null)
    : null
  const enriched = await attachTrainingCostsToUpgradeSuggestions({
    suggestions,
    operators: payload.operators,
    encryptedCred: profile?.skland_binding?.encrypted_cred ?? null,
    uid: profile?.skland_binding?.uid ?? null,
  })
  return {
    ...resultWithSuggestionIds,
    upgrade_suggestions: enriched as typeof suggestions,
  }
}

function createSuggestionId(suggestion: NonNullable<OptimizeResult['upgrade_suggestions']>[number]): string {
  const identity = suggestion.type === 'single'
    ? {
      type: suggestion.type,
      id: suggestion.id ?? null,
      name: suggestion.name,
      current: suggestion.current,
      target: suggestion.target,
      specialType: suggestion.specialType ?? null,
    }
    : {
      type: suggestion.type,
      ops: suggestion.ops.map((operator) => ({
        id: operator.id ?? null,
        name: operator.name,
        current: operator.current ?? operator.current_elite ?? null,
        target: operator.target ?? operator.target_elite ?? null,
      })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
      specialType: suggestion.specialType ?? null,
    }
  return `upgrade-${createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 20)}`
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
  }
}
