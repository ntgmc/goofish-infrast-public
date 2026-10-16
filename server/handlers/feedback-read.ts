import { z } from 'zod'
import { FEEDBACK_STATUSES, adminFeedbackFiltersSchema } from '../../src/lib/feedback-contracts'
import { feedbackCopy as text } from '../../src/copy/zh-CN/feedback'
import { getFeedbackDetail, getFeedbackImage, listAdminFeedback, listUserFeedback } from '../storage/feedback-store'
import { parseAdminPageRequest } from './admin-pagination'
import { RequestInputError } from '../security/request-validation'
import { jsonResponse } from './license-utils'

const readQuery = adminFeedbackFiltersSchema.extend({
  feedback_id: z.uuid().optional(), image_id: z.uuid().optional(),
  before_revision: z.coerce.number().int().positive().optional(),
  status: z.enum(FEEDBACK_STATUSES).optional(),
})

export async function readFeedback(req: Request, userId: string | null, username = ''): Promise<Response> {
  const url = new URL(req.url)
  const input = readQuery.safeParse(Object.fromEntries([...url.searchParams].filter(([key]) => !['page', 'page_size'].includes(key))))
  if (!input.success) throw new RequestInputError('反馈查询参数无效。')
  const { feedback_id: id, image_id: imageId, before_revision: before, status, todo, ...filters } = input.data
  const hasFilters = status || todo || Object.keys(filters).length > 0
  if ((id && imageId) || (before && !id) || ((userId || id || imageId) && hasFilters)) throw new RequestInputError('反馈查询参数无效。')
  if (imageId) {
    const image = await getFeedbackImage(imageId, userId)
    if (!image) return jsonResponse({ error: text.imageNotFound }, 404, { 'Cache-Control': 'no-store' })
    return new Response(new Uint8Array(image.image_data), { headers: {
      'Content-Type': image.image_type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline', 'Content-Security-Policy': "default-src 'none'; sandbox",
    } })
  }
  if (id) return jsonResponse(await getFeedbackDetail(id, userId, before), 200, { 'Cache-Control': 'no-store' })
  const { page, pageSize } = parseAdminPageRequest(url)
  return jsonResponse(userId ? await listUserFeedback(userId, page, pageSize) : await listAdminFeedback(page, pageSize, status, todo, filters, username), 200, { 'Cache-Control': 'no-store' })
}
