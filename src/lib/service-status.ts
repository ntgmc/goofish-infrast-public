export const QUEUE_CONGESTION_THRESHOLD = 5
export const QUEUE_OVERLOAD_THRESHOLD = 20
const SERVICE_STATUS_HISTORY_DAYS = 30
export const SERVICE_STATUS_HISTORY_HOURS = SERVICE_STATUS_HISTORY_DAYS * 24
const SERVICE_STATUS_HISTORY_INTERVAL = 'hour' as const

export const SERVICE_STATUS_LEVELS = ['available', 'busy', 'congested', 'overloaded', 'unavailable'] as const
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

const SERVICE_STATUS_COST_TIMEZONE = 'Asia/Shanghai' as const
type ServiceStatusCostBillingModel = 'ecs_payg'

export interface ServiceStatusCostScheduleWindow {
  start: string
  end: string
  worker_instances: number
}

export interface ServiceStatusCostConfig {
  component_id: ServiceStatusComponentId
  billing_model: ServiceStatusCostBillingModel
  currency: 'CNY'
  hourly_price_cny: number | null
  timezone: typeof SERVICE_STATUS_COST_TIMEZONE
  schedule_enabled: boolean
  valley_worker_instances: number
  peak_windows: ServiceStatusCostScheduleWindow[]
  updated_at: string | null
}

export interface ServiceStatusCostEstimate {
  observed_24h_worker_hours: number | null
  observed_30d_worker_hours: number | null
  observed_24h_sample_hours: number
  observed_30d_sample_hours: number
  observed_24h_cost_cny: number | null
  observed_30d_cost_cny: number | null
  projected_monthly_cost_cny: number | null
  observed_savings_cny: number | null
  planned_daily_worker_hours: number
  planned_monthly_worker_hours: number
  estimated_daily_cost_cny: number | null
  estimated_monthly_cost_cny: number | null
}

export interface ServiceStatusCostRecommendation {
  generated_at: string
  source_sample_count: number
  confidence: 'none' | 'limited' | 'observed'
  valley_worker_instances: number
  peak_windows: ServiceStatusCostScheduleWindow[]
  hourly_worker_instances: number[]
  rationale: string[]
}

interface ServiceStatusQueueSnapshot {
  queued: number
  running: number
  queue_limit: number
  worker_concurrency: number
  worker_instances: number
  billable_worker_instances?: number
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
    queue_overloaded_at: number
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
  overloaded_samples: number
  average_active_concurrency: number | null
  average_provisioned_concurrency: number | null
  average_worker_instances: number | null
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
  cost: {
    config: ServiceStatusCostConfig
    estimate: ServiceStatusCostEstimate
    recommendation: ServiceStatusCostRecommendation
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
  overloadedSamples: number
  runningSum: number
  provisionedSum: number
  utilizationSum: number
  workerInstancesSum: number
  peakQueued: number
  peakRunning: number
  peakWorkerInstances: number
  lastSampleAt: string
}

export function resolveOptimizationServiceStatus(input: OptimizationServiceStatusInput): ServiceStatusLevel {
  if (!input.serviceReady || input.workerInstances <= 0 || input.workerConcurrency <= 0) return 'unavailable'
  if (input.queued === 0 && input.running < input.workerConcurrency) return 'available'
  if (input.queued < QUEUE_CONGESTION_THRESHOLD) return 'busy'
  if (input.queued > QUEUE_OVERLOAD_THRESHOLD) return 'overloaded'
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
      overloadedSamples: sample.status === 'overloaded' ? 1 : 0,
      unavailableSamples: sample.status === 'unavailable' ? 1 : 0,
      runningSum: sample.running,
      provisionedSum: sample.workerConcurrency,
      utilizationSum: sample.workerConcurrency > 0 ? Math.min(100, (sample.running / sample.workerConcurrency) * 100) : 0,
      workerInstancesSum: Math.max(0, sample.workerInstances),
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
    overloadedSamples: current.overloadedSamples + (sample.status === 'overloaded' ? 1 : 0),
    runningSum: current.runningSum + sample.running,
    provisionedSum: current.provisionedSum + sample.workerConcurrency,
    utilizationSum: current.utilizationSum + (sample.workerConcurrency > 0 ? Math.min(100, (sample.running / sample.workerConcurrency) * 100) : 0),
    workerInstancesSum: current.workerInstancesSum + Math.max(0, sample.workerInstances),
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
    average_worker_instances: aggregate.sampleCount > 0
      ? Math.round((aggregate.workerInstancesSum / aggregate.sampleCount) * 100) / 100
      : null,
    peak_queued: aggregate.peakQueued,
    peak_running: aggregate.peakRunning,
    peak_worker_instances: aggregate.peakWorkerInstances,
    unavailable_samples: aggregate.unavailableSamples,
    busy_samples: aggregate.busySamples,
    congested_samples: aggregate.congestedSamples,
    overloaded_samples: aggregate.overloadedSamples,
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

export function createDefaultServiceStatusCostConfig(
  componentId: ServiceStatusComponentId = SERVICE_STATUS_COMPONENT_IDS[0],
): ServiceStatusCostConfig {
  return {
    component_id: componentId,
    billing_model: 'ecs_payg',
    currency: 'CNY',
    hourly_price_cny: null,
    timezone: SERVICE_STATUS_COST_TIMEZONE,
    schedule_enabled: false,
    valley_worker_instances: 0,
    peak_windows: [],
    updated_at: null,
  }
}

export function normalizeServiceStatusCostConfig(
  value: Partial<ServiceStatusCostConfig> | null | undefined,
  componentId: ServiceStatusComponentId = SERVICE_STATUS_COMPONENT_IDS[0],
): ServiceStatusCostConfig {
  const fallback = createDefaultServiceStatusCostConfig(componentId)
  const windows = Array.isArray(value?.peak_windows)
    ? value.peak_windows
      .filter((window): window is ServiceStatusCostScheduleWindow => Boolean(window && typeof window === 'object'))
      .map((window) => ({
        start: typeof window.start === 'string' ? window.start : '09:00',
        end: typeof window.end === 'string' ? window.end : '22:00',
        worker_instances: Number.isFinite(Number(window.worker_instances)) ? Math.max(0, Math.floor(Number(window.worker_instances))) : 0,
      }))
      .slice(0, 24)
    : fallback.peak_windows
  const price = value?.hourly_price_cny
  return {
    component_id: componentId,
    billing_model: 'ecs_payg',
    currency: 'CNY',
    hourly_price_cny: price === null || price === undefined || !Number.isFinite(Number(price)) ? null : Math.max(0, Number(price)),
    timezone: SERVICE_STATUS_COST_TIMEZONE,
    schedule_enabled: value?.schedule_enabled === true,
    valley_worker_instances: Number.isFinite(Number(value?.valley_worker_instances)) ? Math.max(0, Math.floor(Number(value?.valley_worker_instances))) : fallback.valley_worker_instances,
    peak_windows: windows,
    updated_at: typeof value?.updated_at === 'string' ? value.updated_at : null,
  }
}
