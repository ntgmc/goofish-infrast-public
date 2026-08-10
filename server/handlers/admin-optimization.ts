import { randomUUID } from 'node:crypto'
import { authenticateAdminRequest } from './admin-auth'
import { jsonResponse } from './license-utils'
import {
  discardAllOptimizationDeadLetters,
  discardOptimizationDeadLetter,
  getAdminOptimizationQueueSnapshot,
  getOptimizationDeadLetterDetail,
  listOptimizationDeadLetters,
  isOptimizeJobAdmissionError,
  replayOptimizationDeadLetter,
  type OptimizationDeadLetterRecord,
  type OptimizationDeadLetterResolution,
} from '../storage/optimize-job-store'
import { requestOptimizeJobProcessing } from '../optimize-job-signals'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson } from '../security/request-validation'
import { getRequestClientIp } from '../security/client-ip'
import { recordAdminOperationAudit } from '../storage/admin-operation-audit-store'

export default async function adminOptimizationHandler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const view = url.searchParams.get('view')
  const authentication = await authenticateAdminRequest(req, optimizationRequirement(req.method, view))
  if (!authentication.ok) return authentication.response

  try {
    if (req.method === 'GET') {
      if (view === 'queue') {
        return noStore(jsonResponse(await getAdminOptimizationQueueSnapshot(undefined, 20)))
      }
      if (view === 'dead_letter' || view === 'dead_letter_download') {
        const id = url.searchParams.get('id')?.trim() ?? ''
        if (!id) return jsonResponse({ error: '缺少死信任务 ID。' }, 400)
        const deadLetter = await getOptimizationDeadLetterDetail(id)
        if (!deadLetter) return jsonResponse({ error: '死信任务不存在。' }, 404)
        await recordAdminOperationAudit({
          actorUsername: authentication.username,
          action: view === 'dead_letter_download'
            ? 'optimization_dead_letter.payload_download'
            : 'optimization_dead_letter.payload_view',
          targetType: 'optimization_dead_letter',
          targetId: deadLetter.id,
          reason: view === 'dead_letter_download' ? '管理员下载完整死信载荷。' : '管理员查看完整死信载荷。',
          requestId: requestId(req),
          clientIp: getRequestClientIp(req),
          before: { status: deadLetter.status, job_id: deadLetter.job_id },
        })
        if (view === 'dead_letter_download') return jsonAttachment(deadLetter.payload_json, deadLetter.id)
        return noStore(jsonResponse({ dead_letter: deadLetter }))
      }
      if (view) return jsonResponse({ error: '不支持的异步任务视图。' }, 400)
      const rawStatus = url.searchParams.get('status')
      const status = isDeadLetterStatus(rawStatus) ? rawStatus : null
      const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') ?? 50) || 50))
      return noStore(jsonResponse({ dead_letters: await listOptimizationDeadLetters(limit, status) }))
    }

    if (req.method === 'POST') {
      const body = await getValidatedJson(req, requestSchemas.adminOptimization)
      const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
      if (!reason) return jsonResponse({ error: '必须填写死信任务处理原因。' }, 400)
      const resolution: OptimizationDeadLetterResolution = {
        actorUsername: authentication.username,
        reason,
        requestId: requestId(req),
        clientIp: getRequestClientIp(req),
      }
      if (body.action === 'discard_all') {
        const discardedCount = await discardAllOptimizationDeadLetters(resolution)
        return noStore(jsonResponse({ ok: true, discarded_count: discardedCount }))
      }
      const id = typeof body.id === 'string' ? body.id.trim() : ''
      if (!id) return jsonResponse({ error: '缺少死信任务 ID。' }, 400)
      if (body.action === 'replay') {
        const job = await replayOptimizationDeadLetter(id, resolution)
        if (!job) return jsonResponse({ error: '死信任务不存在、已处理或原任务状态无效。' }, 409)
        requestOptimizeJobProcessing()
        return noStore(jsonResponse({ ok: true, replayed_job_id: job.id }, 202))
      }
      if (body.action === 'discard') {
        const discarded = await discardOptimizationDeadLetter(id, resolution)
        if (!discarded) return jsonResponse({ error: '死信任务不存在或已经处理。' }, 409)
        return noStore(jsonResponse({ ok: true }))
      }
      return jsonResponse({ error: '不支持的死信任务操作。' }, 400)
    }

    return jsonResponse({ error: 'Method not allowed' }, 405)
  } catch (error) {
    if (isOptimizeJobAdmissionError(error)) {
      return jsonResponse({ error: error.message, code: error.code }, error.status)
    }
    console.error('admin optimization error:', error instanceof Error ? error.name : 'UnknownError')
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}

function optimizationRequirement(method: string, view: string | null) {
  if (method === 'POST') {
    return { capability: 'optimization_manage' as const, requireRecentLogin: true }
  }
  if (view === 'dead_letter' || view === 'dead_letter_download') {
    return { capability: 'sensitive_data_view' as const, requireRecentLogin: view === 'dead_letter_download' }
  }
  return 'optimization_view' as const
}

function requestId(req: Request): string {
  return req.headers.get('x-request-id')?.trim() || randomUUID()
}

function isDeadLetterStatus(value: string | null): value is OptimizationDeadLetterRecord['status'] {
  return value === 'pending_review' || value === 'replayed' || value === 'discarded' || value === 'resolved'
}

function noStore(response: Response): Response {
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function jsonAttachment(payload: unknown, id: string): Response {
  const safeId = id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'unknown'
  return noStore(new Response(JSON.stringify(payload, null, 2) ?? 'null', {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="optimization-dead-letter-${safeId}.json"`,
    },
  }))
}
