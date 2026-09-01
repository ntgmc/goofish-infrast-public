import { getRequestClientIp } from '../security/client-ip'
import { RateLimitStoreError, reservePersistentRateLimit } from '../security/persistent-rate-limit'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson, RequestInputError } from '../security/request-validation'
import {
  authenticateWebsiteIntegrationRequest,
  resolveWebsitePublicUrl,
  websiteIntegrationResponse,
} from '../security/website-integration-auth'
import { issueQqBotRegistrationInvitation } from '../storage/admin-registration-invitation-store'

const ISSUANCE_RATE_LIMIT = 120
const ISSUANCE_RATE_LIMIT_WINDOW_MS = 60_000

export default async function qqBotRegistrationInvitationsHandler(req: Request): Promise<Response> {
  const authentication = authenticateWebsiteIntegrationRequest(req, 'WEBSITE_EVENTS_TOKEN')
  if (!authentication.ok) return authentication.response
  if (req.method !== 'POST') return websiteIntegrationResponse({ error: 'Method not allowed' }, 405)

  let body
  try {
    body = await getValidatedJson(req, requestSchemas.qqBotRegistrationInvitation, true)
  } catch (error) {
    if (error instanceof RequestInputError) {
      return websiteIntegrationResponse({ error: 'QQ number is invalid', code: error.code }, error.status)
    }
    throw error
  }

  try {
    const rateLimit = await reservePersistentRateLimit(
      'qqbot-registration-invitation',
      getRequestClientIp(req),
      ISSUANCE_RATE_LIMIT,
      ISSUANCE_RATE_LIMIT_WINDOW_MS,
    )
    if (!rateLimit.allowed) {
      return websiteIntegrationResponse(
        { error: 'Too many requests', code: 'rate_limited' },
        429,
        { 'Retry-After': String(rateLimit.retryAfterSeconds) },
      )
    }
    rateLimit.attempt.retain()

    const result = await issueQqBotRegistrationInvitation({
      qqNumber: body.qq_number,
      encryptionSecret: authentication.token,
    })
    if (result.status === 'bound') {
      return websiteIntegrationResponse({ schema_version: 1, status: 'bound' })
    }
    return websiteIntegrationResponse({
      schema_version: 1,
      status: result.status,
      invitation_code: result.code,
      expires_at: result.expiresAt,
      registration_url: resolveWebsitePublicUrl('/tool/profiles', `invite=${result.code}`),
    }, result.status === 'created' ? 201 : 200)
  } catch (error) {
    if (error instanceof RateLimitStoreError) {
      return websiteIntegrationResponse({ error: 'Service unavailable', code: 'service_unavailable' }, 503)
    }
    console.error('QQ Bot registration invitation request failed', {
      error_type: error instanceof Error ? error.name : typeof error,
    })
    return websiteIntegrationResponse({ error: 'Service unavailable', code: 'service_unavailable' }, 503)
  }
}
