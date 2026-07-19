const OPTIMIZE_POLL_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 10_000] as const

export function isRetryableOptimizePollStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

export function getOptimizePollRetryDelayMs(failureCount: number, random = Math.random): number {
  const index = Math.max(0, Math.min(OPTIMIZE_POLL_RETRY_DELAYS_MS.length - 1, failureCount - 1))
  const baseDelay = OPTIMIZE_POLL_RETRY_DELAYS_MS[index]
  return Math.round(baseDelay * (0.8 + Math.max(0, Math.min(1, random())) * 0.4))
}
