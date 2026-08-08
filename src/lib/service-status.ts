export const QUEUE_CONGESTION_THRESHOLD = 5
const SERVICE_STATUS_HISTORY_DAYS = 30
export const SERVICE_STATUS_HISTORY_HOURS = SERVICE_STATUS_HISTORY_DAYS * 24
const SERVICE_STATUS_HISTORY_INTERVAL = 'hour' as const

export const SERVICE_STATUS_LEVELS = ['available', 'busy', 'congested', 'unavailable'] as const
export type ServiceStatusLevel = typeof SERVICE_STATUS_LEVELS[number]
const SERVICE_STATUS_HISTORY_LEVELS = [...SERVICE_STATUS_LEVELS, 'unknown'] as const
export type ServiceStatusHistoryLevel = typeof SERVICE_STATUS_HISTORY_LEVELS[number]
export const SERVICE_STATUS_COMPONENT_IDS = ['optimization'] as const
export type ServiceStatusComponentId = typeof SERVICE_STATUS_COMPONENT_IDS[number]

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
    id: ServiceStatusComponentId
    status: ServiceStatusLevel
  }>
  thresholds: {
    queue_congested_at: number
  }
  history: ServiceStatusHistoryResponse
  incidents: PublicStatusIncident[]
}

export interface ServiceStatusHistoryBucket {
  component_id: ServiceStatusComponentId
  bucket_start: string
  status: ServiceStatusHistoryLevel
  sample_count: number
  availability_percent: number | null
}

export interface AdminServiceStatusHistoryBucket extends ServiceStatusHistoryBucket {
  busy_samples: number
  congested_samples: number
  average_active_concurrency: number | null
  average_provisioned_concurrency: number | null
  average_utilization_percent: number | null
  peak_queued: number | null
  peak_running: number | null
  peak_worker_instances: number | null
  unavailable_samples: number
}

export interface ServiceStatusHistoryResponse {
  from: string
  to: string
  interval: typeof SERVICE_STATUS_HISTORY_INTERVAL
  complete: boolean
  buckets: ServiceStatusHistoryBucket[]
}

export type StatusIncidentImpact = 'minor' | 'major' | 'critical'
export type StatusIncidentState = 'investigating' | 'identified' | 'monitoring' | 'resolved'

export interface PublicStatusIncidentUpdate {
  id: string
  status: StatusIncidentState
  body: string
  created_at: string
}

export interface PublicStatusIncident {
  id: string
  component_id: ServiceStatusComponentId
  title: string
  impact: StatusIncidentImpact
  status: StatusIncidentState
  started_at: string
  resolved_at: string | null
  updated_at: string
  updates: PublicStatusIncidentUpdate[]
}

export interface AdminServiceStatusResponse extends ServiceStatusResponse {
  history: Omit<ServiceStatusHistoryResponse, 'buckets'> & {
    buckets: AdminServiceStatusHistoryBucket[]
  }
}

export interface ServiceStatusSample {
  componentId: ServiceStatusComponentId
  bucketStart: string
  status: ServiceStatusLevel
  queued: number
  running: number
  workerConcurrency: number
  workerInstances: number
  sampledAt: string
}

export interface ServiceStatusHistoryAggregate {
  componentId: ServiceStatusComponentId
  bucketStart: string
  status: ServiceStatusHistoryLevel
  sampleCount: number
  availableSamples: number
  unavailableSamples: number
  busySamples: number
  congestedSamples: number
  runningSum: number
  provisionedSum: number
  utilizationSum: number
  peakQueued: number
  peakRunning: number
  peakWorkerInstances: number
  lastSampleAt: string
}

export function resolveOptimizationServiceStatus(input: OptimizationServiceStatusInput): ServiceStatusLevel {
  if (!input.serviceReady || input.workerInstances <= 0 || input.workerConcurrency <= 0) return 'unavailable'
  if (input.queued === 0 && input.running < input.workerConcurrency) return 'available'
  if (input.queued < QUEUE_CONGESTION_THRESHOLD) return 'busy'
  return 'congested'
}

function statusSeverity(level: ServiceStatusHistoryLevel): number {
  return level === 'unknown' ? -1 : SERVICE_STATUS_LEVELS.indexOf(level)
}

export function mergeServiceStatusLevels(
  current: ServiceStatusHistoryLevel,
  next: ServiceStatusHistoryLevel,
): ServiceStatusHistoryLevel {
  return statusSeverity(next) > statusSeverity(current) ? next : current
}

export function floorStatusTimestampToHour(value: string | Date): string {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value)
  if (!Number.isFinite(timestamp)) throw new Error('Invalid status timestamp')
  const bucket = new Date(timestamp)
  bucket.setUTCMinutes(0, 0, 0)
  return bucket.toISOString()
}

export function createEmptyServiceStatusHistory(
  to = new Date(),
  hours = SERVICE_STATUS_HISTORY_HOURS,
): ServiceStatusHistoryResponse {
  const end = new Date(to)
  end.setUTCMinutes(0, 0, 0)
  const start = new Date(end.getTime() - Math.max(1, hours) * 60 * 60 * 1000)
  return {
    from: start.toISOString(),
    to: end.toISOString(),
    interval: SERVICE_STATUS_HISTORY_INTERVAL,
    complete: false,
    buckets: [],
  }
}

export function aggregateServiceStatusSample(
  current: ServiceStatusHistoryAggregate | null,
  sample: ServiceStatusSample,
): ServiceStatusHistoryAggregate {
  if (!current) {
    return {
      componentId: sample.componentId,
      bucketStart: sample.bucketStart,
      status: sample.status,
      sampleCount: 1,
      availableSamples: sample.status === 'available' ? 1 : 0,
      busySamples: sample.status === 'busy' ? 1 : 0,
      congestedSamples: sample.status === 'congested' ? 1 : 0,
      unavailableSamples: sample.status === 'unavailable' ? 1 : 0,
      runningSum: sample.running,
      provisionedSum: sample.workerConcurrency,
      utilizationSum: sample.workerConcurrency > 0 ? Math.min(100, (sample.running / sample.workerConcurrency) * 100) : 0,
      peakQueued: sample.queued,
      peakRunning: sample.running,
      peakWorkerInstances: sample.workerInstances,
      lastSampleAt: sample.sampledAt,
    }
  }
  const sampleCount = current.sampleCount + 1
  return {
    ...current,
    status: mergeServiceStatusLevels(current.status, sample.status),
    sampleCount,
    availableSamples: current.availableSamples + (sample.status === 'available' ? 1 : 0),
    unavailableSamples: current.unavailableSamples + (sample.status === 'unavailable' ? 1 : 0),
    busySamples: current.busySamples + (sample.status === 'busy' ? 1 : 0),
    congestedSamples: current.congestedSamples + (sample.status === 'congested' ? 1 : 0),
    runningSum: current.runningSum + sample.running,
    provisionedSum: current.provisionedSum + sample.workerConcurrency,
    utilizationSum: current.utilizationSum + (sample.workerConcurrency > 0 ? Math.min(100, (sample.running / sample.workerConcurrency) * 100) : 0),
    peakQueued: Math.max(current.peakQueued, sample.queued),
    peakRunning: Math.max(current.peakRunning, sample.running),
    peakWorkerInstances: Math.max(current.peakWorkerInstances, sample.workerInstances),
    lastSampleAt: sample.sampledAt,
  }
}

export function historyBucketFromAggregate(
  aggregate: ServiceStatusHistoryAggregate,
): AdminServiceStatusHistoryBucket {
  return {
    component_id: aggregate.componentId,
    bucket_start: aggregate.bucketStart,
    status: aggregate.status,
    sample_count: aggregate.sampleCount,
    availability_percent: aggregate.sampleCount > 0
      ? Math.round((aggregate.availableSamples / aggregate.sampleCount) * 10000) / 100
      : null,
    average_active_concurrency: aggregate.sampleCount > 0
      ? Math.round((aggregate.runningSum / aggregate.sampleCount) * 100) / 100
      : null,
    average_provisioned_concurrency: aggregate.sampleCount > 0
      ? Math.round((aggregate.provisionedSum / aggregate.sampleCount) * 100) / 100
      : null,
    average_utilization_percent: aggregate.sampleCount > 0
      ? Math.round((aggregate.utilizationSum / aggregate.sampleCount) * 100) / 100
      : null,
    peak_queued: aggregate.peakQueued,
    peak_running: aggregate.peakRunning,
    peak_worker_instances: aggregate.peakWorkerInstances,
    unavailable_samples: aggregate.unavailableSamples,
    busy_samples: aggregate.busySamples,
    congested_samples: aggregate.congestedSamples,
  }
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
