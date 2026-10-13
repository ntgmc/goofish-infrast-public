import { feedbackCopy as text } from '../../src/copy/zh-CN/feedback'
import { FEEDBACK_IMAGE_MAX_BYTES, type FeedbackRequest } from '../../src/lib/feedback-contracts'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson, RequestInputError, validateAndStoreJsonBody } from '../security/request-validation'
import { reservePersistentRateLimit } from '../security/persistent-rate-limit'
import { createFeedback, updateFeedback, FeedbackError } from '../storage/feedback-store'
import { readFeedback } from './feedback-read'
import { AdminPaginationError } from './admin-pagination'
import { jsonResponse, requireUserSession } from './user-auth'

export default async function userFeedbackHandler(req: Request): Promise<Response> {
  try {
    if (!['GET', 'POST', 'PATCH'].includes(req.method)) return respond({ error: 'Method not allowed' }, 405)
    const auth = await requireUserSession(req)
    if (!auth) return respond({ error: text.loginRequired }, 401)
    if (req.method === 'GET') return await readFeedback(req, auth.user.id)
    if (req.method === 'PATCH') {
      await validateAndStoreJsonBody(req, requestSchemas.userFeedbackReply, 'standard')
      const body = await getValidatedJson(req, requestSchemas.userFeedbackReply, true)
      const decision = await reservePersistentRateLimit('user-feedback', auth.user.id, 10, 60 * 60 * 1000)
      if (!decision.allowed) return jsonResponse({ error: text.tooFrequent }, 429, { 'Cache-Control': 'no-store', 'Retry-After': String(decision.retryAfterSeconds) })
      await updateFeedback(body, { userId: auth.user.id })
      decision.attempt.retain()
      return respond({ id: body.feedback_id })
    }
    await validateAndStoreJsonBody(req, requestSchemas.userFeedback, 'feedback')
    const body = await getValidatedJson(req, requestSchemas.userFeedback, true)
    const image = decodeImage(body.image)
    const decision = await reservePersistentRateLimit('user-feedback', auth.user.id, 10, 60 * 60 * 1000)
    if (!decision.allowed) return jsonResponse({ error: text.tooFrequent }, 429, { 'Cache-Control': 'no-store', 'Retry-After': String(decision.retryAfterSeconds) })
    const id = await createFeedback(auth.user.id, body, image)
    decision.attempt.retain()
    return respond({ id }, 201)
  } catch (error) {
    if (error instanceof RequestInputError || error instanceof FeedbackError) return respond({ error: error.message, code: error.code }, error.status)
    if (error instanceof AdminPaginationError) return respond({ error: error.message }, 400)
    console.error('user feedback error:', error instanceof Error ? error.name : 'UnknownError')
    return respond({ error: req.method === 'GET' ? text.loadFailed : req.method === 'PATCH' ? text.saveFailed : text.submitFailed }, 500)
  }
}

function decodeImage(image: FeedbackRequest['image']): Buffer | null {
  if (!image) return null
  const bytes = Buffer.from(image.base64, 'base64')
  if (bytes.length > FEEDBACK_IMAGE_MAX_BYTES) throw new RequestInputError(text.imageTooLarge, 'payload_too_large', 413)
  const valid = image.type === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : image.type === 'image/jpeg' ? bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9
      : bytes.length >= 16 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16))
  if (!valid || bytes.toString('base64') !== image.base64) throw new RequestInputError(text.invalidImage)
  return bytes
}

function respond(body: unknown, status = 200): Response {
  return jsonResponse(body, status, { 'Cache-Control': 'no-store' })
}
