import { describe, expect, it } from 'vitest'
import { reserveSklandAttempt } from './auth-rate-limit'

describe('Skland rate limiting', () => {
  it('allows a complete scan polling cycle and isolates different users', () => {
    const firstUser = `skland-rate-limit-a-${crypto.randomUUID()}`
    const secondUser = `skland-rate-limit-b-${crypto.randomUUID()}`

    for (let attemptNumber = 0; attemptNumber < 30; attemptNumber += 1) {
      const decision = reserveSklandAttempt(firstUser)
      expect(decision.allowed).toBe(true)
      if (decision.allowed) decision.attempt.retainFailure()
    }

    expect(reserveSklandAttempt(firstUser).allowed).toBe(false)
    expect(reserveSklandAttempt(secondUser).allowed).toBe(true)
  })

  it('keeps lightweight polling separate from expensive upstream operations', () => {
    const userId = `skland-rate-limit-split-${crypto.randomUUID()}`
    for (let attemptNumber = 0; attemptNumber < 30; attemptNumber += 1) {
      const decision = reserveSklandAttempt(userId, 'external')
      expect(decision.allowed).toBe(true)
      if (decision.allowed) decision.attempt.retainFailure()
    }
    expect(reserveSklandAttempt(userId, 'external').allowed).toBe(false)

    for (let attemptNumber = 0; attemptNumber < 60; attemptNumber += 1) {
      const decision = reserveSklandAttempt(userId, 'poll')
      expect(decision.allowed).toBe(true)
      if (decision.allowed) decision.attempt.retainFailure()
    }
    expect(reserveSklandAttempt(userId, 'poll').allowed).toBe(false)
  })
})
