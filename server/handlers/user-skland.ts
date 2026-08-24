import { createHash, createHmac, randomUUID } from 'node:crypto'
import QRCode from 'qrcode'
import type { PoolClient } from 'pg'
import type { AuthSuccessResponse, LicenseConfig, SklandCredentialInvalidReason } from '../../src/lib/types'
import {
  emptyWorkspace,
  deleteFreePreviewPendingClaim,
  getFreePreviewClaim,
  getFreePreviewPendingClaim,
  getLifetimeVoucherPendingBinding,
  getProfileForUser,
  isDepotValueProfile,
  isFreePreviewProfile,
  listProfilesForUser,
  updateProfileWorkspaceInTransaction,
  deleteLifetimeVoucherPendingBinding,
  saveFreePreviewPendingClaim,
  saveUserProfile,
  saveLifetimeVoucherPendingBinding,
  type FreePreviewClaimRecord,
  type FreePreviewPendingAccountSelectionRecord,
  type FreePreviewPendingClaimRecord,
  type FreePreviewPendingConfirmationRecord,
  type LifetimeVoucherPendingAccountSelectionRecord,
  type LifetimeVoucherPendingBindingRecord,
  type LifetimeVoucherPendingConfirmationRecord,
  type SklandBindingRecord,
  type SklandPendingAccountSelectionRecord,
  type SklandPendingBindingRecord,
  type SklandPendingConfirmationRecord,
  type UserGameAccountRecord,
} from '../storage/user-store'
import { isLifetimeVoucherUpgradeableProfile } from './lifetime-voucher-profile-policy'
import { commitReservedItemsInTransaction, getItemBalance, grantFreePreviewLimitedVoucher, InventoryError, markOnboardingTaskComplete, reserveItemsInTransaction } from '../storage/inventory-store'
import { hasDatabaseUrl, query, withTransaction } from '../storage/postgres'
import { createLifetimeVoucherProfileAuthorizationInTransaction, saveProfileInTransaction } from '../storage/cdk-redemption'
import {
  buildOperatorFingerprint,
  getCdkRecordStore,
  getRiskControlSettings,
  isProfileCdkRecord,
  normalizePermissionMode,
  recordOperatorFingerprint,
  resolveConfigForPermission,
  resolveFreePreviewConfig,
  validateConfig,
  validateOperators,
} from './license-utils'
import { getEffectiveProfilePermission, isFreePreviewTrialActive } from '../free-preview-trial'
import { getValidatedJsonRecord } from '../security/request-validation'
import { reserveSklandAttemptLayered } from '../security/layered-auth-rate-limit'
import { RateLimitStoreError } from '../security/persistent-rate-limit'
import {
  createHypergryphScan,
  decryptSklandCredential,
  encryptSklandCredential,
  getCredByHypergryphToken,
  getHypergryphTokenByScanCode,
  getScanCode,
  importSklandOperatorsByCred,
  isSklandCredentialCurrent,
  listSklandArknightsBindingsByCred,
  SklandClientError,
  type IntermediateInventory,
  type SklandAccountOption,
  type SklandBindingSummary,
  type SklandImportSummary,
} from './skland-client'
import { buildAuthPayload, jsonResponse, requireUserSession } from './user-auth'
import { recordUsageEvent } from './usage-stats'
import type { UsageReasonCode } from '../storage/usage-store'
import { CURRENT_PERSONAL_USE_DECLARATION, isCurrentPersonalUseDeclarationEffective } from '../personal-use-declaration'
import {
  attachPersonalUseDeclarationAcceptanceToProfileInTransaction,
  getPersonalUseDeclarationAcceptance,
  recordPersonalUseDeclarationUsageInTransaction,
} from '../storage/personal-use-declaration-store'
import { getRequestClientIp } from '../security/client-ip'
import {
  recordAuthenticatedRequestBehaviorEvent,
  recordRequestBehaviorEvent,
  recordRequestBehaviorEventInTransaction,
} from '../behavior-risk/service'
import {
  lockSklandUidProfilesInTransaction,
  recordSklandUidMismatchInTransaction,
} from '../storage/skland-binding-store'
import { resolveProfileAuthorization } from './profile-authorization'
import {
  ensureSklandServiceConfiguration,
  getFreePreviewUidHashSecret,
  SklandConfigurationError,
} from '../skland-config'

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
type SklandRequestContext = { req: Request; sessionTokenHash: string }

interface SklandPreview {
  uid: string
  nickname: string
  channel_name: string
  operator_count: number
}

class SklandProfileError extends Error {
  constructor(readonly code: 'profile_archived', message: string, readonly status: 409) {
    super(message)
    this.name = 'SklandProfileError'
  }
}

class SklandHttpError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 400 | 404 | 409,
    readonly recoveryAction?: 'retry' | 'rebind' | 'bind_first',
  ) {
    super(message)
    this.name = 'SklandHttpError'
  }
}

export default async (req: Request): Promise<Response> => {

  const startedAt = Date.now()
  try {
    const auth = await requireUserSession(req)
    if (!auth) return jsonResponse({ error: '请先登录。' }, 401)
    const pathname = new URL(req.url).pathname
    const rateLimit = await reserveSklandAttemptLayered(
      auth.user.id,
      pathname.endsWith('/login/complete') || pathname.endsWith('/pending/cancel') ? 'poll' : 'external',
    )
    if (!rateLimit.allowed) {
      return jsonResponse(
        { error: `森空岛请求过于频繁，请 ${rateLimit.retryAfterSeconds} 秒后重试。`, code: 'rate_limited' },
        429,
        { 'Retry-After': String(rateLimit.retryAfterSeconds), 'Cache-Control': 'no-store' },
      )
    }
    rateLimit.attempt.retainFailure()

    if (pathname.endsWith('/lifetime-voucher/pending/cancel')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      const body = await readJsonBody(req)
      if (typeof body.pending_id !== 'string' || !body.pending_id.trim()) {
        return jsonResponse({ error: '本次操作已失效，请重新开始。', code: 'operation_expired' }, 400)
      }
      await deleteLifetimeVoucherPendingBinding(auth.user.id, body.pending_id.trim())
      return jsonResponse(null, 204)
    }

    if (pathname.endsWith('/free-preview/pending/cancel')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      const body = await readJsonBody(req)
      if (typeof body.pending_id !== 'string' || !body.pending_id.trim()) {
        return jsonResponse({ error: '本次操作已失效，请重新开始。', code: 'operation_expired' }, 400)
      }
      await deleteFreePreviewPendingClaim(auth.user.id, body.pending_id.trim())
      return jsonResponse(null, 204)
    }

    if (pathname.endsWith('/pending/cancel')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      const body = await readJsonBody(req)
      const profile = await requireProfile(auth.user.id, body.profile_id)
      if (typeof body.pending_id !== 'string' || !body.pending_id.trim()) {
        return jsonResponse({ error: '本次操作已失效，请重新开始。', code: 'operation_expired' }, 400)
      }
      await clearProfileSklandPendingBinding(auth.user.id, profile.id, body.pending_id.trim())
      return jsonResponse(null, 204)
    }

    if (pathname.endsWith('/lifetime-voucher/login/start')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      ensureSklandServiceConfiguration()
      if (await getItemBalance(auth.user.id, 'lifetime_profile_voucher') < 1) {
        return jsonResponse({ error: '背包中没有可用的终身版兑换 CDK。', code: 'item_unavailable' }, 409)
      }
      const scan = await createHypergryphScan()
      return jsonResponse({
        scan_id: scan.scanId,
        qr_data_url: await QRCode.toDataURL(scan.scanUrl, { width: 300, margin: 2, errorCorrectionLevel: 'M' }),
        expires_at: scan.expiresAt,
      })
    }

    if (pathname.endsWith('/lifetime-voucher/login/complete')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      ensureSklandServiceConfiguration()
      const body = await readJsonBody(req)
      if (typeof body.scan_id !== 'string' || !body.scan_id.trim()) {
        return jsonResponse({ error: '扫码信息已失效，请重新生成二维码。', code: 'scan_expired' }, 400)
      }
      const scanCode = await getScanCode(body.scan_id.trim())
      if (!scanCode) return jsonResponse({ status: 'pending' }, 202)
      const accountToken = await getHypergryphTokenByScanCode(scanCode)
      return await createPendingLifetimeVoucherBinding(auth.user, await getCredByHypergryphToken(accountToken))
    }

    if (pathname.endsWith('/lifetime-voucher/credential/preview')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      ensureSklandServiceConfiguration()
      const body = await readJsonBody(req)
      const cred = extractSklandCredential(body.credential_text)
      if (!cred) return jsonResponse({ error: '缺少森空岛凭据。' }, 400)
      return await createPendingLifetimeVoucherBinding(auth.user, cred, normalizeCredentialSource(body.source))
    }

    if (pathname.endsWith('/lifetime-voucher/account/select')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      ensureSklandServiceConfiguration()
      const body = await readJsonBody(req)
      if (typeof body.selection_id !== 'string' || !body.selection_id.trim()) {
        return jsonResponse({ error: '账号选择信息已失效，请重新读取森空岛账号。', code: 'account_selection_expired' }, 400)
      }
      if (typeof body.uid !== 'string' || !body.uid.trim()) return jsonResponse({ error: '请选择要导入的森空岛账号。' }, 400)
      return await selectLifetimeVoucherAccount(auth.user, body.selection_id.trim(), body.uid.trim())
    }

    if (pathname.endsWith('/lifetime-voucher/login/confirm')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      ensureSklandServiceConfiguration()
      const body = await readJsonBody(req)
      if (typeof body.confirmation_id !== 'string' || !body.confirmation_id.trim()) {
        return jsonResponse({ error: '本次操作已失效，请重新开始。', code: 'operation_expired' }, 400)
      }
      if (typeof body.idempotency_key !== 'string' || !body.idempotency_key.trim()) {
        return jsonResponse({ error: '本次提交信息不完整，请重新操作。', code: 'submission_incomplete' }, 400)
      }
      return await confirmLifetimeVoucherBinding(auth.user, body.confirmation_id.trim(), body.idempotency_key.trim(), req, auth.tokenHash)
    }

    if (pathname.endsWith('/free-preview/login/start')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      ensureSklandServiceConfiguration()
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
      ensureSklandServiceConfiguration()
      const body = await readJsonBody(req)
      if (typeof body.scan_id !== 'string' || !body.scan_id.trim()) {
        return jsonResponse({ error: '扫码信息已失效，请重新生成二维码。', code: 'scan_expired' }, 400)
      }
      const scanCode = await getScanCode(body.scan_id.trim())
      if (!scanCode) return jsonResponse({ status: 'pending' }, 202)

      const accountToken = await getHypergryphTokenByScanCode(scanCode)
      const cred = await getCredByHypergryphToken(accountToken)
      return await createPendingFreePreviewClaimFromCred(auth.user, cred, body.display_name, body.note)
    }

    if (pathname.endsWith('/free-preview/credential/preview')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      ensureSklandServiceConfiguration()
      const body = await readJsonBody(req)
      const source = normalizeCredentialSource(body.source)
      const cred = extractSklandCredential(body.credential_text)
      if (!cred) return jsonResponse({ error: '缺少森空岛凭据。' }, 400)
      return await createPendingFreePreviewClaimFromCred(auth.user, cred, body.display_name, body.note, source)
    }

    if (pathname.endsWith('/free-preview/account/select')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      ensureSklandServiceConfiguration()
      const body = await readJsonBody(req)
      if (typeof body.selection_id !== 'string' || !body.selection_id.trim()) {
        return jsonResponse({ error: '账号选择信息已失效，请重新读取森空岛账号。', code: 'account_selection_expired' }, 400)
      }
      if (typeof body.uid !== 'string' || !body.uid.trim()) {
        return jsonResponse({ error: '请选择要导入的森空岛账号。' }, 400)
      }
      return await selectFreePreviewAccount(auth.user, body.selection_id.trim(), body.uid.trim())
    }

    if (pathname.endsWith('/free-preview/login/confirm')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      ensureSklandServiceConfiguration()
      const body = await readJsonBody(req)
      if (typeof body.confirmation_id !== 'string' || !body.confirmation_id.trim()) {
        return jsonResponse({ error: '本次操作已失效，请重新开始。', code: 'operation_expired' }, 400)
      }
      if (typeof body.idempotency_key !== 'string' || !body.idempotency_key.trim()) {
        return jsonResponse({ error: '本次提交信息不完整，请重新操作。', code: 'submission_incomplete' }, 400)
      }
      return await confirmFreePreviewClaim(
        auth.user,
        body.confirmation_id.trim(),
        body.idempotency_key.trim(),
        req,
        auth.tokenHash,
      )
    }

    if (pathname.endsWith('/login/start')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      ensureSklandServiceConfiguration()
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
      ensureSklandServiceConfiguration()
      const body = await readJsonBody(req)
      const profile = await requireActiveProfile(auth.user.id, body.profile_id)
      if (typeof body.scan_id !== 'string' || !body.scan_id.trim()) {
        return jsonResponse({ error: '扫码信息已失效，请重新生成二维码。', code: 'scan_expired' }, 400)
      }
      const scanCode = await getScanCode(body.scan_id.trim())
      if (!scanCode) return jsonResponse({ status: 'pending' }, 202)

      const accountToken = await getHypergryphTokenByScanCode(scanCode)
      const cred = await getCredByHypergryphToken(accountToken)
      return await createPendingSklandBindingFromCred(auth.user, profile, cred, undefined, { req, sessionTokenHash: auth.tokenHash })
    }

    if (pathname.endsWith('/credential/preview')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      ensureSklandServiceConfiguration()
      const body = await readJsonBody(req)
      const profile = await requireActiveProfile(auth.user.id, body.profile_id)
      const source = normalizeCredentialSource(body.source)
      const cred = extractSklandCredential(body.credential_text)
      if (!cred) return jsonResponse({ error: '缺少森空岛凭据。' }, 400)
      return await createPendingSklandBindingFromCred(auth.user, profile, cred, source, { req, sessionTokenHash: auth.tokenHash })
    }

    if (pathname.endsWith('/account/select')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      ensureSklandServiceConfiguration()
      const body = await readJsonBody(req)
      const profile = await requireActiveProfile(auth.user.id, body.profile_id)
      if (typeof body.selection_id !== 'string' || !body.selection_id.trim()) {
        return jsonResponse({ error: '账号选择信息已失效，请重新读取森空岛账号。', code: 'account_selection_expired' }, 400)
      }
      if (typeof body.uid !== 'string' || !body.uid.trim()) {
        return jsonResponse({ error: '请选择要导入的森空岛账号。' }, 400)
      }
      return await selectSklandAccount(
        auth.user,
        profile,
        body.selection_id.trim(),
        body.uid.trim(),
        { req, sessionTokenHash: auth.tokenHash },
      )
    }

    if (pathname.endsWith('/login/confirm')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      ensureSklandServiceConfiguration()
      const body = await readJsonBody(req)
      const profile = await requireProfile(auth.user.id, body.profile_id)
      if (typeof body.confirmation_id !== 'string' || !body.confirmation_id.trim()) {
        return jsonResponse({ error: '本次操作已失效，请重新开始。', code: 'operation_expired' }, 400)
      }
      if (typeof body.idempotency_key !== 'string' || !body.idempotency_key.trim()) {
        return jsonResponse({ error: '本次提交信息不完整，请重新操作。', code: 'submission_incomplete' }, 400)
      }
      return await confirmProfileSklandBinding({
        user: auth.user,
        profile,
        confirmationId: body.confirmation_id.trim(),
        idempotencyKey: body.idempotency_key.trim(),
        req,
        auth,
        startedAt,
      })
    }

    if (pathname.endsWith('/import/refresh')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      ensureSklandServiceConfiguration()
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
        const imported = await saveSklandImport(auth.user.id, profile, decryptSklandCredential(encryptedCred), profile.skland_binding!.uid)
        await recordSklandImport('success', 'ok', startedAt, profile.id, 'refresh')
        await recordAuthenticatedRequestBehaviorEvent({ req, auth, eventType: 'workspace_save', profileId: profile.id })
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
        throw caught
      }
    }

    return jsonResponse({ error: 'API route not found' }, 404)
  } catch (error) {
    if (error instanceof SklandConfigurationError) {
      return jsonResponse({
        error: error.message,
        code: error.code,
        recovery_action: 'contact_support',
      }, 503, { 'Cache-Control': 'no-store' })
    }
    if (error instanceof SklandProfileError) {
      return jsonResponse({ error: error.message, code: error.code }, error.status)
    }
    if (error instanceof SklandHttpError) {
      return jsonResponse({
        error: error.message,
        code: error.code,
        ...(error.recoveryAction && { recovery_action: error.recoveryAction }),
      }, error.status)
    }
    if (error instanceof RateLimitStoreError) {
      return jsonResponse(
        { error: 'Credential service is temporarily unavailable.' },
        503,
        { 'Retry-After': '1', 'Cache-Control': 'no-store' },
      )
    }
    if (error instanceof InventoryError) {
      return jsonResponse({ error: error.message, code: error.code }, error.status)
    }
    console.error('user skland error:', error instanceof Error ? error.message : error)
    if (error instanceof SklandClientError) {
      if (error.code === 'credential_invalid' || error.code === 'credential_format_invalid') {
        return jsonResponse({ error: error.message, code: 'skland_credential_invalid', recovery_action: 'rebind' }, 400)
      }
      return jsonResponse({
        error: '鹰角或森空岛服务暂不可用，请稍后重试。',
        code: 'skland_upstream_failed',
        recovery_action: 'retry',
      }, 502)
    }
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return jsonResponse({
        error: '鹰角或森空岛服务请求超时，请稍后重试。',
        code: 'skland_upstream_timeout',
        recovery_action: 'retry',
      }, 504)
    }
    return jsonResponse({
      error: '森空岛服务处理请求时发生内部错误。',
      code: 'skland_internal_error',
      recovery_action: 'retry',
    }, 500)
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

async function clearProfileSklandPendingBinding(userId: string, profileId: string, pendingId: string): Promise<void> {
  await withTransaction(async (client) => {
    const locked = await client.query<{ record_json: UserGameAccountRecord }>(
      'select record_json from user_game_accounts where id = $1 and user_id = $2 for update',
      [profileId, userId],
    )
    const profile = locked.rows[0]?.record_json
    if (!profile || profile.skland_pending_binding?.confirmation_id !== pendingId) return
    await saveProfileInTransaction(client, {
      ...profile,
      skland_pending_binding: null,
      updated_at: new Date().toISOString(),
    })
  })
}

type SklandConfirmationOperationResponse = {
  profile_id: string
  imported?: SklandImportSummary
}

type PreparedSklandImport = {
  binding: SklandBindingSummary
  operators: Extract<ReturnType<typeof validateOperators>, { ok: true }>['operators']
  intermediateInventory?: IntermediateInventory
  inventoryWarning?: string
  importedAt: string
}

async function getSklandConfirmationReplay(
  userId: string,
  idempotencyKey: string,
  requestHash: string,
): Promise<SklandConfirmationOperationResponse | null> {
  const replay = await query<{
    request_hash: string
    response_json: SklandConfirmationOperationResponse | null
  }>(
    'select request_hash, response_json from inventory_operations where user_id = $1 and idempotency_key = $2',
    [userId, idempotencyKey],
  )
  const row = replay.rows[0]
  if (!row) return null
  if (row.request_hash !== requestHash) {
    throw new SklandHttpError('idempotency_conflict', '提交内容已发生变化，请刷新页面后重新操作。', 409)
  }
  if (!row.response_json) {
    throw new SklandHttpError('operation_in_progress', '森空岛绑定正在处理中。', 409, 'retry')
  }
  return row.response_json
}

async function beginSklandConfirmationOperation(
  client: PoolClient,
  input: {
    userId: string
    idempotencyKey: string
    requestHash: string
    operationType: 'bind_skland_profile' | 'claim_free_preview'
    now: string
  },
): Promise<string> {
  const operationId = randomUUID()
  const inserted = await client.query(
    `insert into inventory_operations
      (id, user_id, idempotency_key, operation_type, request_hash, created_at)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (user_id, idempotency_key) do nothing`,
    [operationId, input.userId, input.idempotencyKey, input.operationType, input.requestHash, input.now],
  )
  if (!inserted.rowCount) {
    throw new SklandHttpError('operation_in_progress', '森空岛绑定正在处理中。', 409, 'retry')
  }
  return operationId
}

async function completeSklandConfirmationOperation(
  client: PoolClient,
  operationId: string,
  response: SklandConfirmationOperationResponse,
  now: string,
): Promise<void> {
  await client.query(
    'update inventory_operations set response_json = $2::jsonb, completed_at = $3 where id = $1',
    [operationId, JSON.stringify(response), now],
  )
}

function createSklandConfirmationRequestHash(
  scope: 'profile' | 'free_preview' | 'lifetime_voucher',
  userId: string,
  confirmationId: string,
  profileId?: string,
): string {
  return createHash('sha256')
    .update(JSON.stringify({ scope, userId, confirmationId, profileId: profileId ?? null }))
    .digest('hex')
}

async function prepareSklandImport(
  profile: UserGameAccountRecord,
  cred: string,
  uid: string,
): Promise<PreparedSklandImport> {
  if (profile.archived_at) throw new SklandProfileError('profile_archived', '归档档案不能更新森空岛绑定或工作区。', 409)
  const imported = await importSklandOperatorsByCred(cred, { uid, includeInventory: true })
  const operatorsCheck = validateOperators(imported.operators)
  if (!operatorsCheck.ok) {
    throw new SklandHttpError('skland_operator_data_invalid', operatorsCheck.message, 400)
  }
  if (profile.skland_binding?.uid && profile.skland_binding.uid !== imported.binding.uid) {
    throw new SklandHttpError('skland_account_mismatch', '森空岛账号与当前档案绑定的 UID 不一致。', 409, 'rebind')
  }

  return {
    binding: imported.binding,
    operators: operatorsCheck.operators,
    intermediateInventory: imported.intermediateInventory,
    inventoryWarning: imported.inventoryWarning,
    importedAt: imported.importedAt,
  }
}

async function persistPreparedSklandImportInTransaction(
  client: PoolClient,
  userId: string,
  profileId: string,
  cred: string,
  prepared: PreparedSklandImport,
): Promise<SklandImportSummary> {
  const locked = await client.query<{ record_json: UserGameAccountRecord }>(
    `select record_json from user_game_accounts
      where id = $1 and user_id = $2
      for update`,
    [profileId, userId],
  )
  const profile = locked.rows[0]?.record_json
  if (!profile) throw new SklandHttpError('profile_not_found', '账号档案不存在。', 404)
  if (profile.archived_at) throw new SklandProfileError('profile_archived', '归档档案不能更新森空岛绑定或工作区。', 409)
  if (profile.status !== 'active') throw new SklandHttpError('profile_unavailable', '账号档案状态不可用。', 409)
  if (profile.skland_binding?.uid && profile.skland_binding.uid !== prepared.binding.uid) {
    throw new SklandHttpError('skland_account_mismatch', '森空岛账号与当前档案绑定的 UID 不一致。', 409, 'rebind')
  }

  if (isFreePreviewProfile(profile)) {
    const uidHash = hashFreePreviewUid(prepared.binding.uid)
    const claim = buildFreePreviewClaim(uidHash, userId, profile.id, prepared.binding, prepared.importedAt)
    const inserted = await client.query(
      `insert into free_preview_claims (uid_hash, user_id, profile_id, claimed_at, record_json)
       values ($1, $2, $3, $4, $5::jsonb)
       on conflict (uid_hash) do nothing`,
      [claim.uid_hash, claim.user_id, claim.profile_id, claim.claimed_at, JSON.stringify(claim)],
    )
    if (!inserted.rowCount) {
      const existing = await client.query<{ profile_id: string }>(
        'select profile_id from free_preview_claims where uid_hash = $1 for update',
        [uidHash],
      )
      if (existing.rows[0]?.profile_id !== profile.id) {
        throw new SklandHttpError('free_preview_uid_claimed', '该森空岛 UID 已经领取过免费个人排班档案。', 409)
      }
    }
  }

  let configResult: ReturnType<typeof resolveSklandImportConfig> = { config: null }
  await updateProfileWorkspaceInTransaction(client, profile.id, (existingWorkspace) => {
    configResult = resolveSklandImportConfig(profile, existingWorkspace?.config ?? null, prepared.intermediateInventory)
    return {
      ...(existingWorkspace ?? emptyWorkspace(profile.id)),
      operators: prepared.operators,
      config: configResult.config ?? existingWorkspace?.config ?? null,
      elite_overrides: {},
      updated_at: prepared.importedAt,
    }
  })

  const existingBinding = profile.skland_binding
  await saveProfileInTransaction(client, {
    ...profile,
    skland_binding: {
      uid: prepared.binding.uid,
      nickname: prepared.binding.nickname,
      channel_name: prepared.binding.channel_name,
      bound_at: existingBinding?.bound_at ?? prepared.importedAt,
      last_imported_at: prepared.importedAt,
      encrypted_cred: shouldReuseEncryptedCred(existingBinding, cred)
        ? existingBinding.encrypted_cred
        : encryptSklandCredential(cred),
      credential_status: 'available',
      credential_invalid_at: null,
      credential_invalid_reason: null,
    },
    skland_pending_binding: null,
    skland_risk: { uid_mismatch_count: 0, last_mismatch_uid: null, last_mismatch_nickname: null, last_mismatch_at: null },
    updated_at: prepared.importedAt,
  })

  return {
    status: 'imported',
    ...prepared.binding,
    operator_count: prepared.operators.length,
    imported_at: prepared.importedAt,
    ...(prepared.intermediateInventory && { intermediate_inventory: prepared.intermediateInventory }),
    inventory_synced: Boolean(prepared.intermediateInventory && configResult.config),
    config_saved: Boolean(configResult.config),
    ...(configResult.warning || prepared.inventoryWarning
      ? { inventory_warning: [prepared.inventoryWarning, configResult.warning].filter(Boolean).join(' ') }
      : {}),
  }
}

async function runSklandImportPostCommit(
  userId: string,
  profile: UserGameAccountRecord,
  prepared: PreparedSklandImport,
): Promise<void> {
  const tasks: Promise<unknown>[] = []
  if (hasDatabaseUrl()) tasks.push(markOnboardingTaskComplete(userId, 'bind_skland', prepared.importedAt))
  if (isFreePreviewProfile(profile)) tasks.push(grantFreePreviewLimitedVoucher(userId, new Date(prepared.importedAt)))
  if (profile.cdk_key) tasks.push(recordSklandOperatorFingerprint(profile, prepared.operators))
  const results = await Promise.allSettled(tasks)
  for (const result of results) {
    if (result.status === 'rejected') console.warn('skland import post-commit task skipped:', result.reason)
  }
}

async function recordSklandOperatorFingerprint(
  profile: UserGameAccountRecord,
  operators: PreparedSklandImport['operators'],
): Promise<void> {
  if (!profile.cdk_key) return
  const cdkStore = await getCdkRecordStore()
  const cdkRecord = await cdkStore.get(profile.cdk_key)
  if (!cdkRecord || !isProfileCdkRecord(cdkRecord) || cdkRecord.status !== 'used') return
  if (normalizePermissionMode(cdkRecord.permission) !== 'advanced') return
  const riskSettings = await getRiskControlSettings()
  if (!riskSettings.operator_data_risk_enabled) return
  await recordOperatorFingerprint(cdkRecord, buildOperatorFingerprint(operators))
}

async function confirmProfileSklandBinding(input: {
  user: AuthPayloadUser
  profile: UserGameAccountRecord
  confirmationId: string
  idempotencyKey: string
  req: Request
  auth: NonNullable<Awaited<ReturnType<typeof requireUserSession>>>
  startedAt: number
}): Promise<Response> {
  const requestHash = createSklandConfirmationRequestHash(
    'profile',
    input.user.id,
    input.confirmationId,
    input.profile.id,
  )
  const replay = await getSklandConfirmationReplay(input.user.id, input.idempotencyKey, requestHash)
  if (replay) {
    const payload = replay.imported
      ? await buildPayloadWithImport(input.user, replay.profile_id, replay.imported)
      : await buildAuthPayload(input.user, replay.profile_id)
    return jsonResponse({ ...payload, replayed: true })
  }

  const pending = input.profile.skland_pending_binding
  if (!isSklandConfirmationPending(pending) || pending.confirmation_id !== input.confirmationId) {
    await recordSklandImport('failure', 'skland_confirm_invalid', input.startedAt, input.profile.id, 'login_confirm')
    throw new SklandHttpError('skland_confirm_invalid', '森空岛绑定确认已失效，请重新登录森空岛。', 400, 'rebind')
  }
  if (Date.now() > Date.parse(pending.expires_at)) {
    await clearProfileSklandPendingBinding(input.user.id, input.profile.id, input.confirmationId)
    await recordSklandImport('failure', 'skland_pending_expired', input.startedAt, input.profile.id, 'login_confirm')
    throw new SklandHttpError('skland_pending_expired', '森空岛绑定确认已过期，请重新登录森空岛。', 400, 'rebind')
  }
  if (input.profile.skland_binding?.uid && input.profile.skland_binding.uid !== pending.uid) {
    await recordSklandImport('failure', 'skland_account_mismatch', input.startedAt, input.profile.id, 'login_confirm')
    throw new SklandHttpError('skland_account_mismatch', '森空岛账号与当前绑定账号不一致，请重新登录森空岛。', 409, 'rebind')
  }

  const now = new Date().toISOString()
  let operationResponse: SklandConfirmationOperationResponse
  if (isDepotValueProfile(input.profile)) {
    operationResponse = await withTransaction(async (client) => {
      const operationId = await beginSklandConfirmationOperation(client, {
        userId: input.user.id,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        operationType: 'bind_skland_profile',
        now,
      })
      const locked = await client.query<{ record_json: UserGameAccountRecord }>(
        'select record_json from user_game_accounts where id = $1 and user_id = $2 for update',
        [input.profile.id, input.user.id],
      )
      const current = locked.rows[0]?.record_json
      const currentPending = current?.skland_pending_binding
      if (!current || !isSklandConfirmationPending(currentPending) || currentPending.confirmation_id !== input.confirmationId) {
        throw new SklandHttpError('skland_confirm_invalid', '森空岛绑定确认已失效，请重新登录森空岛。', 400, 'rebind')
      }
      if (current.archived_at) {
        throw new SklandProfileError('profile_archived', '归档档案不能更新森空岛绑定或工作区。', 409)
      }
      if (current.status !== 'active') {
        throw new SklandHttpError('profile_unavailable', '账号档案状态不可用。', 409)
      }
      await saveProfileInTransaction(client, buildDepotValueSklandProfile(current, currentPending, now))
      const response = { profile_id: current.id }
      await completeSklandConfirmationOperation(client, operationId, response, now)
      return response
    })
  } else {
    const cred = decryptSklandCredential(pending.encrypted_cred)
    const prepared = await prepareSklandImport(input.profile, cred, pending.uid)
    operationResponse = await withTransaction(async (client) => {
      const operationId = await beginSklandConfirmationOperation(client, {
        userId: input.user.id,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        operationType: 'bind_skland_profile',
        now: prepared.importedAt,
      })
      const imported = await persistPreparedSklandImportInTransaction(
        client,
        input.user.id,
        input.profile.id,
        cred,
        prepared,
      )
      const response = { profile_id: input.profile.id, imported }
      await completeSklandConfirmationOperation(client, operationId, response, prepared.importedAt)
      return response
    })
    await runSklandImportPostCommit(input.user.id, input.profile, prepared)
  }

  await recordSklandImport('success', 'ok', input.startedAt, input.profile.id, 'login_confirm')
  const behaviorDeclaration = isFreePreviewProfile(input.profile)
    ? await getPersonalUseDeclarationAcceptance(input.user.id).catch(() => null)
    : null
  await recordAuthenticatedRequestBehaviorEvent({
    req: input.req,
    auth: input.auth,
    eventType: 'bind',
    profileId: input.profile.id,
    uid: pending.uid,
    activityClaimedAt: isFreePreviewProfile(input.profile) ? input.profile.created_at : null,
    declarationVersion: behaviorDeclaration?.declaration_version,
    declarationAcceptedAt: behaviorDeclaration?.accepted_at,
  })
  const payload = operationResponse.imported
    ? await buildPayloadWithImport(input.user, operationResponse.profile_id, operationResponse.imported)
    : await buildAuthPayload(input.user, operationResponse.profile_id)
  return jsonResponse({ ...payload, replayed: false })
}

async function createPendingLifetimeVoucherBinding(
  user: AuthPayloadUser,
  cred: string,
  source?: CredentialSource,
): Promise<Response> {
  if (await getItemBalance(user.id, 'lifetime_profile_voucher') < 1) {
    return jsonResponse({ error: '背包中没有可用的终身版兑换 CDK。', code: 'item_unavailable' }, 409)
  }
  const accounts = await listSklandArknightsBindingsByCred(cred)
  const now = new Date()
  const confirmationId = randomUUID()
  const createdAt = now.toISOString()
  const expiresAt = new Date(now.getTime() + PENDING_BINDING_TTL_MS).toISOString()
  if (accounts.length > 1) {
    await saveLifetimeVoucherPendingBinding({
      stage: 'account_selection', confirmation_id: confirmationId, user_id: user.id, accounts,
      encrypted_cred: encryptSklandCredential(cred), ...(source && { source }), created_at: createdAt, expires_at: expiresAt,
    })
    return accountSelectionResponse(confirmationId, accounts, '请选择要绑定或升级为终身版的明日方舟账号。')
  }
  return createLifetimeVoucherConfirmation(user, cred, accounts[0].uid, { confirmationId, createdAt, expiresAt })
}

async function selectLifetimeVoucherAccount(user: AuthPayloadUser, selectionId: string, uid: string): Promise<Response> {
  const pending = await getLifetimeVoucherPendingBinding(user.id, selectionId)
  if (!isLifetimeVoucherAccountSelectionPending(pending) || Date.now() > Date.parse(pending.expires_at)) {
    await deleteLifetimeVoucherPendingBinding(user.id, selectionId)
    return jsonResponse({ error: '森空岛账号选择已失效，请重新授权。' }, 400)
  }
  if (!pending.accounts.some((account) => account.uid === uid)) return jsonResponse({ error: '所选森空岛账号无效。' }, 400)
  const cred = decryptSklandCredential(pending.encrypted_cred)
  const currentAccounts = await listSklandArknightsBindingsByCred(cred)
  if (!currentAccounts.some((account) => account.uid === uid)) {
    await deleteLifetimeVoucherPendingBinding(user.id, selectionId)
    return jsonResponse({ error: '所选账号已不在森空岛绑定列表中，请重新授权。' }, 400)
  }
  return createLifetimeVoucherConfirmation(user, cred, uid, {
    confirmationId: pending.confirmation_id,
    createdAt: pending.created_at,
    expiresAt: pending.expires_at,
  })
}

async function createLifetimeVoucherConfirmation(
  user: AuthPayloadUser,
  cred: string,
  uid: string,
  options: { confirmationId: string; createdAt: string; expiresAt: string },
): Promise<Response> {
  const imported = await importSklandOperatorsByCred(cred, { uid })
  const operatorsCheck = validateOperators(imported.operators)
  if (!operatorsCheck.ok) throw new Error(operatorsCheck.message)
  await saveLifetimeVoucherPendingBinding({
    stage: 'confirmation', confirmation_id: options.confirmationId, user_id: user.id,
    uid: imported.binding.uid, nickname: imported.binding.nickname, channel_name: imported.binding.channel_name,
    operator_count: operatorsCheck.operators.length, encrypted_cred: encryptSklandCredential(cred),
    created_at: options.createdAt, expires_at: options.expiresAt,
  })
  return jsonResponse({
    status: 'confirm_required',
    confirmation_id: options.confirmationId,
    skland_preview: toSklandPreview(imported.binding, operatorsCheck.operators.length),
    warning: '确认后将创建终身档案；同 UID 的免费预览或个人按次档案会原地升级。只有最终保存成功后才消耗道具。',
  })
}

async function confirmLifetimeVoucherBinding(
  user: AuthPayloadUser,
  confirmationId: string,
  idempotencyKey: string,
  req: Request,
  sessionTokenHash: string,
): Promise<Response> {
  const requestHash = createSklandConfirmationRequestHash('lifetime_voucher', user.id, confirmationId)
  const replay = await query<{ request_hash: string; response_json: LifetimeVoucherOperationResponse | null }>(
    'select request_hash, response_json from inventory_operations where user_id = $1 and idempotency_key = $2',
    [user.id, idempotencyKey],
  )
  if (replay.rows[0]) {
    if (replay.rows[0].request_hash !== requestHash) {
      return jsonResponse({ error: '提交内容已发生变化，请刷新页面后重新操作。', code: 'idempotency_conflict' }, 409)
    }
    if (!replay.rows[0].response_json) return jsonResponse({ error: '终身版绑定正在处理中。', code: 'operation_in_progress' }, 409)
    const previous = replay.rows[0].response_json
    return jsonResponse({ ...(await buildPayloadWithImport(user, previous.profile_id, previous.imported)), replayed: true })
  }
  const pending = await getLifetimeVoucherPendingBinding(user.id, confirmationId)
  if (!isLifetimeVoucherConfirmationPending(pending) || Date.now() > Date.parse(pending.expires_at)) {
    await deleteLifetimeVoucherPendingBinding(user.id, confirmationId)
    return jsonResponse({ error: '终身版绑定确认已过期，请重新登录森空岛。' }, 400)
  }
  const cred = decryptSklandCredential(pending.encrypted_cred)
  const imported = await importSklandOperatorsByCred(cred, { uid: pending.uid, includeInventory: true })
  const operatorsCheck = validateOperators(imported.operators)
  if (!operatorsCheck.ok) throw new Error(operatorsCheck.message)
  const result = await withTransaction(async (client): Promise<LifetimeVoucherOperationResponse> => {
    const operationId = randomUUID()
    const now = imported.importedAt
    const inserted = await client.query(
      `insert into inventory_operations (id, user_id, idempotency_key, operation_type, request_hash, created_at)
       values ($1, $2, $3, 'bind_lifetime_profile', $4, $5)
       on conflict (user_id, idempotency_key) do nothing`,
      [operationId, user.id, idempotencyKey, requestHash, now],
    )
    if (!inserted.rowCount) throw new InventoryError('operation_in_progress', '终身版绑定正在处理中。', 409)
    const uidProfiles = await lockSklandUidProfilesInTransaction(client, imported.binding.uid)
    const foreign = uidProfiles.find((profile) => profile.user_id !== user.id)
    if (foreign) throw new InventoryError('skland_uid_owned', '该森空岛 UID 已绑定其他网站账号。', 409)
    const currentUserProfiles = uidProfiles
    const nonUpgradeable = currentUserProfiles.find((profile) => !isLifetimeVoucherUpgradeableProfile(profile))
    if (nonUpgradeable) throw new InventoryError('skland_uid_already_bound', '该森空岛 UID 已经绑定其他终身或商用档案。', 409)
    const existingProfile = currentUserProfiles.find(isLifetimeVoucherUpgradeableProfile)
    const profileId = existingProfile?.id ?? randomUUID()
    const authorization = await createLifetimeVoucherProfileAuthorizationInTransaction(client, {
      operationId,
      userId: user.id,
      profileId,
      authorizedAt: now,
      operatorCount: operatorsCheck.operators.length,
    })
    const currentWorkspace = existingProfile
      ? await updateProfileWorkspaceInTransaction(client, profileId, (workspace) => workspace ?? emptyWorkspace(profileId))
      : emptyWorkspace(profileId)
    const baseProfile: UserGameAccountRecord = existingProfile ?? {
      version: 1, id: profileId, user_id: user.id, kind: 'cdk', cdk_key: null, cdk_code_hash: null,
      cdk_order_hash: null, permission: 'advanced', status: 'active', display_name: imported.binding.nickname || '终身档案',
      note: '使用终身版兑换 CDK 绑定。', created_at: now, updated_at: now,
    }
    const nextProfile: UserGameAccountRecord = {
      ...baseProfile,
      kind: 'cdk', cdk_key: authorization.cdkKey, cdk_code_hash: authorization.codeHash,
      cdk_order_hash: authorization.orderHash, permission: 'advanced', status: 'active', temporary_permission: null,
      skland_binding: {
        uid: imported.binding.uid, nickname: imported.binding.nickname, channel_name: imported.binding.channel_name,
        bound_at: existingProfile?.skland_binding?.bound_at ?? now, last_imported_at: now,
        encrypted_cred: encryptSklandCredential(cred), credential_status: 'available',
        credential_invalid_at: null, credential_invalid_reason: null,
      },
      skland_pending_binding: null,
      skland_risk: { uid_mismatch_count: 0, last_mismatch_uid: null, last_mismatch_nickname: null, last_mismatch_at: null },
      updated_at: now,
    }
    const configResult = resolveSklandImportConfig(nextProfile, currentWorkspace.config, imported.intermediateInventory)
    await saveProfileInTransaction(client, nextProfile)
    await updateProfileWorkspaceInTransaction(client, profileId, () => ({
      ...currentWorkspace, profile_id: profileId, operators: operatorsCheck.operators,
      config: configResult.config ?? currentWorkspace.config, elite_overrides: {}, updated_at: now,
    }))
    await reserveItemsInTransaction(client, user.id, ['lifetime_profile_voucher'], 'inventory_operation', operationId, profileId, now)
    await commitReservedItemsInTransaction(client, 'inventory_operation', operationId, now)
    const response: LifetimeVoucherOperationResponse = {
      profile_id: profileId,
      imported: {
        status: 'imported', ...imported.binding, operator_count: operatorsCheck.operators.length, imported_at: now,
        ...(imported.intermediateInventory && { intermediate_inventory: imported.intermediateInventory }),
        inventory_synced: Boolean(imported.intermediateInventory && configResult.config),
        config_saved: Boolean(configResult.config),
        ...(configResult.warning || imported.inventoryWarning
          ? { inventory_warning: [imported.inventoryWarning, configResult.warning].filter(Boolean).join(' ') }
          : {}),
      },
    }
    await client.query(
      'delete from lifetime_voucher_pending_bindings where user_id = $1 and confirmation_id = $2',
      [user.id, confirmationId],
    )
    await client.query('update inventory_operations set response_json = $2::jsonb, completed_at = $3 where id = $1', [operationId, JSON.stringify(response), now])
    return response
  })
  const postCommitTasks = await Promise.allSettled([
    markOnboardingTaskComplete(user.id, 'bind_skland', result.imported.imported_at),
    recordRequestBehaviorEvent({ req, eventType: 'bind', userId: user.id, sessionTokenHash, profileId: result.profile_id, uid: result.imported.uid }),
  ])
  for (const task of postCommitTasks) {
    if (task.status === 'rejected') console.warn('lifetime voucher post-commit task skipped:', task.reason)
  }
  return jsonResponse({ ...(await buildPayloadWithImport(user, result.profile_id, result.imported)), replayed: false })
}

type LifetimeVoucherOperationResponse = { profile_id: string; imported: SklandImportSummary }

function isLifetimeVoucherAccountSelectionPending(
  pending: LifetimeVoucherPendingBindingRecord | null,
): pending is LifetimeVoucherPendingAccountSelectionRecord {
  return pending?.stage === 'account_selection'
}

function isLifetimeVoucherConfirmationPending(
  pending: LifetimeVoucherPendingBindingRecord | null,
): pending is LifetimeVoucherPendingConfirmationRecord {
  return pending?.stage === 'confirmation'
}

async function createPendingFreePreviewClaimFromCred(
  user: AuthPayloadUser,
  cred: string,
  displayNameValue?: unknown,
  noteValue?: unknown,
  source?: CredentialSource,
): Promise<Response> {
  const existingPreview = (await listProfilesForUser(user.id)).find((profile) => isFreePreviewProfile(profile))
  if (existingPreview?.skland_binding) {
    return jsonResponse({ error: '当前网站账号已经领取过免费个人排班档案。', code: 'free_preview_already_claimed' }, 409)
  }
  if (existingPreview && existingPreview.status !== 'active') {
    return jsonResponse({ error: '免费个人排班档案当前不可用。' }, 403)
  }

  const accounts = await listSklandArknightsBindingsByCred(cred)
  const now = new Date()
  const confirmationId = randomUUID()
  const displayName = normalizeProfileDisplayName(displayNameValue)
  const note = normalizeProfileNote(noteValue)
  const createdAt = now.toISOString()
  const expiresAt = new Date(now.getTime() + PENDING_BINDING_TTL_MS).toISOString()
  if (accounts.length > 1) {
    const pending: FreePreviewPendingAccountSelectionRecord = {
      stage: 'account_selection',
      confirmation_id: confirmationId,
      user_id: user.id,
      accounts,
      encrypted_cred: encryptSklandCredential(cred),
      display_name: displayName,
      note,
      ...(source && { source }),
      created_at: createdAt,
      expires_at: expiresAt,
    }
    await saveFreePreviewPendingClaim(pending)
    return accountSelectionResponse(
      confirmationId,
      accounts,
      source === 'bookmarklet'
        ? '已读取书签脚本凭据，请选择要用于免费个人排班的明日方舟账号。'
        : '检测到多个明日方舟账号，请选择要用于免费个人排班的账号。',
    )
  }

  return createPendingFreePreviewConfirmationFromCred(user, cred, accounts[0].uid, {
    confirmationId,
    displayName,
    note,
    source,
    createdAt,
    expiresAt,
  })
}

async function selectFreePreviewAccount(user: AuthPayloadUser, selectionId: string, uid: string): Promise<Response> {
  const pending = await getFreePreviewPendingClaim(user.id, selectionId)
  if (!isFreePreviewAccountSelectionPending(pending)) {
    return jsonResponse({ error: '森空岛账号选择已失效，请重新授权。' }, 400)
  }
  if (Date.now() > Date.parse(pending.expires_at)) {
    await deleteFreePreviewPendingClaim(user.id, selectionId)
    return jsonResponse({ error: '森空岛账号选择已过期，请重新授权。' }, 400)
  }
  if (!pending.accounts.some((account) => account.uid === uid)) {
    await deleteFreePreviewPendingClaim(user.id, selectionId)
    return jsonResponse({ error: '所选森空岛账号无效，请重新授权。' }, 400)
  }

  const cred = decryptSklandCredential(pending.encrypted_cred)
  const currentAccounts = await listSklandArknightsBindingsByCred(cred)
  if (!currentAccounts.some((account) => account.uid === uid)) {
    await deleteFreePreviewPendingClaim(user.id, selectionId)
    return jsonResponse({ error: '所选账号已不在森空岛绑定列表中，请重新授权。' }, 400)
  }

  return createPendingFreePreviewConfirmationFromCred(user, cred, uid, {
    confirmationId: pending.confirmation_id,
    displayName: pending.display_name,
    note: pending.note,
    source: pending.source,
    createdAt: pending.created_at,
    expiresAt: pending.expires_at,
  })
}

async function createPendingFreePreviewConfirmationFromCred(
  user: AuthPayloadUser,
  cred: string,
  uid: string,
  options: {
    confirmationId: string
    displayName: string
    note: string
    source?: CredentialSource
    createdAt: string
    expiresAt: string
  },
): Promise<Response> {
  const imported = await importSklandOperatorsByCred(cred, { uid })
  const operatorsCheck = validateOperators(imported.operators)
  if (!operatorsCheck.ok) throw new Error(operatorsCheck.message)
  const preview = toSklandPreview(imported.binding, operatorsCheck.operators.length)

  const uidHash = hashFreePreviewUid(imported.binding.uid)
  const existingClaim = await getFreePreviewClaim(uidHash)
  const existingPreview = (await listProfilesForUser(user.id)).find((profile) => isFreePreviewProfile(profile))
  if (existingClaim && existingClaim.profile_id !== existingPreview?.id) {
    return jsonResponse({ error: '该森空岛 UID 已经领取过免费个人排班档案。', code: 'free_preview_uid_claimed' }, 409)
  }

  await saveFreePreviewPendingClaim({
    stage: 'confirmation',
    confirmation_id: options.confirmationId,
    user_id: user.id,
    uid: imported.binding.uid,
    nickname: imported.binding.nickname,
    channel_name: imported.binding.channel_name,
    encrypted_cred: encryptSklandCredential(cred),
    operator_count: operatorsCheck.operators.length,
    display_name: options.displayName,
    note: options.note,
    created_at: options.createdAt,
    expires_at: options.expiresAt,
  })

  return jsonResponse({
    status: 'confirm_required',
    confirmation_id: options.confirmationId,
    skland_preview: preview,
    warning: options.source === 'bookmarklet'
      ? '已读取书签脚本凭据，请确认昵称和 UID 后再创建免费个人排班档案。'
      : '请确认昵称和 UID 后再创建免费个人排班档案。',
  })
}

async function confirmFreePreviewClaim(
  user: AuthPayloadUser,
  confirmationId: string,
  idempotencyKey: string,
  req: Request,
  sessionTokenHash: string,
): Promise<Response> {
  const requestHash = createSklandConfirmationRequestHash('free_preview', user.id, confirmationId)
  const replay = await getSklandConfirmationReplay(user.id, idempotencyKey, requestHash)
  if (replay?.imported) {
    return jsonResponse({
      ...(await buildPayloadWithImport(user, replay.profile_id, replay.imported)),
      replayed: true,
    })
  }

  const pending = await getFreePreviewPendingClaim(user.id, confirmationId)
  if (!isFreePreviewConfirmationPending(pending)) {
    throw new SklandHttpError('skland_confirm_invalid', '免费个人排班确认已过期，请重新登录森空岛。', 400, 'rebind')
  }
  if (Date.now() > Date.parse(pending.expires_at)) {
    await deleteFreePreviewPendingClaim(user.id, confirmationId)
    throw new SklandHttpError('skland_pending_expired', '免费个人排班确认已过期，请重新登录森空岛。', 400, 'rebind')
  }

  const personalUseDeclarationEffective = isCurrentPersonalUseDeclarationEffective()
  const personalUseAcceptance = personalUseDeclarationEffective
    ? await getPersonalUseDeclarationAcceptance(user.id)
    : null
  if (personalUseDeclarationEffective && !personalUseAcceptance) {
    return jsonResponse({
      error: '请先完成个人使用声明确认，再领取免费个人排班档案。',
      code: 'personal_use_confirmation_required',
      declaration_id: CURRENT_PERSONAL_USE_DECLARATION.id,
    }, 428)
  }

  const profiles = await listProfilesForUser(user.id)
  const existingPreview = profiles.find((profile) => isFreePreviewProfile(profile))
  if (existingPreview?.skland_binding) {
    return jsonResponse({ error: '当前网站账号已经领取过免费个人排班档案。', code: 'free_preview_already_claimed' }, 409)
  }
  if (existingPreview && existingPreview.status !== 'active') {
    return jsonResponse({ error: '免费个人排班档案当前不可用。' }, 403)
  }

  const preparedAt = new Date().toISOString()
  const candidateProfile: UserGameAccountRecord = existingPreview ?? {
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
    created_at: preparedAt,
    updated_at: preparedAt,
  }
  const cred = decryptSklandCredential(pending.encrypted_cred)
  const prepared = await prepareSklandImport(candidateProfile, cred, pending.uid)
  const result = await withTransaction(async (client): Promise<Required<SklandConfirmationOperationResponse>> => {
    const operationId = await beginSklandConfirmationOperation(client, {
      userId: user.id,
      idempotencyKey,
      requestHash,
      operationType: 'claim_free_preview',
      now: prepared.importedAt,
    })
    await client.query("select pg_advisory_xact_lock(hashtextextended('skland-free-preview-user:' || $1, 0))", [user.id])
    const pendingResult = await client.query<{ record_json: FreePreviewPendingClaimRecord }>(
      `select record_json from free_preview_pending_claims
        where user_id = $1 and confirmation_id = $2
        for update`,
      [user.id, confirmationId],
    )
    const currentPending = pendingResult.rows[0]?.record_json
    if (!isFreePreviewConfirmationPending(currentPending) || Date.now() > Date.parse(currentPending.expires_at)) {
      throw new SklandHttpError('skland_pending_expired', '免费个人排班确认已过期，请重新登录森空岛。', 400, 'rebind')
    }
    const existing = await client.query<{ record_json: UserGameAccountRecord }>(
      `select record_json from user_game_accounts
        where user_id = $1 and kind = 'free_preview'
        order by created_at asc
        for update`,
      [user.id],
    )
    const currentProfile = existing.rows[0]?.record_json ?? candidateProfile
    if (currentProfile.skland_binding) {
      throw new SklandHttpError('free_preview_already_claimed', '当前网站账号已经领取过免费个人排班档案。', 409)
    }
    if (currentProfile.status !== 'active') {
      throw new SklandHttpError('profile_unavailable', '免费个人排班档案当前不可用。', 409)
    }
    if (!existing.rows[0]) await saveProfileInTransaction(client, currentProfile)
    await attachPersonalUseDeclarationAcceptanceToProfileInTransaction(client, user.id, currentProfile.id)
    await recordPersonalUseDeclarationUsageInTransaction(client, {
      userId: user.id,
      profileId: currentProfile.id,
      action: 'free_preview_claim',
      clientIp: getRequestClientIp(req),
      occurredAt: new Date(prepared.importedAt),
    })
    const imported = await persistPreparedSklandImportInTransaction(
      client,
      user.id,
      currentProfile.id,
      cred,
      prepared,
    )
    await recordRequestBehaviorEventInTransaction(client, {
      req,
      eventType: 'bind',
      eventKey: `free-preview-claim:${user.id}:${idempotencyKey}`,
      userId: user.id,
      sessionTokenHash,
      profileId: currentProfile.id,
      uid: imported.uid,
      activityClaimedAt: currentProfile.created_at,
      declarationVersion: personalUseAcceptance?.declaration_version,
      declarationAcceptedAt: personalUseAcceptance?.accepted_at,
      occurredAt: new Date(prepared.importedAt),
    })
    await client.query(
      'delete from free_preview_pending_claims where user_id = $1 and confirmation_id = $2',
      [user.id, confirmationId],
    )
    const response = { profile_id: currentProfile.id, imported }
    await completeSklandConfirmationOperation(client, operationId, response, prepared.importedAt)
    return response
  })

  await runSklandImportPostCommit(user.id, candidateProfile, prepared)
  return jsonResponse({
    ...(await buildPayloadWithImport(user, result.profile_id, result.imported)),
    replayed: false,
  })
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

function buildDepotValueSklandProfile(
  profile: UserGameAccountRecord,
  pending: SklandPendingConfirmationRecord,
  now: string,
): UserGameAccountRecord {
  const existingBinding = profile.skland_binding
  return {
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
  }
}

async function createPendingSklandBindingFromCred(
  user: AuthPayloadUser,
  profile: UserGameAccountRecord,
  cred: string,
  source?: CredentialSource,
  requestContext?: SklandRequestContext,
): Promise<Response> {
  const accounts = await listSklandArknightsBindingsByCred(cred)
  const existingUid = profile.skland_binding?.uid
  if (existingUid) {
    const matchingAccount = accounts.find((account) => account.uid === existingUid)
    if (matchingAccount) {
      return createPendingSklandConfirmationFromCred(user, profile, cred, matchingAccount.uid, source, undefined, requestContext)
    }
    const fallbackAccount = accounts.find((account) => account.is_default) ?? accounts[0]
    const imported = await importSklandOperatorsByCred(cred, { uid: fallbackAccount.uid })
    const operatorsCheck = validateOperators(imported.operators)
    if (!operatorsCheck.ok) throw new Error(operatorsCheck.message)
    return handleAccountMismatch(user, profile, toSklandPreview(imported.binding, operatorsCheck.operators.length), requestContext)
  }

  const now = new Date()
  const confirmationId = randomUUID()
  const createdAt = now.toISOString()
  const expiresAt = new Date(now.getTime() + PENDING_BINDING_TTL_MS).toISOString()
  if (accounts.length > 1) {
    const pending: SklandPendingAccountSelectionRecord = {
      stage: 'account_selection',
      confirmation_id: confirmationId,
      accounts,
      encrypted_cred: encryptSklandCredential(cred),
      ...(source && { source }),
      created_at: createdAt,
      expires_at: expiresAt,
    }
    await saveUserProfile({ ...profile, skland_pending_binding: pending, updated_at: createdAt })
    return accountSelectionResponse(
      confirmationId,
      accounts,
      source === 'bookmarklet'
        ? '书签脚本已读取森空岛凭据。检测到多个明日方舟账号，请选择要导入的账号。'
        : '检测到多个明日方舟账号，请选择要导入的账号。',
    )
  }

  return createPendingSklandConfirmationFromCred(
    user,
    profile,
    cred,
    accounts[0].uid,
    source,
    { confirmationId, createdAt, expiresAt },
    requestContext,
  )
}

async function selectSklandAccount(
  user: AuthPayloadUser,
  profile: UserGameAccountRecord,
  selectionId: string,
  uid: string,
  requestContext?: SklandRequestContext,
): Promise<Response> {
  const pending = profile.skland_pending_binding
  if (!isSklandAccountSelectionPending(pending) || pending.confirmation_id !== selectionId) {
    return jsonResponse({ error: '森空岛账号选择已失效，请重新授权。' }, 400)
  }
  if (Date.now() > Date.parse(pending.expires_at)) {
    await saveUserProfile({ ...profile, skland_pending_binding: null, updated_at: new Date().toISOString() })
    return jsonResponse({ error: '森空岛账号选择已过期，请重新授权。' }, 400)
  }
  if (!pending.accounts.some((account) => account.uid === uid)) {
    await saveUserProfile({ ...profile, skland_pending_binding: null, updated_at: new Date().toISOString() })
    return jsonResponse({ error: '所选森空岛账号无效，请重新授权。' }, 400)
  }

  const cred = decryptSklandCredential(pending.encrypted_cred)
  const currentAccounts = await listSklandArknightsBindingsByCred(cred)
  if (!currentAccounts.some((account) => account.uid === uid)) {
    await saveUserProfile({ ...profile, skland_pending_binding: null, updated_at: new Date().toISOString() })
    return jsonResponse({ error: '所选账号已不在森空岛绑定列表中，请重新授权。' }, 400)
  }

  return createPendingSklandConfirmationFromCred(user, profile, cred, uid, pending.source, {
    confirmationId: pending.confirmation_id,
    createdAt: pending.created_at,
    expiresAt: pending.expires_at,
  }, requestContext)
}

async function createPendingSklandConfirmationFromCred(
  user: AuthPayloadUser,
  profile: UserGameAccountRecord,
  cred: string,
  uid: string,
  source?: CredentialSource,
  pendingOptions?: { confirmationId: string; createdAt: string; expiresAt: string },
  requestContext?: SklandRequestContext,
): Promise<Response> {
  const imported = await importSklandOperatorsByCred(cred, { uid })
  const operatorsCheck = validateOperators(imported.operators)
  if (!operatorsCheck.ok) throw new Error(operatorsCheck.message)
  const preview = toSklandPreview(imported.binding, operatorsCheck.operators.length)

  if (profile.skland_binding?.uid && profile.skland_binding.uid !== imported.binding.uid) {
    return handleAccountMismatch(user, profile, preview, requestContext)
  }
  if (isFreePreviewProfile(profile)) {
    const existingClaim = await getFreePreviewClaim(hashFreePreviewUid(imported.binding.uid))
    if (existingClaim && existingClaim.profile_id !== profile.id) {
      return jsonResponse({ error: '该森空岛 UID 已经领取过免费个人排班档案。', code: 'free_preview_uid_claimed' }, 409)
    }
  }

  const now = new Date()
  const confirmationId = pendingOptions?.confirmationId ?? randomUUID()
  const createdAt = pendingOptions?.createdAt ?? now.toISOString()
  const expiresAt = pendingOptions?.expiresAt ?? new Date(now.getTime() + PENDING_BINDING_TTL_MS).toISOString()
  await saveUserProfile({
    ...profile,
    skland_pending_binding: {
      stage: 'confirmation',
      confirmation_id: confirmationId,
      uid: imported.binding.uid,
      nickname: imported.binding.nickname,
      channel_name: imported.binding.channel_name,
      encrypted_cred: encryptSklandCredential(cred),
      operator_count: operatorsCheck.operators.length,
      created_at: createdAt,
      expires_at: expiresAt,
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
  requestContext?: SklandRequestContext,
): Promise<Response> {
  const authorization = await resolveProfileAuthorization(profile)
  if (authorization.ok && authorization.permission === 'ultimate') {
    return jsonResponse({
      status: 'account_mismatch',
      skland_preview: preview,
      warning: '该账号与当前绑定账号不一致，请确认是否登录错账号。',
    })
  }
  const now = new Date().toISOString()
  const nextProfile = await withTransaction((client) => recordSklandUidMismatchInTransaction(client, {
    userId: user.id,
    profileId: profile.id,
    uid: preview.uid,
    nickname: preview.nickname,
    freezeThreshold: UID_MISMATCH_FREEZE_THRESHOLD,
    now,
  }))
  if (!nextProfile) throw new SklandHttpError('profile_not_found', '账号档案不存在。', 404)
  if (requestContext) {
    try {
      await recordRequestBehaviorEvent({
        req: requestContext.req,
        eventType: 'skland_uid_mismatch',
        userId: user.id,
        sessionTokenHash: requestContext.sessionTokenHash,
        profileId: profile.id,
        uid: preview.uid,
      })
    } catch (error) {
      console.warn('skland mismatch audit event skipped:', error)
    }
  }

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
  uid: string,
): Promise<SklandImportSummary> {
  const prepared = await prepareSklandImport(profile, cred, uid)
  const imported = await withTransaction((client) => persistPreparedSklandImportInTransaction(
    client,
    userId,
    profile.id,
    cred,
    prepared,
  ))
  await runSklandImportPostCommit(userId, profile, prepared)
  return imported
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
    const permissionCheck = isFreePreviewProfile(profile) && !isFreePreviewTrialActive(profile)
      ? resolveFreePreviewConfig(configCheck.config)
      : resolveConfigForPermission(getEffectiveProfilePermission(profile), configCheck.config)
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
  if (profile.archived_at) throw new SklandProfileError('profile_archived', '归档档案不能更新森空岛绑定或工作区。', 409)
  if (profile.status !== 'active') throw new SklandHttpError('profile_unavailable', '账号档案状态不可用。', 409)
  return profile
}

async function requireProfile(userId: string, profileId: unknown): Promise<UserGameAccountRecord> {
  if (typeof profileId !== 'string' || !profileId.trim()) {
    throw new SklandHttpError('invalid_request', '请先选择游戏账号。', 400)
  }
  const profile = await getProfileForUser(userId, profileId.trim())
  if (!profile) throw new SklandHttpError('profile_not_found', '账号档案不存在。', 404)
  return profile
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  return await getValidatedJsonRecord(req)
}

function toSklandPreview(binding: SklandBindingSummary, operatorCount: number): SklandPreview {
  return {
    uid: binding.uid,
    nickname: binding.nickname,
    channel_name: binding.channel_name,
    operator_count: operatorCount,
  }
}

function accountSelectionResponse(selectionId: string, accounts: SklandAccountOption[], warning: string): Response {
  return jsonResponse({
    status: 'account_selection_required',
    selection_id: selectionId,
    skland_accounts: accounts,
    warning,
  })
}

function isSklandAccountSelectionPending(
  pending: SklandPendingBindingRecord | null | undefined,
): pending is SklandPendingAccountSelectionRecord {
  return pending?.stage === 'account_selection'
}

function isSklandConfirmationPending(
  pending: SklandPendingBindingRecord | null | undefined,
): pending is SklandPendingConfirmationRecord {
  return Boolean(pending && pending.stage !== 'account_selection' && pending.uid)
}

function isFreePreviewAccountSelectionPending(
  pending: FreePreviewPendingClaimRecord | null | undefined,
): pending is FreePreviewPendingAccountSelectionRecord {
  return pending?.stage === 'account_selection'
}

function isFreePreviewConfirmationPending(
  pending: FreePreviewPendingClaimRecord | null | undefined,
): pending is FreePreviewPendingConfirmationRecord {
  return Boolean(pending && pending.stage !== 'account_selection' && pending.uid)
}

function hashFreePreviewUid(uid: string): string {
  return createHmac('sha256', getFreePreviewUidHashSecret())
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

function extractSklandCredential(value: unknown): string | null {
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
