import { publicContentCopy as text } from '../../src/copy/zh-CN/public-content'
import { IMAGE_UPLOAD_MAX_BYTES } from '../../src/lib/image-upload'
import { hasImageSignature } from '../security/image-upload'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson, RequestInputError, validateAndStoreJsonBody } from '../security/request-validation'
import { savePublicContentImage } from '../storage/public-content-image-store'
import { authenticateAdminRequest } from './admin-auth'
import { jsonResponse } from './user-auth'

export default async function adminPublicContentImageHandler(req: Request): Promise<Response> {
  const auth = await authenticateAdminRequest(req, 'admin_manage')
  if (!auth.ok) return auth.response
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
  try {
    await validateAndStoreJsonBody(req, requestSchemas.adminPublicContentImage, 'image')
    const image = await getValidatedJson(req, requestSchemas.adminPublicContentImage, true)
    const bytes = Buffer.from(image.base64, 'base64')
    if (bytes.length > IMAGE_UPLOAD_MAX_BYTES) throw new RequestInputError(text.admin_image_too_large, 'payload_too_large', 413)
    if (!hasImageSignature(bytes, image.type) || bytes.toString('base64') !== image.base64) throw new RequestInputError(text.admin_image_invalid)
    const id = await savePublicContentImage(image.type, bytes)
    return jsonResponse({ url: `/api/site/public-content-image?id=${id}` }, 201, { 'Cache-Control': 'no-store' })
  } catch (error) {
    if (error instanceof RequestInputError) return jsonResponse({ error: error.message, code: error.code }, error.status, { 'Cache-Control': 'no-store' })
    throw error
  }
}
