import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FEEDBACK_IMAGE_MAX_BYTES } from '../../src/lib/feedback-contracts'

const mocks = vi.hoisted(() => ({ session: vi.fn(), admin: vi.fn(), create: vi.fn(), list: vi.fn(), image: vi.fn(), rate: vi.fn() }))
vi.mock('./user-auth', () => ({ requireUserSession: mocks.session, jsonResponse: (body: unknown, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers }) }))
vi.mock('./admin-auth', () => ({ authenticateAdminRequest: mocks.admin }))
vi.mock('../storage/feedback-store', () => ({ createFeedback: mocks.create, listAdminFeedback: mocks.list, getFeedbackImage: mocks.image }))
vi.mock('../security/persistent-rate-limit', () => ({ reservePersistentRateLimit: mocks.rate }))
import userFeedbackHandler from './user-feedback'
import adminFeedbackHandler from './admin-feedback'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZKsAAAAASUVORK5CYII=', 'base64')
const id = '764b3769-09e4-4261-83b8-d23896419a8f'
const request = (body: unknown) => new Request('http://localhost/api/user/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({ user: { id: 'logged-in-user' } })
  mocks.admin.mockResolvedValue({ ok: true })
  mocks.create.mockResolvedValue(id)
  mocks.rate.mockResolvedValue({ allowed: true, attempt: { retain: vi.fn() } })
  mocks.list.mockResolvedValue({ items: [], pagination: { page: 1, page_size: 25, total: 0, total_pages: 0 } })
  mocks.image.mockResolvedValue({ image_type: 'image/png', image_data: png })
})

describe('feedback authorization and upload boundary', () => {
  it('requires login before storing feedback', async () => {
    mocks.session.mockResolvedValue(null)
    expect((await userFeedbackHandler(request({ category: 'other', message: '问题' }))).status).toBe(401)
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('uses the logged-in account and stores the validated image with trimmed text', async () => {
    const response = await userFeedbackHandler(request({ category: 'schedule', message: '  排班问题  ', image: { type: 'image/png', base64: png.toString('base64') } }))
    expect(response.status).toBe(201)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(mocks.create).toHaveBeenCalledWith('logged-in-user', expect.objectContaining({ message: '排班问题' }), png)
  })
  it.each([
    { category: 'unknown', message: '问题' },
    { category: 'other', message: '   ' },
    { category: 'other', message: '字'.repeat(2001) },
    { category: 'other', message: '问题', user_id: 'another-user' },
    { category: 'other', message: '问题', image: { type: 'image/svg+xml', base64: 'PHN2Zz4=' } },
    { category: 'other', message: '问题', image: { type: 'image/png', base64: Buffer.from('<svg/>').toString('base64') } },
    { category: 'other', message: '问题', image: { type: 'image/png', base64: '%%%%' } },
  ])('rejects malformed or forged feedback %#', async (body) => {
    expect((await userFeedbackHandler(request(body))).status).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('enforces the decoded image limit even when the JSON body fits', async () => {
    const bytes = Buffer.alloc(FEEDBACK_IMAGE_MAX_BYTES + 1)
    png.copy(bytes)
    const response = await userFeedbackHandler(request({ category: 'other', message: '问题', image: { type: 'image/png', base64: bytes.toString('base64') } }))
    expect(response.status).toBe(413)
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('limits repeated submissions before writing', async () => {
    mocks.rate.mockResolvedValue({ allowed: false, retryAfterSeconds: 30 })
    const response = await userFeedbackHandler(request({ category: 'other', message: '问题' }))
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('30')
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('protects both the admin list and image from unauthorized access', async () => {
    mocks.admin.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) })
    for (const query of ['', `?image_id=${id}`]) {
      expect((await adminFeedbackHandler(new Request(`http://localhost/api/admin/feedback${query}`))).status).toBe(403)
    }
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.image).not.toHaveBeenCalled()
    expect(mocks.admin).toHaveBeenCalledWith(expect.any(Request), 'user_view')
  })
  it('returns paginated feedback and restricts page size', async () => {
    expect((await adminFeedbackHandler(new Request('http://localhost/api/admin/feedback?page=2&page_size=50'))).status).toBe(200)
    expect(mocks.list).toHaveBeenCalledWith(2, 50)
    expect((await adminFeedbackHandler(new Request('http://localhost/api/admin/feedback?page_size=1000'))).status).toBe(400)
  })
  it('serves authenticated images with their validated MIME type and without caching', async () => {
    const response = await adminFeedbackHandler(new Request(`http://localhost/api/admin/feedback?image_id=${id}`))
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png)
    mocks.image.mockResolvedValue(null)
    expect((await adminFeedbackHandler(new Request(`http://localhost/api/admin/feedback?image_id=${id}`))).status).toBe(404)
  })
})
