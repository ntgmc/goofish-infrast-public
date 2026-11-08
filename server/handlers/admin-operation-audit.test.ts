import { beforeEach, describe, expect, it, vi } from 'vitest'
import handler from './admin-operation-audit'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn(), detail: vi.fn() }))
vi.mock('./admin-auth', () => ({ authenticateAdminRequest: mocks.auth }))
vi.mock('../storage/admin-operation-audit-store', () => ({ listAdminOperationAudits: mocks.list, getAdminOperationAudit: mocks.detail }))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ ok: true, username: 'admin' })
  mocks.list.mockResolvedValue({ items: [], pagination: { page: 1, page_size: 25, total: 0, total_pages: 0 } })
})

describe('global operation audit', () => {
  it('requires sensitive-data access before querying any audit table', async () => {
    mocks.auth.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) })
    const request = new Request('http://localhost/api/admin/operation-audit')
    expect((await handler(request)).status).toBe(403)
    expect(mocks.auth).toHaveBeenCalledWith(request, 'sensitive_data_view')
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.detail).not.toHaveBeenCalled()
  })

  it('passes validated combined filters and pagination to the shared query', async () => {
    const params = new URLSearchParams({ actor: ' operator ', from: '2026-11-01T00:00:00+08:00', to: '2026-11-08T23:59:59+08:00', action: 'user.freeze_account', target_type: 'user', target_id: 'user-1', request_id: 'request-1', page: '2', page_size: '50' })
    expect((await handler(new Request(`http://localhost/api/admin/operation-audit?${params}`))).status).toBe(200)
    expect(mocks.list).toHaveBeenCalledWith(2, 50, { actor: 'operator', from: '2026-11-01T00:00:00+08:00', to: '2026-11-08T23:59:59+08:00', action: 'user.freeze_account', target_type: 'user', target_id: 'user-1', request_id: 'request-1' })
  })

  it.each(['from=2026-02-30T00:00:00Z', 'from=2026-11-09T00:00:00Z&to=2026-11-08T00:00:00Z', 'page=0', 'page_size=999', 'source=admin', 'source=unknown&id=1', 'related_id=1', `actor=${'a'.repeat(33)}`])('rejects invalid query %s without a database read', async (search) => {
    expect((await handler(new Request(`http://localhost/api/admin/operation-audit?${search}`))).status).toBe(400)
    expect(mocks.list).not.toHaveBeenCalled()
    expect(mocks.detail).not.toHaveBeenCalled()
  })

  it('looks up a detail by both source and ID, with a missing-record response', async () => {
    mocks.detail.mockResolvedValueOnce({ source: 'inventory', id: 'shared-id', before_json: { quantity: 1 }, after_json: { quantity: 2 } }).mockResolvedValueOnce(null)
    const request = () => new Request('http://localhost/api/admin/operation-audit?source=inventory&id=shared-id')
    expect(await (await handler(request())).json()).toMatchObject({ item: { source: 'inventory', before_json: { quantity: 1 } } })
    expect(mocks.detail).toHaveBeenCalledWith('inventory', 'shared-id')
    expect((await handler(request())).status).toBe(404)
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('preserves related-record identity and rejects writes', async () => {
    expect((await handler(new Request('http://localhost/api/admin/operation-audit?related_source=risk_review&related_id=review-1'))).status).toBe(200)
    expect(mocks.list).toHaveBeenCalledWith(1, 25, { related_source: 'risk_review', related_id: 'review-1' })
    mocks.list.mockClear()
    expect((await handler(new Request('http://localhost/api/admin/operation-audit', { method: 'POST' }))).status).toBe(405)
    expect(mocks.list).not.toHaveBeenCalled()
  })
})
