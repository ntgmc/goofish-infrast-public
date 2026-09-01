import { createHash, timingSafeEqual } from 'node:crypto'
import { jsonResponse } from '../handlers/license-utils'

export type WebsiteIntegrationTokenName =
  | 'WEBSITE_EVENTS_TOKEN'
  | 'WEBSITE_RELEASE_CONFIRMATION_TOKEN'

export type WebsiteIntegrationAuthentication =
  | { ok: true; token: string }
  | { ok: false; response: Response }

const NO_STORE_HEADERS = Object.freeze({
  'Cache-Control': 'private, no-store',
})

export function authenticateWebsiteIntegrationRequest(
  req: Request,
  tokenName: WebsiteIntegrationTokenName,
): WebsiteIntegrationAuthentication {
  const configuredToken = process.env[tokenName]?.trim()
  if (!configuredToken || Buffer.byteLength(configuredToken, 'utf8') < 32) {
    return {
      ok: false,
      response: jsonResponse(
        { error: 'Service unavailable', code: 'integration_not_configured' },
        503,
        NO_STORE_HEADERS,
      ),
    }
  }

  const authorization = req.headers.get('Authorization')
  const match = /^Bearer ([^\s]+)$/.exec(authorization ?? '')
  const presentedToken = match?.[1] ?? ''
  const otherTokenName = tokenName === 'WEBSITE_EVENTS_TOKEN'
    ? 'WEBSITE_RELEASE_CONFIRMATION_TOKEN'
    : 'WEBSITE_EVENTS_TOKEN'
  const otherConfiguredToken = process.env[otherTokenName]?.trim()
  const matchesExpectedToken = tokensMatch(configuredToken, presentedToken)
  const matchesOtherSecurityDomain = Boolean(
    otherConfiguredToken
    && Buffer.byteLength(otherConfiguredToken, 'utf8') >= 32
    && tokensMatch(otherConfiguredToken, presentedToken),
  )
  if (!matchesExpectedToken) {
    if (matchesOtherSecurityDomain) {
      return {
        ok: false,
        response: jsonResponse(
          { error: 'Forbidden', code: 'forbidden' },
          403,
          NO_STORE_HEADERS,
        ),
      }
    }
    return {
      ok: false,
      response: jsonResponse(
        { error: 'Unauthorized', code: 'unauthorized' },
        401,
        {
          ...NO_STORE_HEADERS,
          'WWW-Authenticate': 'Bearer',
        },
      ),
    }
  }
  return { ok: true, token: configuredToken }
}

function tokensMatch(expected: string, presented: string): boolean {
  const expectedDigest = createHash('sha256').update(expected).digest()
  const presentedDigest = createHash('sha256').update(presented).digest()
  return timingSafeEqual(expectedDigest, presentedDigest)
}

export function resolveWebsitePublicUrl(pathname: string, hash?: string): string {
  const configured = process.env.PUBLIC_APP_URL?.trim()
  if (!configured) throw new Error('PUBLIC_APP_URL is not configured.')
  const baseUrl = new URL(configured)
  if (baseUrl.protocol !== 'https:' || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new Error('PUBLIC_APP_URL must be an HTTPS URL without credentials, query, or fragment.')
  }
  const url = new URL(pathname, baseUrl)
  if (hash) url.hash = hash
  return url.toString()
}

export function websiteIntegrationResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return jsonResponse(body, status, { ...NO_STORE_HEADERS, ...headers })
}
