import type { ScenarioComparisonResult } from '../../../src/lib/scenario-comparison'
import type {
  OptimizeCalculationStage,
  OptimizeResult,
  ReorderCheckResult,
} from '../../../src/lib/types'
import type {
  OptimizeJobPayload,
  ReorderCheckJobPayload,
  ScenarioComparisonJobPayload,
} from './shared'

export const OPTIMIZER_PORT_VERSION = 1 as const

export type OptimizeExecutionContext = {
  jobId: string
  attemptNo: number
  workerId: string
  lockToken: string
  deadlineAtMs: number
  reportStage?: (stage: OptimizeCalculationStage) => void | Promise<void>
}

export interface OptimizerPort {
  readonly version: typeof OPTIMIZER_PORT_VERSION
  executeSchedule(
    payload: OptimizeJobPayload,
    context: OptimizeExecutionContext,
  ): Promise<OptimizeResult>
  executeScenarioComparison(
    payload: ScenarioComparisonJobPayload,
    context: OptimizeExecutionContext,
  ): Promise<ScenarioComparisonResult>
  executeReorderCheck(
    payload: ReorderCheckJobPayload,
    context: OptimizeExecutionContext,
  ): Promise<ReorderCheckResult>
}

export class OptimizerPortNotRegisteredError extends Error {
  constructor() {
    super('OptimizerPort is not registered. The optimize worker cannot start without a private optimizer implementation.')
    this.name = 'OptimizerPortNotRegisteredError'
  }
}

export class OptimizerPortConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OptimizerPortConfigurationError'
  }
}

let registeredOptimizerPort: OptimizerPort | null = null

export function assertCompatibleOptimizerPort(value: unknown): asserts value is OptimizerPort {
  if (!value || typeof value !== 'object') {
    throw new OptimizerPortConfigurationError('OptimizerPort must be an object.')
  }
  const candidate = value as Partial<OptimizerPort> & { version?: unknown }
  if (candidate.version !== OPTIMIZER_PORT_VERSION) {
    throw new OptimizerPortConfigurationError(
      `Unsupported OptimizerPort version: ${String(candidate.version ?? 'missing')}. Expected ${OPTIMIZER_PORT_VERSION}.`,
    )
  }
  for (const method of ['executeSchedule', 'executeScenarioComparison', 'executeReorderCheck'] as const) {
    if (typeof candidate[method] !== 'function') {
      throw new OptimizerPortConfigurationError(`OptimizerPort.${method} must be a function.`)
    }
  }
}

export function registerOptimizerPort(port: OptimizerPort): () => void {
  assertCompatibleOptimizerPort(port)
  if (registeredOptimizerPort) {
    throw new OptimizerPortConfigurationError('An OptimizerPort implementation is already registered.')
  }
  registeredOptimizerPort = port
  let active = true
  return () => {
    if (!active) return
    active = false
    if (registeredOptimizerPort === port) registeredOptimizerPort = null
  }
}

export function getRegisteredOptimizerPort(): OptimizerPort | null {
  return registeredOptimizerPort
}

export function requireRegisteredOptimizerPort(): OptimizerPort {
  if (!registeredOptimizerPort) throw new OptimizerPortNotRegisteredError()
  return registeredOptimizerPort
}
