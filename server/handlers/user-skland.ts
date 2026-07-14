import { createHmac, randomUUID } from 'node:crypto'
import QRCode from 'qrcode'
import type { AuthSuccessResponse, LicenseConfig, SklandCredentialInvalidReason } from '../../src/lib/types'
import {
  emptyWorkspace,
  claimFreePreviewUid,
  deleteFreePreviewClaim,
  deleteFreePreviewPendingClaim,
  getFreePreviewClaim,
  getFreePreviewPendingClaim,
  getProfileForUser,
  getProfileWorkspace,
  isDepotValueProfile,
  isFreePreviewProfile,
  listProfilesForUser,
  saveProfileWorkspace,
  saveFreePreviewPendingClaim,
  saveUserProfile,
  type FreePreviewClaimRecord,
  type SklandBindingRecord,
  type UserGameAccountRecord,
  type UserWorkspaceRecord,
} from '../storage/user-store'
import { resolveConfigForPermission, resolveFreePreviewConfig, validateConfig, validateOperators } from './license-utils'
import {
  createHypergryphScan,
  decryptSklandCredential,
  encryptSklandCredential,
  ensureSklandCredentialSecret,
  getCredByHypergryphToken,
  getHypergryphTokenByScanCode,
  getScanCode,
  importSklandOperatorsByCred,
  isSklandCredentialCurrent,
  SklandClientError,
  type IntermediateInventory,
  type SklandBindingSummary,
  type SklandImportSummary,
} from './skland-client'
import { buildAuthPayload, jsonResponse, requireUserSession } from './user-auth'
import { recordUsageEvent } from './usage-stats'
import type { UsageReasonCode } from '../storage/usage-store'

const PENDING_BINDING_TTL_MS = 10 * 60 * 1000
const UID_MISMATCH_FREEZE_THRESHOLD = 3
const MAX_CREDENTIAL_TEXT_LENGTH = 16 * 1024
const MAX_CREDENTIAL_JSON_DEPTH = 8

const DEFAULT_SKLAND_CONFIG: LicenseConfig = {
  layout: '2-4-3',
  desc: '243 均衡流 (2赤金/2经验)',
  schedule_mode: 'maa',
  dormitory_rule: 'fixed',
  trading_stations_count: 2,
  manufacturing_stations_count: 4,
  product_requirements: {
    trading_stations: { LMD: 2 },
    manufacturing_stations: { 'Pure Gold': 2, 'Battle Record': 2 },
  },
  Fiammetta: { enable: true },
  drones: { enable: true, auto: true, order: 'pre', targets: ['LMD', 'Pure Gold', 'LMD'] },
}

type HandlerResponse = AuthSuccessResponse & { skland_import?: SklandImportSummary }
type AuthPayloadUser = Parameters<typeof buildAuthPayload>[0]
type CredentialSource = 'manual' | 'bookmarklet'

interface SklandPreview {
  uid: string
  nickname: string
  channel_name: string
  operator_count: number
}

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)

  const startedAt = Date.now()
  try {
    const auth = await requireUserSession(req)
    if (!auth) return jsonResponse({ error: '请先登录。' }, 401)

    const pathname = new URL(req.url).pathname
    if (pathname.endsWith('/free-preview/login/start')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      ensureSklandCredentialSecret()
      const scan = await createHypergryphScan()
      const qrDataUrl = await QRCode.toDataURL(scan.scanUrl, {
        width: 300,
        margin: 2,
        errorCorrectionLevel: 'M',
      })
      return jsonResponse({
        scan_id: scan.scanId,
        qr_data_url: qrDataUrl,
        expires_at: scan.expiresAt,
      })
    }

    if (pathname.endsWith('/free-preview/login/complete')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      ensureSklandCredentialSecret()
      const body = await readJsonBody(req)
      if (typeof body.scan_id !== 'string' || !body.scan_id.trim()) {
        return jsonResponse({ error: 'Missing scan_id.' }, 400)
      }
      const scanCode = await getScanCode(body.scan_id.trim())
      if (!scanCode) return jsonResponse({ status: 'pending' }, 202)

      const accountToken = await getHypergryphTokenByScanCode(scanCode)
      const cred = await getCredByHypergryphToken(accountToken)
      return createPendingFreePreviewClaimFromCred(auth.user, cred, body.display_name, body.note)
    }

    if (pathname.endsWith('/free-preview/credential/preview')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      ensureSklandCredentialSecret()
      const body = await readJsonBody(req)
      const source = normalizeCredentialSource(body.source)
      const cred = extractSklandCredential(body.credential_text)
      if (!cred) return jsonResponse({ error: '缺少森空岛凭据。' }, 400)
      return createPendingFreePreviewClaimFromCred(auth.user, cred, body.display_name, body.note, source)
    }

    if (pathname.endsWith('/free-preview/login/confirm')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      ensureSklandCredentialSecret()
      const body = await readJsonBody(req)
      if (typeof body.confirmation_id !== 'string' || !body.confirmation_id.trim()) {
        return jsonResponse({ error: 'Missing confirmation_id.' }, 400)
      }
      return confirmFreePreviewClaim(auth.user, body.confirmation_id.trim())
    }

    if (pathname.endsWith('/login/start')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      ensureSklandCredentialSecret()
      const body = await readJsonBody(req)
      await requireActiveProfile(auth.user.id, body.profile_id)
      const scan = await createHypergryphScan()
      const qrDataUrl = await QRCode.toDataURL(scan.scanUrl, {
        width: 300,
        margin: 2,
        errorCorrectionLevel: 'M',
      })
      return jsonResponse({
        scan_id: scan.scanId,
        qr_data_url: qrDataUrl,
        expires_at: scan.expiresAt,
      })
    }

    if (pathname.endsWith('/login/complete')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      ensureSklandCredentialSecret()
      const body = await readJsonBody(req)
      const profile = await requireActiveProfile(auth.user.id, body.profile_id)
      if (typeof body.scan_id !== 'string' || !body.scan_id.trim()) {
        return jsonResponse({ error: 'Missing scan_id.' }, 400)
      }
      const scanCode = await getScanCode(body.scan_id.trim())
      if (!scanCode) return jsonResponse({ status: 'pending' }, 202)

      const accountToken = await getHypergryphTokenByScanCode(scanCode)
      const cred = await getCredByHypergryphToken(accountToken)
      return createPendingSklandBindingFromCred(auth.user, profile, cred)
    }

    if (pathname.endsWith('/credential/preview')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      ensureSklandCredentialSecret()
      const body = await readJsonBody(req)
      const profile = await requireActiveProfile(auth.user.id, body.profile_id)
      const source = normalizeCredentialSource(body.source)
      const cred = extractSklandCredential(body.credential_text)
      if (!cred) return jsonResponse({ error: '缺少森空岛凭据。' }, 400)
      return createPendingSklandBindingFromCred(auth.user, profile, cred, source)
    }

    if (pathname.endsWith('/login/confirm')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      ensureSklandCredentialSecret()
      const body = await readJsonBody(req)
      const profile = await requireActiveProfile(auth.user.id, body.profile_id)
      if (typeof body.confirmation_id !== 'string' || !body.confirmation_id.trim()) {
        return jsonResponse({ error: '缺少 confirmation_id。' }, 400)
      }
      const pending = profile.skland_pending_binding
      if (!pending || pending.confirmation_id !== body.confirmation_id.trim()) {
        await recordSklandImport('failure', 'skland_confirm_invalid', startedAt, profile.id, 'login_confirm')
        return jsonResponse({ error: '森空岛绑定确认已失效，请重新登录森空岛。' }, 400)
      }
      if (Date.now() > Date.parse(pending.expires_at)) {
        await saveUserProfile({ ...profile, skland_pending_binding: null, updated_at: new Date().toISOString() })
        await recordSklandImport('failure', 'skland_pending_expired', startedAt, profile.id, 'login_confirm')
        return jsonResponse({ error: '森空岛绑定确认已过期，请重新登录森空岛。' }, 400)
      }
      if (profile.skland_binding?.uid && profile.skland_binding.uid !== pending.uid) {
        await recordSklandImport('failure', 'skland_account_mismatch', startedAt, profile.id, 'login_confirm')
        return jsonResponse({ error: '森空岛账号与当前绑定账号不一致，请重新登录森空岛。' }, 409)
      }

      if (isDepotValueProfile(profile)) {
        return jsonResponse(await saveDepotValueSklandBinding(auth.user, profile))
      }

      if (isFreePreviewProfile(profile)) {
        const claim = await claimFreePreviewProfileUid(auth.user.id, profile, pending, new Date().toISOString())
        if (!claim.ok) {
          await recordSklandImport('failure', 'permission_denied', startedAt, profile.id, 'login_confirm')
          return jsonResponse({ error: claim.message, code: 'free_preview_uid_claimed' }, 409)
        }
      }

      let imported: SklandImportSummary
      try {
        imported = await saveSklandImport(auth.user.id, profile, decryptSklandCredential(pending.encrypted_cred))
      } catch (error) {
        if (isFreePreviewProfile(profile)) await deleteFreePreviewClaim(hashFreePreviewUid(pending.uid), profile.id)
        throw error
      }
      await recordSklandImport('success', 'ok', startedAt, profile.id, 'login_confirm')
      return jsonResponse(await buildPayloadWithImport(auth.user, profile.id, imported))
    }

    if (pathname.endsWith('/import/refresh')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      ensureSklandCredentialSecret()
      const body = await readJsonBody(req)
      const profile = await requireActiveProfile(auth.user.id, body.profile_id)
      if (isDepotValueProfile(profile)) {
        await recordSklandImport('failure', 'skland_refresh_forbidden', startedAt, profile.id, 'refresh')
        return jsonResponse({
          error: '仓库分析档案不会刷新干员工作区，请在仓库价值分析页重新分析。',
          code: 'skland_depot_refresh_forbidden',
          recovery_action: 'use_depot_analysis',
        }, 403)
      }
      const encryptedCred = profile.skland_binding?.encrypted_cred
      if (!encryptedCred) {
        await recordSklandImport('failure', 'skland_not_bound', startedAt, profile.id, 'refresh')
        return jsonResponse({
          error: '当前账号尚未绑定森空岛，请先登录导入。',
          code: 'skland_not_bound',
          recovery_action: 'bind_first',
        }, 404)
      }
      try {
        const imported = await saveSklandImport(auth.user.id, profile, decryptSklandCredential(encryptedCred))
        await recordSklandImport('success', 'ok', startedAt, profile.id, 'refresh')
        return jsonResponse(await buildPayloadWithImport(auth.user, profile.id, imported))
      } catch (caught) {
        if (isSklandCredentialInvalid(caught)) {
          const nextProfile = await markSklandCredentialInvalid(profile, credentialInvalidReason(caught))
          await recordSklandImport('failure', 'skland_credential_invalid', startedAt, profile.id, 'refresh')
          return jsonResponse({
            ...(await buildAuthPayload(auth.user, nextProfile.id)),
            error: (caught as Error).message || '森空岛凭据已失效，请重新绑定。',
            code: 'skland_credential_invalid',
            recovery_action: 'rebind',
          }, 400)
        }
        await recordSklandImport('failure', 'skland_refresh_failed', startedAt, profile.id, 'refresh')
        return jsonResponse({
          error: (caught as Error).message || '森空岛刷新失败，请稍后重试。',
          code: 'skland_refresh_failed',
          recovery_action: 'retry',
        }, 400)
      }
    }

    return jsonResponse({ error: 'API route not found' }, 404)
  } catch (error) {
    console.error('user skland error:', error instanceof Error ? error.message : error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    const status = message.includes('SKLAND_CREDENTIAL_SECRET') ? 500 : 400
    return jsonResponse({ error: message }, status)
  }
}

async function recordSklandImport(
  status: 'success' | 'failure',
  reasonCode: UsageReasonCode,
  startedAt: number,
  profileId: string,
  source: string,
): Promise<void> {
  try {
    await recordUsageEvent('skland_import', {
      status,
      reason_code: reasonCode,
      duration_ms: Date.now() - startedAt,
      profile_id: profileId,
      source,
    })
  } catch (error) {
    console.warn('usage stats skland import skipped:', error)
  }
}

async function createPendingFreePreviewClaimFromCred(
  user: AuthPayloadUser,
  cred: string,
  displayNameValue?: unknown,
  noteValue?: unknown,
  source?: CredentialSource,
): Promise<Response> {
  const imported = await importSklandOperatorsByCred(cred)
  const operatorsCheck = validateOperators(imported.operators)
  if (!operatorsCheck.ok) throw new Error(operatorsCheck.message)
  const preview = toSklandPreview(imported.binding, operatorsCheck.operators.length)
  const existingPreview = (await listProfilesForUser(user.id)).find((profile) => isFreePreviewProfile(profile))
  if (existingPreview?.skland_binding) {
    return jsonResponse({ error: '当前网站账号已经领取过免费个人排班档案。', code: 'free_preview_already_claimed' }, 409)
  }
  if (existingPreview && existingPreview.status !== 'active') {
    return jsonResponse({ error: '免费个人排班档案当前不可用。' }, 403)
  }

  const uidHash = hashFreePreviewUid(imported.binding.uid)
  const existingClaim = await getFreePreviewClaim(uidHash)
  if (existingClaim && existingClaim.profile_id !== existingPreview?.id) {
    return jsonResponse({ error: '该森空岛 UID 已经领取过免费个人排班档案。', code: 'free_preview_uid_claimed' }, 409)
  }

  const now = new Date()
  const confirmationId = randomUUID()
  await saveFreePreviewPendingClaim({
    confirmation_id: confirmationId,
    user_id: user.id,
    uid: imported.binding.uid,
    nickname: imported.binding.nickname,
    channel_name: imported.binding.channel_name,
    encrypted_cred: encryptSklandCredential(cred),
    operator_count: operatorsCheck.operators.length,
    display_name: normalizeProfileDisplayName(displayNameValue),
    note: normalizeProfileNote(noteValue),
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + PENDING_BINDING_TTL_MS).toISOString(),
  })

  return jsonResponse({
    status: 'confirm_required',
    confirmation_id: confirmationId,
    skland_preview: preview,
    warning: source === 'bookmarklet'
      ? '已读取书签脚本凭据，请确认昵称和 UID 后再创建免费个人排班档案。'
      : '请确认昵称和 UID 后再创建免费个人排班档案。',
  })
}

async function confirmFreePreviewClaim(user: AuthPayloadUser, confirmationId: string): Promise<Response> {
  const pending = await getFreePreviewPendingClaim(user.id, confirmationId)
  if (!pending) {
    return jsonResponse({ error: '免费个人排班确认已过期，请重新登录森空岛。' }, 400)
  }
  if (Date.now() > Date.parse(pending.expires_at)) {
    await deleteFreePreviewPendingClaim(user.id, confirmationId)
    return jsonResponse({ error: '免费个人排班确认已过期，请重新登录森空岛。' }, 400)
  }

  const profiles = await listProfilesForUser(user.id)
  const existingPreview = profiles.find((profile) => isFreePreviewProfile(profile))
  if (existingPreview?.skland_binding) {
    await deleteFreePreviewPendingClaim(user.id, confirmationId)
    return jsonResponse({ error: '当前网站账号已经领取过免费个人排班档案。', code: 'free_preview_already_claimed' }, 409)
  }
  if (existingPreview && existingPreview.status !== 'active') {
    return jsonResponse({ error: '免费个人排班档案当前不可用。' }, 403)
  }

  const now = new Date().toISOString()
  const profile: UserGameAccountRecord = existingPreview ?? {
    version: 1,
    id: randomUUID(),
    user_id: user.id,
    kind: 'free_preview',
    cdk_key: null,
    cdk_code_hash: null,
    cdk_order_hash: null,
    permission: 'growth',
    status: 'active',
    display_name: pending.display_name || '免费个人排班',
    note: pending.note || '已绑定森空岛的免费个人排班档案。',
    skland_binding: null,
    skland_pending_binding: null,
    skland_risk: null,
    created_at: now,
    updated_at: now,
  }
  const uidHash = hashFreePreviewUid(pending.uid)
  const claim = await claimFreePreviewUid(buildFreePreviewClaim(uidHash, user.id, profile.id, pending, now))
  if (!claim.ok && claim.claim?.profile_id !== profile.id) {
    return jsonResponse({ error: '该森空岛 UID 已经领取过免费个人排班档案。', code: 'free_preview_uid_claimed' }, 409)
  }

  try {
    if (!existingPreview) await saveUserProfile(profile)
    const imported = await saveSklandImport(user.id, profile, decryptSklandCredential(pending.encrypted_cred))
    await deleteFreePreviewPendingClaim(user.id, confirmationId)
    return jsonResponse(await buildPayloadWithImport(user, profile.id, imported))
  } catch (error) {
    if (!existingPreview) await deleteFreePreviewClaim(uidHash, profile.id)
    throw error
  }
}

async function claimFreePreviewProfileUid(
  userId: string,
  profile: UserGameAccountRecord,
  binding: Pick<SklandBindingSummary, 'uid' | 'nickname' | 'channel_name'>,
  claimedAt: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const uidHash = hashFreePreviewUid(binding.uid)
  const claim = await claimFreePreviewUid(buildFreePreviewClaim(uidHash, userId, profile.id, binding, claimedAt))
  if (!claim.ok && claim.claim?.profile_id !== profile.id) {
    return { ok: false, message: '该森空岛 UID 已经领取过免费个人排班档案。' }
  }
  return { ok: true }
}

function buildFreePreviewClaim(
  uidHash: string,
  userId: string,
  profileId: string,
  binding: Pick<SklandBindingSummary, 'uid' | 'nickname' | 'channel_name'>,
  claimedAt: string,
): FreePreviewClaimRecord {
  return {
    uid_hash: uidHash,
    user_id: userId,
    profile_id: profileId,
    claimed_at: claimedAt,
    uid: binding.uid,
    nickname: binding.nickname,
    channel_name: binding.channel_name,
  }
}

async function saveDepotValueSklandBinding(
  user: AuthPayloadUser,
  profile: UserGameAccountRecord,
): Promise<AuthSuccessResponse> {
  const pending = profile.skland_pending_binding
  if (!pending) throw new Error('森空岛绑定确认已失效，请重新登录森空岛。')
  const now = new Date().toISOString()
  const existingBinding = profile.skland_binding
  await saveUserProfile({
    ...profile,
    skland_binding: {
      uid: pending.uid,
      nickname: pending.nickname,
      channel_name: pending.channel_name,
      bound_at: existingBinding?.bound_at ?? now,
      last_imported_at: null,
      encrypted_cred: pending.encrypted_cred,
      credential_status: 'available',
      credential_invalid_at: null,
      credential_invalid_reason: null,
    },
    skland_pending_binding: null,
    skland_risk: { uid_mismatch_count: 0, last_mismatch_uid: null, last_mismatch_nickname: null, last_mismatch_at: null },
    updated_at: now,
  })
  return buildAuthPayload(user, profile.id)
}

async function createPendingSklandBindingFromCred(
  user: AuthPayloadUser,
  profile: UserGameAccountRecord,
  cred: string,
  source?: CredentialSource,
): Promise<Response> {
  const imported = await importSklandOperatorsByCred(cred)
  const operatorsCheck = validateOperators(imported.operators)
  if (!operatorsCheck.ok) throw new Error(operatorsCheck.message)
  const preview = toSklandPreview(imported.binding, operatorsCheck.operators.length)

  if (profile.skland_binding?.uid && profile.skland_binding.uid !== imported.binding.uid) {
    return handleAccountMismatch(user, profile, preview)
  }
  if (isFreePreviewProfile(profile)) {
    const existingClaim = await getFreePreviewClaim(hashFreePreviewUid(imported.binding.uid))
    if (existingClaim && existingClaim.profile_id !== profile.id) {
      return jsonResponse({ error: '该森空岛 UID 已经领取过免费个人排班档案。', code: 'free_preview_uid_claimed' }, 409)
    }
  }

  const now = new Date()
  const confirmationId = randomUUID()
  await saveUserProfile({
    ...profile,
    skland_pending_binding: {
      confirmation_id: confirmationId,
      uid: imported.binding.uid,
      nickname: imported.binding.nickname,
      channel_name: imported.binding.channel_name,
      encrypted_cred: encryptSklandCredential(cred),
      operator_count: operatorsCheck.operators.length,
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + PENDING_BINDING_TTL_MS).toISOString(),
    },
    updated_at: now.toISOString(),
  })

  return jsonResponse({
    status: 'confirm_required',
    confirmation_id: confirmationId,
    skland_preview: preview,
    warning: source === 'bookmarklet'
      ? '书签脚本已读取森空岛凭据。绑定后不可解绑，请确认这是当前账号对应的森空岛角色。'
      : '绑定后不可解绑，请确认这是当前账号对应的森空岛角色。',
  })
}

async function handleAccountMismatch(
  user: AuthPayloadUser,
  profile: UserGameAccountRecord,
  preview: SklandPreview,
): Promise<Response> {
  const now = new Date().toISOString()
  const previousRisk = profile.skland_risk
  const mismatchCount = (previousRisk?.uid_mismatch_count ?? 0) + 1
  const nextProfile: UserGameAccountRecord = {
    ...profile,
    status: mismatchCount >= UID_MISMATCH_FREEZE_THRESHOLD ? 'frozen' : profile.status,
    skland_pending_binding: null,
    skland_risk: {
      uid_mismatch_count: mismatchCount,
      last_mismatch_uid: preview.uid,
      last_mismatch_nickname: preview.nickname,
      last_mismatch_at: now,
    },
    updated_at: now,
  }
  await saveUserProfile(nextProfile)

  if (nextProfile.status === 'frozen') {
    return jsonResponse({
      ...(await buildAuthPayload(user, profile.id)),
      status: 'frozen',
      warning: '森空岛账号多次与当前绑定账号不一致，当前游戏账号档案已冻结。',
    })
  }

  return jsonResponse({
    status: 'account_mismatch',
    skland_preview: preview,
    warning: '该账号与当前绑定账号不一致，请确认是否登录错账号。',
  })
}

async function saveSklandImport(
  userId: string,
  profile: UserGameAccountRecord,
  cred: string,
): Promise<SklandImportSummary> {
  const imported = await importSklandOperatorsByCred(cred, { includeInventory: true })
  const operatorsCheck = validateOperators(imported.operators)
  if (!operatorsCheck.ok) throw new Error(operatorsCheck.message)
  if (profile.skland_binding?.uid && profile.skland_binding.uid !== imported.binding.uid) {
    throw new Error('森空岛账号与当前档案绑定的 UID 不一致。')
  }
  if (isFreePreviewProfile(profile)) {
    const claim = await claimFreePreviewProfileUid(userId, profile, imported.binding, imported.importedAt)
    if (!claim.ok) throw new Error(claim.message)
  }

  const existingWorkspace = await getProfileWorkspace(profile.id)
  const configResult = resolveSklandImportConfig(profile, existingWorkspace?.config ?? null, imported.intermediateInventory)
  const nextWorkspace: UserWorkspaceRecord = {
    ...(existingWorkspace ?? emptyWorkspace(profile.id)),
    operators: operatorsCheck.operators,
    config: configResult.config ?? existingWorkspace?.config ?? null,
    elite_overrides: {},
    last_result: null,
    updated_at: imported.importedAt,
  }
  await saveProfileWorkspace(nextWorkspace)

  const existingBinding = profile.skland_binding
  await saveUserProfile({
    ...profile,
    skland_binding: {
      uid: imported.binding.uid,
      nickname: imported.binding.nickname,
      channel_name: imported.binding.channel_name,
      bound_at: existingBinding?.bound_at ?? imported.importedAt,
      last_imported_at: imported.importedAt,
      encrypted_cred: shouldReuseEncryptedCred(existingBinding, cred)
        ? existingBinding.encrypted_cred
        : encryptSklandCredential(cred),
      credential_status: 'available',
      credential_invalid_at: null,
      credential_invalid_reason: null,
    },
    skland_pending_binding: null,
    skland_risk: { uid_mismatch_count: 0, last_mismatch_uid: null, last_mismatch_nickname: null, last_mismatch_at: null },
    updated_at: imported.importedAt,
  })

  return {
    status: 'imported',
    ...imported.binding,
    operator_count: operatorsCheck.operators.length,
    imported_at: imported.importedAt,
    ...(imported.intermediateInventory && { intermediate_inventory: imported.intermediateInventory }),
    inventory_synced: Boolean(imported.intermediateInventory && configResult.config),
    config_saved: Boolean(configResult.config),
    ...(configResult.warning || imported.inventoryWarning
      ? { inventory_warning: [imported.inventoryWarning, configResult.warning].filter(Boolean).join(' ') }
      : {}),
  }
}

function resolveSklandImportConfig(
  profile: UserGameAccountRecord,
  existingConfig: LicenseConfig | null,
  inventory: IntermediateInventory | undefined,
): { config: LicenseConfig | null; warning?: string } {
  if (!inventory) return { config: null }

  const candidates = [
    ...(existingConfig ? [existingConfig] : []),
    DEFAULT_SKLAND_CONFIG,
  ]
  let lastMessage = ''
  for (const candidate of candidates) {
    const next = applyIntermediateInventoryToConfig(cloneConfig(candidate), inventory)
    const configCheck = validateConfig(next)
    if (!configCheck.ok) {
      lastMessage = configCheck.message
      continue
    }
    const permissionCheck = isFreePreviewProfile(profile)
      ? resolveFreePreviewConfig(configCheck.config)
      : resolveConfigForPermission(profile.permission, configCheck.config)
    if (permissionCheck.ok) return { config: permissionCheck.config }
    lastMessage = permissionCheck.message
  }

  return {
    config: null,
    warning: lastMessage
      ? `森空岛库存已读取，但基建配置未自动保存：${lastMessage}`
      : '森空岛库存已读取，但基建配置未自动保存。',
  }
}

function applyIntermediateInventoryToConfig(config: LicenseConfig, inventory: IntermediateInventory): LicenseConfig {
  config.intermediate_inventory = {
    'Originium Shard': normalizeInventoryCount(inventory['Originium Shard']),
    'Pure Gold': normalizeInventoryCount(inventory['Pure Gold']),
    'Orirock Cube': normalizeInventoryCount(inventory['Orirock Cube']),
  }
  config.auto_balance_source = 'intermediate_inventory'
  config.drones = {
    ...(config.drones ?? { order: 'pre', targets: [] }),
    enable: true,
    auto: true,
    auto_strategy: 'trading_priority',
    auto_target_product: undefined,
    order: config.drones?.order ?? 'pre',
    targets: Array.isArray(config.drones?.targets) ? config.drones.targets : [],
  }
  return config
}

function cloneConfig(config: LicenseConfig): LicenseConfig {
  return JSON.parse(JSON.stringify(config)) as LicenseConfig
}

function normalizeInventoryCount(value: unknown): number {
  const count = Number(value)
  return Number.isFinite(count) ? Math.max(0, Math.round(count * 100) / 100) : 0
}

async function buildPayloadWithImport(
  user: AuthPayloadUser,
  profileId: string,
  imported: SklandImportSummary,
): Promise<HandlerResponse> {
  return {
    ...(await buildAuthPayload(user, profileId)),
    skland_import: imported,
  }
}

async function markSklandCredentialInvalid(
  profile: UserGameAccountRecord,
  reason: SklandCredentialInvalidReason,
): Promise<UserGameAccountRecord> {
  if (!profile.skland_binding) return profile
  const now = new Date().toISOString()
  const nextProfile: UserGameAccountRecord = {
    ...profile,
    skland_binding: {
      ...profile.skland_binding,
      credential_status: 'invalid',
      credential_invalid_at: now,
      credential_invalid_reason: reason,
    },
    updated_at: now,
  }
  await saveUserProfile(nextProfile)
  return nextProfile
}

function isSklandCredentialInvalid(error: unknown): boolean {
  return error instanceof SklandClientError
    && (error.code === 'credential_invalid' || error.code === 'credential_format_invalid')
}

function credentialInvalidReason(error: unknown): SklandCredentialInvalidReason {
  return error instanceof SklandClientError && error.code === 'credential_format_invalid'
    ? 'credential_format_invalid'
    : 'expired_or_revoked'
}

async function requireActiveProfile(userId: string, profileId: unknown): Promise<UserGameAccountRecord> {
  const profile = await requireProfile(userId, profileId)
  if (profile.status !== 'active') throw new Error('账号档案状态不可用。')
  return profile
}

async function requireProfile(userId: string, profileId: unknown): Promise<UserGameAccountRecord> {
  if (typeof profileId !== 'string' || !profileId.trim()) throw new Error('缺少 profile_id。')
  const profile = await getProfileForUser(userId, profileId.trim())
  if (!profile) throw new Error('账号档案不存在。')
  return profile
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function toSklandPreview(binding: SklandBindingSummary, operatorCount: number): SklandPreview {
  return {
    uid: binding.uid,
    nickname: binding.nickname,
    channel_name: binding.channel_name,
    operator_count: operatorCount,
  }
}

function hashFreePreviewUid(uid: string): string {
  const secret = process.env.FREE_PREVIEW_UID_HASH_SECRET?.trim()
  if (!secret) throw new Error('FREE_PREVIEW_UID_HASH_SECRET is not configured')
  return createHmac('sha256', secret)
    .update(`skland:${uid.trim()}`)
    .digest('hex')
}

function normalizeProfileDisplayName(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 40) : ''
}

function normalizeProfileNote(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 500) : ''
}

function normalizeCredentialSource(value: unknown): CredentialSource {
  return value === 'bookmarklet' ? 'bookmarklet' : 'manual'
}

export function extractSklandCredential(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const input = value.trim()
  if (!input) return null
  if (input.length > MAX_CREDENTIAL_TEXT_LENGTH) return null

  const parsed = parseCredentialJson(input)
  if (parsed) return parsed

  const keyValue = extractCredentialFromKeyValueText(input)
  if (keyValue) return keyValue

  const firstCommaValue = normalizeCredentialCandidate(input.split(',')[0])
  if (firstCommaValue) return firstCommaValue

  return normalizeCredentialCandidate(input)
}

function parseCredentialJson(input: string): string | null {
  try {
    return findCredentialInObject(JSON.parse(input))
  } catch {
    return null
  }
}

function findCredentialInObject(value: unknown, depth = 0): string | null {
  if (depth > MAX_CREDENTIAL_JSON_DEPTH) return null
  if (!value || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findCredentialInObject(item, depth + 1)
      if (found) return found
    }
    return null
  }

  const record = value as Record<string, unknown>
  for (const key of ['SK_OAUTH_CRED_KEY', 'sk_oauth_cred_key', 'cred', 'credential']) {
    const found = normalizeCredentialCandidate(record[key])
    if (found) return found
  }
  for (const item of Object.values(record)) {
    const found = findCredentialInObject(item, depth + 1)
    if (found) return found
  }
  return null
}

function extractCredentialFromKeyValueText(input: string): string | null {
  const match = input.match(/(?:^|[;,\s{，；])["']?(?:SK_OAUTH_CRED_KEY|sk_oauth_cred_key|cred|credential)["']?\s*[:=]\s*["']?([^"',;\s}，；]+)/)
  return normalizeCredentialCandidate(match?.[1])
}

function normalizeCredentialCandidate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const rawCandidate = value.trim().replace(/^["']|["']$/g, '')
  const candidate = decodeCredentialCandidate(rawCandidate)
  if (!candidate || candidate.includes('=') || candidate.includes(';')) return null
  if (candidate.length < 12) return null
  return candidate
}

function decodeCredentialCandidate(value: string): string {
  if (!value.includes('%')) return value
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function shouldReuseEncryptedCred(existingBinding: SklandBindingRecord | null | undefined, cred: string): existingBinding is SklandBindingRecord {
  return Boolean(
    existingBinding?.encrypted_cred
      && isSklandCredentialCurrent(existingBinding.encrypted_cred)
      && cred === decryptIfPossible(existingBinding.encrypted_cred),
  )
}

function decryptIfPossible(encrypted: string): string | null {
  try {
    return decryptSklandCredential(encrypted)
  } catch {
    return null
  }
}
