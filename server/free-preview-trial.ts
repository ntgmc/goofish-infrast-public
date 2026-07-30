import type { FreePreviewTrial, PermissionMode, TemporaryProfilePermission, UserGameAccountKind } from '../src/lib/types'

export const FREE_PREVIEW_LIMITED_CDK_ACTIVITY = {
  id: 'free-preview-limited-cdk-2026',
  startsAt: '2026-07-17T04:00:00.000Z',
  endsAt: '2026-08-19T16:00:00.000Z',
  effectivePermission: 'advanced' as const,
}

/** @deprecated Use FREE_PREVIEW_LIMITED_CDK_ACTIVITY. */
export const FREE_PREVIEW_ADVANCED_TRIAL = FREE_PREVIEW_LIMITED_CDK_ACTIVITY

type TrialProfile = {
  kind?: UserGameAccountKind
  temporary_permission?: TemporaryProfilePermission | null
}

export function getFreePreviewTrial(profile: TrialProfile, now = new Date()): FreePreviewTrial | null {
  if (profile.kind !== 'free_preview') return null
  const temporaryPermission = profile.temporary_permission
  if (!temporaryPermission
    || temporaryPermission.source !== 'limited_profile_voucher'
    || temporaryPermission.activity_id !== FREE_PREVIEW_LIMITED_CDK_ACTIVITY.id) return null
  const active = now.getTime() >= Date.parse(temporaryPermission.starts_at)
    && now.getTime() < Date.parse(temporaryPermission.ends_at)
  if (!active) return null
  return {
    id: temporaryPermission.activity_id,
    starts_at: temporaryPermission.starts_at,
    ends_at: temporaryPermission.ends_at,
    active: true,
    effective_permission: temporaryPermission.permission,
  }
}

export function getEffectiveProfilePermission(
  profile: TrialProfile & { permission: PermissionMode },
  now = new Date(),
): PermissionMode {
  return getFreePreviewTrial(profile, now)?.effective_permission ?? profile.permission
}

export function isFreePreviewTrialActive(profile: TrialProfile, now = new Date()): boolean {
  return getFreePreviewTrial(profile, now)?.active === true
}

export function hasFreePreviewTrialEnded(profile: TrialProfile, now = new Date()): boolean {
  return profile.kind === 'free_preview'
    && profile.temporary_permission?.source === 'limited_profile_voucher'
    && profile.temporary_permission.activity_id === FREE_PREVIEW_LIMITED_CDK_ACTIVITY.id
    && now.getTime() >= Date.parse(profile.temporary_permission.ends_at)
}

export function isFreePreviewLimitedCdkActivityActive(now = new Date()): boolean {
  return now.getTime() >= Date.parse(FREE_PREVIEW_LIMITED_CDK_ACTIVITY.startsAt)
    && now.getTime() < Date.parse(FREE_PREVIEW_LIMITED_CDK_ACTIVITY.endsAt)
}
