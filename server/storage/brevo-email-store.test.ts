import { describe, expect, it } from 'vitest'
import { getUtcDate, secondsUntilNextUtcDay } from './brevo-email-store'

describe('Brevo email quota date helpers', () => {
  it('uses UTC midnight as the quota day boundary', () => {
    expect(getUtcDate(new Date('2026-07-21T23:59:59.000Z'))).toBe('2026-07-21')
    expect(getUtcDate(new Date('2026-07-22T00:00:00.000Z'))).toBe('2026-07-22')
  })

  it('returns the remaining seconds until the next UTC midnight', () => {
    expect(secondsUntilNextUtcDay(new Date('2026-07-21T23:59:59.000Z'))).toBe(1)
    expect(secondsUntilNextUtcDay(new Date('2026-07-22T00:00:00.000Z'))).toBe(24 * 60 * 60)
  })
})
