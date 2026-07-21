import { describe, expect, it } from 'vitest'
import {
  normalizePersistedOptimizationJobPayload,
  UnsupportedOptimizationJobPayloadError,
} from './shared'

describe('persisted optimization payload compatibility', () => {
  it('keeps the current version 3 payload unchanged', () => {
    const payload = { version: 3, submittedAt: 1 }
    expect(normalizePersistedOptimizationJobPayload(payload)).toBe(payload)
  })

  it('normalizes the previous version without retaining legacy secret-bearing records', () => {
    const normalized = normalizePersistedOptimizationJobPayload({
      version: 2,
      submittedAt: 1,
      operators: [],
      effectiveConfig: {},
      scheduleUsageBase: {},
      activeProfileId: 'profile-1',
      isPreviewProfile: false,
      isPreviewTrial: false,
      freeScheduleDecision: null,
      estimate: {},
      request: {},
      effectiveLicense: {
        permission: 'premium',
        sig: 'must-not-survive-normalization',
      },
      checkedCdkRecord: {
        code_hash: 'hash-only',
        key: 'must-not-survive-normalization',
      },
    })

    expect(normalized).toMatchObject({
      version: 3,
      configPermission: 'advanced',
      cdkUsageRef: { code_hash: 'hash-only' },
    })
    expect(normalized).not.toHaveProperty('effectiveLicense')
    expect(normalized).not.toHaveProperty('checkedCdkRecord')
    expect(JSON.stringify(normalized)).not.toContain('must-not-survive-normalization')
  })

  it.each([
    null,
    {},
    { version: 1 },
    { version: 2, kind: 'scenario_comparison' },
    { version: 99 },
  ])('rejects unsupported payloads: %j', (payload) => {
    expect(() => normalizePersistedOptimizationJobPayload(payload))
      .toThrow(UnsupportedOptimizationJobPayloadError)
  })
})
