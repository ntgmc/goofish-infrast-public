import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ gate: vi.fn(), read: vi.fn() }))
vi.mock('../feature-gate', () => ({ requireSiteFeatures: mocks.gate }))
vi.mock('../storage/value-clock-store', () => ({ getPublicValueClock: mocks.read }))
import handler from './value-clock'
beforeEach(() => { vi.clearAllMocks(); mocks.gate.mockResolvedValue(null); mocks.read.mockResolvedValue({ status: 'ready' }) })
it('gates anonymous statistics and only serves the production view', async () => {
  mocks.gate.mockResolvedValueOnce(Response.json({ code: 'feature_disabled' }, { status: 503 }))
  expect((await handler(new Request('http://localhost/api/site/value-clock'))).status).toBe(503)
  expect(mocks.read).not.toHaveBeenCalled()
  expect((await handler(new Request('http://localhost/api/site/value-clock?view=gain'))).status).toBe(400)
  expect((await handler(new Request('http://localhost/api/site/value-clock', { method: 'POST' }))).status).toBe(405)
})
it('serves an anonymous no-store snapshot without requiring a session', async () => {
  const response = await handler(new Request('http://localhost/api/site/value-clock?view=production'))
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(await response.json()).toEqual({ status: 'ready' })
  expect(mocks.read).toHaveBeenCalledOnce()
})
