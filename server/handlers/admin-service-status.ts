import { randomUUID } from 'node:crypto'
import { QUEUE_CONGESTION_THRESHOLD, QUEUE_OVERLOAD_THRESHOLD, resolveOptimizationServiceStatus, type AdminServiceStatusResponse, normalizeServiceStatusCostConfig } from '../../src/lib/service-status'
import { calculateServiceStatusCostEstimate, recommendServiceStatusCostPlan } from '../../src/lib/service-status-cost'
import { authenticateAdminRequest } from './admin-auth'
import { jsonResponse } from './license-utils'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson, RequestInputError } from '../security/request-validation'
import { getRequestClientIp } from '../security/client-ip'
import {
  appendServiceStatusIncidentUpdate,
  createServiceStatusIncident,
  getServiceStatusCostConfig,
  getAdminServiceStatusHistory,
  listAdminServiceStatusIncidents,
  saveServiceStatusCostConfig,
  type ServiceStatusIncidentConflict,
} from '../storage/service-status-store'
import { getAdminOptimizationQueueSnapshot } from '../storage/optimize-job-store'
import { isServiceReady } from '../lifecycle'

export default async function adminServiceStatusHandler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  if ([...url.searchParams.keys()].some((key) => key !== 'view')) return jsonResponse({ error: '不支持的查询参数。' }, 400)
  const view = url.searchParams.get('view')

  if (req.method === 'GET') {
    const authentication = await authenticateAdminRequest(req, 'optimization_view')
    if (!authentication.ok) return authentication.response
    if (view !== 'history') return jsonResponse({ error: '必须指定 view=history。' }, 400)
    try {
      const history = await getAdminServiceStatusHistory()
      const incidents = await listAdminServiceStatusIncidents(history.from)
      const costConfig = await getServiceStatusCostConfig()
      const snapshot = await getAdminOptimizationQueueSnapshot(undefined, 1)
      const currentStatus = resolveOptimizationServiceStatus({
        serviceReady: isServiceReady(), queued: snapshot.counts.queued, running: snapshot.counts.running,
        workerConcurrency: snapshot.capacity.worker_concurrency, workerInstances: snapshot.capacity.worker_instances,
      })
      const response: AdminServiceStatusResponse = {
        generated_at: snapshot.snapshot_at,
        status: currentStatus,
        queue: { queued: snapshot.counts.queued, running: snapshot.counts.running, queue_limit: snapshot.capacity.queue_limit, worker_concurrency: snapshot.capacity.worker_concurrency, worker_instances: snapshot.capacity.worker_instances, billable_worker_instances: snapshot.capacity.billable_worker_instances },
        components: [{ id: 'optimization', status: currentStatus }],
        thresholds: { queue_congested_at: QUEUE_CONGESTION_THRESHOLD, queue_overloaded_at: QUEUE_OVERLOAD_THRESHOLD },
        history: { ...history, interval: 'hour', complete: true },
        incidents,
        cost: {
          config: costConfig,
          estimate: calculateServiceStatusCostEstimate(costConfig, history.buckets),
          recommendation: recommendServiceStatusCostPlan(history.buckets, costConfig, snapshot.snapshot_at),
        },
      }
      return noStore(jsonResponse(response))
    } catch (error) {
      console.error('admin service status get error:', error instanceof Error ? error.name : 'UnknownError')
      return noStore(jsonResponse({ error: 'Internal server error' }, 500))
    }
  }

  const authentication = await authenticateAdminRequest(req, { capability: 'optimization_manage', requireRecentLogin: true })
  if (!authentication.ok) return authentication.response

  try {
    const requestId = req.headers.get('x-request-id')?.trim() || randomUUID()
    const clientIp = getRequestClientIp(req)
    if (req.method === 'POST') {
      const body = await getValidatedJson(req, requestSchemas.adminServiceStatusCreate, true)
      if (body.action === 'save_cost_config') {
        const config = await saveServiceStatusCostConfig({
          config: normalizeServiceStatusCostConfig(body, body.component_id),
          expectedUpdatedAt: body.expected_updated_at,
          audit: {
            actorUsername: authentication.username,
            reason: body.reason,
            requestId,
            clientIp,
          },
        })
        return noStore(jsonResponse({ cost: config }))
      }
      const incident = await createServiceStatusIncident({
        componentId: body.component_id,
        title: body.title,
        impact: body.impact,
        status: body.status,
        body: body.body,
        startedAt: body.started_at,
        audit: {
          actorUsername: authentication.username,
          reason: body.reason,
          requestId,
          clientIp,
        },
      })
      return noStore(jsonResponse({ incident }, 201))
    }
    if (req.method === 'PATCH') {
      const body = await getValidatedJson(req, requestSchemas.adminServiceStatusPatch, true)
      const incident = await appendServiceStatusIncidentUpdate({
        incidentId: body.incident_id,
        status: body.status,
        body: body.body,
        expectedUpdatedAt: body.expected_updated_at,
        audit: {
          actorUsername: authentication.username,
          reason: body.reason,
          requestId,
          clientIp,
        },
      })
      return noStore(jsonResponse({ incident }))
    }
    return jsonResponse({ error: 'Method not allowed' }, 405)
  } catch (error) {
    if (isConflict(error)) return noStore(jsonResponse({ error: '状态或成本配置已被其他管理员更新，请刷新后重试。' }, 409))
    if (error instanceof Error && error.message === 'service_status_incident_not_found') {
      return noStore(jsonResponse({ error: '事件不存在。' }, 404))
    }
    if (error instanceof RequestInputError) return jsonResponse({ error: error.message, code: error.code }, error.status)
    console.error('admin service status mutation error:', error instanceof Error ? error.name : 'UnknownError')
    return noStore(jsonResponse({ error: 'Internal server error' }, 500))
  }
}

function isConflict(error: unknown): error is ServiceStatusIncidentConflict {
  return Boolean(error && typeof error === 'object' && ['service_status_incident_conflict', 'service_status_cost_config_conflict'].includes(String((error as { code?: unknown }).code)))
}

function noStore(response: Response): Response {
  response.headers.set('Cache-Control', 'no-store')
  return response
}
