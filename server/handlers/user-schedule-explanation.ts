import { createHash } from 'node:crypto'
import type { AiGenerationAccounting } from '../../src/lib/ai-usage'
import { ZodError } from 'zod'
import { projectOptimizeResultForCapabilities } from '../../src/lib/optimize-result-projection'
import { buildScheduleExplanationSummary, generateScheduleExplanation, SCHEDULE_EXPLANATION_VERSION } from '../schedule-explanation'
import { getScheduleExplanationConfig } from '../storage/ai-settings-store'
import { hasTrainingDiagnosisEntitlement } from '../optimization/jobs/entitlements'
import { parseOptimizeResult } from '../optimization/jobs/runtime-contracts'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson, RequestInputError } from '../security/request-validation'
import { getProfileOptimizationResult } from '../storage/optimization-result-store'
import { readScheduleExplanation, reserveScheduleExplanation, settleScheduleExplanation } from '../storage/schedule-explanation-store'
import { getProfileForUser, listStoredProfilesForUser, normalizeProfileKind } from '../storage/user-store'
import { resolveProfileAuthorization } from './profile-authorization'
import { jsonResponse, requireUserSession } from './user-auth'

export default async function userScheduleExplanationHandler(req: Request): Promise<Response> {
  try {
    const auth = await requireUserSession(req)
    if (!auth) return jsonResponse({ error: '请先登录。' }, 401)
    if (req.method !== 'GET' && req.method !== 'POST') return jsonResponse({ error: '方法不允许。' }, 405)
    const url = new URL(req.url)
    const ids = req.method === 'POST' ? await getValidatedJson(req, requestSchemas.scheduleExplanation, true)
      : requestSchemas.scheduleExplanation.parse({ profile_id: url.searchParams.get('profile_id'), result_id: url.searchParams.get('result_id') })
    const profile = await getProfileForUser(auth.user.id, ids.profile_id)
    if (!profile) return jsonResponse({ error: '账号档案不存在。' }, 404)
    if (profile.kind === 'depot_value') return jsonResponse({ error: '仓库分析档案没有排班结果。' }, 403)
    const authorization = await resolveProfileAuthorization(profile)
    if (!authorization.ok) return jsonResponse({ error: authorization.message, code: authorization.code }, authorization.status)
    const stored = await getProfileOptimizationResult(profile.id, ids.result_id)
    if (!stored) return jsonResponse({ error: '排班结果不存在。' }, 404)
    const result = projectOptimizeResultForCapabilities(parseOptimizeResult(stored.result), {
      kind: normalizeProfileKind(profile), permission: authorization.permission,
    }, Boolean(stored.job_id) && await hasTrainingDiagnosisEntitlement(stored.job_id!))
    const summary = buildScheduleExplanationSummary(result)
    const config = await getScheduleExplanationConfig()
    let monthly = false
    for (const candidate of await listStoredProfilesForUser(auth.user.id)) {
      if (normalizeProfileKind(candidate) === 'cdk' && (await resolveProfileAuthorization(candidate)).ok) { monthly = true; break }
    }
    const input = {
      userId: auth.user.id, profileId: profile.id, resultId: stored.id, config, monthly,
      cacheKey: createHash('sha256').update(JSON.stringify([SCHEDULE_EXPLANATION_VERSION, auth.user.id, profile.id, stored.id, summary])).digest('hex'),
    }
    if (req.method === 'GET') return jsonResponse(await readScheduleExplanation(input))
    const { state, attemptId } = await reserveScheduleExplanation(input)
    if (!attemptId) return jsonResponse(state)
    const started = Date.now()
    let generated: AiGenerationAccounting & { text: string | null }
    try {
      generated = await generateScheduleExplanation(summary, config)
    } catch (error) {
      const localError = error instanceof Error && (error.message === 'explanation_input_too_large' || error.message === 'explanation_disabled')
      generated = { text: null, cost: localError ? 0 : config.reservation, costBasis: localError ? 'usage' : 'reserved',
        usage: null, breakdown: null, providerRequestId: null,
        errorCode: localError ? (error.message === 'explanation_disabled' ? 'disabled' : 'input_too_large') : 'provider_error' }
    }
    await settleScheduleExplanation(input, attemptId, { ...generated, durationMs: Date.now() - started })
    if (!generated.text) return jsonResponse({ error: '本次解读未能完成，未扣除次数。请稍后重试。', code: 'ai_generation_failed' }, 502)
    return jsonResponse(await readScheduleExplanation(input))
  } catch (error) {
    if (error instanceof RequestInputError) return jsonResponse({ error: '解读请求无效。', code: error.code }, error.status)
    if (error instanceof ZodError) return jsonResponse({ error: '排班数据无效，无法解读。', code: 'ai_input_invalid' }, 400)
    // Provider errors may contain credentials or report data; never log their payloads.
    return jsonResponse({ error: '读取排班解读失败，请稍后重试。', code: 'ai_unavailable' }, 503)
  }
}
