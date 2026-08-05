import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,119}$/
const DEFAULT_MAX_ATTEMPTS = 5
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000
const MAX_RETRY_DELAY_MS = 30_000

class ProductionReleaseConfirmationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ProductionReleaseConfirmationError'
  }
}

export function readProductionReleaseConfiguration(environment = process.env) {
  const publicAppUrl = String(environment.PUBLIC_APP_URL ?? '').trim()
  if (!publicAppUrl) {
    throw new ProductionReleaseConfirmationError('PUBLIC_APP_URL is required')
  }

  const token = String(environment.WEBSITE_RELEASE_CONFIRMATION_TOKEN ?? '').trim()
  if (Buffer.byteLength(token, 'utf8') < 32) {
    throw new ProductionReleaseConfirmationError(
      'WEBSITE_RELEASE_CONFIRMATION_TOKEN must contain at least 32 bytes',
    )
  }

  return { publicAppUrl, token }
}

export async function confirmProductionRelease(configuration, options = {}) {
  const origin = normalizeProductionOrigin(configuration.publicAppUrl)
  const token = String(configuration.token ?? '').trim()
  if (Buffer.byteLength(token, 'utf8') < 32) {
    throw new ProductionReleaseConfirmationError(
      'WEBSITE_RELEASE_CONFIRMATION_TOKEN must contain at least 32 bytes',
    )
  }

  const requestOptions = {
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
    sleepImpl: options.sleepImpl ?? sleep,
    maxAttempts: options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
  }
  validateRequestOptions(requestOptions)

  const health = await requestJson(
    new URL('/api/health/ready', origin),
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'error',
    },
    'production readiness check',
    requestOptions,
  )
  if (health.status !== 200 || health.body?.ok !== true) {
    throw new ProductionReleaseConfirmationError(
      `production readiness check returned an unexpected response (HTTP ${health.status})`,
    )
  }

  const frontendVersion = requireReleaseVersion(
    health.body?.build_meta?.frontend_version,
    'frontend',
  )
  const backendVersion = requireReleaseVersion(
    health.body?.build_meta?.backend_version,
    'backend',
  )
  if (frontendVersion !== backendVersion) {
    throw new ProductionReleaseConfirmationError(
      `deployed frontend version ${frontendVersion} does not match backend version ${backendVersion}`,
    )
  }

  const confirmation = await requestJson(
    new URL('/api/internal/releases/confirm', origin),
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ version: frontendVersion }),
      redirect: 'error',
    },
    'production release confirmation',
    requestOptions,
  )

  const expectedCreated = confirmation.status === 201
    ? true
    : confirmation.status === 200
      ? false
      : null
  const expectedEventId = `release:${frontendVersion}`
  if (
    expectedCreated === null
    || confirmation.body?.ok !== true
    || confirmation.body?.created !== expectedCreated
    || confirmation.body?.event_id !== expectedEventId
  ) {
    throw new ProductionReleaseConfirmationError(
      `production release confirmation returned an invalid success response (HTTP ${confirmation.status})`,
    )
  }

  return {
    version: frontendVersion,
    created: expectedCreated,
    eventId: expectedEventId,
    status: confirmation.status,
  }
}

function normalizeProductionOrigin(value) {
  let url
  try {
    url = new URL(String(value ?? '').trim())
  } catch {
    throw new ProductionReleaseConfirmationError('PUBLIC_APP_URL must be a valid HTTPS origin')
  }
  if (
    url.protocol !== 'https:'
    || !url.hostname
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash
  ) {
    throw new ProductionReleaseConfirmationError(
      'PUBLIC_APP_URL must be an HTTPS origin without credentials, path, query, or fragment',
    )
  }
  return url
}

function requireReleaseVersion(value, label) {
  if (typeof value !== 'string' || !VERSION_PATTERN.test(value)) {
    throw new ProductionReleaseConfirmationError(
      `production readiness response contains an invalid ${label} version`,
    )
  }
  return value
}

function validateRequestOptions(options) {
  if (typeof options.fetchImpl !== 'function') {
    throw new ProductionReleaseConfirmationError('a fetch implementation is required')
  }
  if (typeof options.sleepImpl !== 'function') {
    throw new ProductionReleaseConfirmationError('a sleep implementation is required')
  }
  if (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1 || options.maxAttempts > 10) {
    throw new ProductionReleaseConfirmationError('maxAttempts must be an integer between 1 and 10')
  }
  if (
    !Number.isInteger(options.requestTimeoutMs)
    || options.requestTimeoutMs < 1
    || options.requestTimeoutMs > 120_000
  ) {
    throw new ProductionReleaseConfirmationError(
      'requestTimeoutMs must be an integer between 1 and 120000',
    )
  }
}

async function requestJson(url, init, label, options) {
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    let response
    try {
      response = await options.fetchImpl(url, {
        ...init,
        signal: AbortSignal.timeout(options.requestTimeoutMs),
      })
    } catch (error) {
      if (attempt === options.maxAttempts) {
        const errorType = error instanceof Error ? error.name : typeof error
        throw new ProductionReleaseConfirmationError(
          `${label} failed after ${attempt} attempts (${errorType})`,
        )
      }
      await options.sleepImpl(retryDelayMs(attempt))
      continue
    }

    if (isRetryableStatus(response.status) && attempt < options.maxAttempts) {
      const delay = retryDelayMs(attempt, response.headers.get('Retry-After'))
      await response.body?.cancel()
      await options.sleepImpl(delay)
      continue
    }

    const body = await readJsonBody(response, label)
    if (!response.ok) {
      const code = typeof body?.code === 'string' && body.code ? `, code=${body.code}` : ''
      throw new ProductionReleaseConfirmationError(
        `${label} failed (HTTP ${response.status}${code})`,
      )
    }
    return { status: response.status, body }
  }

  throw new ProductionReleaseConfirmationError(`${label} exhausted its retry budget`)
}

async function readJsonBody(response, label) {
  try {
    return await response.json()
  } catch {
    throw new ProductionReleaseConfirmationError(
      `${label} returned invalid JSON (HTTP ${response.status})`,
    )
  }
}

function isRetryableStatus(status) {
  return status === 429 || status >= 500
}

function retryDelayMs(attempt, retryAfter) {
  const retryAfterMs = parseRetryAfterMs(retryAfter)
  if (retryAfterMs !== null) return Math.min(retryAfterMs, MAX_RETRY_DELAY_MS)
  return Math.min(2_000 * (2 ** (attempt - 1)), MAX_RETRY_DELAY_MS)
}

function parseRetryAfterMs(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000
  const timestamp = Date.parse(String(value))
  if (!Number.isFinite(timestamp)) return null
  return Math.max(0, timestamp - Date.now())
}

function sleep(milliseconds) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds))
}

function safeFailureMessage(error) {
  if (error instanceof ProductionReleaseConfirmationError) return error.message
  const errorType = error instanceof Error ? error.name : typeof error
  return `unexpected failure (${errorType})`
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await confirmProductionRelease(readProductionReleaseConfiguration())
    const outcome = result.created ? 'created' : 'already confirmed'
    console.log(
      `[confirm-production-release] release ${result.version} ${outcome} (${result.eventId})`,
    )
  } catch (error) {
    console.error(`[confirm-production-release] ${safeFailureMessage(error)}`)
    process.exitCode = 1
  }
}
