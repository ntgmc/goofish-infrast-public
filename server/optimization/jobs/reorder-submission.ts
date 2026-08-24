import { createHash, randomUUID } from 'node:crypto'
import type { CreateReorderCheckRequest } from '../../../src/lib/optimization-contracts'
import type { WorkspaceResultHistoryExportItem, WorkspaceResultHistoryItem } from '../../../src/lib/types'
import { resolveConfigForPermission, resolveFreePreviewConfig } from '../../handlers/license-utils'
import { resolveProfileAuthorization } from '../../handlers/profile-authorization'
import { requireUserSession } from '../../handlers/user-auth'
import { isFreePreviewTrialActive } from '../../free-preview-trial'
import { getServiceLifecycleState } from '../../lifecycle'
import { requestOptimizeJobProcessing } from '../../optimize-job-signals'
import { getShanghaiMonthKey, REORDER_CHECK_MONTHLY_LIMIT } from '../../reorder-check-policy'
import { requestSchemas } from '../../security/request-policy'
import { getValidatedJson, stableJsonStringify } from '../../security/request-validation'
import { getOptimizeJobStore, isOptimizeJobAdmissionError } from '../../storage/optimize-job-store'
import { emptyWorkspace, getProfileForUser, getWorkspace, isFreePreviewProfile } from '../../storage/user-store'
import {
  getLatestProfileOptimizationResult,
  getProfileOptimizationResult,
} from '../../storage/optimization-result-store'
import { getReorderCheckQuota } from './entitlements'
import { buildOptimizeJobAccepted, getOptimizeEstimateBucket, resolveOptimizeDurationEstimate } from './job-status'
import { jsonResponse, sanitizeConfigForPublicOptimize } from './http-core'
import { resolveBaselineHistoryItem } from './reorder-baseline'
import { recordReorderCheckEvent } from './reorder-telemetry'
import type { ReorderCheckJobPayload } from './shared'
import { getRequestClientIp } from '../../security/client-ip'
import {
  PersonalUseDeclarationRequiredError,
  recordPersonalUseDeclarationUsage,
} from '../../storage/personal-use-declaration-store'

export async function submitReorderCheck(req: Request): Promise<Response> {
  const startedAt = Date.now()
  let profileIdForUsage: string | undefined
  const lifecycleState = getServiceLifecycleState()
  if (lifecycleState === 'draining' || lifecycleState === 'stopped') {
    const response = jsonResponse({ error: '服务正在重启或排空任务，请稍后重试。', code: 'service_draining' }, 503)
    response.headers.set('Retry-After', '60')
    return response
  }
  const idempotencyKey = normalizeIdempotencyKey(req.headers.get('Idempotency-Key'))
  if (!idempotencyKey) return jsonResponse({ error: '本次提交信息不完整，请重新操作。', code: 'idempotency_key_required' }, 400)

  try {
    const body = await getValidatedJson(req, requestSchemas.reorderCheck) as CreateReorderCheckRequest
    const useCoupon = body.use_items?.includes('reorder_check_coupon') === true
    const requestHash = createHash('sha256').update(stableJsonStringify(body)).digest('hex')
    const store = getOptimizeJobStore()
    const activeProfileId = typeof body.profileId === 'string' ? body.profileId.trim() : ''
    if (!activeProfileId || !body.config) {
      await recordReorderCheckEvent('failure', 'validation_failed', startedAt)
      return jsonResponse({ error: '请先选择游戏账号并完成排班设置。' }, 400)
    }
    profileIdForUsage = activeProfileId

    const auth = await requireUserSession(req)
    if (!auth) {
      await recordReorderCheckEvent('failure', 'auth_required', startedAt, profileIdForUsage)
      return jsonResponse({ error: '请先登录后再检测是否需要重排。' }, 401)
    }
    const profile = await getProfileForUser(auth.user.id, activeProfileId)
    if (!profile) {
      await recordReorderCheckEvent('failure', 'profile_missing', startedAt, profileIdForUsage)
      return jsonResponse({ error: '档案不存在。' }, 404)
    }
    const replayed = await store.findIdempotentJob(
      `reorder-job:${activeProfileId}`,
      idempotencyKey,
      requestHash,
    )
    if (replayed) return jsonResponse({ job: await buildOptimizeJobAccepted(replayed) }, 202)
    if (!isFreePreviewProfile(profile)) {
      await recordReorderCheckEvent('failure', 'permission_denied', startedAt, profileIdForUsage)
      return jsonResponse({ error: '重排检测仅面向免费个人排班档案开放。' }, 403)
    }
    const isPreviewTrial = isFreePreviewTrialActive(profile)
    const authorization = await resolveProfileAuthorization(profile)
    if (!authorization.ok) {
      const reason = authorization.code.includes('revoked') ? 'cdk_revoked' : authorization.code.includes('frozen') ? 'cdk_frozen' : 'permission_denied'
      await recordReorderCheckEvent('failure', reason, startedAt, profileIdForUsage)
      return jsonResponse({ error: authorization.message, code: authorization.code }, authorization.status)
    }
    if (!profile.skland_binding) {
      await recordReorderCheckEvent('failure', 'permission_denied', startedAt, profileIdForUsage)
      return jsonResponse({ error: '免费个人排班档案必须先绑定森空岛后才能检测是否需要重排。' }, 403)
    }

    const workspace = await getWorkspace(activeProfileId) ?? emptyWorkspace(activeProfileId)
    const operators = Array.isArray(workspace.operators) ? workspace.operators : []
    if (operators.length === 0) {
      await recordReorderCheckEvent('failure', 'validation_failed', startedAt, profileIdForUsage)
      return jsonResponse({ error: '暂无可用于重排检测的森空岛干员数据。' }, 409)
    }
    const storedBaselineItem = typeof body.baselineHistoryId === 'string' && body.baselineHistoryId.trim()
      ? await getProfileOptimizationResult(activeProfileId, body.baselineHistoryId.trim())
      : await getLatestProfileOptimizationResult(activeProfileId)
    const baselineItem = storedBaselineItem ? toReorderJobBaseline(storedBaselineItem) : null
    const baseline = resolveBaselineHistoryItem(baselineItem ? [baselineItem] : [], body.baselineHistoryId)
    if (!baseline.ok) {
      await recordReorderCheckEvent('failure', 'validation_failed', startedAt, profileIdForUsage)
      return jsonResponse({ error: baseline.message }, baseline.status)
    }
    const configForPermission = isPreviewTrial
      ? resolveConfigForPermission('advanced', body.config)
      : resolveFreePreviewConfig(body.config)
    if (!configForPermission.ok) {
      await recordReorderCheckEvent('failure', 'permission_denied', startedAt, profileIdForUsage)
      return jsonResponse({ error: configForPermission.message }, 403)
    }

    const effectiveConfig = sanitizeConfigForPublicOptimize(configForPermission.config, isPreviewTrial ? 'advanced' : 'free_preview')
    const estimate = await resolveOptimizeDurationEstimate(getOptimizeEstimateBucket(effectiveConfig, false))
    const payload: ReorderCheckJobPayload = {
      version: 3,
      kind: 'reorder_check',
      submittedAt: startedAt,
      operators,
      effectiveConfig,
      activeProfileId,
      isPreviewTrial,
      baseline: baseline.item,
      estimate,
    }
    if (useCoupon && isPreviewTrial) {
      return jsonResponse({ error: '试用档案无需使用调序检查券。', code: 'item_not_applicable' }, 409)
    }
    await recordPersonalUseDeclarationUsage({
      userId: auth.user.id,
      profileId: activeProfileId,
      action: 'reorder_check',
      clientIp: getRequestClientIp(req),
    })
    const admitted = await store.admitJob({
      id: randomUUID(),
      priority: 0,
      owner_key: `reorder-job:${activeProfileId}`,
      profile_id: activeProfileId,
      permission: 'free_preview',
      source: 'reorder_check',
      payload_json: payload,
      idempotency_key: idempotencyKey,
      request_hash: requestHash,
      reward_user_id: useCoupon ? auth.user.id : null,
      reward_item_codes: useCoupon ? ['reorder_check_coupon'] : [],
      reorderCheckQuota: isPreviewTrial ? null : {
        profileId: activeProfileId,
        windowKey: getShanghaiMonthKey(new Date()),
        limit: REORDER_CHECK_MONTHLY_LIMIT,
        useCoupon,
      },
    })
    requestOptimizeJobProcessing()
    return jsonResponse({ job: await buildOptimizeJobAccepted(admitted.job) }, 202)
  } catch (error) {
    if (error instanceof PersonalUseDeclarationRequiredError) {
      return jsonResponse({ error: error.message, code: error.code }, error.status)
    }
    if (isOptimizeJobAdmissionError(error)) {
      await recordReorderCheckEvent(
        'failure',
        error.code === 'reorder_check_quota_exceeded' ? 'monthly_quota_exceeded' : 'validation_failed',
        startedAt,
        profileIdForUsage,
      )
      const quota = error.code === 'reorder_check_quota_exceeded' && profileIdForUsage
        ? await getReorderCheckQuota(profileIdForUsage)
        : undefined
      return jsonResponse({ error: error.message, code: error.code, ...(quota && { quota }) }, error.status)
    }
    console.error('reorder-check enqueue error:', error)
    await recordReorderCheckEvent('failure', 'optimizer_runtime_error', startedAt, profileIdForUsage)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}

function toReorderJobBaseline(item: WorkspaceResultHistoryExportItem): WorkspaceResultHistoryItem {
  return {
    id: item.id,
    ...(item.job_id ? { job_id: item.job_id } : {}),
    name: item.name,
    created_at: item.created_at,
    config: item.config,
    result: item.result,
    operator_count: item.operator_count,
    source: item.source,
  }
}

function normalizeIdempotencyKey(value: string | null): string | null {
  const key = value?.trim() ?? ''
  return key && key.length <= 200 ? key : null
}
