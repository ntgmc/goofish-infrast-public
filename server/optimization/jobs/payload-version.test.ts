import { describe, expect, it } from 'vitest'
import {
  normalizePersistedOptimizationJobPayload,
  UnsupportedOptimizationJobPayloadError,
} from './shared'

describe('persisted optimization payload versions', () => {
  it('keeps the current version 3 payload unchanged', () => {
    const payload = { version: 3, submittedAt: 1 }
    expect(normalizePersistedOptimizationJobPayload(payload)).toBe(payload)
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
