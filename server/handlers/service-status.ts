import { QUEUE_CONGESTION_THRESHOLD, resolveOptimizationServiceStatus, type ServiceStatusResponse } from '../../src/lib/service-status'
import { isServiceReady } from '../lifecycle'
import { getAdminOptimizationQueueSnapshot } from '../storage/optimize-job-store'
import { jsonResponse } from './user-auth'

export default async function serviceStatusHandler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const snapshot = await getAdminOptimizationQueueSnapshot(undefined, 1)
    const status = resolveOptimizationServiceStatus({
      serviceReady: isServiceReady(),
      queued: snapshot.counts.queued,
      running: snapshot.counts.running,
      workerConcurrency: snapshot.capacity.worker_concurrency,
      workerInstances: snapshot.capacity.worker_instances,
    })
    const payload: ServiceStatusResponse = {
      generated_at: snapshot.snapshot_at,
      status,
      queue: {
        queued: snapshot.counts.queued,
        running: snapshot.counts.running,
        queue_limit: snapshot.capacity.queue_limit,
        worker_concurrency: snapshot.capacity.worker_concurrency,
        worker_instances: snapshot.capacity.worker_instances,
      },
      components: [{ id: 'optimization', status }],
      thresholds: { queue_congested_at: QUEUE_CONGESTION_THRESHOLD },
    }
    return jsonResponse(payload, status === 'unavailable' ? 503 : 200, { 'Cache-Control': 'no-store' })
  } catch (error) {
    console.error('service status error:', error instanceof Error ? error.name : 'UnknownError')
    return jsonResponse(unavailablePayload(), 503, { 'Cache-Control': 'no-store' })
  }
}

function unavailablePayload(): ServiceStatusResponse {
  return {
    generated_at: new Date().toISOString(),
    status: 'unavailable',
    queue: null,
    components: [{ id: 'optimization', status: 'unavailable' }],
    thresholds: { queue_congested_at: QUEUE_CONGESTION_THRESHOLD },
  }
}
