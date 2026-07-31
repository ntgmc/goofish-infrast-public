import { isCurrentPersonalUseDeclarationEffective, toPublicPersonalUseDeclaration, type PersonalUseDeclarationAction } from '../personal-use-declaration'
import { getRequestClientIp } from '../security/client-ip'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson } from '../security/request-validation'
import { getProfileForUser, isFreePreviewProfile } from '../storage/user-store'
import { confirmPersonalUseDeclaration, getPersonalUseDeclarationAcceptance } from '../storage/personal-use-declaration-store'
import { jsonResponse, requireUserSession } from './user-auth'

export default async function personalUseDeclarationHandler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)
  const auth = await requireUserSession(req)
  if (!auth) return jsonResponse({ error: '请先登录。' }, 401)

  try {
    if (req.method === 'GET') {
      const profileId = new URL(req.url).searchParams.get('profile_id')
      if (profileId) {
        const profile = await getProfileForUser(auth.user.id, profileId)
        if (!profile || (!isFreePreviewProfile(profile) && profile.kind !== 'metered_personal')) {
          return jsonResponse({ error: '该操作仅适用于免费预览或个人按次档案。' }, 403)
        }
      }
      const effective = isCurrentPersonalUseDeclarationEffective()
      const acceptance = effective ? await getPersonalUseDeclarationAcceptance(auth.user.id) : null
      return jsonResponse({ declaration: toPublicPersonalUseDeclaration(), accepted: !effective || Boolean(acceptance), effective })
    }

    if (req.method === 'POST') {
      const body = await getValidatedJson(req, requestSchemas.personalUseDeclarationConfirmation)
      const action = body.action as PersonalUseDeclarationAction
      const profileId = body.profile_id ?? null
      if (action === 'free_preview_claim' && profileId) return jsonResponse({ error: '领取免费权益时不应提交 profile_id。' }, 400)
      if (action === 'metered_personal_create' && profileId) {
        const profile = await getProfileForUser(auth.user.id, profileId)
        if (!profile || !isFreePreviewProfile(profile)) return jsonResponse({ error: '只能将免费预览档案转换为个人按次档案。' }, 403)
      }
      if (action === 'generated_result_export') {
        if (!profileId) return jsonResponse({ error: '缺少 profile_id。' }, 400)
        const profile = await getProfileForUser(auth.user.id, profileId)
        if (!profile || (!isFreePreviewProfile(profile) && profile.kind !== 'metered_personal')) {
          return jsonResponse({ error: '该操作仅适用于免费预览或个人按次档案。' }, 403)
        }
      }
      if (!isCurrentPersonalUseDeclarationEffective()) {
        return jsonResponse({ declaration: toPublicPersonalUseDeclaration(), accepted: true, effective: false })
      }
      const acceptance = await confirmPersonalUseDeclaration(auth.user.id, action, getRequestClientIp(req), profileId)
      return jsonResponse({ declaration: toPublicPersonalUseDeclaration(), accepted: true, effective: true, acceptance: toPublicAcceptance(acceptance) })
    }

    return jsonResponse({ error: 'Method not allowed' }, 405)
  } catch (error) {
    console.error('personal use declaration error:', error)
    return jsonResponse({ error: '个人使用声明暂时不可用，请稍后重试。' }, 500)
  }
}

function toPublicAcceptance(acceptance: { declaration_id: string; declaration_version: string; action: PersonalUseDeclarationAction; accepted_at: string }) {
  return {
    declaration_id: acceptance.declaration_id,
    declaration_version: acceptance.declaration_version,
    action: acceptance.action,
    accepted_at: acceptance.accepted_at,
  }
}
