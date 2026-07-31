import { resolveRuntimePermission } from '../../src/lib/product-catalog'
import type { PermissionMode } from '../../src/lib/types'
import { getEffectiveProfilePermission } from '../free-preview-trial'
import type { UserGameAccountRecord } from '../storage/user-store'
import {
  formatRiskFreezeMessage,
  getCdkRecordStore,
  isProfileCdkRecord,
  type CdkRecord,
} from './license-utils'

type ProfileAuthorizationFailureCode =
  | 'profile_frozen'
  | 'profile_revoked'
  | 'license_frozen'
  | 'license_revoked'
  | 'license_unavailable'
  | 'permission_invalid'

export type ProfileAuthorizationResult =
  | { ok: true; permission: PermissionMode; cdkRecord: CdkRecord | null }
  | { ok: false; status: 403; code: ProfileAuthorizationFailureCode; message: string }

export async function resolveProfileAuthorization(
  profile: UserGameAccountRecord,
): Promise<ProfileAuthorizationResult> {
  if (profile.status === 'frozen') {
    return { ok: false, status: 403, code: 'profile_frozen', message: '当前档案暂时不可用，请联系支持人员核验或恢复。' }
  }
  if (profile.status === 'revoked') {
    return { ok: false, status: 403, code: 'profile_revoked', message: '账号授权已撤销，请联系卖家。' }
  }

  if (profile.kind === 'free_preview') {
    return resolvePermission(getEffectiveProfilePermission(profile), null)
  }

  if (!profile.cdk_key) {
    if (!profile.kind || profile.kind === 'cdk') {
      return { ok: false, status: 403, code: 'license_unavailable', message: '账号授权记录缺失，请联系支持人员。' }
    }
    return resolvePermission(profile.permission, null)
  }

  const cdkRecord = await (await getCdkRecordStore()).get(profile.cdk_key)
  if (!cdkRecord || !isProfileCdkRecord(cdkRecord)) {
    return { ok: false, status: 403, code: 'license_unavailable', message: '账号授权记录缺失或类型无效，请联系支持人员。' }
  }
  if (cdkRecord.status === 'frozen') {
    return {
      ok: false,
      status: 403,
      code: 'license_frozen',
      message: formatRiskFreezeMessage(cdkRecord.freeze_reason || '账号授权已冻结，请联系卖家。'),
    }
  }
  if (cdkRecord.status === 'revoked') {
    return { ok: false, status: 403, code: 'license_revoked', message: '账号授权已撤销，请联系卖家。' }
  }
  if (cdkRecord.status !== 'used') {
    return { ok: false, status: 403, code: 'license_unavailable', message: '账号授权尚未生效，请联系支持人员。' }
  }
  return resolvePermission(cdkRecord.permission, cdkRecord)
}

function resolvePermission(permission: string | null | undefined, cdkRecord: CdkRecord | null): ProfileAuthorizationResult {
  const resolved = resolveRuntimePermission(permission)
  if (!resolved) {
    return { ok: false, status: 403, code: 'permission_invalid', message: '账号权限数据无效，请联系支持人员。' }
  }
  return { ok: true, permission: resolved, cdkRecord }
}
