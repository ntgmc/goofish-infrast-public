import { resolveAppRole } from './process-role'

export const DEFAULT_OPTIMIZE_GLOBAL_WORKER_CONCURRENCY = 3
export const DEFAULT_OPTIMIZE_WORKER_CONCURRENCY = 1
export const DEFAULT_OPTIMIZE_LOCAL_FALLBACK_CONCURRENCY = 1
export const DEFAULT_OPTIMIZE_QUEUE_POLL_MS = 1_000
const OPTIMIZE_STATUS_QUEUE_PICKUP_GRACE_POLLS = 5
export const MAX_OPTIMIZE_GLOBAL_WORKER_CONCURRENCY = 100
export const MAX_OPTIMIZE_WORKER_CONCURRENCY = 32
export const DEFAULT_OPTIMIZE_WORKER_SCALE_UP_QUEUE_THRESHOLD = 4
export const DEFAULT_OPTIMIZE_WORKER_SCALE_DOWN_QUEUE_THRESHOLD = 1
export const DEFAULT_OPTIMIZE_WORKER_SCALE_DOWN_IDLE_MS = 10 * 60_000
export const DEFAULT_OPTIMIZE_WORKER_AUTOSCALE_INTERVAL_MS = 30_000
const MAX_OPTIMIZE_WORKER_SCALE_UP_QUEUE_THRESHOLD = 1_000
const MAX_OPTIMIZE_WORKER_SCALE_DOWN_IDLE_MS = 24 * 60 * 60_000
const MAX_OPTIMIZE_WORKER_AUTOSCALE_INTERVAL_MS = 10 * 60_000
const MAX_OPTIMIZE_JOB_HARD_TIMEOUT_MS = 20 * 60_000
export const DEFAULT_OPTIMIZE_JOB_HARD_TIMEOUT_MS = MAX_OPTIMIZE_JOB_HARD_TIMEOUT_MS
export const DEFAULT_OPTIMIZE_JOB_MAX_ATTEMPTS = 2
export const MAX_OPTIMIZE_JOB_ATTEMPTS = 10
export const DEFAULT_OPTIMIZE_WORKER_CLAIM_PRIORITY = 0
export const MAX_OPTIMIZE_WORKER_CLAIM_PRIORITY = 1_000
export const DEFAULT_OPTIMIZE_WORKER_MAX_OLD_SPACE_MB = 0
export const MAX_OPTIMIZE_WORKER_MAX_OLD_SPACE_MB = 16_384

export function getOptimizeGlobalWorkerConcurrency(
  environment: Pick<NodeJS.ProcessEnv, 'OPTIMIZE_GLOBAL_WORKER_CONCURRENCY'> = process.env,
): number {
  return resolveInteger(
    'OPTIMIZE_GLOBAL_WORKER_CONCURRENCY',
    environment.OPTIMIZE_GLOBAL_WORKER_CONCURRENCY,
    DEFAULT_OPTIMIZE_GLOBAL_WORKER_CONCURRENCY,
    1,
    MAX_OPTIMIZE_GLOBAL_WORKER_CONCURRENCY,
  )
}

export function getOptimizeWorkerConcurrency(
  environment: Pick<NodeJS.ProcessEnv, 'OPTIMIZE_WORKER_CONCURRENCY'> = process.env,
): number {
  return resolveInteger(
    'OPTIMIZE_WORKER_CONCURRENCY',
    environment.OPTIMIZE_WORKER_CONCURRENCY,
    DEFAULT_OPTIMIZE_WORKER_CONCURRENCY,
    1,
    MAX_OPTIMIZE_WORKER_CONCURRENCY,
  )
}

export function getOptimizeQueuePollMs(
  environment: Pick<NodeJS.ProcessEnv, 'OPTIMIZE_QUEUE_POLL_MS'> = process.env,
): number {
  const configured = Number(environment.OPTIMIZE_QUEUE_POLL_MS ?? DEFAULT_OPTIMIZE_QUEUE_POLL_MS)
  return Number.isFinite(configured)
    ? Math.max(250, Math.floor(configured))
    : DEFAULT_OPTIMIZE_QUEUE_POLL_MS
}

export function getOptimizeStatusQueuePickupGraceMs(
  environment: Pick<NodeJS.ProcessEnv, 'OPTIMIZE_QUEUE_POLL_MS'> = process.env,
): number {
  return getOptimizeQueuePollMs(environment) * OPTIMIZE_STATUS_QUEUE_PICKUP_GRACE_POLLS
}

export function getOptimizeWorkerClaimPriority(
  environment: Pick<NodeJS.ProcessEnv, 'OPTIMIZE_WORKER_CLAIM_PRIORITY'> = process.env,
): number {
  return resolveInteger(
    'OPTIMIZE_WORKER_CLAIM_PRIORITY',
    environment.OPTIMIZE_WORKER_CLAIM_PRIORITY,
    DEFAULT_OPTIMIZE_WORKER_CLAIM_PRIORITY,
    0,
    MAX_OPTIMIZE_WORKER_CLAIM_PRIORITY,
  )
}

export function getOptimizeWorkerMaxOldSpaceMb(
  environment: Pick<NodeJS.ProcessEnv, 'OPTIMIZE_WORKER_MAX_OLD_SPACE_MB'> = process.env,
): number {
  return resolveInteger(
    'OPTIMIZE_WORKER_MAX_OLD_SPACE_MB',
    environment.OPTIMIZE_WORKER_MAX_OLD_SPACE_MB,
    DEFAULT_OPTIMIZE_WORKER_MAX_OLD_SPACE_MB,
    0,
    MAX_OPTIMIZE_WORKER_MAX_OLD_SPACE_MB,
  )
}

/**
 * The combined service process deliberately has one local execution slot. A
 * stopped remote ECS worker therefore does not leave the queue without a
 * consumer, while the public API process remains queue-only.
 */
export function getOptimizeLocalFallbackConcurrency(): number {
  return DEFAULT_OPTIMIZE_LOCAL_FALLBACK_CONCURRENCY
}

export function getOptimizeWorkerRuntimeConcurrency(
  environment: NodeJS.ProcessEnv = process.env,
): number {
  if (resolveAppRole(environment) === 'all' && getOptimizeWorkerAutoscalingConfiguration(environment).enabled) {
    return getOptimizeLocalFallbackConcurrency()
  }
  return getOptimizeWorkerConcurrency(environment)
}

export type OptimizeWorkerAutoscalingConfiguration = {
  enabled: boolean
  scaleUpQueueThreshold: number
  scaleDownQueueThreshold: number
  scaleDownIdleMs: number
  intervalMs: number
}

export function getOptimizeWorkerAutoscalingConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): OptimizeWorkerAutoscalingConfiguration {
  const scaleUpQueueThreshold = resolveInteger(
    'OPTIMIZE_WORKER_SCALE_UP_QUEUE_THRESHOLD',
    firstConfigured(environment.OPTIMIZE_WORKER_SCALE_UP_QUEUE_THRESHOLD, environment.OPTIMIZE_QUEUE_SCALE_UP_THRESHOLD),
    DEFAULT_OPTIMIZE_WORKER_SCALE_UP_QUEUE_THRESHOLD,
    1,
    MAX_OPTIMIZE_WORKER_SCALE_UP_QUEUE_THRESHOLD,
  )
  const scaleDownQueueThreshold = resolveInteger(
    'OPTIMIZE_WORKER_SCALE_DOWN_QUEUE_THRESHOLD',
    firstConfigured(environment.OPTIMIZE_WORKER_SCALE_DOWN_QUEUE_THRESHOLD, environment.OPTIMIZE_QUEUE_SCALE_DOWN_THRESHOLD),
    DEFAULT_OPTIMIZE_WORKER_SCALE_DOWN_QUEUE_THRESHOLD,
    0,
    MAX_OPTIMIZE_WORKER_SCALE_UP_QUEUE_THRESHOLD,
  )
  if (scaleDownQueueThreshold > scaleUpQueueThreshold) {
    throw new Error('OPTIMIZE_WORKER_SCALE_DOWN_QUEUE_THRESHOLD must not exceed the scale-up threshold')
  }
  return {
    enabled: resolveBoolean(
      firstConfigured(environment.OPTIMIZE_WORKER_AUTOSCALING_ENABLED, environment.ALIYUN_ECS_WORKER_AUTOSCALING_ENABLED),
      false,
    ),
    scaleUpQueueThreshold,
    scaleDownQueueThreshold,
    scaleDownIdleMs: resolveInteger(
      'OPTIMIZE_WORKER_SCALE_DOWN_IDLE_MS',
      environment.OPTIMIZE_WORKER_SCALE_DOWN_IDLE_MS,
      DEFAULT_OPTIMIZE_WORKER_SCALE_DOWN_IDLE_MS,
      1,
      MAX_OPTIMIZE_WORKER_SCALE_DOWN_IDLE_MS,
    ),
    intervalMs: resolveInteger(
      'OPTIMIZE_WORKER_AUTOSCALE_INTERVAL_MS',
      environment.OPTIMIZE_WORKER_AUTOSCALE_INTERVAL_MS,
      DEFAULT_OPTIMIZE_WORKER_AUTOSCALE_INTERVAL_MS,
      1_000,
      MAX_OPTIMIZE_WORKER_AUTOSCALE_INTERVAL_MS,
    ),
  }
}

export function getOptimizeJobHardTimeoutMs(): number {
  const minimum = process.env.NODE_ENV === 'production' ? 30_000 : 10
  const configured = Number(process.env.OPTIMIZE_JOB_HARD_TIMEOUT_MS ?? DEFAULT_OPTIMIZE_JOB_HARD_TIMEOUT_MS)
  return Number.isFinite(configured)
    ? Math.min(MAX_OPTIMIZE_JOB_HARD_TIMEOUT_MS, Math.max(minimum, Math.floor(configured)))
    : DEFAULT_OPTIMIZE_JOB_HARD_TIMEOUT_MS
}

export function getOptimizeJobMaxAttempts(
  environment: Pick<NodeJS.ProcessEnv, 'OPTIMIZE_JOB_MAX_ATTEMPTS'> = process.env,
): number {
  return resolveInteger(
    'OPTIMIZE_JOB_MAX_ATTEMPTS',
    environment.OPTIMIZE_JOB_MAX_ATTEMPTS,
    DEFAULT_OPTIMIZE_JOB_MAX_ATTEMPTS,
    1,
    MAX_OPTIMIZE_JOB_ATTEMPTS,
  )
}

export function getOptimizeWorkerConfiguration(environment: NodeJS.ProcessEnv = process.env): {
  localConcurrency: number
  globalConcurrency: number
  maxAttempts: number
} {
  const localConcurrency = getOptimizeWorkerRuntimeConcurrency(environment)
  const globalConcurrency = getOptimizeGlobalWorkerConcurrency(environment)
  if (localConcurrency > globalConcurrency) {
    throw new Error('OPTIMIZE_WORKER_CONCURRENCY must not exceed OPTIMIZE_GLOBAL_WORKER_CONCURRENCY')
  }
  return {
    localConcurrency,
    globalConcurrency,
    maxAttempts: getOptimizeJobMaxAttempts(environment),
  }
}

export function formatOptimizeJobHardTimeout(): string {
  const timeoutMs = getOptimizeJobHardTimeoutMs()
  if (timeoutMs % 60_000 === 0) return `${timeoutMs / 60_000} 分钟`
  return `${Math.ceil(timeoutMs / 1_000)} 秒`
}

function resolveInteger(
  name: string,
  rawValue: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const trimmed = rawValue?.trim()
  if (!trimmed) return fallback
  const configured = Number(trimmed)
  if (!Number.isSafeInteger(configured) || configured < minimum || configured > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  return configured
}

function resolveBoolean(rawValue: string | undefined, fallback: boolean): boolean {
  const normalized = rawValue?.trim().toLowerCase()
  if (!normalized) return fallback
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  throw new Error('OPTIMIZE_WORKER_AUTOSCALING_ENABLED must be true or false')
}

function firstConfigured(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value?.trim())
}
