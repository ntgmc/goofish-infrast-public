import {
  QUEUE_CONGESTION_THRESHOLD,
  createEmptyServiceStatusHistory,
  resolveOptimizationServiceStatus,
  type ServiceStatusHistoryResponse,
  type ServiceStatusResponse,
} from '../../src/lib/service-status'
import { isServiceReady } from '../lifecycle'
import { getAdminOptimizationQueueSnapshot } from '../storage/optimize-job-store'
import { getServiceStatusHistory, listPublicServiceStatusIncidents } from '../storage/service-status-store'
import { jsonResponse } from './user-auth'

export default async function serviceStatusHandler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405)
  const url = new URL(req.url)
  if ([...url.searchParams.keys()].length > 0) return jsonResponse({ error: '不支持的查询参数。' }, 400)

  try {
    const snapshot = await getAdminOptimizationQueueSnapshot(undefined, 1)
    const status = resolveOptimizationServiceStatus({
      serviceReady: isServiceReady(),
      queued: snapshot.counts.queued,
      running: snapshot.counts.running,
      workerConcurrency: snapshot.capacity.worker_concurrency,
      workerInstances: snapshot.capacity.worker_instances,
    })
    const emptyHistory = createEmptyServiceStatusHistory(new Date(snapshot.snapshot_at))
    let history: ServiceStatusHistoryResponse = emptyHistory
    let incidents = [] as ServiceStatusResponse['incidents']
    try {
      const stored = await getServiceStatusHistory('optimization', new Date(snapshot.snapshot_at))
      history = { ...stored, interval: 'hour', complete: true }
    } catch (error) {
      console.warn('service status history unavailable:', error instanceof Error ? error.name : 'UnknownError')
    }
    try {
      incidents = await listPublicServiceStatusIncidents(history.from)
    } catch (error) {
      console.warn('service status incidents unavailable:', error instanceof Error ? error.name : 'UnknownError')
    }
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
      history,
      incidents,
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
    history: createEmptyServiceStatusHistory(),
    incidents: [],
  }
}
