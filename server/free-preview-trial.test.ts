import { describe, expect, it } from 'vitest'
import {
  FREE_PREVIEW_ADVANCED_TRIAL,
  FREE_PREVIEW_LIMITED_CDK_ACTIVITY,
  getFreePreviewTrial,
  getEffectiveProfilePermission,
  hasFreePreviewTrialEnded,
} from './free-preview-trial'

const previewProfile = { kind: 'free_preview' as const, permission: 'growth' as const }
const cdkProfile = { kind: 'cdk' as const, permission: 'growth' as const }
const activatedPreviewProfile = {
  ...previewProfile,
  temporary_permission: {
    source: 'limited_profile_voucher' as const,
    activity_id: FREE_PREVIEW_LIMITED_CDK_ACTIVITY.id,
    permission: 'advanced' as const,
    starts_at: FREE_PREVIEW_LIMITED_CDK_ACTIVITY.startsAt,
    ends_at: FREE_PREVIEW_LIMITED_CDK_ACTIVITY.endsAt,
    operation_id: 'operation-1',
  },
}

describe('free preview limited CDK permission', () => {
  it('upgrades only activated free preview profiles during the exact activity window', () => {
    const startsAt = new Date(FREE_PREVIEW_ADVANCED_TRIAL.startsAt)
    const endsAt = new Date(FREE_PREVIEW_ADVANCED_TRIAL.endsAt)

    expect(FREE_PREVIEW_ADVANCED_TRIAL.startsAt).toBe('2026-07-17T04:00:00.000Z')
    expect(getFreePreviewTrial(previewProfile, startsAt)).toBeNull()
    expect(getFreePreviewTrial(activatedPreviewProfile, new Date(startsAt.getTime() - 1))).toBeNull()
    expect(getFreePreviewTrial(activatedPreviewProfile, startsAt)?.effective_permission).toBe('advanced')
    expect(getFreePreviewTrial(activatedPreviewProfile, new Date(endsAt.getTime() - 1))?.active).toBe(true)
    expect(getFreePreviewTrial(activatedPreviewProfile, endsAt)).toBeNull()
    expect(getFreePreviewTrial({ ...cdkProfile, temporary_permission: activatedPreviewProfile.temporary_permission }, startsAt)).toBeNull()
  })

  it('keeps the base permission intact before activation and after expiry', () => {
    expect(getEffectiveProfilePermission(previewProfile, new Date(FREE_PREVIEW_ADVANCED_TRIAL.startsAt))).toBe('growth')
    expect(getEffectiveProfilePermission(activatedPreviewProfile, new Date(FREE_PREVIEW_ADVANCED_TRIAL.startsAt))).toBe('advanced')
    expect(getEffectiveProfilePermission(activatedPreviewProfile, new Date(FREE_PREVIEW_ADVANCED_TRIAL.endsAt))).toBe('growth')
    expect(hasFreePreviewTrialEnded(previewProfile, new Date(FREE_PREVIEW_ADVANCED_TRIAL.endsAt))).toBe(false)
    expect(hasFreePreviewTrialEnded(activatedPreviewProfile, new Date(FREE_PREVIEW_ADVANCED_TRIAL.endsAt))).toBe(true)
  })
})
