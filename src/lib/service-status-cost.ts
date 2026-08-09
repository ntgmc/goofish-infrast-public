import type {
  ServiceStatusCostConfig,
  ServiceStatusCostEstimate,
  ServiceStatusCostRecommendation,
  ServiceStatusCostScheduleWindow,
  AdminServiceStatusHistoryBucket,
} from './service-status'
import { copy } from '../copy'

const MINUTES_PER_DAY = 24 * 60
const HOURS_PER_MONTH = 30 * 24

export function calculatePlannedDailyWorkerHours(config: ServiceStatusCostConfig): number {
  const baseline = Math.max(0, config.valley_worker_instances)
  if (!config.schedule_enabled || config.peak_windows.length === 0) return roundHours(baseline * 24)
  let workerMinutes = 0
  for (let minute = 0; minute < MINUTES_PER_DAY; minute += 1) {
    workerMinutes += workersAtMinute(config.peak_windows, baseline, minute)
  }
  return roundHours(workerMinutes / 60)
}

export function calculateServiceStatusCostEstimate(
  config: ServiceStatusCostConfig,
  buckets: AdminServiceStatusHistoryBucket[],
): ServiceStatusCostEstimate {
  const plannedDaily = calculatePlannedDailyWorkerHours(config)
  const price = config.hourly_price_cny
  const observed24 = observedWorkerHours(buckets, 24)
  const observed30d = observedWorkerHours(buckets, HOURS_PER_MONTH)
  return {
    observed_24h_worker_hours: observed24,
    observed_30d_worker_hours: observed30d,
    planned_daily_worker_hours: plannedDaily,
    planned_monthly_worker_hours: roundHours(plannedDaily * 30),
    estimated_daily_cost_cny: price === null ? null : roundMoney(plannedDaily * price),
    estimated_monthly_cost_cny: price === null ? null : roundMoney(plannedDaily * 30 * price),
  }
}

export function recommendServiceStatusCostPlan(
  buckets: AdminServiceStatusHistoryBucket[],
  currentConfig: ServiceStatusCostConfig,
  generatedAt = new Date().toISOString(),
): ServiceStatusCostRecommendation {
  const hourly = Array.from({ length: 24 }, () => [] as AdminServiceStatusHistoryBucket[])
  for (const bucket of buckets) {
    if (bucket.sample_count <= 0 || bucket.average_worker_instances === null) continue
    const hour = projectHour(bucket.bucket_start)
    if (hour !== null) hourly[hour].push(bucket)
  }
  const hourlyWorkers = hourly.map((samples) => recommendWorkers(samples, currentConfig.valley_worker_instances))
  const sourceSampleCount = hourly.reduce((sum, samples) => sum + samples.reduce((inner, bucket) => inner + bucket.sample_count, 0), 0)
  const observedHours = hourly.filter((samples) => samples.length > 0).length
  const baseline = Math.max(0, currentConfig.valley_worker_instances)
  const observedValleyCandidates = hourly
    .filter((samples) => samples.length > 0)
    .map((samples) => Math.ceil(Math.max(
      ...samples.map((sample) => sample.average_worker_instances ?? 0),
      ...samples.map((sample) => sample.peak_worker_instances ?? 0),
    )))
    .filter((workers) => workers > 0)
  const fallback = observedValleyCandidates.length > 0
    ? Math.max(baseline, Math.min(...observedValleyCandidates))
    : baseline
  const normalizedHourly = sourceSampleCount === 0
    ? Array.from({ length: 24 }, () => Math.max(0, currentConfig.valley_worker_instances))
    : hourlyWorkers.map((workers, index) => hourly[index].length > 0 ? workers : fallback)
  const valley = fallback
  const peakWindows = hourlyPlanWindows(normalizedHourly, valley)
  const rationale = sourceSampleCount === 0
    ? [copy.status.pages_AdminEcsCost_039]
    : [
      copy.status.pages_AdminEcsCost_040(observedHours),
      copy.status.pages_AdminEcsCost_041,
      copy.status.pages_AdminEcsCost_042,
    ]
  return {
    generated_at: generatedAt,
    source_sample_count: sourceSampleCount,
    confidence: sourceSampleCount === 0 ? 'none' : observedHours < 12 ? 'limited' : 'observed',
    valley_worker_instances: valley,
    peak_windows: peakWindows,
    hourly_worker_instances: normalizedHourly,
    rationale,
  }
}

function observedWorkerHours(buckets: AdminServiceStatusHistoryBucket[], hours: number): number | null {
  const samples = buckets
    .filter((bucket) => bucket.sample_count > 0 && typeof bucket.average_worker_instances === 'number')
    .slice(-hours)
  if (samples.length === 0) return null
  return roundHours(samples.reduce((sum, bucket) => sum + (bucket.average_worker_instances ?? 0), 0))
}

function recommendWorkers(samples: AdminServiceStatusHistoryBucket[], baseline: number): number {
  if (samples.length === 0) return Math.max(0, baseline)
  const average = Math.max(...samples.map((sample) => sample.average_worker_instances ?? 0))
  const peak = Math.max(...samples.map((sample) => sample.peak_worker_instances ?? 0))
  const pressured = samples.some((sample) =>
    sample.status === 'congested'
    || sample.status === 'overloaded'
    || (sample.peak_queued ?? 0) > 0,
  )
  return Math.max(0, Math.ceil(Math.max(baseline, average, peak + (pressured ? 1 : 0))))
}

function hourlyPlanWindows(hourlyWorkers: number[], valley: number): ServiceStatusCostScheduleWindow[] {
  if (hourlyWorkers.length === 0) return []
  const windows: ServiceStatusCostScheduleWindow[] = []
  let start = 0
  for (let hour = 1; hour <= hourlyWorkers.length; hour += 1) {
    if (hour < hourlyWorkers.length && hourlyWorkers[hour] === hourlyWorkers[start]) continue
    if (hourlyWorkers[start] > valley) {
      windows.push({
        start: `${String(start).padStart(2, '0')}:00`,
        // HTML time inputs do not accept 24:00. Midnight is represented as
        // 00:00; workersAtMinute treats an end-of-day 00:00 as the boundary
        // at the next day rather than as an empty or full-day window.
        end: hour === 24 ? '00:00' : `${String(hour).padStart(2, '0')}:00`,
        worker_instances: hourlyWorkers[start],
      })
    }
    start = hour
  }
  return windows
}

function projectHour(value: string): number | null {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return null
  const hour = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', hour: '2-digit', hourCycle: 'h23' }).format(new Date(timestamp))
  const parsed = Number(hour)
  return Number.isInteger(parsed) && parsed >= 0 && parsed < 24 ? parsed : null
}

function workersAtMinute(windows: ServiceStatusCostScheduleWindow[], baseline: number, minute: number): number {
  return windows.reduce((workers, window) => {
    const start = parseTime(window.start)
    const end = parseTime(window.end)
    if (start === null || end === null || start === end) return workers
    const inWindow = end > start
      ? minute >= start && minute < end
      : minute >= start || minute < end
    return inWindow ? Math.max(workers, Math.max(baseline, window.worker_instances)) : workers
  }, baseline)
}

function parseTime(value: string): number | null {
  const match = /^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/.exec(value)
  if (!match) return null
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

function roundHours(value: number): number {
  return Math.round(value * 100) / 100
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}
