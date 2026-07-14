import { describe, expect, it } from 'vitest'
import {
  FREE_PREVIEW_ADVANCED_TRIAL,
  getFreePreviewTrial,
  getEffectiveProfilePermission,
} from './free-preview-trial'

const previewProfile = { kind: 'free_preview' as const, permission: 'growth' as const }
const cdkProfile = { kind: 'cdk' as const, permission: 'growth' as const }

describe('free preview advanced trial', () => {
  it('upgrades only free preview profiles during the exact activity window', () => {
    const startsAt = new Date(FREE_PREVIEW_ADVANCED_TRIAL.startsAt)
    const endsAt = new Date(FREE_PREVIEW_ADVANCED_TRIAL.endsAt)

    expect(getFreePreviewTrial(previewProfile, new Date(startsAt.getTime() - 1))?.active).toBe(false)
    expect(getFreePreviewTrial(previewProfile, startsAt)?.effective_permission).toBe('advanced')
    expect(getFreePreviewTrial(previewProfile, new Date(endsAt.getTime() - 1))?.active).toBe(true)
    expect(getFreePreviewTrial(previewProfile, endsAt)?.active).toBe(false)
    expect(getFreePreviewTrial(cdkProfile, startsAt)).toBeNull()
  })

  it('keeps the permanent permission intact after the activity', () => {
    expect(getEffectiveProfilePermission(previewProfile, new Date(FREE_PREVIEW_ADVANCED_TRIAL.startsAt))).toBe('advanced')
    expect(getEffectiveProfilePermission(previewProfile, new Date(FREE_PREVIEW_ADVANCED_TRIAL.endsAt))).toBe('growth')
  })
})
