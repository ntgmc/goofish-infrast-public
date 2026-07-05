import { randomUUID } from 'node:crypto'
import QRCode from 'qrcode'
import type { AuthSuccessResponse } from '../../src/lib/types'
import {
  emptyWorkspace,
  getProfileForUser,
  getProfileWorkspace,
  saveProfileWorkspace,
  saveUserProfile,
  type SklandBindingRecord,
  type UserGameAccountRecord,
  type UserWorkspaceRecord,
} from '../storage/user-store'
import { validateOperators } from './license-utils'
import {
  createHypergryphScan,
  decryptSklandCredential,
  encryptSklandCredential,
  ensureSklandCredentialSecret,
  getCredByHypergryphToken,
  getHypergryphTokenByScanCode,
  getScanCode,
  importSklandOperatorsByCred,
  type SklandBindingSummary,
  type SklandImportSummary,
} from './skland-client'
import { buildAuthPayload, jsonResponse, requireUserSession } from './user-auth'

const PENDING_BINDING_TTL_MS = 10 * 60 * 1000
const UID_MISMATCH_FREEZE_THRESHOLD = 3

type HandlerResponse = AuthSuccessResponse & { skland_import?: SklandImportSummary }

interface SklandPreview {
  uid: string
  nickname: string
  channel_name: string
  operator_count: number
}

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)

  try {
    const auth = await requireUserSession(req)
    if (!auth) return jsonResponse({ error: '请先登录。' }, 401)

    const pathname = new URL(req.url).pathname
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
      return jsonResponse({ scan_id: scan.scanId, qr_data_url: qrDataUrl, expires_at: scan.expiresAt })
    }

    if (pathname.endsWith('/login/complete')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      ensureSklandCredentialSecret()
      const body = await readJsonBody(req)
      const profile = await requireActiveProfile(auth.user.id, body.profile_id)
      if (typeof body.scan_id !== 'string' || !body.scan_id.trim()) {
        return jsonResponse({ error: '缺少 scan_id。' }, 400)
      }
      const scanCode = await getScanCode(body.scan_id.trim())
      if (!scanCode) return jsonResponse({ status: 'pending' }, 202)

      const accountToken = await getHypergryphTokenByScanCode(scanCode)
      const cred = await getCredByHypergryphToken(accountToken)
      const imported = await importSklandOperatorsByCred(cred)
      const operatorsCheck = validateOperators(imported.operators)
      if (!operatorsCheck.ok) throw new Error(operatorsCheck.message)
      const preview = toSklandPreview(imported.binding, operatorsCheck.operators.length)

      if (profile.skland_binding?.uid && profile.skland_binding.uid !== imported.binding.uid) {
        return handleAccountMismatch(auth.user, profile, preview)
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
        warning: '绑定后不可解绑，请确认这是当前账号对应的森空岛角色。',
      })
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
        return jsonResponse({ error: '森空岛绑定确认已失效，请重新扫码。' }, 400)
      }
      if (Date.now() > Date.parse(pending.expires_at)) {
        await saveUserProfile({ ...profile, skland_pending_binding: null, updated_at: new Date().toISOString() })
        return jsonResponse({ error: '森空岛绑定确认已过期，请重新扫码。' }, 400)
      }
      if (profile.skland_binding?.uid && profile.skland_binding.uid !== pending.uid) {
        return jsonResponse({ error: '森空岛账号与当前绑定账号不一致，请重新扫码。' }, 409)
      }

      const imported = await saveSklandImport(auth.user.id, profile, decryptSklandCredential(pending.encrypted_cred))
      return jsonResponse(await buildPayloadWithImport(auth.user, profile.id, imported))
    }

    if (pathname.endsWith('/import/refresh')) {
      if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
      ensureSklandCredentialSecret()
      const body = await readJsonBody(req)
      const profile = await requireActiveProfile(auth.user.id, body.profile_id)
      const encryptedCred = profile.skland_binding?.encrypted_cred
      if (!encryptedCred) return jsonResponse({ error: '当前账号尚未绑定森空岛，请先扫码导入。' }, 404)
      const imported = await saveSklandImport(auth.user.id, profile, decryptSklandCredential(encryptedCred))
      return jsonResponse(await buildPayloadWithImport(auth.user, profile.id, imported))
    }

    return jsonResponse({ error: 'API route not found' }, 404)
  } catch (error) {
    console.error('user skland error:', error instanceof Error ? error.message : error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    const status = message.includes('SKLAND_CREDENTIAL_SECRET') ? 500 : 400
    return jsonResponse({ error: message }, status)
  }
}

async function handleAccountMismatch(
  user: Parameters<typeof buildAuthPayload>[0],
  profile: UserGameAccountRecord,
  preview: SklandPreview,
): Promise<Response> {
  const now = new Date().toISOString()
  const mismatchCount = (profile.skland_risk?.uid_mismatch_count ?? 0) + 1
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
      warning: '森空岛扫码账号多次与当前绑定账号不一致，当前游戏账号档案已冻结。',
    })
  }

  return jsonResponse({
    status: 'account_mismatch',
    skland_preview: preview,
    warning: '该账号与当前绑定账号不一致，请确认是否扫错账号。',
  })
}

async function saveSklandImport(
  userId: string,
  profile: UserGameAccountRecord,
  cred: string,
): Promise<SklandImportSummary> {
  const imported = await importSklandOperatorsByCred(cred)
  const operatorsCheck = validateOperators(imported.operators)
  if (!operatorsCheck.ok) throw new Error(operatorsCheck.message)

  const existingWorkspace = await getProfileWorkspace(profile.id)
  const nextWorkspace: UserWorkspaceRecord = {
    ...(existingWorkspace ?? emptyWorkspace(profile.id)),
    operators: operatorsCheck.operators,
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
  }
}

async function buildPayloadWithImport(
  user: Parameters<typeof buildAuthPayload>[0],
  profileId: string,
  imported: SklandImportSummary,
): Promise<HandlerResponse> {
  return {
    ...(await buildAuthPayload(user, profileId)),
    skland_import: imported,
  }
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

function shouldReuseEncryptedCred(existingBinding: SklandBindingRecord | null | undefined, cred: string): existingBinding is SklandBindingRecord {
  return Boolean(existingBinding?.encrypted_cred && cred === decryptIfPossible(existingBinding.encrypted_cred))
}

function decryptIfPossible(encrypted: string): string | null {
  try {
    return decryptSklandCredential(encrypted)
  } catch {
    return null
  }
}
