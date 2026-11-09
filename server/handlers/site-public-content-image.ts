import { getPublicContentImage } from '../storage/public-content-image-store'
import { jsonResponse } from './user-auth'

export default async function sitePublicContentImageHandler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, 405)
  const id = new URL(req.url).searchParams.get('id')
  if (!id || !/^[a-f0-9]{64}$/.test(id)) return jsonResponse({ error: 'Invalid image ID' }, 400, { 'Cache-Control': 'no-store' })
  const image = await getPublicContentImage(id)
  if (!image) return jsonResponse({ error: 'Image not found' }, 404, { 'Cache-Control': 'no-store' })
  return new Response(new Uint8Array(image.image_data), { headers: {
    'Content-Type': image.image_type,
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  } })
}
