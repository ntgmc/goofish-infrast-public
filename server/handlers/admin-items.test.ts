import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), create: vi.fn(), status: vi.fn() }))
vi.mock('./admin-auth', () => ({ authenticateAdminRequest: mocks.authenticate, requireRootAdminPassword: vi.fn() }))
vi.mock('../storage/admin-inventory-store', async (original) => ({
  ...await original<typeof import('../storage/admin-inventory-store')>(),
  createQqBotCampaign: mocks.create, setQqBotCampaignStatus: mocks.status,
}))
import handler from './admin-items'
import { InventoryError } from '../storage/inventory-store'

const input = { action: 'create_qqbot_campaign', group_id: '123456789', campaign_id: 'welcome7',
  item_code: 'maa_export_trial_coupon', quantity: 2, validity_days: 30, min_join_days: 7,
  joined_before: null, ends_at: null, idempotency_key: 'operation-1' }
const request = (body: unknown) => new Request('https://example.test/api/admin/inventory', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})
beforeEach(() => {
  vi.resetAllMocks()
  mocks.authenticate.mockResolvedValue({ ok: true, username: 'website-admin' })
})
describe('administrator QQ group campaigns', () => {
  it('requires a recent authorized admin session, even when a bot token is configured', async () => {
    mocks.authenticate.mockResolvedValue({ ok: false, response: Response.json({ error: 'forbidden' }, { status: 403 }) })
    expect((await handler(request(input))).status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.authenticate).toHaveBeenCalledWith(expect.any(Request), { capability: 'admin_manage', requireRecentLogin: true })
  })
  it('creates with the authenticated administrator identity and preserves conflicts', async () => {
    mocks.create.mockResolvedValue({ campaign_id: 'welcome7' })
    expect((await handler(request(input))).status).toBe(201)
    expect(mocks.create).toHaveBeenCalledWith('website-admin', input)
    mocks.create.mockRejectedValue(new InventoryError('campaign_exists', '编号已存在', 409))
    expect((await handler(request(input))).status).toBe(409)
  })
  it('rejects invalid activity fields before creating a campaign', async () => {
    expect((await handler(request({ ...input, min_join_days: -1 }))).status).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('passes the expected revision when changing status', async () => {
    const body = { action: 'set_qqbot_campaign_status', group_id: '123456789', campaign_id: 'welcome7', enabled: false, expected_revision: 2 }
    expect((await handler(request(body))).status).toBe(200)
    expect(mocks.status).toHaveBeenCalledWith('website-admin', body)
  })
})
