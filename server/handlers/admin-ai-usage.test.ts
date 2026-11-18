import { beforeEach, expect, it, vi } from 'vitest'
import handler from './admin-ai-usage'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn(), detail: vi.fn() }))
vi.mock('./admin-auth', () => ({ authenticateAdminRequest: mocks.auth }))
vi.mock('../storage/ai-usage-store', () => ({ listAiUsage: mocks.list, getAiUsage: mocks.detail }))
beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ ok: true })
  mocks.list.mockResolvedValue({ items: [] })
  mocks.detail.mockResolvedValue({ item: { id: 'a1' }, explanation: null })
})
const request = (params = '', method = 'GET') => new Request(`https://example.test/api/admin/ai-usage${params}`, { method })

it('requires the AI management capability before reading records', async () => {
  mocks.auth.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) })
  expect((await handler(request())).status).toBe(403)
  expect(mocks.auth).toHaveBeenCalledWith(expect.any(Request), 'admin_manage')
  expect(mocks.list).not.toHaveBeenCalled()
  expect(mocks.detail).not.toHaveBeenCalled()
})

it('applies bounded dates and server pagination, and passes only supported filters', async () => {
  expect((await handler(request('?page=2&page_size=50&model=model-1&provider=service&user_id=u1&status=failed'))).status).toBe(200)
  expect(mocks.list).toHaveBeenCalledWith(2, 50, expect.objectContaining({ model: 'model-1', provider: 'service', user_id: 'u1', status: 'failed', from: expect.any(String), to: expect.any(String) }))
  const filters = mocks.list.mock.calls[0][2]
  expect(Date.parse(filters.to) - Date.parse(filters.from)).toBe(30 * 86400000)
})

it.each(['?from=invalid', '?status=other', '?from=2026-11-17T00:00:00Z&to=2026-11-16T00:00:00Z',
  '?from=2020-01-01T00:00:00Z&to=2026-01-01T00:00:00Z', '?page_size=1', '?page=-1'])('rejects invalid filters %s', async (params) => {
  expect((await handler(request(params))).status).toBe(400)
  expect(mocks.list).not.toHaveBeenCalled()
})

it('reads one detail without loading unrelated records and returns not found when missing', async () => {
  expect((await handler(request('?id=a1'))).status).toBe(200)
  expect(mocks.detail).toHaveBeenCalledWith('a1')
  expect(mocks.list).not.toHaveBeenCalled()
  mocks.detail.mockResolvedValue(null)
  expect((await handler(request('?id=a1'))).status).toBe(404)
  expect((await handler(request('', 'POST'))).status).toBe(405)
})

it('does not echo database errors into the response or logs', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    mocks.list.mockRejectedValue(new Error('private database details'))
    const response = await handler(request())
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain('private')
    expect(log).toHaveBeenCalledWith('admin AI usage read failed')
  } finally { log.mockRestore() }
})
