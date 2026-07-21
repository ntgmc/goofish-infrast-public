export const DEFAULT_OPTIMIZE_GLOBAL_WORKER_CONCURRENCY = 3

export function getOptimizeGlobalWorkerConcurrency(): number {
  const configured = Number(process.env.OPTIMIZE_GLOBAL_WORKER_CONCURRENCY ?? DEFAULT_OPTIMIZE_GLOBAL_WORKER_CONCURRENCY)
  return Number.isFinite(configured)
    ? Math.max(1, Math.floor(configured))
    : DEFAULT_OPTIMIZE_GLOBAL_WORKER_CONCURRENCY
}
