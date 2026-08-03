import { getValidatedJson } from '../security/request-validation'
import { requestSchemas } from '../security/request-policy'
import { jsonResponse, requireUserSession } from './user-auth'
import {
  createCommercialProfile,
  batchArchiveCommercialProfiles,
  createOrConvertMeteredPersonal,
  deleteCommercialProfile,
  listCommercialProfiles,
  MeteredProfileError,
  patchCommercialProfile,
} from '../storage/metered-profile-store'
import { getRequestClientIp } from '../security/client-ip'
import { PersonalUseDeclarationRequiredError } from '../storage/personal-use-declaration-store'

export default async function userMeteredProfilesHandler(req: Request): Promise<Response> {
  try {
    const auth = await requireUserSession(req)
    if (!auth) return jsonResponse({ error: '请先登录。' }, 401)
    const url = new URL(req.url)
    if (url.pathname.endsWith('/metered-personal')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      const body = await getValidatedJson(req, requestSchemas.meteredPersonalProfile)
      return jsonResponse({ profile: await createOrConvertMeteredPersonal({
        userId: auth.user.id,
        profileId: body.profile_id,
        displayName: body.display_name,
        note: body.note,
        personalUseClientIp: getRequestClientIp(req),
      }) }, 201)
    }
    if (req.method === 'GET') {
      const rawState = url.searchParams.get('state') ?? 'active'
      if (rawState !== 'active' && rawState !== 'archived') {
        return jsonResponse({ error: '商用档案状态筛选无效。', code: 'invalid_state' }, 400)
      }
      const state = rawState
      const rawLimit = url.searchParams.get('limit')
      return jsonResponse(await listCommercialProfiles({
        userId: auth.user.id,
        state,
        query: url.searchParams.get('q'),
        cursor: url.searchParams.get('cursor'),
        limit: rawLimit === null ? undefined : Number(rawLimit),
      }))
    }
    if (req.method === 'POST') {
      const body = await getValidatedJson(req, requestSchemas.commercialProfileCreate)
      return jsonResponse(await createCommercialProfile({
        userId: auth.user.id,
        displayName: body.display_name,
        note: body.note,
      }), 201)
    }
    if (req.method === 'PATCH') {
      const body = await getValidatedJson(req, requestSchemas.commercialProfilePatch)
      if (body.action === 'batch_archive') {
        return jsonResponse(await batchArchiveCommercialProfiles({
          userId: auth.user.id,
          profileIds: body.profile_ids,
          operationId: body.operation_id,
        }))
      }
      return jsonResponse(await patchCommercialProfile({
        userId: auth.user.id,
        profileId: body.profile_id,
        action: body.action,
        displayName: body.display_name,
        note: body.note,
      }))
    }
    if (req.method === 'DELETE') {
      const body = await getValidatedJson(req, requestSchemas.commercialProfileDelete)
      return jsonResponse(await deleteCommercialProfile({
        userId: auth.user.id,
        profileId: body.profile_id,
        confirmed: body.confirm_permanent_delete,
      }))
    }
    return jsonResponse({ error: 'Method not allowed' }, 405)
  } catch (error) {
    if (error instanceof PersonalUseDeclarationRequiredError) {
      return jsonResponse({ error: error.message, code: error.code }, error.status)
    }
    if (error instanceof MeteredProfileError) return jsonResponse({ error: error.message, code: error.code }, error.status)
    console.error('metered profiles error:', error)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}
