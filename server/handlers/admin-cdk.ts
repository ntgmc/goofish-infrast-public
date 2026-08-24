import type { ProductPermissionMode } from '../../src/lib/types'
import { normalizePointsAmount } from '../../src/lib/balance-contracts'
import { getPermissionRank, normalizeRuntimePermission } from '../../src/lib/product-catalog'
import { authenticateAdminRequest } from './admin-auth'
import {
  CDK_PRODUCT_PERMISSIONS,
  PROFILE_CDK_DURATION_DAYS,
  generateCdk,
  getCdkBalanceAmount,
  getCdkItemCode,
  getCdkItemExpiresAt,
  getCdkProfileDuration,
  getCdkProfileDurationDays,
  getCdkProfileExpiresAt,
  getCdkType,
  isProfileCdkRecord,
  getCdkRecordStore,
  hashCdk,
  jsonResponse,
  acceptLatestOperatorBaselineAndUnfreeze,
  buildOperatorFingerprint,
  requireEnv,
  setOperatorBaselineByAdmin,
  unfreezeCdkRecord,
  validateOperators,
  type CdkRecord,
  type CdkStatus,
  type CdkType,
  type ItemCdkCode,
  type ProfileCdkDuration,
  type OperatorBaselineSource,
  type AdminCdkPageOptions,
  type AdminCdkPageResult,
} from './license-utils'
import { FREE_PREVIEW_LIMITED_CDK_ACTIVITY, isFreePreviewLimitedCdkActivityActive } from '../free-preview-trial'
import { AdminPaginationError, buildAdminPagination, parseAdminPageRequest } from './admin-pagination'
import { buildAdminCdkOpsSummary } from './admin-cdk-summary'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson } from '../security/request-validation'
import { getProfileById, getProfileWorkspace } from '../storage/user-store'

type CdkStatusFilter = CdkStatus | 'all'

const MAX_BATCH_CREATE_COUNT = 100
const MAX_CDK_GENERATION_ATTEMPTS = 10

export default async (req: Request): Promise<Response> => {
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
    const body = await getValidatedJson(req, requestSchemas.adminCdkCreate)
    const {
      permission,
      order_note,
      count,
      cdk_type,
      amount,
      item_code,
      profile_duration,
      item_validity_mode,
      item_validity_days,
      item_expires_at,
      validity_days,
      expires_at,
    } = body
    const hashSecret = requireEnv('CDK_HASH_SECRET')

    const authentication = await authenticateAdminRequest(req, {
      capability: 'admin_manage',
      requireRecentLogin: true,
    })
    if (!authentication.ok) return authentication.response
    const cdkType = (cdk_type ?? 'profile') as CdkType
    if (cdkType === 'profile' && (
      amount !== undefined
      || item_code !== undefined
      || item_validity_mode !== undefined
      || item_validity_days !== undefined
      || item_expires_at !== undefined
      || validity_days !== undefined
      || expires_at !== undefined
    )) {
      return jsonResponse({ error: '档案 CDK 只能设置档案权限。', code: 'cdk_payload_mismatch' }, 400)
    }
    if (cdkType === 'balance' && (
      permission !== undefined
      || item_code !== undefined
      || profile_duration !== undefined
      || item_validity_mode !== undefined
      || item_validity_days !== undefined
      || item_expires_at !== undefined
      || validity_days !== undefined
      || expires_at !== undefined
    )) {
      return jsonResponse({ error: '余额 CDK 只能设置积分面额。', code: 'cdk_payload_mismatch' }, 400)
    }
    if (cdkType === 'item' && (permission !== undefined || amount !== undefined || profile_duration !== undefined)) {
      return jsonResponse({ error: '道具 CDK 只能设置道具类型。', code: 'cdk_payload_mismatch' }, 400)
    }
    const cdkPermission = cdkType === 'profile' && permission && (CDK_PRODUCT_PERMISSIONS as string[]).includes(permission)
      ? permission as ProductPermissionMode
      : null
    const balanceAmount = cdkType === 'balance' ? normalizePointsAmount(amount) : null
    const itemCode = cdkType === 'item' ? item_code as ItemCdkCode | undefined : undefined
    if (cdkType === 'profile' && !cdkPermission) {
      return jsonResponse({ error: '档案 CDK 权限必须是 recommended、growth、advanced 或 ultimate。' }, 400)
    }
    if (cdkType === 'balance' && !balanceAmount) {
      return jsonResponse({ error: '余额 CDK 面额必须是 0.01 到 1000000.00 之间、最多两位小数的字符串。' }, 400)
    }
    if (cdkType === 'item' && !itemCode) {
      return jsonResponse({ error: '道具 CDK 必须选择终身版或限时版道具。', code: 'cdk_payload_required' }, 400)
    }
    const profileDuration = cdkType === 'profile'
      ? normalizeProfileDuration(profile_duration)
      : null
    if (cdkType === 'profile' && !profileDuration) {
      return jsonResponse({ error: '档案 CDK 有效期必须是终身、30 天、90 天或 365 天。', code: 'cdk_profile_duration_invalid' }, 400)
    }
    const createdAt = new Date().toISOString()
    const itemExpiry = cdkType === 'item'
      ? resolveItemCdkExpiresAt({
          itemCode: itemCode!,
          validityMode: item_validity_mode,
          validityDays: item_validity_days ?? validity_days,
          expiresAt: item_expires_at ?? expires_at,
          now: createdAt,
        })
      : { ok: true as const, expiresAt: null }
    if (!itemExpiry.ok) return jsonResponse({ error: itemExpiry.error, code: itemExpiry.code }, itemExpiry.status)
    const itemExpiresAt = itemExpiry.expiresAt

    const store = await getCdkRecordStore()
    const batchCount = normalizeCreateCount(count)
    if (batchCount === null) {
      return jsonResponse({ error: `生成数量必须是 1-${MAX_BATCH_CREATE_COUNT} 的整数。` }, 400)
    }
    const orderNote = order_note?.trim() || null
    const createdCdks = await createCdkBatch(store, {
      count: batchCount,
      createdAt,
      hashSecret,
      orderNote,
      cdkType,
      permission: cdkPermission,
      profileDuration,
      balanceAmount,
      itemCode: itemCode ?? null,
      itemExpiresAt,
    })
    const response = {
      cdk_type: cdkType,
      ...(cdkPermission ? { permission: cdkPermission } : {}),
      ...(profileDuration ? { profile_duration: profileDuration, profile_duration_days: profileDuration === 'lifetime' ? null : PROFILE_CDK_DURATION_DAYS[profileDuration] } : {}),
      ...(balanceAmount ? { amount: balanceAmount } : {}),
      ...(itemCode ? { item_code: itemCode, item_name: itemCdkName(itemCode), item_expires_at: itemExpiresAt } : {}),
      created_at: createdAt,
      count: createdCdks.length,
      cdks: createdCdks.map(({ code }) => ({
        code,
        cdk_type: cdkType,
        ...(cdkPermission ? { permission: cdkPermission } : {}),
        ...(profileDuration ? { profile_duration: profileDuration, profile_duration_days: profileDuration === 'lifetime' ? null : PROFILE_CDK_DURATION_DAYS[profileDuration] } : {}),
        ...(balanceAmount ? { amount: balanceAmount } : {}),
        ...(itemCode ? { item_code: itemCode, item_name: itemCdkName(itemCode), item_expires_at: itemExpiresAt } : {}),
        created_at: createdAt,
      })),
    }

    return jsonResponse(batchCount === 1 ? { code: createdCdks[0]?.code, ...response } : response)
  } catch (error) {
    console.error('admin cdk error:', error)
    return jsonResponse({ error: 'Internal server error' }, 500)
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
  cdkType: CdkType;
  permission: ProductPermissionMode | null;
  profileDuration: ProfileCdkDuration | null;
  balanceAmount: string | null;
  itemCode: ItemCdkCode | null;
  itemExpiresAt: string | null;
}

function normalizeCreateCount(value: unknown): number | null {
  if (value === undefined) return 1
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  if (value < 1 || value > MAX_BATCH_CREATE_COUNT) return null
  return value
}

function normalizeProfileDuration(value: unknown): ProfileCdkDuration | null {
  if (value === undefined || value === 'lifetime') return 'lifetime'
  return value === 'month' || value === 'half_year' || value === 'year' ? value : null
}

function resolveItemCdkExpiresAt(input: {
  itemCode: ItemCdkCode
  validityMode: 'days' | 'date' | 'never' | undefined
  validityDays: number | undefined
  expiresAt: string | undefined
  now: string
}):
  | { ok: true; expiresAt: string | null }
  | { ok: false; status: 400; code: string; error: string } {
  if (input.itemCode === 'lifetime_profile_voucher') {
    if (input.validityMode !== undefined && input.validityMode !== 'never') {
      return { ok: false, status: 400, code: 'cdk_item_validity_mismatch', error: '终身版道具 CDK 不支持限时有效期。' }
    }
    if (input.validityDays !== undefined || input.expiresAt !== undefined) {
      return { ok: false, status: 400, code: 'cdk_item_validity_mismatch', error: '终身版道具 CDK 不支持限时有效期。' }
    }
    return { ok: true, expiresAt: null }
  }

  if (input.validityMode === undefined) {
    if (!isFreePreviewLimitedCdkActivityActive(new Date(input.now))) {
      return { ok: false, status: 409, code: 'cdk_item_expired', error: '限时 CDK 活动尚未开始或已经结束。' }
    }
    return { ok: true, expiresAt: FREE_PREVIEW_LIMITED_CDK_ACTIVITY.endsAt }
  }
  if (input.validityMode === 'never') {
    return { ok: false, status: 400, code: 'cdk_item_validity_required', error: '限时 CDK 必须指定有效天数或到期日。' }
  }
  if (input.validityMode === 'days') {
    if (input.validityDays === undefined || !Number.isInteger(input.validityDays) || input.validityDays < 1 || input.validityDays > 3650) {
      return { ok: false, status: 400, code: 'cdk_item_validity_days_invalid', error: '限时 CDK 有效天数必须是 1-3650 的整数。' }
    }
    return {
      ok: true,
      expiresAt: new Date(Date.parse(input.now) + input.validityDays * 86_400_000).toISOString(),
    }
  }

  if (input.validityDays !== undefined || !input.expiresAt?.trim()) {
    return { ok: false, status: 400, code: 'cdk_item_validity_mismatch', error: '指定到期日时不能同时提交有效天数。' }
  }
  const raw = input.expiresAt.trim()
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T23:59:59+08:00` : raw
  const timestamp = Date.parse(normalized)
  if (!Number.isFinite(timestamp)) {
    return { ok: false, status: 400, code: 'cdk_item_expiry_invalid', error: '限时 CDK 到期日格式无效。' }
  }
  const nowMs = Date.parse(input.now)
  if (timestamp <= nowMs || timestamp > nowMs + 3650 * 86_400_000) {
    return { ok: false, status: 400, code: 'cdk_item_expiry_invalid', error: '限时 CDK 到期日必须晚于当前时间且不超过 3650 天。' }
  }
  return { ok: true, expiresAt: new Date(timestamp).toISOString() }
}

async function createCdkBatch(
  store: Awaited<ReturnType<typeof getCdkRecordStore>>,
  options: CreateCdkBatchOptions,
): Promise<CreatedCdk[]> {
  const created: CreatedCdk[] = []
  const entries: Array<{ key: string; record: CdkRecord }> = []
  const generatedHashes = new Set<string>()

  for (let index = 0; index < options.count; index += 1) {
    const generated = await generateUniqueCdk(store, options.hashSecret, generatedHashes)
    generatedHashes.add(generated.codeHash)

    const base = {
      code_hash: generated.codeHash,
      status: 'unused' as const,
      created_at: options.createdAt,
      used_at: null,
      revoked_at: null,
      order_note: options.orderNote,
      license_order_hash: null,
      operator_count: null,
      config_desc: null,
      schedule_generate_count: 0,
    }
    const record: CdkRecord = options.cdkType === 'balance'
      ? { ...base, version: 2, cdk_type: 'balance', permission: null, balance_amount: options.balanceAmount! }
      : options.cdkType === 'item'
        ? { ...base, version: 3, cdk_type: 'item', permission: null, balance_amount: null, item_code: options.itemCode!, item_expires_at: options.itemExpiresAt }
        : {
            ...base,
            version: 2,
            cdk_type: 'profile',
            permission: options.permission!,
            balance_amount: null,
            profile_duration: options.profileDuration ?? 'lifetime',
            profile_duration_days: options.profileDuration && options.profileDuration !== 'lifetime'
              ? PROFILE_CDK_DURATION_DAYS[options.profileDuration]
              : null,
            profile_expires_at: null,
          }
    entries.push({ key: `cdk/${generated.codeHash}.json`, record })
    created.push(generated)
  }

  await store.createBatch(entries)
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
    const url = new URL(req.url)
    const authentication = await authenticateAdminRequest(
      req,
      url.searchParams.get('view') === 'risk' ? 'risk_view' : 'admin_manage',
    )
    if (!authentication.ok) return authentication.response

    const detailCodeHash = url.searchParams.get('code_hash')
    if (detailCodeHash) {
      if (!/^[a-f0-9]{64}$/i.test(detailCodeHash)) {
        return jsonResponse({ error: 'CDK 标识无效，请刷新列表后重试。' }, 400)
      }
      const store = await getCdkRecordStore()
      const record = await store.get(`cdk/${detailCodeHash}.json`)
      if (!record) return jsonResponse({ error: 'CDK not found.' }, 404)
      return jsonResponse({ cdk: await toAdminCdkDetail(record) })
    }

    if (url.searchParams.get('view') === 'summary') {
      const store = await getCdkRecordStore()
      const records = (await store.list('cdk/')).map(toAdminCdkRecord)
      return jsonResponse({ summary: buildAdminCdkOpsSummary(records) })
    }

    const request = parseAdminPageRequest(url)
    const status = normalizeStatusFilter(req.headers.get('X-Cdk-Status'), req.url)
    const permission = normalizePermissionFilter(url.searchParams.get('permission'))
    const cdkType = normalizeCdkTypeFilter(url.searchParams.get('cdk_type'))
    const risk = normalizeBinaryFilter(url.searchParams.get('risk'), 'risk')
    const generated = normalizeBinaryFilter(url.searchParams.get('generated'), 'generated')
    const riskOnly = url.searchParams.get('view') === 'risk'
    const store = await getCdkRecordStore()
    const result = store.listAdminPage
      ? await store.listAdminPage({ ...request, status, permission, cdkType, risk, generated, riskOnly })
      : paginateMemoryRecords(await store.list('cdk/'), { ...request, status, permission, cdkType, risk, generated, riskOnly })

    return jsonResponse({
      status,
      cdk_type: cdkType,
      cdks: result.records.map(toAdminCdkRecord),
      pagination: buildAdminPagination(result.page, request.pageSize, result.total),
    })
  } catch (error) {
    if (error instanceof AdminPaginationError) return jsonResponse({ error: error.message }, 400)
    console.error('admin cdk list error:', error)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}

async function handlePatch(req: Request): Promise<Response> {
  try {
    const body = await getValidatedJson(req, requestSchemas.adminCdkPatch)
    const { code_hash, code_hashes, action, permission, order_note, reason, baseline_source } = body

    const authentication = await authenticateAdminRequest(req, {
      capability: 'admin_manage',
      requireRecentLogin: true,
    })
    if (!authentication.ok) return authentication.response
    if (code_hashes !== undefined) {
      if (action !== 'revoke' || code_hash !== undefined) {
        return jsonResponse({ error: '批量请求仅支持撤销，且不能同时提交 code_hash。' }, 400)
      }
      if (new Set(code_hashes).size !== code_hashes.length || code_hashes.some((value) => !/^[a-f0-9]{64}$/i.test(value))) {
        return jsonResponse({ error: '批量 CDK 标识必须唯一且格式有效。' }, 400)
      }
      const store = await getCdkRecordStore()
      const results = await Promise.all(code_hashes.map(async (codeHash) => {
        try {
          return await revokeCdkByHash(store, codeHash)
        } catch (error) {
          console.error('admin batch cdk revoke item error:', error)
          return { code_hash: codeHash, ok: false as const, status: 500, error: 'Internal server error' }
        }
      }))
      const succeeded = results.filter((result) => result.ok).length
      return jsonResponse({ results, succeeded, failed: results.length - succeeded })
    }
    if (!code_hash || !/^[a-f0-9]{64}$/i.test(code_hash)) {
      return jsonResponse({ error: 'CDK 标识无效，请刷新列表后重试。' }, 400)
    }

    const store = await getCdkRecordStore()
    const key = `cdk/${code_hash}.json`
    const existing = await store.get(key) as CdkRecord | null

    if (!existing) {
      return jsonResponse({ error: 'CDK not found.' }, 404)
    }

    if (action === 'set_operator_baseline' || action === 'accept_operator_baseline_and_unfreeze') {
      const reviewReason = typeof reason === 'string' ? reason.trim().slice(0, 500) : ''
      if (!reviewReason) return jsonResponse({ error: '售后核验备注不能为空。' }, 400)
      if (!isProfileCdkRecord(existing)) return jsonResponse({ error: '只有档案 CDK 可以设置干员基线。' }, 409)
      if (existing.status !== 'used' && existing.status !== 'frozen') {
        return jsonResponse({ error: '只有已使用或已冻结授权可以执行售后恢复。' }, 409)
      }
      const source: OperatorBaselineSource | null = action === 'accept_operator_baseline_and_unfreeze'
        ? 'latest'
        : baseline_source ?? null
      if (!source) return jsonResponse({ error: '请选择新的干员基线来源。' }, 400)
      const workspaceBaseline = source === 'workspace' ? await resolveWorkspaceBaseline(existing) : null
      if (source === 'workspace' && !workspaceBaseline) {
        return jsonResponse({ error: '关联档案没有可用的工作区干员数据。' }, 409)
      }
      const updated = action === 'accept_operator_baseline_and_unfreeze'
        ? await acceptLatestOperatorBaselineAndUnfreeze(existing, reviewReason)
        : await setOperatorBaselineByAdmin(existing, {
            source,
            reason: reviewReason,
            unfreeze: true,
            ...(workspaceBaseline && { fingerprint: workspaceBaseline.fingerprint }),
          })
      if (!updated) {
        return jsonResponse({ error: source === 'latest' ? '授权没有可接受的最新干员快照。' : '更新干员基线失败。' }, 409)
      }
      return jsonResponse({
        recovered: true,
        action,
        cdk_id: existing.code_hash.slice(0, 12),
        status: updated.status,
        cdk: await toAdminCdkDetail(updated),
      })
    }

    if (action === 'update_note') {
      const note = typeof order_note === 'string' && order_note.trim() ? order_note.trim().slice(0, 500) : null
      const updated = await store.mutate(key, (current) => ({ ...current, order_note: note })) ?? existing
      if (updated.status === 'revoked') return jsonResponse({ error: '已撤销授权不能修改备注。' }, 409)
      return jsonResponse({ updated: true, cdk: await toAdminCdkDetail(updated) })
    }

    if (action === 'set_permission') {
      if (!isProfileCdkRecord(existing)) return jsonResponse({ error: '只有档案 CDK 可以调整权限。' }, 409)
      if (!permission || !(CDK_PRODUCT_PERMISSIONS as string[]).includes(permission)) {
        return jsonResponse({ error: '目标 CDK 类型必须是 recommended、growth、advanced 或 ultimate。' }, 400)
      }
      if (existing.status === 'revoked') {
        return jsonResponse({ error: '已撤销授权不能调整权限。' }, 409)
      }
      const updated = await store.mutate(key, (current) => isProfileCdkRecord(current) ? { ...current, permission: permission as ProductPermissionMode } : null) ?? existing
      if (updated.status === 'revoked') return jsonResponse({ error: '已撤销授权不能调整权限。' }, 409)
      return jsonResponse({
        updated: true,
        cdk_id: existing.code_hash.slice(0, 12),
        permission: updated.permission,
        cdk: await toAdminCdkDetail(updated),
      })
    }

    if (action === 'unfreeze') {
      if (!isProfileCdkRecord(existing)) return jsonResponse({ error: '只有档案 CDK 支持风控解冻。' }, 409)
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
      if (!isProfileCdkRecord(existing)) return jsonResponse({ error: '只有档案 CDK 可以升级权限。' }, 409)
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
      if (getPermissionRank(nextPermission) <= getPermissionRank(currentPermission)) {
        return jsonResponse({ error: '只能升级到更高等级的授权。' }, 409)
      }

      const updated = await store.mutate(key, (current) => isProfileCdkRecord(current) ? { ...current, permission: nextPermission } : null) ?? existing
      if (updated.status === 'revoked') return jsonResponse({ error: '已撤销授权不能升级。' }, 409)
      return jsonResponse({
        upgraded: true,
        cdk_id: existing.code_hash.slice(0, 12),
        previous_permission: currentPermission,
        permission: nextPermission,
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
    const updated = await store.mutate(key, (current) => ({
      ...current,
      status: 'revoked',
      revoked_at: revokedAt,
    }), { allowedStatuses: ['used', 'frozen'] }) ?? existing
    if (updated.status !== 'revoked') return jsonResponse({ error: 'Only used or frozen CDKs can be revoked.' }, 409)
    return jsonResponse({
      revoked: true,
      already_revoked: false,
      cdk_id: existing.code_hash.slice(0, 12),
      revoked_at: revokedAt,
    })
  } catch (error) {
    console.error('admin cdk revoke error:', error)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}

async function revokeCdkByHash(
  store: Awaited<ReturnType<typeof getCdkRecordStore>>,
  codeHash: string,
): Promise<
  | { code_hash: string; ok: true; already_revoked: boolean; revoked_at: string | null }
  | { code_hash: string; ok: false; status: number; error: string }
> {
  const key = `cdk/${codeHash}.json`
  const existing = await store.get(key)
  if (!existing) return { code_hash: codeHash, ok: false, status: 404, error: 'CDK not found.' }
  if (existing.status === 'revoked') {
    return { code_hash: codeHash, ok: true, already_revoked: true, revoked_at: existing.revoked_at ?? null }
  }
  if (existing.status !== 'used' && existing.status !== 'frozen') {
    return { code_hash: codeHash, ok: false, status: 409, error: 'Only used or frozen CDKs can be revoked.' }
  }
  const revokedAt = new Date().toISOString()
  const updated = await store.mutate(key, (current) => ({
    ...current,
    status: 'revoked',
    revoked_at: revokedAt,
  }), { allowedStatuses: ['used', 'frozen'] }) ?? existing
  if (updated.status !== 'revoked') {
    return { code_hash: codeHash, ok: false, status: 409, error: 'Only used or frozen CDKs can be revoked.' }
  }
  return { code_hash: codeHash, ok: true, already_revoked: false, revoked_at: revokedAt }
}

async function handleDelete(req: Request): Promise<Response> {
  try {
    const body = await getValidatedJson(req, requestSchemas.adminCdkDelete)
    const { code_hash } = body

    const authentication = await authenticateAdminRequest(req, {
      capability: 'admin_manage',
      requireRecentLogin: true,
    })
    if (!authentication.ok) return authentication.response
    if (!code_hash || !/^[a-f0-9]{64}$/i.test(code_hash)) {
      return jsonResponse({ error: 'CDK 标识无效，请刷新列表后重试。' }, 400)
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

    if (!(await store.deleteUnused(key))) {
      return jsonResponse({ error: 'Only unused CDKs can be deleted.' }, 409)
    }
    return jsonResponse({ deleted: true, cdk_id: existing.code_hash.slice(0, 12) })
  } catch (error) {
    console.error('admin cdk delete error:', error)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}

function normalizeStatusFilter(headerValue: string | null, requestUrl: string): CdkStatusFilter {
  if (headerValue === 'used' || headerValue === 'frozen' || headerValue === 'revoked' || headerValue === 'all') return headerValue
  const queryValue = new URL(requestUrl).searchParams.get('status')
  if (queryValue === 'used' || queryValue === 'frozen' || queryValue === 'revoked' || queryValue === 'all') return queryValue
  if (queryValue === 'unused') return queryValue
  if (queryValue) throw new AdminPaginationError('status 筛选值无效。')
  return 'unused'
}

function toAdminCdkRecord(record: CdkRecord) {
  return {
    code_hash: record.code_hash,
    cdk_id: record.code_hash.slice(0, 12),
    cdk_type: getCdkType(record),
    permission: record.permission,
    profile_duration: isProfileCdkRecord(record) ? getCdkProfileDuration(record) : null,
    profile_duration_days: isProfileCdkRecord(record) ? getCdkProfileDurationDays(record) : null,
    profile_expires_at: isProfileCdkRecord(record) ? getCdkProfileExpiresAt(record) : null,
    amount: getCdkBalanceAmount(record),
    item_code: getCdkItemCode(record),
    item_name: getCdkItemCode(record) ? itemCdkName(getCdkItemCode(record)!) : null,
    item_expires_at: getCdkItemExpiresAt(record),
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
    risk_event_count: record.risk_events?.length ?? 0,
    risk_events: (record.risk_events ?? []).map(summarizeRiskEvent).filter((event): event is NonNullable<ReturnType<typeof summarizeRiskEvent>> => Boolean(event)),
    latest_risk_event: summarizeRiskEvent(record.risk_events?.at(-1)),
  }
}

function itemCdkName(itemCode: ItemCdkCode): string {
  return itemCode === 'lifetime_profile_voucher' ? '终身版兑换 CDK' : '限时 CDK'
}

function summarizeRiskEvent(event: NonNullable<CdkRecord['risk_events']>[number] | undefined) {
  if (!event) return null
  return {
    at: event.at,
    type: event.type,
    reason: event.reason,
    soft_block: event.detail?.soft_block === true,
    escalation: event.type === 'operator_review_recommended' || event.type === 'soft_block_threshold',
  }
}

async function toAdminCdkDetail(record: CdkRecord) {
  return {
    ...toAdminCdkRecord(record),
    revoked_at: record.revoked_at ?? null,
    baseline_operator_count: record.baseline_operator_fingerprint?.owned_count ?? null,
    latest_operator_count: record.latest_operator_fingerprint?.owned_count ?? null,
    risk_events: (record.risk_events ?? []).map((event) => ({
      at: event.at,
      type: event.type,
      reason: event.reason,
      detail: sanitizeRiskDetail(event.detail),
    })),
    linked_account: record.account_id && record.profile_id
      ? { account_id: record.account_id, profile_id: record.profile_id }
      : null,
    ...(isProfileCdkRecord(record) && {
      operator_baseline_options: await buildOperatorBaselineOptions(record),
    }),
  }
}

async function buildOperatorBaselineOptions(record: CdkRecord) {
  const workspace = await resolveWorkspaceBaseline(record)
  return [
    {
      source: 'latest' as const,
      available: Boolean(record.latest_operator_fingerprint),
      owned_count: record.latest_operator_fingerprint?.owned_count ?? null,
      updated_at: null,
    },
    {
      source: 'workspace' as const,
      available: Boolean(workspace),
      owned_count: workspace?.fingerprint.owned_count ?? null,
      updated_at: workspace?.updatedAt ?? null,
    },
    {
      source: 'next_import' as const,
      available: true,
      owned_count: null,
      updated_at: null,
    },
  ]
}

async function resolveWorkspaceBaseline(record: CdkRecord) {
  if (!record.account_id || !record.profile_id) return null
  const profile = await getProfileById(record.profile_id)
  if (
    !profile
    || profile.user_id !== record.account_id
    || profile.cdk_code_hash !== record.code_hash
  ) return null
  const workspace = await getProfileWorkspace(profile.id)
  const operators = validateOperators(workspace?.operators)
  if (!operators.ok) return null
  return {
    fingerprint: buildOperatorFingerprint(operators.operators),
    updatedAt: workspace?.updated_at ?? null,
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
  const normalized = normalizeRuntimePermission(permission)
  if ((CDK_PRODUCT_PERMISSIONS as string[]).includes(normalized)) return normalized as ProductPermissionMode
  return null
}

function normalizePermissionFilter(value: string | null): ProductPermissionMode | 'all' {
  if (!value || value === 'all') return 'all'
  if ((CDK_PRODUCT_PERMISSIONS as string[]).includes(value)) return value as ProductPermissionMode
  throw new AdminPaginationError('permission 筛选值无效。')
}

function normalizeCdkTypeFilter(value: string | null): CdkType | 'all' {
  if (!value || value === 'all') return 'all'
  if (value === 'profile' || value === 'balance' || value === 'item') return value
  throw new AdminPaginationError('cdk_type 筛选值无效。')
}

function normalizeBinaryFilter(value: string | null, field: string): 'all' | 'yes' | 'no' {
  if (!value || value === 'all') return 'all'
  if (value === 'yes' || value === 'no') return value
  throw new AdminPaginationError(`${field} 筛选值无效。`)
}

function paginateMemoryRecords(records: CdkRecord[], options: AdminCdkPageOptions): AdminCdkPageResult {
  const term = options.search.toLowerCase()
  const filtered = records.filter((record) => {
    const hasRisk = record.status === 'frozen' || (record.risk_events?.length ?? 0) > 0
    const generated = (record.schedule_generate_count ?? 0) > 0
    if (options.status !== 'all' && record.status !== options.status) return false
    if (options.permission !== 'all' && record.permission !== options.permission) return false
    if (options.cdkType !== 'all' && getCdkType(record) !== options.cdkType) return false
    if (options.riskOnly && !hasRisk) return false
    if (options.risk !== 'all' && hasRisk !== (options.risk === 'yes')) return false
    if (options.generated !== 'all' && generated !== (options.generated === 'yes')) return false
    if (term && ![record.code_hash, record.license_order_hash, record.order_note].some((value) => String(value ?? '').toLowerCase().includes(term))) return false
    return true
  }).sort((left, right) => right.created_at.localeCompare(left.created_at) || left.code_hash.localeCompare(right.code_hash))
  const totalPages = filtered.length === 0 ? 0 : Math.ceil(filtered.length / options.pageSize)
  const page = totalPages === 0 ? 1 : Math.min(options.page, totalPages)
  return {
    records: filtered.slice((page - 1) * options.pageSize, page * options.pageSize),
    total: filtered.length,
    page,
    totalPages,
  }
}
