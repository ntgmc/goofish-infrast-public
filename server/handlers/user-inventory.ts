import type { ItemUseRequest, OnboardingTaskCode } from '../../src/lib/inventory-contracts'
import {
  claimOnboardingTask,
  InventoryError,
  listInventory,
  listOnboardingTasks,
  useInventoryItem,
} from '../storage/inventory-store'
import { getValidatedJson } from '../security/request-validation'
import { requestSchemas } from '../security/request-policy'
import { getReorderCheckQuota } from '../optimization/jobs/entitlements'
import { jsonResponse, requireUserSession } from './user-auth'

export default async function userInventoryHandler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)
  try {
    const auth = await requireUserSession(req)
    if (!auth) return jsonResponse({ error: '请先登录。' }, 401)
    const path = new URL(req.url).pathname

    if (path === '/api/user/inventory') {
      if (req.method === 'GET') {
        const inventory = await listInventory(auth.user.id)
        const reorderQuotas = await Promise.all(inventory.capacities.map(async (profile) => ({
          profile_id: profile.profile_id,
          ...await getReorderCheckQuota(profile.profile_id),
        })))
        return jsonResponse({ ...inventory, reorder_quotas: reorderQuotas })
      }
      if (req.method !== 'POST') return jsonResponse({ error: '方法不允许。' }, 405)
      const body = await getValidatedJson(req, requestSchemas.inventoryUse) as ItemUseRequest
      return jsonResponse(await useInventoryItem(auth.user.id, body))
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
