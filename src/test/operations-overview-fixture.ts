import { operationsDate, shiftOperationsDate, type OperationsOverview, type OperationsPeriod } from '../lib/operations-overview'

export function createOperationsOverview(successfulUsers = 42): OperationsOverview {
  const to = operationsDate()
  const from = shiftOperationsDate(to, -29)
  const current: OperationsPeriod = {
    from, to, observed_until: new Date().toISOString(), complete: true,
    successful_users: successfulUsers, registered_users: 50, deleted_users: 0, successful_generations: 100, failed_requests: 4,
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
    deletions: { total_deleted: 0, pending: 0, failed: 0, reasons: [], recent_feedback: [] },
    skland: { successful: 45, failed: 5, success_rate: 90 },
    tools: {
      tracking_started_at: `${shiftOperationsDate(from, -60)}T00:00:00Z`,
      pages: [{ page: 'cultivation-projects', visitors: 72, views: 135 }, { page: 'depot', visitors: 51, views: 80 }],
      current: [{ tool: 'cultivation_projects', users: 18, anonymous_visitors: 0, attempts: 30, successful: 27, failed: 2, cancelled: 1, success_rate: 93.1, latency_samples: 27, p50_ms: 1_200, p95_ms: 4_500 },
        { tool: 'depot_value', users: 15, anonymous_visitors: 4, attempts: 25, successful: 25, failed: 0, cancelled: 0, success_rate: 100, latency_samples: 25, p50_ms: 800, p95_ms: 2_100 }],
      previous: [],
    },
    coverage: { retained_from: shiftOperationsDate(from, -150), complete: true, unattributed_successes: 0, unknown_outcomes: 0, maa_tracking_started_at: `${shiftOperationsDate(from, -10)}T00:00:00Z` },
  }
}
