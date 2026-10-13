export type OperationsRangeMode = '7d' | '14d' | '30d' | 'custom'

export interface OperationsPeriod {
  from: string
  to: string
  observed_until: string
  complete: boolean
  successful_users: number
  registered_users: number
  successful_generations: number
  failed_requests: number
  success_rate: number | null
  latency_samples: number
  p50_wait_ms: number | null
  p95_wait_ms: number | null
  activation: {
    eligible: number
    activated: number
    pending: number
    with_profile: number
    rate: number | null
  }
  reuse: { eligible: number; reused: number; pending: number; rate: number | null }
  maa: { eligible: number; exported: number; rate: number | null; complete: boolean }
  cost: {
    estimated_cny: number | null
    per_success_cny: number | null
    recorded_hours: number
    expected_hours: number
    successful_generations: number
    prices_configured: boolean
    through: string
  }
}

export interface OperationsOverview {
  metrics_version: 'business.v1'
  generated_at: string
  timezone: 'Asia/Shanghai'
  current: OperationsPeriod
  previous: OperationsPeriod
  days: Array<{ date: string; successful_users: number; registered_users: number; successful_generations: number; failed_requests: number }>
  failure_reasons: Array<{ reason_code: string; count: number }>
  skland: { successful: number; failed: number; success_rate: number | null }
  coverage: {
    retained_from: string
    complete: boolean
    unattributed_successes: number
    unknown_outcomes: number
    maa_tracking_started_at: string | null
  }
}

export function operationsDate(now = new Date()): string {
  return new Date(now.getTime() + 8 * 60 * 60_000).toISOString().slice(0, 10)
}

export function shiftOperationsDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

export function isOperationsDate(value: string): boolean {
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const timestamp = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
}

export function operationsOverviewCsv(data: OperationsOverview): string {
  const rows: Array<Array<string | number | null | boolean>> = [
    ['section', 'metric', 'date', 'current', 'previous'],
    ['metadata', 'metrics_version', data.metrics_version, null],
    ['metadata', 'timezone', data.timezone, null],
    ['metadata', 'generated_at', data.generated_at, null],
    ['metadata', 'from', data.current.from, data.previous.from],
    ['metadata', 'to', data.current.to, data.previous.to],
    ['metadata', 'observed_until', data.current.observed_until, data.previous.observed_until],
    ['coverage', 'complete', data.current.complete, data.previous.complete],
    ['coverage', 'retained_from', data.coverage.retained_from, null],
    ['coverage', 'unattributed_successes', data.coverage.unattributed_successes, null],
    ['coverage', 'unknown_outcomes', data.coverage.unknown_outcomes, null],
    ['coverage', 'maa_tracking_started_at', data.coverage.maa_tracking_started_at, null],
  ]
  for (const key of ['successful_users', 'registered_users', 'successful_generations', 'failed_requests', 'success_rate', 'latency_samples', 'p50_wait_ms', 'p95_wait_ms'] as const) {
    rows.push(['usage', key, data.current[key], data.previous[key]])
  }
  for (const key of ['eligible', 'activated', 'pending', 'with_profile', 'rate'] as const) {
    rows.push(['activation', key, data.current.activation[key], data.previous.activation[key]])
  }
  for (const key of ['eligible', 'reused', 'pending', 'rate'] as const) {
    rows.push(['reuse', key, data.current.reuse[key], data.previous.reuse[key]])
  }
  for (const key of ['eligible', 'exported', 'rate', 'complete'] as const) {
    rows.push(['maa', key, data.current.maa[key], data.previous.maa[key]])
  }
  for (const key of ['estimated_cny', 'per_success_cny', 'recorded_hours', 'expected_hours', 'successful_generations', 'prices_configured', 'through'] as const) {
    rows.push(['cost', key, data.current.cost[key], data.previous.cost[key]])
  }
  rows.push(['skland', 'successful', data.skland.successful, null], ['skland', 'failed', data.skland.failed, null], ['skland', 'success_rate', data.skland.success_rate, null])
  for (const day of data.days) {
    for (const key of ['successful_users', 'registered_users', 'successful_generations', 'failed_requests'] as const) {
      rows.push(['days', key, day.date, day[key], null])
    }
  }
  for (const reason of data.failure_reasons) rows.push(['failure_reason', reason.reason_code, '', reason.count, null])
  return rows.map((row) => (row.length === 4 ? [row[0], row[1], '', row[2], row[3]] : row).map((value) => {
    const text = String(value ?? '')
    const safe = typeof value === 'string' && /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text
    return `"${safe.replace(/"/g, '""')}"`
  }).join(',')).join('\n')
}
