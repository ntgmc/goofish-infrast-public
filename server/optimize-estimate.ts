export function isOptimizeEstimateOverdue(runningElapsedMs: number, estimatedDurationMs: number): boolean {
  return runningElapsedMs >= estimatedDurationMs
}