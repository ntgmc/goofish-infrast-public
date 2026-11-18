import { beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_AI_SETTINGS } from '../../src/lib/ai-settings'
import handler from './admin-ai-settings'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), read: vi.fn(), save: vi.fn() }))
vi.mock('./admin-auth', () => ({ authenticateAdminRequest: mocks.auth }))
vi.mock('../storage/ai-settings-store', async (original) => ({ ...await original<object>(), getAdminAiSettings: mocks.read, saveAdminAiSettings: mocks.save }))
const update = { settings: DEFAULT_AI_SETTINGS, enabled: false, expected_revision: 0, expected_feature_revision: 0, reason: '保存草稿' }
const request = (body?: unknown) => new Request('https://example.test/api/admin/ai-settings', body ? { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ ok: true, username: 'admin' })
  mocks.read.mockResolvedValue({ settings: DEFAULT_AI_SETTINGS, has_api_key: true })
})
it('requires management capability for both reads and writes', async () => {
  mocks.auth.mockResolvedValue({ ok: false, response: new Response('forbidden', { status: 403 }) })
  expect((await handler(request())).status).toBe(403)
  expect((await handler(request(update))).status).toBe(403)
  expect(mocks.auth).toHaveBeenCalledWith(expect.any(Request), 'admin_manage')
  expect(mocks.read).not.toHaveBeenCalled()
  expect(mocks.save).not.toHaveBeenCalled()
})
it('returns only the redacted store projection without caching', async () => {
  const response = await handler(request())
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(await response.json()).toEqual({ settings: DEFAULT_AI_SETTINGS, has_api_key: true })
})
it('validates protocol and numeric bounds before saving and conceals sensitive failures', async () => {
  expect((await handler(request({ ...update, settings: { ...DEFAULT_AI_SETTINGS, protocol: 'unknown' } }))).status).toBe(400)
  expect(mocks.save).not.toHaveBeenCalled()
  mocks.save.mockRejectedValueOnce(new Error('secret-test-value'))
  const response = await handler(request({ ...update, api_key: 'secret-test-value' }))
  expect(response.status).toBe(503)
  expect(await response.text()).not.toContain('secret-test-value')
})
it('reports incomplete settings and optimistic concurrency errors with actionable statuses', async () => {
  const { AiSettingsValidationError } = await import('../storage/ai-settings-store')
  const { SettingsConflictError } = await import('../storage/settings-conflict')
  mocks.save.mockRejectedValueOnce(new AiSettingsValidationError([{ path: 'api_key', message: '请配置密钥。' }]))
  expect((await handler(request(update))).status).toBe(400)
  mocks.save.mockRejectedValueOnce(new SettingsConflictError())
  expect((await handler(request(update))).status).toBe(409)
})
