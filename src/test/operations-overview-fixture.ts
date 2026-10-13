import { operationsDate, shiftOperationsDate, type OperationsOverview, type OperationsPeriod } from '../lib/operations-overview'

export function createOperationsOverview(successfulUsers = 42): OperationsOverview {
  const to = operationsDate()
  const from = shiftOperationsDate(to, -29)
  const current: OperationsPeriod = {
    from, to, observed_until: new Date().toISOString(), complete: true,
    successful_users: successfulUsers, registered_users: 50, successful_generations: 100, failed_requests: 4,
    success_rate: 96.2, latency_samples: 98, p50_wait_ms: 30_000, p95_wait_ms: 125_000,
    activation: { eligible: 30, activated: 18, pending: 20, with_profile: 24, rate: 60 },
    reuse: { eligible: 35, reused: 14, pending: 7, rate: 40 },
    maa: { eligible: 80, exported: 64, rate: 80, complete: true },
    cost: { estimated_cny: 100, per_success_cny: 1, recorded_hours: 720, expected_hours: 720, successful_generations: 100, prices_configured: true, through: `${to}T00:00:00Z` },
  }
  return {
    metrics_version: 'business.v1', generated_at: new Date().toISOString(), timezone: 'Asia/Shanghai',
    current,
    previous: { ...structuredClone(current), from: shiftOperationsDate(from, -30), to: shiftOperationsDate(from, -1), successful_users: 32 },
    days: Array.from({ length: 30 }, (_, index) => ({ date: shiftOperationsDate(from, index), successful_users: index % 6 + 1, registered_users: index % 4, successful_generations: index % 6 + 2, failed_requests: index % 8 === 0 ? 1 : 0 })),
    failure_reasons: [{ reason_code: 'optimizer_runtime_error', count: 4 }],
    skland: { successful: 45, failed: 5, success_rate: 90 },
    coverage: { retained_from: shiftOperationsDate(from, -150), complete: true, unattributed_successes: 0, unknown_outcomes: 0, maa_tracking_started_at: `${shiftOperationsDate(from, -10)}T00:00:00Z` },
  }
}
