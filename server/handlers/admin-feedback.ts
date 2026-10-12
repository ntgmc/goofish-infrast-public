import { feedbackCopy as text } from '../../src/copy/zh-CN/feedback'
import { getFeedbackImage, listAdminFeedback } from '../storage/feedback-store'
import { authenticateAdminRequest } from './admin-auth'
import { AdminPaginationError, parseAdminPageRequest } from './admin-pagination'
import { jsonResponse } from './license-utils'

export default async function adminFeedbackHandler(req: Request): Promise<Response> {
  const authentication = await authenticateAdminRequest(req, 'user_view')
  if (!authentication.ok) return authentication.response
  if (req.method !== 'GET') return respond({ error: 'Method not allowed' }, 405)
  try {
    const url = new URL(req.url)
    const imageId = url.searchParams.get('image_id')
    if (imageId !== null) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(imageId)) return respond({ error: text.imageNotFound }, 400)
      const image = await getFeedbackImage(imageId)
      if (!image) return respond({ error: text.imageNotFound }, 404)
      return new Response(new Uint8Array(image.image_data), { headers: {
        'Content-Type': image.image_type,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      } })
    }
    const { page, pageSize } = parseAdminPageRequest(url)
    return respond(await listAdminFeedback(page, pageSize))
  } catch (error) {
    if (error instanceof AdminPaginationError) return respond({ error: error.message }, 400)
    console.error('admin feedback error:', error instanceof Error ? error.name : 'UnknownError')
    return respond({ error: text.loadFailed }, 500)
  }
}

function respond(body: unknown, status = 200): Response {
  return jsonResponse(body, status, { 'Cache-Control': 'no-store' })
}
