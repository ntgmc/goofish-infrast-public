import type { Context } from '@netlify/functions'
import type { ProductPermissionMode } from '../../src/lib/types'
import {
  CDK_PRODUCT_PERMISSIONS,
  generateCdk,
  getOperatorUpdateGrantRemaining,
  getCdkRecordStore,
  hashCdk,
  jsonResponse,
  requireEnv,
  unfreezeCdkRecord,
  type CdkRecord,
  type CdkStatus,
} from './license-utils'

type CdkStatusFilter = CdkStatus | 'all'

const PRODUCT_PERMISSION_RANK: Record<ProductPermissionMode, number> = {
  recommended: 0,
  growth: 1,
  advanced: 2,
  ultimate: 3,
}

export default async (req: Request, _context: Context): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return jsonResponse(null, 204)
  }
  if (req.method === 'GET') {
    return handleList(req)
  }
  if (req.method === 'DELETE') {
    return handleDelete(req)
  }
  if (req.method === 'PATCH') {
    return handlePatch(req)
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    const { admin_password, permission, order_note } = await req.json() as {
      admin_password?: string;
      permission?: string;
      order_note?: string;
    }
    const adminPassword = requireEnv('MAA_ADMIN_PASSWORD')
    const hashSecret = requireEnv('CDK_HASH_SECRET')

    if (admin_password !== adminPassword) {
      return jsonResponse({ error: '管理口令错误。' }, 401)
    }
    if (!permission || !(CDK_PRODUCT_PERMISSIONS as string[]).includes(permission)) {
      return jsonResponse({ error: 'CDK 类型必须是 recommended、growth、advanced 或 ultimate。' }, 400)
    }
    const cdkPermission = permission as ProductPermissionMode

    const store = await getCdkRecordStore()
    let code = generateCdk()
    let codeHash = hashCdk(code, hashSecret)
    let key = `cdk/${codeHash}.json`
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const existing = await store.get(key)
      if (!existing) break
      code = generateCdk()
      codeHash = hashCdk(code, hashSecret)
      key = `cdk/${codeHash}.json`
    }

    const createdAt = new Date().toISOString()
    const record: CdkRecord = {
      version: 1,
      code_hash: codeHash,
      permission: cdkPermission,
      status: 'unused',
      created_at: createdAt,
      used_at: null,
      revoked_at: null,
      order_note: order_note?.trim() || null,
      license_order_hash: null,
      operator_count: null,
      config_desc: null,
      schedule_generate_count: 0,
    }
    await store.set(key, record)

    return jsonResponse({ code, permission: cdkPermission, created_at: createdAt })
  } catch (error) {
    console.error('admin cdk error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return jsonResponse({ error: message }, 500)
  }
}

async function handleList(req: Request): Promise<Response> {
  try {
    const adminPassword = requireEnv('MAA_ADMIN_PASSWORD')
    const providedPassword = req.headers.get('X-Admin-Password')
    if (providedPassword !== adminPassword) {
      return jsonResponse({ error: '管理口令错误。' }, 401)
    }

    const status = normalizeStatusFilter(req.headers.get('X-Cdk-Status'), req.url)
    const store = await getCdkRecordStore()
    const records = (await store.list('cdk/'))
      .filter((record) => status === 'all' || record.status === status)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))

    return jsonResponse({
      status,
      total: records.length,
      cdks: records.map(toAdminCdkRecord),
    })
  } catch (error) {
    console.error('admin cdk list error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return jsonResponse({ error: message }, 500)
  }
}

async function handlePatch(req: Request): Promise<Response> {
  try {
    const { admin_password, code_hash, action, permission } = await req.json() as {
      admin_password?: string;
      code_hash?: string;
      action?: string;
      permission?: string;
    }
    const adminPassword = requireEnv('MAA_ADMIN_PASSWORD')

    if (admin_password !== adminPassword) {
      return jsonResponse({ error: '管理口令错误。' }, 401)
    }
    if (action !== 'revoke' && action !== 'upgrade' && action !== 'grant_operator_update' && action !== 'unfreeze') {
      return jsonResponse({ error: 'Unsupported action.' }, 400)
    }
    if (!code_hash || !/^[a-f0-9]{64}$/i.test(code_hash)) {
      return jsonResponse({ error: 'Invalid CDK identifier.' }, 400)
    }

    const store = await getCdkRecordStore()
    const key = `cdk/${code_hash}.json`
    const existing = await store.get(key) as CdkRecord | null

    if (!existing) {
      return jsonResponse({ error: 'CDK not found.' }, 404)
    }

    if (action === 'unfreeze') {
      if (existing.status === 'revoked') {
        return jsonResponse({ error: '已撤销授权不能解冻。' }, 409)
      }
      if (existing.status !== 'frozen') {
        return jsonResponse({
          unfrozen: true,
          already_unfrozen: true,
          cdk_id: existing.code_hash.slice(0, 12),
          status: existing.status,
        })
      }
      const updated = await unfreezeCdkRecord(existing)
      return jsonResponse({
        unfrozen: true,
        already_unfrozen: false,
        cdk_id: existing.code_hash.slice(0, 12),
        status: updated.status,
      })
    }

    if (action === 'upgrade') {
      if (!permission || !(CDK_PRODUCT_PERMISSIONS as string[]).includes(permission)) {
        return jsonResponse({ error: '目标 CDK 类型必须是 recommended、growth、advanced 或 ultimate。' }, 400)
      }
      if (existing.status === 'revoked') {
        return jsonResponse({ error: '已撤销授权不能升级。' }, 409)
      }
      const currentPermission = normalizeProductPermission(existing.permission)
      if (!currentPermission) {
        return jsonResponse({ error: '当前授权类型不支持后台升级。' }, 409)
      }
      const nextPermission = permission as ProductPermissionMode
      if (PRODUCT_PERMISSION_RANK[nextPermission] <= PRODUCT_PERMISSION_RANK[currentPermission]) {
        return jsonResponse({ error: '只能升级到更高等级的授权。' }, 409)
      }

      const updated: CdkRecord = {
        ...existing,
        permission: nextPermission,
      }
      await store.set(key, updated)
      return jsonResponse({
        upgraded: true,
        cdk_id: existing.code_hash.slice(0, 12),
        previous_permission: currentPermission,
        permission: nextPermission,
      })
    }

    if (action === 'grant_operator_update') {
      if (existing.status === 'revoked') {
        return jsonResponse({ error: '已撤销授权不能发放干员更新权限。' }, 409)
      }
      if (existing.status !== 'used') {
        return jsonResponse({ error: '只能给已使用 CDK 发放干员更新权限。' }, 409)
      }
      if (!existing.license_order_hash) {
        return jsonResponse({ error: '授权记录缺少订单标识，无法发放干员更新权限。' }, 409)
      }

      const remaining = getOperatorUpdateGrantRemaining(existing)
      if (remaining > 0) {
        return jsonResponse({
          granted: true,
          already_granted: true,
          cdk_id: existing.code_hash.slice(0, 12),
          operator_update_grant_remaining: remaining,
          operator_update_granted_at: existing.operator_update_granted_at ?? null,
        })
      }

      const grantedAt = new Date().toISOString()
      const updated: CdkRecord = {
        ...existing,
        operator_update_grant_count: (existing.operator_update_grant_count ?? 0) + 1,
        operator_update_granted_at: grantedAt,
      }
      await store.set(key, updated)
      return jsonResponse({
        granted: true,
        already_granted: false,
        cdk_id: existing.code_hash.slice(0, 12),
        operator_update_grant_remaining: getOperatorUpdateGrantRemaining(updated),
        operator_update_granted_at: grantedAt,
      })
    }

    if (existing.status === 'revoked') {
      return jsonResponse({
        revoked: true,
        already_revoked: true,
        cdk_id: existing.code_hash.slice(0, 12),
        revoked_at: existing.revoked_at ?? null,
      })
    }
    if (existing.status !== 'used' && existing.status !== 'frozen') {
      return jsonResponse({ error: 'Only used or frozen CDKs can be revoked.' }, 409)
    }

    const revokedAt = new Date().toISOString()
    const updated: CdkRecord = {
      ...existing,
      status: 'revoked',
      revoked_at: revokedAt,
    }
    await store.set(key, updated)
    return jsonResponse({
      revoked: true,
      already_revoked: false,
      cdk_id: existing.code_hash.slice(0, 12),
      revoked_at: revokedAt,
    })
  } catch (error) {
    console.error('admin cdk revoke error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return jsonResponse({ error: message }, 500)
  }
}

async function handleDelete(req: Request): Promise<Response> {
  try {
    const { admin_password, code_hash } = await req.json() as {
      admin_password?: string;
      code_hash?: string;
    }
    const adminPassword = requireEnv('MAA_ADMIN_PASSWORD')

    if (admin_password !== adminPassword) {
      return jsonResponse({ error: 'Invalid admin password.' }, 401)
    }
    if (!code_hash || !/^[a-f0-9]{64}$/i.test(code_hash)) {
      return jsonResponse({ error: 'Invalid CDK identifier.' }, 400)
    }

    const store = await getCdkRecordStore()
    const key = `cdk/${code_hash}.json`
    const existing = await store.get(key) as CdkRecord | null

    if (!existing) {
      return jsonResponse({ error: 'CDK not found.' }, 404)
    }
    if (existing.status !== 'unused') {
      return jsonResponse({ error: 'Only unused CDKs can be deleted.' }, 409)
    }

    await store.delete(key)
    return jsonResponse({ deleted: true, cdk_id: existing.code_hash.slice(0, 12) })
  } catch (error) {
    console.error('admin cdk delete error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return jsonResponse({ error: message }, 500)
  }
}

function normalizeStatusFilter(headerValue: string | null, requestUrl: string): CdkStatusFilter {
  if (headerValue === 'used' || headerValue === 'frozen' || headerValue === 'revoked' || headerValue === 'all') return headerValue
  const queryValue = new URL(requestUrl).searchParams.get('status')
  if (queryValue === 'used' || queryValue === 'frozen' || queryValue === 'revoked' || queryValue === 'all') return queryValue
  return 'unused'
}

function toAdminCdkRecord(record: CdkRecord) {
  return {
    code_hash: record.code_hash,
    cdk_id: record.code_hash.slice(0, 12),
    permission: record.permission,
    status: record.status,
    created_at: record.created_at,
    used_at: record.used_at,
    revoked_at: record.revoked_at ?? null,
    frozen_at: record.frozen_at ?? null,
    freeze_reason: record.freeze_reason ?? null,
    order_note: record.order_note,
    license_order_hash: record.license_order_hash,
    operator_count: record.operator_count,
    config_desc: record.config_desc,
    schedule_generate_count: record.schedule_generate_count ?? 0,
    operator_update_grant_count: record.operator_update_grant_count ?? 0,
    operator_update_used_count: record.operator_update_used_count ?? 0,
    operator_update_grant_remaining: getOperatorUpdateGrantRemaining(record),
    operator_update_granted_at: record.operator_update_granted_at ?? null,
    operator_update_consumed_at: record.operator_update_consumed_at ?? null,
    operator_update_event_count: record.operator_update_events?.length ?? 0,
    activation_bound: Boolean(record.activation_token_hash),
    user_agent_count: new Set((record.user_agent_events ?? []).map((event) => event.hash)).size,
    ip_prefix_count: new Set((record.ip_prefix_events ?? []).map((event) => event.hash)).size,
    risk_event_count: record.risk_events?.length ?? 0,
    latest_risk_event: record.risk_events?.at(-1) ?? null,
  }
}

function normalizeProductPermission(permission: CdkRecord['permission']): ProductPermissionMode | null {
  if (permission === 'basic') return 'growth'
  if (permission === 'premium') return 'advanced'
  if ((CDK_PRODUCT_PERMISSIONS as string[]).includes(permission)) return permission as ProductPermissionMode
  return null
}
