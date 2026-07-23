export const ALLOWED_REGISTRATION_EMAIL_DOMAINS = [
  'qq.com',
  'foxmail.com',
  '163.com',
  '126.com',
  'yeah.net',
  'sina.com',
  'sohu.com',
  '139.com',
  '189.cn',
  'gmail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'icloud.com',
  'yahoo.com',
  'proton.me',
  'protonmail.com',
] as const

export type RegistrationEmailValidationReason =
  | 'invalid_format'
  | 'unsupported_provider'
  | 'alias_not_allowed'
  | 'domain_typo'

export type RegistrationEmailValidation =
  | { ok: true; email: string }
  | { ok: false; reason: RegistrationEmailValidationReason; suggestedEmail?: string }

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const allowedDomainSet = new Set<string>(ALLOWED_REGISTRATION_EMAIL_DOMAINS)

export function validateRegistrationEmail(value: unknown): RegistrationEmailValidation {
  if (typeof value !== 'string') return invalidFormat()

  const email = value.trim().toLowerCase()
  if (!EMAIL_PATTERN.test(email) || email.length > 254) return invalidFormat()

  const atIndex = email.lastIndexOf('@')
  const localPart = email.slice(0, atIndex)
  const inputDomain = email.slice(atIndex + 1)

  if (localPart.includes('+')) return { ok: false, reason: 'alias_not_allowed' }

  if (inputDomain === 'googlemail.com') return gmailAliasFailure(localPart)

  const canonicalDomain = allowedDomainSet.has(inputDomain)
    ? inputDomain
    : uniqueDomainSuggestion(inputDomain)

  if (!canonicalDomain) return { ok: false, reason: 'unsupported_provider' }

  if (canonicalDomain === 'gmail.com' && localPart.includes('.')) return gmailAliasFailure(localPart)

  if (canonicalDomain !== inputDomain) {
    return { ok: false, reason: 'domain_typo', suggestedEmail: `${localPart}@${canonicalDomain}` }
  }

  return { ok: true, email }
}

function invalidFormat(): RegistrationEmailValidation {
  return { ok: false, reason: 'invalid_format' }
}

function gmailAliasFailure(localPart: string): RegistrationEmailValidation {
  const canonicalLocalPart = localPart.replace(/\./g, '')
  return canonicalLocalPart
    ? { ok: false, reason: 'alias_not_allowed', suggestedEmail: `${canonicalLocalPart}@gmail.com` }
    : { ok: false, reason: 'alias_not_allowed' }
}

function uniqueDomainSuggestion(inputDomain: string): string | null {
  const candidates = ALLOWED_REGISTRATION_EMAIL_DOMAINS.filter((domain) => isDamerauLevenshteinDistanceOne(inputDomain, domain))
  return candidates.length === 1 ? candidates[0] : null
}

function isDamerauLevenshteinDistanceOne(value: string, candidate: string): boolean {
  if (value === candidate || Math.abs(value.length - candidate.length) > 1) return false

  if (value.length === candidate.length) {
    let index = 0
    while (index < value.length && value[index] === candidate[index]) index += 1
    if (index === value.length) return false
    if (value.slice(index + 1) === candidate.slice(index + 1)) return true
    return value[index] === candidate[index + 1]
      && value[index + 1] === candidate[index]
      && value.slice(index + 2) === candidate.slice(index + 2)
  }

  const [longer, shorter] = value.length > candidate.length ? [value, candidate] : [candidate, value]
  let longerIndex = 0
  let shorterIndex = 0
  let skipped = false

  while (longerIndex < longer.length && shorterIndex < shorter.length) {
    if (longer[longerIndex] === shorter[shorterIndex]) {
      longerIndex += 1
      shorterIndex += 1
      continue
    }
    if (skipped) return false
    skipped = true
    longerIndex += 1
  }

  return true
}
