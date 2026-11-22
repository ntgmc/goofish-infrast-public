import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ read: vi.fn(), verify: vi.fn(), activate: vi.fn() }))
vi.mock('../storage/value-clock-comparison-store', () => ({ readPersonalValueClock: mocks.read, verifyPersonalValueClock: mocks.verify, activatePersonalValueClock: mocks.activate }))
import handler from './user-value-clock'

beforeEach(() => vi.clearAllMocks())

it.each(['GET', 'POST'])('closes the personal comparison API for %s without authenticating or reading data', async (method) => {
  const response = await handler(new Request('http://localhost/api/user/value-clock/comparisons?profile_id=p', {
    method, headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined, body: method === 'POST' ? '{}' : undefined,
  }))
  expect(response.status).toBe(404)
  expect(await response.json()).toEqual({ error: '此功能暂不可用。', code: 'feature_unavailable' })
  expect(mocks.read).not.toHaveBeenCalled()
  expect(mocks.verify).not.toHaveBeenCalled()
  expect(mocks.activate).not.toHaveBeenCalled()
})

it('keeps method rejection behavior for unsupported requests', async () => {
  expect((await handler(new Request('http://localhost/api/user/value-clock/comparisons', { method: 'DELETE' }))).status).toBe(405)
})
