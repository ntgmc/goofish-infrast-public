import { createHash } from 'node:crypto'
import type { AiGenerationAccounting } from '../../src/lib/ai-usage'
import { parseWorkspaceAssistantReply } from '../../src/lib/workspace-assistant'
import { getValidatedJson, RequestInputError } from '../security/request-validation'
import { requestSchemas } from '../security/request-policy'
import { generateAiText } from '../schedule-explanation'
import { getScheduleExplanationConfig } from '../storage/ai-settings-store'
import { readScheduleExplanation, reserveScheduleExplanation, settleScheduleExplanation } from '../storage/schedule-explanation-store'
import { getProfileForUser } from '../storage/user-store'
import { assistantInstructions } from '../workspace-assistant'
import { resolveProfileAuthorization } from './profile-authorization'
import { jsonResponse, requireUserSession } from './user-auth'
import { hasMonthlyAiQuota } from './user-schedule-explanation'

export default async function userWorkspaceAssistantHandler(req: Request): Promise<Response> {
  try {
    const auth = await requireUserSession(req)
    if (!auth) return jsonResponse({ error: '请先登录。' }, 401)
    if (req.method !== 'GET' && req.method !== 'POST') return jsonResponse({ error: '方法不允许。' }, 405)
    const body = req.method === 'POST' ? await getValidatedJson(req, requestSchemas.workspaceAssistant, true) : null
    const profileId = body?.profile_id ?? new URL(req.url).searchParams.get('profile_id')
    if (!profileId || profileId.length > 128) return jsonResponse({ error: '请先选择档案。' }, 400)
    const profile = await getProfileForUser(auth.user.id, profileId)
    if (!profile) return jsonResponse({ error: '账号档案不存在。' }, 404)
    const authorization = await resolveProfileAuthorization(profile)
    if (!authorization.ok) return jsonResponse({ error: authorization.message, code: authorization.code }, authorization.status)
    const config = await getScheduleExplanationConfig()
    const input = {
      userId: auth.user.id, profileId: profile.id, resultId: null,
      cacheKey: createHash('sha256').update(JSON.stringify(['workspace-assistant', auth.user.id, profile.id, body])).digest('hex'),
      monthly: await hasMonthlyAiQuota(auth.user.id), config,
    }
    if (!body) return jsonResponse(await readScheduleExplanation(input))
    const { attemptId, state } = await reserveScheduleExplanation(input)
    if (!attemptId) return jsonResponse({ reply: null, state })
    const started = Date.now()
    let generated: AiGenerationAccounting & { text: string | null }
    try {
      const content = body.task === 'comparison' ? { question: body.question, context: body.context } : { question: body.question, candidates: body.candidates }
      generated = await generateAiText(JSON.stringify(content), config, assistantInstructions[body.task])
    } catch (error) {
      const local = error instanceof Error && (error.message === 'explanation_disabled' || error.message === 'explanation_input_too_large')
      generated = { text: null, cost: local ? 0 : config.reservation, costBasis: local ? 'usage' : 'reserved', usage: null, breakdown: null, providerRequestId: null,
        errorCode: local ? (error.message === 'explanation_disabled' ? 'disabled' : 'input_too_large') : 'provider_error' }
    }
    const reply = generated.text ? parseWorkspaceAssistantReply(generated.text, body) : null
    await settleScheduleExplanation(input, attemptId, { ...generated, text: reply ? generated.text : null,
      errorCode: generated.errorCode ?? (reply ? null : 'incomplete_output'), durationMs: Date.now() - started })
    if (!reply) return jsonResponse({ error: '助手未能完成整理，未扣除 AI 次数。请缩短描述或稍后重试。', code: 'assistant_invalid_output' }, 502)
    return jsonResponse({ reply, state: await readScheduleExplanation(input) })
  } catch (error) {
    if (error instanceof RequestInputError) return jsonResponse({ error: '请核对问题和待比较的选项。', code: error.code }, error.status)
    return jsonResponse({ error: '助手暂时不可用，请稍后重试。', code: 'assistant_unavailable' }, 503)
  }
}
