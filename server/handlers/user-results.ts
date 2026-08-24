import { createHash, randomUUID } from 'node:crypto'
import { ZodError } from 'zod'
import { hasCapability } from '../../src/lib/product-catalog'
import { projectOptimizeResultForCapabilities } from '../../src/lib/optimize-result-projection'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson, stableJsonStringify } from '../security/request-validation'
import {
  consumeInventoryItemImmediately,
  getProfileCapacityLimitsInTransaction,
  InventoryError,
} from '../storage/inventory-store'
import {
  getProfileForUser,
  isDepotValueProfile,
  isFreePreviewProfile,
  normalizeProfileKind,
  toPublicWorkspace,
  updateProfileWorkspaceInTransaction,
} from '../storage/user-store'
import {
  getProfileOptimizationResult,
  getWorkspaceOptimizationResultOverviewWithClient,
  listProfileOptimizationResults,
  mutateProfileOptimizationResultInTransaction,
  OPTIMIZATION_RESULT_PAGE_MAX_SIZE,
  OptimizationResultCursorError,
  OptimizationResultMutationError,
} from '../storage/optimization-result-store'
import { withTransaction } from '../storage/postgres'
import { jsonResponse, requireUserSession } from './user-auth'
import { recordTrackedExportBehaviorEvent } from '../behavior-risk/service'
import {
  PersonalUseDeclarationRequiredError,
  recordPersonalUseDeclarationUsage,
} from '../storage/personal-use-declaration-store'
import { buildMaaExportPayload, MaaExportValidationError } from '../optimization/jobs/maa-export'
import { parseOptimizeResult } from '../optimization/jobs/runtime-contracts'
import { resolveProfileAuthorization } from './profile-authorization'
import { getRequestClientIp } from '../security/client-ip'

export default async function userResultsHandler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const pathname = url.pathname
  const detailResultId = matchResultDetailId(pathname)
  const isResultListRequest = pathname === '/api/user/results'
  const isResultDetailRequest = detailResultId !== null
  const isMaaExportRequest = pathname.endsWith('/maa-export')
  const isFullResultExportRequest = pathname.endsWith('/full-result-export')

  try {
    const auth = await requireUserSession(req)
    if (!auth) return jsonResponse({ error: '请先登录。' }, 401)

    if (req.method === 'GET' && (isResultListRequest || isResultDetailRequest)) {
      const profileId = readRequiredQueryParameter(url, 'profile_id')
      if (!profileId) return jsonResponse({ error: '账号档案参数无效。', code: 'profile_id_invalid' }, 400)
      const access = await resolveResultProfileAccess(auth.user.id, profileId)
      if (access.response) return access.response
      const profile = access.profile!
      const authorization = access.authorization!

      if (isResultListRequest) {
        const scope = url.searchParams.get('scope')
        if (scope !== 'active' && scope !== 'archived') {
          return jsonResponse({ error: '结果列表范围无效。', code: 'result_scope_invalid' }, 400)
        }
        const limit = readPageLimit(url)
        if (limit === false) return jsonResponse({ error: '结果列表数量无效。', code: 'result_limit_invalid' }, 400)
        const cursor = url.searchParams.get('cursor')
        if (cursor && cursor.length > 512) {
          return jsonResponse({ error: '结果列表加载位置已失效，请重新打开列表。', code: 'result_cursor_invalid' }, 400)
        }
        return jsonResponse(await listProfileOptimizationResults(profile.id, scope, { cursor, limit }))
      }

      const stored = await getProfileOptimizationResult(profile.id, detailResultId!)
      if (!stored) return jsonResponse({ error: '排班结果不存在。', code: 'result_not_found' }, 404)
      const result = parseOptimizeResult(JSON.parse(JSON.stringify(stored.result)))
      return jsonResponse({
        item: {
          ...stored,
          result: projectOptimizeResultForCapabilities(result, {
            kind: normalizeProfileKind(profile),
            permission: authorization.permission,
          }),
        },
      })
    }

    if (req.method !== 'POST') return jsonResponse({ error: '方法不允许。' }, 405)

    if (isFullResultExportRequest) {
      const body = await getValidatedJson(req, requestSchemas.fullResultExport)
      const access = await resolveResultProfileAccess(auth.user.id, body.profile_id)
      if (access.response) return access.response
      const profile = access.profile!
      const authorization = access.authorization!
      if (!hasCapability({
        kind: normalizeProfileKind(profile),
        permission: authorization.permission,
      }, 'export_full_result_json')) {
        return jsonResponse({
          error: '当前档案不支持下载完整计算数据。',
          code: 'full_result_export_forbidden',
        }, 403)
      }
      const historyItem = await getProfileOptimizationResult(profile.id, body.result_id)
      if (!historyItem) return jsonResponse({ error: '排班结果不存在。' }, 404)
      const result = parseOptimizeResult(JSON.parse(JSON.stringify(historyItem.result)))
      const behaviorDeclaration = isFreePreviewProfile(profile) || profile.kind === 'metered_personal'
        ? await recordPersonalUseDeclarationUsage({
            userId: auth.user.id,
            profileId: profile.id,
            action: 'generated_result_export',
            clientIp: getRequestClientIp(req),
          })
        : null
      await recordTrackedExportBehaviorEvent({
        req,
        auth,
        profileId: profile.id,
        jobId: historyItem.job_id ?? historyItem.id,
        uid: profile.skland_binding?.uid,
        result,
        eventKey: `full-result-export:${auth.user.id}:${body.idempotency_key}`,
        activityClaimedAt: isFreePreviewProfile(profile) ? profile.created_at : null,
        declarationVersion: behaviorDeclaration?.declaration_version,
        declarationAcceptedAt: behaviorDeclaration?.acceptance_accepted_at,
      }).catch((error) => {
        console.warn('Full result export behavior event skipped:', error instanceof Error ? error.message : 'unknown error')
        return false
      })
      return jsonResponse({
        result,
        result_id: historyItem.id,
        filename: `maatool_full_result_${historyItem.id}.json`,
      })
    }

    if (isMaaExportRequest) {
      const body = await getValidatedJson(req, requestSchemas.maaExport)
      const access = await resolveResultProfileAccess(auth.user.id, body.profile_id)
      if (access.response) return access.response
      const profile = access.profile!
      const authorization = access.authorization!
      const historyItem = await getProfileOptimizationResult(profile.id, body.result_id)
      if (!historyItem) return jsonResponse({ error: '排班结果不存在。' }, 404)
      if (historyItem.result.schedule_mode === 'rotation') {
        return jsonResponse({ error: '轮班制结果不能导出为 MAA JSON。' }, 409)
      }
      const canExportWithoutCoupon = hasCapability({
        kind: normalizeProfileKind(profile),
        permission: authorization.permission,
      }, 'export_maa_json')
      if (!canExportWithoutCoupon && body.use_coupon !== true) {
        return jsonResponse({
          error: '当前档案需要使用 1 张 MAA 导出体验券，请确认后重试。',
          code: 'maa_export_coupon_required',
        }, 403)
      }
      const result = buildMaaExportPayload(historyItem.result)
      const behaviorDeclaration = isFreePreviewProfile(profile) || profile.kind === 'metered_personal'
        ? await recordPersonalUseDeclarationUsage({
            userId: auth.user.id,
            profileId: profile.id,
            action: 'generated_result_export',
            clientIp: getRequestClientIp(req),
          })
        : null
      const recordExportBehavior = () => recordTrackedExportBehaviorEvent({
        req,
        auth,
        profileId: profile.id,
        jobId: historyItem.job_id ?? historyItem.id,
        uid: profile.skland_binding?.uid,
        result,
        eventKey: `maa-export:${auth.user.id}:${body.idempotency_key}`,
        activityClaimedAt: isFreePreviewProfile(profile) ? profile.created_at : null,
        declarationVersion: behaviorDeclaration?.declaration_version,
        declarationAcceptedAt: behaviorDeclaration?.acceptance_accepted_at,
      }).catch((error) => {
        console.warn('MAA export behavior event skipped:', error instanceof Error ? error.message : 'unknown error')
        return false
      })
      if (canExportWithoutCoupon) {
        await recordExportBehavior()
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
      await recordExportBehavior()
      return jsonResponse(response)
    }

    const body = await getValidatedJson(req, requestSchemas.resultArchive)
    const access = await resolveResultProfileAccess(auth.user.id, body.profile_id)
    if (access.response) return access.response
    const profile = access.profile!
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
        if (existing.rows[0].request_hash !== requestHash) {
          throw new InventoryError('idempotency_conflict', '提交内容已发生变化，请刷新页面后重新操作。', 409)
        }
        if (!existing.rows[0].response_json) {
          throw new InventoryError('operation_in_progress', '结果操作正在处理中。', 409)
        }
        return existing.rows[0].response_json
      }
      const operationId = randomUUID()
      const now = new Date().toISOString()
      await client.query(
        `insert into inventory_operations (id, user_id, idempotency_key, operation_type, request_hash, created_at)
         values ($1, $2, $3, 'result_history_mutation', $4, $5)`,
        [operationId, auth.user.id, body.idempotency_key, requestHash, now],
      )
      const limits = await getProfileCapacityLimitsInTransaction(client, profile.id)
      await mutateProfileOptimizationResultInTransaction(client, {
        profileId: profile.id,
        resultId: body.result_id,
        action: body.action,
        historyLimit: limits.history,
        archiveLimit: limits.archive,
        now,
      })
      const workspace = await updateProfileWorkspaceInTransaction(client, profile.id, (current) => ({
        ...(current ?? {
          version: 1 as const,
          profile_id: profile.id,
          operators: null,
          config: null,
          elite_overrides: {},
          saved_configs: [],
          free_schedule_entitlement: null,
          free_preview_normalized_activity_id: null,
          updated_at: now,
        }),
        updated_at: now,
      }))
      const overview = await getWorkspaceOptimizationResultOverviewWithClient(client, profile.id)
      const result = {
        workspace: toPublicWorkspace(workspace, limits, overview),
        action: body.action,
        result_id: body.result_id,
        operation_id: operationId,
      }
      await client.query(
        'update inventory_operations set response_json = $3::jsonb, completed_at = $4 where id = $1 and user_id = $2',
        [operationId, auth.user.id, JSON.stringify(result), now],
      )
      return result
    })
    return jsonResponse(response)
  } catch (error) {
    if (error instanceof PersonalUseDeclarationRequiredError) {
      return jsonResponse({ error: error.message, code: error.code }, error.status)
    }
    if (error instanceof OptimizationResultCursorError || error instanceof OptimizationResultMutationError) {
      return jsonResponse({ error: error.message, code: error.code }, error.status)
    }
    if (error instanceof MaaExportValidationError) {
      return jsonResponse({ error: error.message, code: error.code }, 422)
    }
    if (error instanceof ZodError) {
      return jsonResponse({
        error: '排班结果数据版本不兼容或已损坏，无法读取。',
        code: 'result_data_invalid',
      }, 422)
    }
    if (error instanceof InventoryError) {
      return jsonResponse({ error: error.message, code: error.code }, error.status)
    }
    console.error('user result operation error:', error)
    if (isResultListRequest || isResultDetailRequest) {
      return jsonResponse({ error: '读取排班结果失败，请稍后重试。', code: 'result_read_failed' }, 500)
    }
    if (isFullResultExportRequest) {
      return jsonResponse({ error: '下载完整计算数据失败，请稍后重试。', code: 'full_result_export_failed' }, 500)
    }
    if (isMaaExportRequest) {
      return jsonResponse({ error: '导出 MAA JSON 失败，请稍后重试。', code: 'maa_export_failed' }, 500)
    }
    return jsonResponse({ error: '结果操作失败，请稍后重试。', code: 'result_operation_failed' }, 500)
  }
}

async function resolveResultProfileAccess(userId: string, profileId: string) {
  const profile = await getProfileForUser(userId, profileId)
  if (!profile) return { response: jsonResponse({ error: '账号档案不存在。' }, 404) }
  if (isDepotValueProfile(profile)) {
    return { response: jsonResponse({ error: '仓库分析档案没有排班结果。' }, 403) }
  }
  const authorization = await resolveProfileAuthorization(profile)
  if (!authorization.ok) {
    return {
      response: jsonResponse({ error: authorization.message, code: authorization.code }, authorization.status),
    }
  }
  return { profile, authorization, response: null }
}

function matchResultDetailId(pathname: string): string | null {
  if (!pathname.startsWith('/api/user/results/')) return null
  const encoded = pathname.slice('/api/user/results/'.length)
  if (!encoded || encoded.includes('/')) return null
  try {
    const resultId = decodeURIComponent(encoded)
    return /^[A-Za-z0-9_-]{1,128}$/.test(resultId) ? resultId : null
  } catch {
    return null
  }
}

function readRequiredQueryParameter(url: URL, name: string): string | null {
  const value = url.searchParams.get(name)?.trim() ?? ''
  return value && value.length <= 128 ? value : null
}

function readPageLimit(url: URL): number | undefined | false {
  const raw = url.searchParams.get('limit')
  if (raw === null) return undefined
  if (!/^[1-9][0-9]*$/.test(raw)) return false
  const value = Number(raw)
  return Number.isSafeInteger(value) && value <= OPTIMIZATION_RESULT_PAGE_MAX_SIZE ? value : false
}
