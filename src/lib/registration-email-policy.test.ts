import { describe, expect, it } from 'vitest'
import {
  ALLOWED_REGISTRATION_EMAIL_DOMAINS,
  validateRegistrationEmail,
} from './registration-email-policy'

describe('registration email policy', () => {
  it('accepts every allowlisted provider after trimming and lowercasing', () => {
    for (const domain of ALLOWED_REGISTRATION_EMAIL_DOMAINS) {
      expect(validateRegistrationEmail(` User@${domain.toUpperCase()} `)).toEqual({
        ok: true,
        email: `user@${domain}`,
      })
    }
  })

  it('rejects malformed and unsupported mailbox providers', () => {
    expect(validateRegistrationEmail('not-an-email')).toEqual({ ok: false, reason: 'invalid_format' })
    expect(validateRegistrationEmail('user@company.example')).toEqual({ ok: false, reason: 'unsupported_provider' })
  })

  it('suggests a provider only for one unambiguous Damerau-Levenshtein edit', () => {
    expect(validateRegistrationEmail('correct@gmial.com')).toEqual({
      ok: false,
      reason: 'domain_typo',
      suggestedEmail: 'correct@gmail.com',
    })
    expect(validateRegistrationEmail('correct@gmail.con')).toEqual({
      ok: false,
      reason: 'domain_typo',
      suggestedEmail: 'correct@gmail.com',
    })
    expect(validateRegistrationEmail('correct@unknown.example')).toEqual({
      ok: false,
      reason: 'unsupported_provider',
    })
  })

  it('rejects plus aliases for every allowlisted provider', () => {
    for (const domain of ALLOWED_REGISTRATION_EMAIL_DOMAINS) {
      expect(validateRegistrationEmail(`user+tag@${domain}`)).toEqual({
        ok: false,
        reason: 'alias_not_allowed',
      })
    }
  })

  it('rejects Gmail dot aliases and googlemail aliases with canonical suggestions', () => {
    expect(validateRegistrationEmail('user.name@gmail.com')).toEqual({
      ok: false,
      reason: 'alias_not_allowed',
      suggestedEmail: 'username@gmail.com',
    })
    expect(validateRegistrationEmail('user.name@gmial.com')).toEqual({
      ok: false,
      reason: 'alias_not_allowed',
      suggestedEmail: 'username@gmail.com',
    })
    expect(validateRegistrationEmail('user.name@googlemail.com')).toEqual({
      ok: false,
      reason: 'alias_not_allowed',
      suggestedEmail: 'username@gmail.com',
    })
  })
})
