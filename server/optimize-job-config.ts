export const DEFAULT_OPTIMIZE_GLOBAL_WORKER_CONCURRENCY = 3
export const DEFAULT_OPTIMIZE_WORKER_CONCURRENCY = 1
export const MAX_OPTIMIZE_GLOBAL_WORKER_CONCURRENCY = 100
export const MAX_OPTIMIZE_WORKER_CONCURRENCY = 32
const MAX_OPTIMIZE_JOB_HARD_TIMEOUT_MS = 10 * 60_000
export const DEFAULT_OPTIMIZE_JOB_HARD_TIMEOUT_MS = MAX_OPTIMIZE_JOB_HARD_TIMEOUT_MS
export const DEFAULT_OPTIMIZE_JOB_MAX_ATTEMPTS = 2
export const MAX_OPTIMIZE_JOB_ATTEMPTS = 10

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
  const localConcurrency = getOptimizeWorkerConcurrency(environment)
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
