import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ gate: vi.fn(), read: vi.fn() }))
vi.mock('../feature-gate', () => ({ requireSiteFeatures: mocks.gate }))
vi.mock('../storage/value-clock-store', () => ({ getPublicValueClock: mocks.read }))
import handler from './value-clock'
beforeEach(() => { vi.clearAllMocks(); mocks.gate.mockResolvedValue(null); mocks.read.mockResolvedValue({ status: 'ready' }) })
it('gates anonymous statistics and rejects unsupported views', async () => {
  mocks.gate.mockResolvedValueOnce(Response.json({ code: 'feature_disabled' }, { status: 503 }))
  expect((await handler(new Request('http://localhost/api/site/value-clock'))).status).toBe(503)
  expect(mocks.read).not.toHaveBeenCalled()
  expect((await handler(new Request('http://localhost/api/site/value-clock?view=other'))).status).toBe(400)
  expect((await handler(new Request('http://localhost/api/site/value-clock', { method: 'POST' }))).status).toBe(405)
})
it('serves the production snapshot and closes the gain view', async () => {
  const response = await handler(new Request('http://localhost/api/site/value-clock?view=production'))
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(await response.json()).toEqual({ status: 'ready' })
  expect(mocks.read).toHaveBeenCalledOnce()
  const gain = await handler(new Request('http://localhost/api/site/value-clock?view=gain'))
  expect(gain.status).toBe(404)
  expect(await gain.json()).toEqual({ error: '此统计视图暂不可用。', code: 'feature_unavailable' })
  expect(mocks.read).toHaveBeenCalledOnce()
})
