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
const OPTIMIZER_FAILURE_PROTOCOL_VERSION = 1 as const

type OptimizerFailureKind = 'validation' | 'permanent' | 'transient'

export interface OptimizerFailure {
  protocolVersion: typeof OPTIMIZER_FAILURE_PROTOCOL_VERSION
  code: string
  kind: OptimizerFailureKind
  retryable: boolean
  publicMessage: string
  internalMessage: string
}

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

export class OptimizerExecutionError extends Error {
  readonly failure: OptimizerFailure

  constructor(input: Omit<OptimizerFailure, 'protocolVersion'>) {
    super(input.internalMessage)
    this.name = 'OptimizerExecutionError'
    this.failure = normalizeOptimizerFailure(input)
  }
}

export function toOptimizerFailure(error: unknown): OptimizerFailure {
  if (error instanceof OptimizerExecutionError) return error.failure
  const internalMessage = error instanceof Error ? error.message : String(error)
  return normalizeOptimizerFailure({
    code: 'optimizer_transient_error',
    kind: 'transient',
    retryable: true,
    publicMessage: '优化服务暂时不可用，系统将自动重试。',
    internalMessage,
  })
}

function normalizeOptimizerFailure(input: Omit<OptimizerFailure, 'protocolVersion'>): OptimizerFailure {
  const code = /^[a-z][a-z0-9_]{0,63}$/.test(input.code) ? input.code : 'optimizer_error'
  const kind = input.kind === 'validation' || input.kind === 'permanent' || input.kind === 'transient'
    ? input.kind
    : 'permanent'
  return {
    protocolVersion: OPTIMIZER_FAILURE_PROTOCOL_VERSION,
    code,
    kind,
    retryable: kind === 'transient' && input.retryable === true,
    publicMessage: truncateMessage(input.publicMessage || '优化任务失败，请检查输入后重试。', 300),
    internalMessage: truncateMessage(input.internalMessage || code, 4_000),
  }
}

function truncateMessage(value: string, maximum: number): string {
  const normalized = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ').trim()
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, maximum - 1)}…`
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
