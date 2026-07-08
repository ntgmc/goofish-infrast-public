import type { ProductPermissionMode } from '../../src/lib/types'
import { authenticateAdminRequest } from './admin-auth'
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

const MAX_BATCH_CREATE_COUNT = 100
const MAX_CDK_GENERATION_ATTEMPTS = 10

const PRODUCT_PERMISSION_RANK: Record<ProductPermissionMode, number> = {
  recommended: 0,
  growth: 1,
  advanced: 2,
  ultimate: 3,
}

export default async (req: Request): Promise<Response> => {
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
    const body = await req.json() as {
      admin_password?: string;
      admin_user?: string;
      permission?: string;
      order_note?: string;
      count?: unknown;
    }
    const { permission, order_note, count } = body
    const hashSecret = requireEnv('CDK_HASH_SECRET')

    if (!(await authenticateAdminRequest(req, body))) {
      return jsonResponse({ error: '管理账号或密码错误。' }, 401)
    }
    if (!permission || !(CDK_PRODUCT_PERMISSIONS as string[]).includes(permission)) {
      return jsonResponse({ error: 'CDK 类型必须是 recommended、growth、advanced 或 ultimate。' }, 400)
    }
    const cdkPermission = permission as ProductPermissionMode

    const store = await getCdkRecordStore()
    const batchCount = normalizeCreateCount(count)
    if (batchCount === null) {
      return jsonResponse({ error: `生成数量必须是 1-${MAX_BATCH_CREATE_COUNT} 的整数。` }, 400)
    }
    const createdAt = new Date().toISOString()
    const orderNote = order_note?.trim() || null
    const createdCdks = await createCdkBatch(store, {
      count: batchCount,
      createdAt,
      hashSecret,
      orderNote,
      permission: cdkPermission,
    })
    const response = {
      permission: cdkPermission,
      created_at: createdAt,
      count: createdCdks.length,
      cdks: createdCdks.map(({ code }) => ({ code, permission: cdkPermission, created_at: createdAt })),
    }

    return jsonResponse(batchCount === 1 ? { code: createdCdks[0]?.code, ...response } : response)
  } catch (error) {
    console.error('admin cdk error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return jsonResponse({ error: message }, 500)
  }
}

interface CreatedCdk {
  code: string;
  codeHash: string;
}

interface CreateCdkBatchOptions {
  count: number;
  createdAt: string;
  hashSecret: string;
  orderNote: string | null;
  permission: ProductPermissionMode;
}

function normalizeCreateCount(value: unknown): number | null {
  if (value === undefined) return 1
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  if (value < 1 || value > MAX_BATCH_CREATE_COUNT) return null
  return value
}

async function createCdkBatch(
  store: Awaited<ReturnType<typeof getCdkRecordStore>>,
  options: CreateCdkBatchOptions,
): Promise<CreatedCdk[]> {
  const created: CreatedCdk[] = []
  const generatedHashes = new Set<string>()

  for (let index = 0; index < options.count; index += 1) {
    const generated = await generateUniqueCdk(store, options.hashSecret, generatedHashes)
    generatedHashes.add(generated.codeHash)

    const record: CdkRecord = {
      version: 1,
      code_hash: generated.codeHash,
      permission: options.permission,
      status: 'unused',
      created_at: options.createdAt,
      used_at: null,
      revoked_at: null,
      order_note: options.orderNote,
      license_order_hash: null,
      operator_count: null,
      config_desc: null,
      schedule_generate_count: 0,
    }
    await store.set(`cdk/${generated.codeHash}.json`, record)
    created.push(generated)
  }

  return created
}

async function generateUniqueCdk(
  store: Awaited<ReturnType<typeof getCdkRecordStore>>,
  hashSecret: string,
  generatedHashes: Set<string>,
): Promise<CreatedCdk> {
  for (let attempt = 0; attempt < MAX_CDK_GENERATION_ATTEMPTS; attempt += 1) {
    const code = generateCdk()
    const codeHash = hashCdk(code, hashSecret)
    if (generatedHashes.has(codeHash)) continue

    const existing = await store.get(`cdk/${codeHash}.json`)
    if (!existing) return { code, codeHash }
  }

  throw new Error('生成 CDK 失败，请重试。')
}

async function handleList(req: Request): Promise<Response> {
  try {
    if (!(await authenticateAdminRequest(req))) {
      return jsonResponse({ error: '管理账号或密码错误。' }, 401)
    }

    const detailCodeHash = new URL(req.url).searchParams.get('code_hash')
    if (detailCodeHash) {
      if (!/^[a-f0-9]{64}$/i.test(detailCodeHash)) {
        return jsonResponse({ error: 'Invalid CDK identifier.' }, 400)
      }
      const store = await getCdkRecordStore()
      const record = await store.get(`cdk/${detailCodeHash}.json`)
      if (!record) return jsonResponse({ error: 'CDK not found.' }, 404)
      return jsonResponse({ cdk: toAdminCdkDetail(record) })
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
    const body = await req.json() as {
      admin_password?: string;
      admin_user?: string;
      code_hash?: string;
      action?: string;
      permission?: string;
      order_note?: string;
    }
    const { code_hash, action, permission, order_note } = body

    if (!(await authenticateAdminRequest(req, body))) {
      return jsonResponse({ error: '管理账号或密码错误。' }, 401)
    }
    if (
      action !== 'revoke'
      && action !== 'upgrade'
      && action !== 'grant_operator_update'
      && action !== 'unfreeze'
      && action !== 'update_note'
      && action !== 'set_permission'
    ) {
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

    if (action === 'update_note') {
      const updated: CdkRecord = {
        ...existing,
        order_note: typeof order_note === 'string' && order_note.trim() ? order_note.trim().slice(0, 500) : null,
      }
      await store.set(key, updated)
      return jsonResponse({ updated: true, cdk: toAdminCdkDetail(updated) })
    }

    if (action === 'set_permission') {
      if (!permission || !(CDK_PRODUCT_PERMISSIONS as string[]).includes(permission)) {
        return jsonResponse({ error: '目标 CDK 类型必须是 recommended、growth、advanced 或 ultimate。' }, 400)
      }
      if (existing.status === 'revoked') {
        return jsonResponse({ error: '已撤销授权不能调整权限。' }, 409)
      }
      const updated: CdkRecord = {
        ...existing,
        permission: permission as ProductPermissionMode,
      }
      await store.set(key, updated)
      return jsonResponse({
        updated: true,
        cdk_id: existing.code_hash.slice(0, 12),
        permission: updated.permission,
        cdk: toAdminCdkDetail(updated),
      })
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
    const body = await req.json() as {
      admin_password?: string;
      admin_user?: string;
      code_hash?: string;
    }
    const { code_hash } = body

    if (!(await authenticateAdminRequest(req, body))) {
      return jsonResponse({ error: '管理账号或密码错误。' }, 401)
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
    risk_events: (record.risk_events ?? []).map(summarizeRiskEvent).filter((event): event is NonNullable<ReturnType<typeof summarizeRiskEvent>> => Boolean(event)),
    latest_risk_event: summarizeRiskEvent(record.risk_events?.at(-1)),
  }
}

function summarizeRiskEvent(event: NonNullable<CdkRecord['risk_events']>[number] | undefined) {
  if (!event) return null
  return {
    at: event.at,
    type: event.type,
    reason: event.reason,
    soft_block: event.detail?.soft_block === true,
    escalation: event.type === 'soft_block_threshold',
  }
}

function toAdminCdkDetail(record: CdkRecord) {
  return {
    ...toAdminCdkRecord(record),
    revoked_at: record.revoked_at ?? null,
    operator_update_granted_at: record.operator_update_granted_at ?? null,
    operator_update_consumed_at: record.operator_update_consumed_at ?? null,
    baseline_operator_count: record.baseline_operator_fingerprint?.owned_count ?? null,
    latest_operator_count: record.latest_operator_fingerprint?.owned_count ?? null,
    risk_events: (record.risk_events ?? []).map((event) => ({
      at: event.at,
      type: event.type,
      reason: event.reason,
      detail: sanitizeRiskDetail(event.detail),
    })),
    operator_update_events: (record.operator_update_events ?? []).map((event) => ({
      at: event.at,
      operator_count: event.operator_count,
    })),
    device_signals: {
      activation_bound: Boolean(record.activation_token_hash),
      user_agent_count: new Set((record.user_agent_events ?? []).map((event) => event.hash)).size,
      ip_prefix_count: new Set((record.ip_prefix_events ?? []).map((event) => event.hash)).size,
    },
    linked_account: record.account_id && record.profile_id
      ? { account_id: record.account_id, profile_id: record.profile_id }
      : null,
  }
}

function sanitizeRiskDetail(detail: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!detail) return null
  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(detail)) {
    if (isSensitiveRiskDetailKey(key)) continue
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      sanitized[key] = value
    } else if (Array.isArray(value)) {
      sanitized[key] = { count: value.length }
    }
  }
  return Object.keys(sanitized).length > 0 ? sanitized : null
}

function isSensitiveRiskDetailKey(key: string): boolean {
  return /(hash|token|secret|credential|encrypted|salt|password)/i.test(key)
}

function normalizeProductPermission(permission: CdkRecord['permission']): ProductPermissionMode | null {
  if (permission === 'basic') return 'growth'
  if (permission === 'premium') return 'advanced'
  if ((CDK_PRODUCT_PERMISSIONS as string[]).includes(permission)) return permission as ProductPermissionMode
  return null
}
