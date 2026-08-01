import { describe, expect, it } from 'vitest'
import {
  normalizePersistedOptimizationJobPayload,
  UnsupportedOptimizationJobPayloadError,
} from './shared'

describe('persisted optimization payload versions', () => {
  it('keeps the current version 3 payload unchanged', () => {
    const payload = schedulePayload()
    expect(normalizePersistedOptimizationJobPayload(payload)).toEqual(payload)
  })

  it('rejects standalone suggestion payloads', () => {
    expect(() => normalizePersistedOptimizationJobPayload({
      version: 3,
      submittedAt: 1,
      request: { suggestions_only: true },
    })).toThrow(UnsupportedOptimizationJobPayloadError)
  })

  it.each([
    null,
    {},
    { version: 1 },
    { version: 2 },
    { version: 99 },
  ])('rejects unsupported payloads: %j', (payload) => {
    expect(() => normalizePersistedOptimizationJobPayload(payload))
      .toThrow(UnsupportedOptimizationJobPayloadError)
  })
})

function schedulePayload() {
  return {
    version: 3,
    submittedAt: 1,
    operators: [{ id: 'op-1', name: 'Operator', own: true, elite: 2, rarity: 6 }],
    effectiveConfig: {
      layout: '243',
      desc: 'test',
      trading_stations_count: 2,
      manufacturing_stations_count: 4,
      product_requirements: {
        trading_stations: { lmd: 2 },
        manufacturing_stations: { pure_gold: 4 },
      },
    },
    scheduleUsageBase: {},
    activeProfileId: 'profile-1',
    isPreviewProfile: false,
    isPreviewTrial: false,
    freeScheduleDecision: null,
    estimate: {
      estimated_duration_ms: 2_000,
      estimate_bucket: 'maa_plain',
      estimate_source: 'fallback_p95',
      estimate_sample_count: 0,
    },
    request: {
      include_upgrade_suggestions: false,
      upgrade_suggestions_allowed: false,
    },
    configPermission: 'advanced',
    cdkUsageRef: null,
  }
}
