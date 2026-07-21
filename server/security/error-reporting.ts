const MAX_LOG_TEXT_LENGTH = 1_000
const SENSITIVE_ENV_NAME = /(SECRET|TOKEN|PASSWORD|API_KEY|CREDENTIAL)/i
const SENSITIVE_ASSIGNMENT = /((?:["']?(?:password|token|secret|api[_-]?key|credential(?:_text)?|cred)["']?|[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY|CREDENTIAL)[A-Z0-9_]*)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}\]]+)/gi
const BEARER_TOKEN = /(\bBearer\s+)[A-Za-z0-9._~+/-]+=*/gi
const URL_PASSWORD = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:)[^\s@/]+(@)/gi

export interface SafeServerErrorDetails {
  name: string
  message: string
  code?: string
  location?: string
  cause?: {
    name: string
    message: string
    code?: string
  }
}

export function describeServerError(error: unknown): SafeServerErrorDetails {
  if (!(error instanceof Error)) {
    return {
      name: 'UnknownError',
      message: sanitizeServerLogText(String(error)),
    }
  }

  const details: SafeServerErrorDetails = {
    name: sanitizeErrorName(error.name),
    message: sanitizeServerLogText(error.message || error.name || 'Unknown error'),
  }
  const code = errorCode(error)
  if (code) details.code = code
  const location = firstApplicationFrame(error.stack)
  if (location) details.location = location

  if (error.cause instanceof Error && error.cause !== error) {
    details.cause = {
      name: sanitizeErrorName(error.cause.name),
      message: sanitizeServerLogText(error.cause.message || error.cause.name || 'Unknown cause'),
    }
    const causeCode = errorCode(error.cause)
    if (causeCode) details.cause.code = causeCode
  }

  return details
}

export function sanitizeServerLogText(value: string): string {
  let sanitized = value
  for (const [name, secret] of Object.entries(process.env)) {
    if (!SENSITIVE_ENV_NAME.test(name) || !secret || secret.length < 4) continue
    sanitized = sanitized.replaceAll(secret, '<redacted>')
  }
  sanitized = sanitized
    .replace(URL_PASSWORD, '$1<redacted>$2')
    .replace(BEARER_TOKEN, '$1<redacted>')
    .replace(SENSITIVE_ASSIGNMENT, '$1<redacted>')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
  return sanitized.slice(0, MAX_LOG_TEXT_LENGTH) || 'Unknown error'
}

function sanitizeErrorName(value: string): string {
  return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(value) ? value : 'Error'
}

function errorCode(error: Error): string | null {
  const code = (error as Error & { code?: unknown }).code
  return typeof code === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(code) ? code : null
}

function firstApplicationFrame(stack: string | undefined): string | null {
  if (!stack) return null
  const frame = stack
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith('at ') && !line.includes('node:internal'))
  return frame ? sanitizeServerLogText(frame) : null
}
