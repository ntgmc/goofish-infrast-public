import {
  validateRegistrationEmail,
  type RegistrationEmailValidationReason,
} from '../../src/lib/registration-email-policy'
import { authCopy } from '../../src/copy/zh-CN/auth'

type RegistrationEmailErrorCode =
  | 'email_invalid'
  | 'email_provider_not_allowed'
  | 'email_alias_not_allowed'
  | 'email_domain_typo'

export type RegistrationEmailCheck =
  | { ok: true; email: string }
  | {
    ok: false
    status: 400
    message: string
    code: RegistrationEmailErrorCode
    suggestedEmail?: string
  }

export function validateRegistrationEmailForRegistration(value: unknown): RegistrationEmailCheck {
  const result = validateRegistrationEmail(value)
  if (result.ok) return result

  const failure = {
    ok: false as const,
    status: 400 as const,
    message: registrationEmailMessage(result.reason),
    code: registrationEmailCode(result.reason),
  }

  return result.suggestedEmail
    ? { ...failure, suggestedEmail: result.suggestedEmail }
    : failure
}

function registrationEmailMessage(reason: RegistrationEmailValidationReason): string {
  switch (reason) {
    case 'invalid_format': return authCopy.api_email_invalid
    case 'unsupported_provider': return authCopy.api_email_provider_not_allowed
    case 'alias_not_allowed': return authCopy.api_email_alias_not_allowed
    case 'domain_typo': return authCopy.api_email_domain_typo
  }
}

function registrationEmailCode(reason: RegistrationEmailValidationReason): RegistrationEmailErrorCode {
  switch (reason) {
    case 'invalid_format': return 'email_invalid'
    case 'unsupported_provider': return 'email_provider_not_allowed'
    case 'alias_not_allowed': return 'email_alias_not_allowed'
    case 'domain_typo': return 'email_domain_typo'
  }
}
