import { APP_BUILD_META } from '../../src/lib/build-meta'
import { CHANGELOG_RELEASES } from '../../src/lib/changelog'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson } from '../security/request-validation'
import {
  authenticateWebsiteIntegrationRequest,
  resolveWebsitePublicUrl,
  websiteIntegrationResponse,
} from '../security/website-integration-auth'
import {
  createWebsiteNotificationEvent,
  WebsiteNotificationEventConflictError,
} from '../storage/website-notification-event-store'

export default async function releaseConfirmationHandler(req: Request): Promise<Response> {
  const authentication = authenticateWebsiteIntegrationRequest(req, 'WEBSITE_RELEASE_CONFIRMATION_TOKEN')
  if (!authentication.ok) return authentication.response
  if (req.method !== 'POST') return websiteIntegrationResponse({ error: 'Method not allowed' }, 405)

  const body = await getValidatedJson(req, requestSchemas.releaseConfirmation)
  const deployedFrontendVersion: string = APP_BUILD_META.frontend_version
  const deployedBackendVersion: string = APP_BUILD_META.backend_version
  if (body.version !== deployedFrontendVersion || body.version !== deployedBackendVersion) {
    return websiteIntegrationResponse(
      { error: 'Requested release does not match the deployed build', code: 'deployed_release_mismatch' },
      409,
    )
  }
  const release = CHANGELOG_RELEASES.find((candidate) => candidate.version === body.version)
  if (!release) {
    return websiteIntegrationResponse(
      { error: 'Requested release is not present in the public changelog', code: 'changelog_release_not_found' },
      409,
    )
  }

  try {
    const result = await createWebsiteNotificationEvent({
      id: `release:${body.version}`,
      type: 'release.published',
      title: truncatePlainText(release.displayVersion, 120),
      summary: buildReleaseSummary(release.sections.flatMap((section) => section.items)),
      url: resolveWebsitePublicUrl('/changelog', `release-${release.id}`),
      published_at: new Date(release.releasedAt).toISOString(),
      version: body.version,
    })
    return websiteIntegrationResponse({
      ok: true,
      created: result.created,
      event_id: result.event.id,
    }, result.created ? 201 : 200)
  } catch (error) {
    if (error instanceof WebsiteNotificationEventConflictError) {
      return websiteIntegrationResponse(
        { error: 'Release event conflicts with an existing event', code: 'release_event_conflict' },
        409,
      )
    }
    console.error('release confirmation failed', {
      error_type: error instanceof Error ? error.name : typeof error,
    })
    return websiteIntegrationResponse({ error: 'Service unavailable', code: 'service_unavailable' }, 503)
  }
}

function buildReleaseSummary(items: readonly string[]): string | null {
  const summary = truncatePlainText(items.join('；'), 500)
  return summary || null
}

function truncatePlainText(value: string, maximumLength: number): string {
  return Array.from(value)
    .slice(0, maximumLength)
    .join('')
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
