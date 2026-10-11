import { CHANGELOG_RELEASES } from '../../src/lib/changelog'
import type { ChangelogPageData } from '../../src/lib/changelog-contract'
import { jsonResponse } from './user-auth'

const PAGE_SIZE = 10

export default async function changelogHandler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405)
  const params = new URL(req.url).searchParams
  const rawPage = params.get('page') ?? '1'
  const requestedPage = Number(rawPage)
  if (!/^\d+$/.test(rawPage) || !Number.isSafeInteger(requestedPage) || requestedPage < 1) {
    return jsonResponse({ error: 'Invalid changelog page' }, 400)
  }
  const releaseId = params.get('release')
  if (releaseId && releaseId.length > 160) return jsonResponse({ error: 'Invalid release' }, 400)
  const releaseIndex = releaseId ? CHANGELOG_RELEASES.findIndex((release) => release.id === releaseId) : -1
  const total = CHANGELOG_RELEASES.length
  const page = releaseIndex >= 0
    ? Math.floor(releaseIndex / PAGE_SIZE) + 1
    : Math.min(requestedPage, Math.max(1, Math.ceil(total / PAGE_SIZE)))
  const data: ChangelogPageData = {
    releases: CHANGELOG_RELEASES.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    page,
    pageSize: PAGE_SIZE,
    total,
  }
  return jsonResponse(data, 200, { 'Cache-Control': 'no-store' })
}
