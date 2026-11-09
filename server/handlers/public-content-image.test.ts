import { beforeEach, expect, it, vi } from 'vitest'
import { IMAGE_UPLOAD_MAX_BYTES } from '../../src/lib/image-upload'
import { REQUEST_BODY_LIMITS, getRoutePolicy } from '../security/request-policy'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), save: vi.fn(), get: vi.fn() }))
vi.mock('./admin-auth', () => ({ authenticateAdminRequest: mocks.auth }))
vi.mock('../storage/public-content-image-store', () => ({ savePublicContentImage: mocks.save, getPublicContentImage: mocks.get }))
import adminHandler from './admin-public-content-image'
import siteHandler from './site-public-content-image'
const id = 'a'.repeat(64)
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const request = (body: unknown) => new Request('http://localhost/api/admin/public-content-image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
beforeEach(() => {
  mocks.auth.mockReset().mockResolvedValue({ ok: true })
  mocks.save.mockReset().mockResolvedValue(id)
  mocks.get.mockReset().mockResolvedValue({ image_type: 'image/png', image_data: png })
})
it('requires admin_manage before accepting an upload', async () => {
  mocks.auth.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) })
  expect((await adminHandler(request({ type: 'image/png', base64: png.toString('base64') }))).status).toBe(403)
  expect(mocks.auth).toHaveBeenCalledWith(expect.any(Request), 'admin_manage')
  expect(mocks.save).not.toHaveBeenCalled()
})
it.each([
  ['image/png', png],
  ['image/jpeg', Buffer.from([255, 216, 255, 0, 255, 217])],
  ['image/webp', Buffer.from('RIFF0000WEBPVP8 0000')],
])('uploads %s and serves the original bytes publicly with a fixed image type', async (type, bytes) => {
  const response = await adminHandler(request({ type, base64: bytes.toString('base64') }))
  expect(response.status).toBe(201)
  expect(await response.json()).toEqual({ url: `/api/site/public-content-image?id=${id}` })
  expect(mocks.save).toHaveBeenCalledWith(type, bytes)
  mocks.get.mockResolvedValue({ image_type: type, image_data: bytes })
  mocks.auth.mockClear()
  const image = await siteHandler(new Request(`http://localhost/api/site/public-content-image?id=${id}`))
  expect(Buffer.from(await image.arrayBuffer())).toEqual(bytes)
  expect(image.headers.get('Content-Type')).toBe(type)
  expect(image.headers.get('X-Content-Type-Options')).toBe('nosniff')
  expect(image.headers.get('Cache-Control')).toContain('immutable')
  expect(mocks.auth).not.toHaveBeenCalled()
})
it.each([
  { type: 'image/svg+xml', base64: Buffer.from('<svg/>').toString('base64') },
  { type: 'image/png', base64: Buffer.from('<script>alert(1)</script>').toString('base64') },
  { type: 'image/jpeg', base64: png.toString('base64') },
  { type: 'image/png', base64: '!!!!' },
  { type: 'image/png', base64: '/x==' },
  { type: 'image/png', base64: '' },
])('rejects malformed, mismatched or oversized images', async (body) => {
  expect((await adminHandler(request(body))).status).toBe(400)
  expect(mocks.save).not.toHaveBeenCalled()
})
it('rejects images over 1 MB even when their encoded length matches the allowed maximum', async () => {
  expect((await adminHandler(request({ type: 'image/png', base64: Buffer.alloc(IMAGE_UPLOAD_MAX_BYTES + 1).toString('base64') }))).status).toBe(413)
  expect(mocks.save).not.toHaveBeenCalled()
})
it('enforces the image body limit and declares both route boundaries', async () => {
  expect((await adminHandler(request({ type: 'image/png', base64: 'a'.repeat(REQUEST_BODY_LIMITS.image) }))).status).toBe(413)
  expect(getRoutePolicy('/api/admin/public-content-image')?.methods.POST.bodyProfile).toBe('image')
  expect(getRoutePolicy('/api/site/public-content-image')?.queryKeys.has('id')).toBe(true)
})
it('does not query storage for invalid IDs and does not cache missing images', async () => {
  expect((await siteHandler(new Request('http://localhost/api/site/public-content-image?id=../private'))).status).toBe(400)
  expect(mocks.get).not.toHaveBeenCalled()
  mocks.get.mockResolvedValue(null)
  const missing = await siteHandler(new Request(`http://localhost/api/site/public-content-image?id=${id}`))
  expect(missing.status).toBe(404)
  expect(missing.headers.get('Cache-Control')).toBe('no-store')
})
it('rejects unsupported methods', async () => {
  expect((await adminHandler(new Request('http://localhost/api/admin/public-content-image'))).status).toBe(405)
  expect((await siteHandler(request({}))).status).toBe(405)
})
