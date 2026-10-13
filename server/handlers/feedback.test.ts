import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FEEDBACK_IMAGE_MAX_BYTES } from '../../src/lib/feedback-contracts'

const mocks = vi.hoisted(() => ({ session: vi.fn(), admin: vi.fn(), create: vi.fn(), list: vi.fn(), userList: vi.fn(), detail: vi.fn(), update: vi.fn(), image: vi.fn(), rate: vi.fn() }))
vi.mock('./user-auth', () => ({ requireUserSession: mocks.session, jsonResponse: (body: unknown, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers }) }))
vi.mock('./admin-auth', () => ({ authenticateAdminRequest: mocks.admin }))
vi.mock('../storage/feedback-store', async (importOriginal) => ({ ...await importOriginal<typeof import('../storage/feedback-store')>(), createFeedback: mocks.create, listAdminFeedback: mocks.list, listUserFeedback: mocks.userList, getFeedbackDetail: mocks.detail, updateFeedback: mocks.update, getFeedbackImage: mocks.image }))
vi.mock('../security/persistent-rate-limit', () => ({ reservePersistentRateLimit: mocks.rate }))
import userFeedbackHandler from './user-feedback'
import adminFeedbackHandler from './admin-feedback'
import { FeedbackError } from '../storage/feedback-store'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZKsAAAAASUVORK5CYII=', 'base64')
const id = '764b3769-09e4-4261-83b8-d23896419a8f'
const request = (body: unknown) => new Request('http://localhost/api/user/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({ user: { id: 'logged-in-user' } })
  mocks.admin.mockResolvedValue({ ok: true, username: 'operator' })
  mocks.create.mockResolvedValue(id)
  mocks.rate.mockResolvedValue({ allowed: true, attempt: { retain: vi.fn() } })
  mocks.list.mockResolvedValue({ items: [], pagination: { page: 1, page_size: 25, total: 0, total_pages: 0 } })
  mocks.image.mockResolvedValue({ image_type: 'image/png', image_data: png })
  mocks.userList.mockResolvedValue({ items: [], pagination: { page: 1, page_size: 25, total: 0, total_pages: 0 } })
  mocks.detail.mockResolvedValue({ feedback: { id }, entries: [], next_before_revision: null })
  mocks.update.mockResolvedValue(undefined)
})

describe('feedback authorization and upload boundary', () => {
  it('scopes user history, detail and screenshots to the authenticated account', async () => {
    for (const params of ['', `?feedback_id=${id}`, `?image_id=${id}`]) {
      expect((await userFeedbackHandler(new Request(`http://localhost/api/user/feedback${params}`))).status).toBe(200)
    }
    expect(mocks.userList).toHaveBeenCalledWith('logged-in-user', 1, 25)
    expect(mocks.detail).toHaveBeenCalledWith(id, 'logged-in-user', undefined)
    expect(mocks.image).toHaveBeenCalledWith(id, 'logged-in-user')
    mocks.session.mockResolvedValue(null)
    expect((await userFeedbackHandler(new Request(`http://localhost/api/user/feedback?feedback_id=${id}`))).status).toBe(401)
  })
  it('requires mutation permission and persists the authenticated administrator with an audit reason', async () => {
    const body = { feedback_id: id, expected_revision: 1, request_key: id, status: 'resolved', assignment: 'mine', message: '已修复', internal_note: '工单 42', reason: '排查完成' }
    const req = () => new Request('http://localhost/api/admin/feedback', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    expect((await adminFeedbackHandler(req())).status).toBe(200)
    expect(mocks.admin).toHaveBeenCalledWith(expect.any(Request), 'user_manage')
    expect(mocks.update).toHaveBeenCalledWith(body, expect.objectContaining({ username: 'operator', audit: expect.objectContaining({ reason: '排查完成', targetId: id, actorUsername: 'operator' }) }))
    mocks.admin.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) })
    mocks.update.mockClear()
    expect((await adminFeedbackHandler(req())).status).toBe(403)
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('accepts a scoped user follow-up, rejects forged internal notes and returns revision conflicts', async () => {
    const body = { feedback_id: id, expected_revision: 2, request_key: id, message: '仍然出现问题' }
    const req = (json: unknown) => new Request('http://localhost/api/user/feedback', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json) })
    expect((await userFeedbackHandler(req(body))).status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith(body, { userId: 'logged-in-user' })
    expect((await userFeedbackHandler(req({ ...body, internal_note: '伪造' }))).status).toBe(400)
    mocks.update.mockRejectedValue(new FeedbackError('feedback_conflict', '刷新后重试', 409))
    expect((await userFeedbackHandler(req(body))).status).toBe(409)
  })
  it.each(['?feedback_id=invalid', '?before_revision=3', `?feedback_id=${id}&image_id=${id}`, '?status=invalid'])('rejects ambiguous or invalid read queries %s', async (params) => {
    expect((await adminFeedbackHandler(new Request(`http://localhost/api/admin/feedback${params}`))).status).toBe(400)
  })
  it.each(['user', 'admin'])('enforces the standard JSON body limit for %s follow-ups', async (scope) => {
    const req = new Request(`http://localhost/api/${scope}/feedback`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '字'.repeat(30_000) }) })
    expect((await (scope === 'user' ? userFeedbackHandler : adminFeedbackHandler)(req)).status).toBe(413)
    expect(mocks.update).not.toHaveBeenCalled()
  })
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
    expect(mocks.list).toHaveBeenCalledWith(2, 50, undefined)
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
