import type { ItemUseRequest, OnboardingTaskCode } from '../../src/lib/inventory-contracts'
import {
  claimOnboardingTask,
  createLifetimeProfileForJsonImport,
  InventoryError,
  listInventory,
  listOnboardingTasks,
  useInventoryItem,
} from '../storage/inventory-store'
import { getValidatedJson } from '../security/request-validation'
import { requestSchemas } from '../security/request-policy'
import { buildAuthPayload, jsonResponse, requireUserSession } from './user-auth'

export default async function userInventoryHandler(req: Request): Promise<Response> {
  try {
    const auth = await requireUserSession(req)
    if (!auth) return jsonResponse({ error: '请先登录。' }, 401)
    const path = new URL(req.url).pathname

    if (path === '/api/user/inventory') {
      if (req.method === 'GET') {
        return jsonResponse(await listInventory(auth.user.id))
      }
      if (req.method !== 'POST') return jsonResponse({ error: '方法不允许。' }, 405)
      const body = await getValidatedJson(req, requestSchemas.inventoryUse) as ItemUseRequest
      const result = await useInventoryItem(auth.user.id, body)
      if (!isLimitedProfileActivation(result)) return jsonResponse(result)
      return jsonResponse({
        ...result,
        auth: await buildAuthPayload(auth.user, result.profile_id),
      })
    }

    if (path === '/api/user/inventory/lifetime-profile') {
      if (req.method !== 'POST') return jsonResponse({ error: '方法不允许。' }, 405)
      const body = await getValidatedJson(req, requestSchemas.lifetimeVoucherProfileCreate)
      const created = await createLifetimeProfileForJsonImport({
        userId: auth.user.id,
        idempotencyKey: body.idempotency_key,
        displayName: body.display_name,
        note: body.note,
      })
      return jsonResponse({
        ...(await buildAuthPayload(auth.user, created.profileId)),
        replayed: created.replayed,
      }, 201)
    }

    if (path === '/api/user/onboarding-tasks') {
      if (req.method !== 'GET') return jsonResponse({ error: '方法不允许。' }, 405)
      return jsonResponse({ tasks: await listOnboardingTasks(auth.user.id) })
    }

    if (path === '/api/user/onboarding-tasks/claim' || /^\/api\/user\/onboarding-tasks\/[^/]+\/claim$/.test(path)) {
      if (req.method !== 'POST') return jsonResponse({ error: '方法不允许。' }, 405)
      const body = await getValidatedJson(req, requestSchemas.onboardingTaskClaim)
      const pathTaskCode = path === '/api/user/onboarding-tasks/claim'
        ? null
        : decodeURIComponent(path.split('/')[4] ?? '')
      const taskCode = pathTaskCode ?? body.task_code
      if (taskCode !== 'welcome_inventory' && taskCode !== 'bind_skland' && taskCode !== 'first_main_schedule') {
        return jsonResponse({ error: '新人任务代码无效。' }, 400)
      }
      return jsonResponse(await claimOnboardingTask(
        auth.user.id,
        taskCode as OnboardingTaskCode,
        body.idempotency_key,
      ))
    }

    return jsonResponse({ error: 'API route not found' }, 404)
  } catch (error) {
    if (error instanceof InventoryError) return jsonResponse({ error: error.message, code: error.code }, error.status)
    console.error('user inventory error:', error)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}

type LimitedProfileActivation = {
  operation_id: string
  item_code: 'limited_profile_voucher'
  profile_id: string
  permission: 'advanced'
  starts_at: string
  ends_at: string
}

function isLimitedProfileActivation(result: Record<string, unknown>): result is LimitedProfileActivation {
  return typeof result.operation_id === 'string'
    && result.item_code === 'limited_profile_voucher'
    && typeof result.profile_id === 'string'
    && result.permission === 'advanced'
    && typeof result.starts_at === 'string'
    && typeof result.ends_at === 'string'
}
