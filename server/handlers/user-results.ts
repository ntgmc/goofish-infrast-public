import { createHash, randomUUID } from 'node:crypto'
import { hasCapability } from '../../src/lib/product-catalog'
import type { WorkspaceResultHistoryItem } from '../../src/lib/types'
import { getEffectiveProfilePermission } from '../free-preview-trial'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson, stableJsonStringify } from '../security/request-validation'
import {
  consumeInventoryItemImmediately,
  getProfileCapacityLimits,
  InventoryError,
} from '../storage/inventory-store'
import {
  emptyWorkspace,
  getProfileForUser,
  getProfileWorkspace,
  isDepotValueProfile,
  toPublicWorkspace,
  updateProfileWorkspaceInTransaction,
} from '../storage/user-store'
import { withTransaction } from '../storage/postgres'
import { jsonResponse, requireUserSession } from './user-auth'

export default async function userResultsHandler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)
  if (req.method !== 'POST') return jsonResponse({ error: '方法不允许。' }, 405)
  try {
    const auth = await requireUserSession(req)
    if (!auth) return jsonResponse({ error: '请先登录。' }, 401)
    const url = new URL(req.url)
    if (url.pathname.endsWith('/maa-export')) {
      const body = await getValidatedJson(req, requestSchemas.maaExport)
      const profile = await getProfileForUser(auth.user.id, body.profile_id)
      if (!profile) return jsonResponse({ error: '账号档案不存在。' }, 404)
      if (isDepotValueProfile(profile)) return jsonResponse({ error: '仓库分析档案没有排班结果。' }, 403)
      const workspace = await getProfileWorkspace(profile.id)
      const historyItem = findHistoryItem(workspace?.result_history ?? [], workspace?.archived_results ?? [], body.result_id)
      if (!historyItem) return jsonResponse({ error: '排班结果不存在。' }, 404)
      if (historyItem.result.schedule_mode === 'rotation') return jsonResponse({ error: '轮班制结果不能导出为 MAA JSON。' }, 409)
      const result = JSON.parse(JSON.stringify(historyItem.result)) as Record<string, unknown>
      const permanent = hasCapability({ permission: getEffectiveProfilePermission(profile) }, 'export_maa_json')
      if (permanent) {
        return jsonResponse({ result, result_id: historyItem.id, filename: `maa_schedule_${historyItem.id}.json`, consumed_coupon: false })
      }
      const requestHash = createHash('sha256').update(stableJsonStringify(body)).digest('hex')
      const response = await consumeInventoryItemImmediately({
        userId: auth.user.id,
        itemCode: 'maa_export_trial_coupon',
        profileId: profile.id,
        idempotencyKey: body.idempotency_key,
        requestHash,
        operationType: 'maa_export',
        response: { result, result_id: historyItem.id, filename: `maa_schedule_${historyItem.id}.json`, consumed_coupon: true },
      })
      return jsonResponse(response)
    }

    const body = await getValidatedJson(req, requestSchemas.resultArchive)
    const profile = await getProfileForUser(auth.user.id, body.profile_id)
    if (!profile) return jsonResponse({ error: '账号档案不存在。' }, 404)
    if (isDepotValueProfile(profile)) return jsonResponse({ error: '仓库分析档案没有排班结果。' }, 403)
    const limits = await getProfileCapacityLimits(profile.id)
    const requestHash = createHash('sha256').update(stableJsonStringify({
      profile_id: body.profile_id,
      result_id: body.result_id,
      action: body.action,
    })).digest('hex')
    const response = await withTransaction(async (client) => {
      const existing = await client.query<{ request_hash: string; response_json: Record<string, unknown> | null }>(
        'select request_hash, response_json from inventory_operations where user_id = $1 and idempotency_key = $2 for update',
        [auth.user.id, body.idempotency_key],
      )
      if (existing.rows[0]) {
        if (existing.rows[0].request_hash !== requestHash) throw new InventoryError('idempotency_conflict', '幂等键已被其他请求使用。', 409)
        if (!existing.rows[0].response_json) throw new InventoryError('operation_in_progress', '结果操作正在处理中。', 409)
        return existing.rows[0].response_json
      }
      const operationId = randomUUID()
      const now = new Date().toISOString()
      await client.query(
        `insert into inventory_operations (id, user_id, idempotency_key, operation_type, request_hash, created_at)
         values ($1, $2, $3, 'result_history_mutation', $4, $5)`,
        [operationId, auth.user.id, body.idempotency_key, requestHash, now],
      )
      const next = await updateProfileWorkspaceInTransaction(client, profile.id, (current) => {
        const workspace = current ?? emptyWorkspace(profile.id)
        const archived = workspace.archived_results ?? []
        if (body.action === 'archive') {
          if (archived.some((item) => item.id === body.result_id)) return workspace
          const target = workspace.result_history.find((item) => item.id === body.result_id)
          if (!target) throw new ResultMutationError('普通历史中不存在该结果。', 404)
          if (archived.length >= limits.archive) throw new ResultMutationError('封存区已满，请先取消封存或使用结果封存夹扩容。', 409)
          return { ...workspace, result_history: workspace.result_history.filter((item) => item.id !== body.result_id), archived_results: [target, ...archived], updated_at: now }
        }
        if (body.action === 'delete') {
          return { ...workspace, result_history: workspace.result_history.filter((item) => item.id !== body.result_id), updated_at: now }
        }
        if (workspace.result_history.some((item) => item.id === body.result_id)) return workspace
        const target = archived.find((item) => item.id === body.result_id)
        if (!target) throw new ResultMutationError('封存区中不存在该结果。', 404)
        if (workspace.result_history.length >= limits.history) throw new ResultMutationError('普通历史区已满，请先删除一个普通结果后再取消封存。', 409)
        return { ...workspace, result_history: [target, ...workspace.result_history], archived_results: archived.filter((item) => item.id !== body.result_id), updated_at: now }
      })
      const result = { workspace: toPublicWorkspace(next, limits), action: body.action, result_id: body.result_id, operation_id: operationId }
      await client.query(
        'update inventory_operations set response_json = $3::jsonb, completed_at = $4 where id = $1 and user_id = $2',
        [operationId, auth.user.id, JSON.stringify(result), now],
      )
      return result
    })
    return jsonResponse(response)
  } catch (error) {
    if (error instanceof InventoryError || error instanceof ResultMutationError) {
      return jsonResponse({ error: error.message, code: error instanceof InventoryError ? error.code : 'result_archive_failed' }, error.status)
    }
    console.error('user result operation error:', error)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}

function findHistoryItem(
  history: WorkspaceResultHistoryItem[],
  archived: WorkspaceResultHistoryItem[],
  resultId: string,
): WorkspaceResultHistoryItem | null {
  return history.find((item) => item.id === resultId) ?? archived.find((item) => item.id === resultId) ?? null
}

class ResultMutationError extends Error {
  constructor(message: string, readonly status: 404 | 409) {
    super(message)
  }
}
