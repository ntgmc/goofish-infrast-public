export const OPTIMIZE_POLL_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 10_000] as const

export function isRetryableOptimizePollStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

export function getOptimizePollRetryDelayMs(failureCount: number): number {
  const index = Math.max(0, Math.min(OPTIMIZE_POLL_RETRY_DELAYS_MS.length - 1, failureCount - 1))
  return OPTIMIZE_POLL_RETRY_DELAYS_MS[index]
}