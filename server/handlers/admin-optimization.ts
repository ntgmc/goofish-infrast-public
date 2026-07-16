import { authenticateAdminRequest } from './admin-auth'
import { jsonResponse } from './license-utils'
import {
  discardOptimizationDeadLetter,
  listOptimizationDeadLetters,
  replayOptimizationDeadLetter,
  type OptimizationDeadLetterRecord,
} from '../storage/optimize-job-store'
import { kickOptimizeJobProcessing } from '../optimize-job-runner'

export default async function adminOptimizationHandler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)
  const authentication = await authenticateAdminRequest(req)
  if (!authentication.ok) return authentication.response

  try {
    if (req.method === 'GET') {
      const url = new URL(req.url)
      const rawStatus = url.searchParams.get('status')
      const status = isDeadLetterStatus(rawStatus) ? rawStatus : null
      const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit') ?? 50) || 50))
      return noStore(jsonResponse({ dead_letters: await listOptimizationDeadLetters(limit, status) }))
    }

    if (req.method === 'POST') {
      const body = await req.json() as { action?: unknown; id?: unknown; reason?: unknown }
      const id = typeof body.id === 'string' ? body.id.trim() : ''
      const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
      if (!id) return jsonResponse({ error: '缺少死信任务 ID。' }, 400)
      if (!reason) return jsonResponse({ error: '必须填写死信任务处理原因。' }, 400)
      if (body.action === 'replay') {
        const job = await replayOptimizationDeadLetter(id, authentication.username)
        if (!job) return jsonResponse({ error: '死信任务不存在、已处理或原任务状态无效。' }, 409)
        kickOptimizeJobProcessing()
        return noStore(jsonResponse({ ok: true, replayed_job_id: job.id }, 202))
      }
      if (body.action === 'discard') {
        const discarded = await discardOptimizationDeadLetter(id)
        if (!discarded) return jsonResponse({ error: '死信任务不存在或已经处理。' }, 409)
        return noStore(jsonResponse({ ok: true }))
      }
      return jsonResponse({ error: '不支持的死信任务操作。' }, 400)
    }

    return jsonResponse({ error: 'Method not allowed' }, 405)
  } catch (error) {
    console.error('admin optimization error:', error instanceof Error ? error.name : 'UnknownError')
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}

function isDeadLetterStatus(value: string | null): value is OptimizationDeadLetterRecord['status'] {
  return value === 'pending_review' || value === 'replayed' || value === 'discarded' || value === 'resolved'
}

function noStore(response: Response): Response {
  response.headers.set('Cache-Control', 'no-store')
  return response
}
