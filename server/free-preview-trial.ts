import type { FreePreviewTrial, PermissionMode, UserGameAccountKind } from '../src/lib/types'

export const FREE_PREVIEW_ADVANCED_TRIAL = {
  id: 'free-preview-advanced-trial-2026',
  startsAt: '2026-07-17T04:00:00.000Z',
  endsAt: '2026-08-19T16:00:00.000Z',
  effectivePermission: 'advanced' as const,
}

type TrialProfile = { kind?: UserGameAccountKind }

export function getFreePreviewTrial(profile: TrialProfile, now = new Date()): FreePreviewTrial | null {
  if (profile.kind !== 'free_preview') return null
  const active = now.getTime() >= Date.parse(FREE_PREVIEW_ADVANCED_TRIAL.startsAt)
    && now.getTime() < Date.parse(FREE_PREVIEW_ADVANCED_TRIAL.endsAt)
  return {
    id: FREE_PREVIEW_ADVANCED_TRIAL.id,
    starts_at: FREE_PREVIEW_ADVANCED_TRIAL.startsAt,
    ends_at: FREE_PREVIEW_ADVANCED_TRIAL.endsAt,
    active,
    effective_permission: active ? FREE_PREVIEW_ADVANCED_TRIAL.effectivePermission : null,
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
  return profile.kind === 'free_preview' && now.getTime() >= Date.parse(FREE_PREVIEW_ADVANCED_TRIAL.endsAt)
}
