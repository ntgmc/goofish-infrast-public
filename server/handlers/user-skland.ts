import QRCode from 'qrcode'
import type { AuthSuccessResponse } from '../../src/lib/types'
import {
  emptyWorkspace,
  getProfileForUser,
  getProfileWorkspace,
  saveProfileWorkspace,
  saveUserProfile,
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
  type SklandImportSummary,
} from './skland-client'
import { buildAuthPayload, jsonResponse, requireUserSession } from './user-auth'

type HandlerResponse = AuthSuccessResponse & { skland_import?: SklandImportSummary }

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
        return jsonResponse({ error: '缺少 scan_id。' }, 400)
      }
      const scanCode = await getScanCode(body.scan_id.trim())
      if (!scanCode) return jsonResponse({ status: 'pending' }, 202)

      const token = await getHypergryphTokenByScanCode(scanCode)
      const cred = await getCredByHypergryphToken(token)
      const imported = await saveSklandImport(auth.user.id, profile, cred)
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

    if (pathname.endsWith('/binding')) {
      if (req.method !== 'DELETE') return jsonResponse({ error: 'Method not allowed' }, 405)
      const body = await readJsonBody(req)
      const profile = await requireProfile(auth.user.id, getProfileId(req, body))
      await saveUserProfile({
        ...profile,
        skland_binding: null,
        updated_at: new Date().toISOString(),
      })
      return jsonResponse(await buildAuthPayload(auth.user, profile.id))
    }

    return jsonResponse({ error: 'API route not found' }, 404)
  } catch (error) {
    console.error('user skland error:', error instanceof Error ? error.message : error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    const status = message.includes('SKLAND_CREDENTIAL_SECRET') ? 500 : 400
    return jsonResponse({ error: message }, status)
  }
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
      encrypted_cred: existingBinding?.encrypted_cred && cred === decryptIfPossible(existingBinding.encrypted_cred)
        ? existingBinding.encrypted_cred
        : encryptSklandCredential(cred),
    },
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

function getProfileId(req: Request, body: Record<string, unknown>): unknown {
  return body.profile_id ?? new URL(req.url).searchParams.get('profile_id')
}

function decryptIfPossible(encrypted: string): string | null {
  try {
    return decryptSklandCredential(encrypted)
  } catch {
    return null
  }
}
