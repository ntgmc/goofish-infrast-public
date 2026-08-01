export const DEFAULT_OPTIMIZE_GLOBAL_WORKER_CONCURRENCY = 3
const MAX_OPTIMIZE_JOB_HARD_TIMEOUT_MS = 10 * 60_000
export const DEFAULT_OPTIMIZE_JOB_HARD_TIMEOUT_MS = MAX_OPTIMIZE_JOB_HARD_TIMEOUT_MS
export const DEFAULT_OPTIMIZE_JOB_MAX_ATTEMPTS = 2
export const MAX_OPTIMIZE_JOB_ATTEMPTS = 10

export function getOptimizeGlobalWorkerConcurrency(): number {
  const configured = Number(process.env.OPTIMIZE_GLOBAL_WORKER_CONCURRENCY ?? DEFAULT_OPTIMIZE_GLOBAL_WORKER_CONCURRENCY)
  return Number.isFinite(configured)
    ? Math.max(1, Math.floor(configured))
    : DEFAULT_OPTIMIZE_GLOBAL_WORKER_CONCURRENCY
}

export function getOptimizeJobHardTimeoutMs(): number {
  const minimum = process.env.NODE_ENV === 'production' ? 30_000 : 10
  const configured = Number(process.env.OPTIMIZE_JOB_HARD_TIMEOUT_MS ?? DEFAULT_OPTIMIZE_JOB_HARD_TIMEOUT_MS)
  return Number.isFinite(configured)
    ? Math.min(MAX_OPTIMIZE_JOB_HARD_TIMEOUT_MS, Math.max(minimum, Math.floor(configured)))
    : DEFAULT_OPTIMIZE_JOB_HARD_TIMEOUT_MS
}

export function getOptimizeJobMaxAttempts(): number {
  const configured = Number(process.env.OPTIMIZE_JOB_MAX_ATTEMPTS ?? DEFAULT_OPTIMIZE_JOB_MAX_ATTEMPTS)
  return Number.isFinite(configured)
    ? Math.min(MAX_OPTIMIZE_JOB_ATTEMPTS, Math.max(1, Math.floor(configured)))
    : DEFAULT_OPTIMIZE_JOB_MAX_ATTEMPTS
}

export function formatOptimizeJobHardTimeout(): string {
  const timeoutMs = getOptimizeJobHardTimeoutMs()
  if (timeoutMs % 60_000 === 0) return `${timeoutMs / 60_000} 分钟`
  return `${Math.ceil(timeoutMs / 1_000)} 秒`
}
