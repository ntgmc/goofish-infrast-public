import { getPublicContentSettings } from '../storage/public-content-settings-store'
import { jsonResponse } from './user-auth'

export default async function sitePublicContentHandler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return jsonResponse(null, 204)
  if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405)
  try {
    return jsonResponse(await getPublicContentSettings(), 200, { 'Cache-Control': 'no-store' })
  } catch (error) {
    console.error('site public content error:', error)
    return jsonResponse({ error: 'Public content is temporarily unavailable.', code: 'public_content_unavailable' }, 503, {
      'Cache-Control': 'no-store',
    })
  }
}
