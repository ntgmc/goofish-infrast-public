export const QUEUE_CONGESTION_THRESHOLD = 5

export const SERVICE_STATUS_LEVELS = ['available', 'busy', 'congested', 'unavailable'] as const
export type ServiceStatusLevel = typeof SERVICE_STATUS_LEVELS[number]

export interface OptimizationServiceStatusInput {
  serviceReady: boolean
  queued: number
  running: number
  workerConcurrency: number
  workerInstances: number
}

export interface OptimizationCostInputs {
  activeConcurrency: number
  provisionedConcurrency: number
  idleConcurrency: number
  utilizationPercent: number
}

interface ServiceStatusQueueSnapshot {
  queued: number
  running: number
  queue_limit: number
  worker_concurrency: number
  worker_instances: number
}

export interface ServiceStatusResponse {
  generated_at: string
  status: ServiceStatusLevel
  queue: ServiceStatusQueueSnapshot | null
  components: Array<{
    id: 'optimization'
    status: ServiceStatusLevel
  }>
  thresholds: {
    queue_congested_at: number
  }
}

export function resolveOptimizationServiceStatus(input: OptimizationServiceStatusInput): ServiceStatusLevel {
  if (!input.serviceReady || input.workerInstances <= 0 || input.workerConcurrency <= 0) return 'unavailable'
  if (input.queued === 0 && input.running < input.workerConcurrency) return 'available'
  if (input.queued < QUEUE_CONGESTION_THRESHOLD) return 'busy'
  return 'congested'
}

export function resolveOptimizationCostInputs(running: number, workerConcurrency: number): OptimizationCostInputs {
  const activeConcurrency = Math.max(0, Math.floor(running))
  const provisionedConcurrency = Math.max(0, Math.floor(workerConcurrency))
  const idleConcurrency = Math.max(0, provisionedConcurrency - activeConcurrency)
  const utilizationPercent = provisionedConcurrency > 0
    ? Math.min(100, Math.round((activeConcurrency / provisionedConcurrency) * 100))
    : 0
  return { activeConcurrency, provisionedConcurrency, idleConcurrency, utilizationPercent }
}
