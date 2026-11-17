import { beforeEach, expect, it, vi } from 'vitest'
import type { OptimizeResult } from '../../src/lib/types'
import handler from './user-schedule-explanation'
import { readServerSentEvents } from '../../src/lib/server-sent-events'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), profile: vi.fn(), profiles: vi.fn(), authorization: vi.fn(), result: vi.fn(),
  read: vi.fn(), reserve: vi.fn(), settle: vi.fn(), generate: vi.fn(), config: vi.fn(),
}))
vi.mock('./user-auth', () => ({ requireUserSession: mocks.auth,
  jsonResponse: (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }),
}))
vi.mock('../storage/user-store', () => ({ getProfileForUser: mocks.profile, listStoredProfilesForUser: mocks.profiles,
  normalizeProfileKind: (profile: { kind?: string }) => profile.kind ?? 'cdk',
}))
vi.mock('./profile-authorization', () => ({ resolveProfileAuthorization: mocks.authorization }))
vi.mock('../storage/optimization-result-store', () => ({ getProfileOptimizationResult: mocks.result }))
vi.mock('../storage/schedule-explanation-store', () => ({ readScheduleExplanation: mocks.read, reserveScheduleExplanation: mocks.reserve, settleScheduleExplanation: mocks.settle }))
vi.mock('../optimization/jobs/entitlements', () => ({ hasTrainingDiagnosisEntitlement: vi.fn().mockResolvedValue(false) }))
vi.mock('../schedule-explanation', async (original) => ({ ...await original<object>(), generateScheduleExplanation: mocks.generate }))
vi.mock('../storage/ai-settings-store', () => ({ getScheduleExplanationConfig: mocks.config }))

const report: OptimizeResult = { author: 'test', title: 'test', description: '', buildingType: 243, planTimes: '', plans: [], raw_results: [],
  daily_production: { trading: { LMD: 50000 } },
  upgrade_suggestions: [{ type: 'single', name: '隐藏培养建议', current: 0, target: 2, gain: 2 }],
  intermediate_depletion: [{ product: 'Pure Gold', stock: 100, net_per_day: -2, days_remaining: 50 }],
}
const state = { explanation: null, pending: false, available: true, reason: null,
  quota: { kind: 'trial', limit: 3, remaining: 3, resets_at: null }, provider: '测试' }
const request = (method = 'GET', body = { profile_id: 'p1', result_id: 'r1' }) => new Request(
  `https://example.test/api/user/schedule-explanation${method === 'GET' ? `?${new URLSearchParams(body)}` : ''}`,
  { method, ...(method === 'POST' ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}) },
)
beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ user: { id: 'u1' } })
  mocks.profile.mockResolvedValue({ id: 'p1', kind: 'free_preview' })
  mocks.profiles.mockResolvedValue([{ id: 'p1', kind: 'free_preview' }])
  mocks.authorization.mockResolvedValue({ ok: true, permission: 'recommended' })
  mocks.result.mockResolvedValue({ id: 'r1', result: structuredClone(report) })
  mocks.read.mockResolvedValue(state)
  mocks.reserve.mockResolvedValue({ state: { ...state, pending: true }, attemptId: 'a1' })
  mocks.config.mockReturnValue({ reservation: 10000, provider: '测试' })
  mocks.generate.mockResolvedValue({ text: '解读正文', cost: 600, costBasis: 'usage', usage: null, breakdown: null, providerRequestId: 'req1', errorCode: null })
})

it('rejects missing sessions, foreign profiles, unavailable authorizations and missing results before reserving or calling a model', async () => {
  mocks.auth.mockResolvedValueOnce(null)
  expect((await handler(request('POST'))).status).toBe(401)
  mocks.profile.mockResolvedValueOnce(null)
  expect((await handler(request('POST'))).status).toBe(404)
  expect(mocks.profile).toHaveBeenCalledWith('u1', 'p1')
  mocks.authorization.mockResolvedValueOnce({ ok: false, message: '已冻结', code: 'profile_frozen', status: 403 })
  expect((await handler(request('POST'))).status).toBe(403)
  mocks.result.mockResolvedValueOnce(null)
  expect((await handler(request('POST'))).status).toBe(404)
  expect(mocks.reserve).not.toHaveBeenCalled()
  expect(mocks.generate).not.toHaveBeenCalled()
})

it('GET only reads; cached or pending POSTs do not call the model', async () => {
  expect((await handler(request())).status).toBe(200)
  expect(mocks.reserve).not.toHaveBeenCalled()
  mocks.reserve.mockResolvedValueOnce({ state: { ...state, pending: true }, attemptId: null })
  expect((await handler(request('POST'))).status).toBe(200)
  expect(mocks.generate).not.toHaveBeenCalled()
})

it('projects private capabilities before summarizing and uses a stable cache key', async () => {
  await handler(request('POST'))
  expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ training: [], inventory: [], maaDefaultComparison: null }), expect.anything())
  expect(mocks.settle).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', profileId: 'p1', resultId: 'r1', monthly: false }), 'a1', expect.objectContaining({ text: '解读正文', cost: 600, costBasis: 'usage', providerRequestId: 'req1', durationMs: expect.any(Number) }))
  await handler(request())
  expect(mocks.read.mock.calls[0][0].cacheKey).toBe(mocks.read.mock.calls[1][0].cacheKey)
})

it('awards monthly allowance only for an authorized maintenance profile, shared with the current free profile', async () => {
  mocks.profiles.mockResolvedValue([{ id: 'paid', kind: 'cdk' }])
  await handler(request())
  expect(mocks.read).toHaveBeenCalledWith(expect.objectContaining({ monthly: true }))
  mocks.authorization.mockResolvedValueOnce({ ok: true, permission: 'recommended' }).mockResolvedValueOnce({ ok: false })
  await handler(request())
  expect(mocks.read).toHaveBeenLastCalledWith(expect.objectContaining({ monthly: false }))
})

it('settles unknown provider expenses conservatively, returns a safe error and refunds the user allowance', async () => {
  mocks.generate.mockRejectedValue(new Error('secret token and private body'))
  const response = await handler(request('POST'))
  expect(response.status).toBe(502)
  expect(await response.text()).not.toContain('secret')
  expect(mocks.settle).toHaveBeenCalledWith(expect.anything(), 'a1', expect.objectContaining({ text: null, cost: 10000, costBasis: 'reserved', errorCode: 'provider_error', usage: null }))
  expect(mocks.generate).toHaveBeenCalledTimes(1)
})

it('does not charge local validation failures that never contact the provider', async () => {
  mocks.generate.mockRejectedValue(new Error('explanation_input_too_large'))
  expect((await handler(request('POST'))).status).toBe(502)
  expect(mocks.settle).toHaveBeenCalledWith(expect.anything(), 'a1', expect.objectContaining({
    cost: 0, costBasis: 'usage', errorCode: 'input_too_large', usage: null,
  }))
})

it('delivers text before settlement, then sends the saved state only after accounting completes', async () => {
  const gate = Promise.withResolvers<unknown>()
  mocks.generate.mockImplementation((_summary, _config, onDelta: (text: string) => void) => { onDelta('**库存**'); return gate.promise })
  const req = request('POST'); req.headers.set('Accept', 'text/event-stream')
  const response = await handler(req)
  expect(response.headers.get('Content-Type')).toContain('text/event-stream')
  expect(response.headers.get('Cache-Control')).toBe('no-store')
  expect(response.headers.get('X-Accel-Buffering')).toBe('no')
  const events = readServerSentEvents(response.body!)
  expect(JSON.parse((await events.next()).value!)).toEqual({ type: 'delta', text: '**库存**' })
  expect(mocks.settle).not.toHaveBeenCalled()
  const saved = { ...state, available: false, explanation: { text: '**库存**', created_at: '2026-11-17T12:00:00.000Z' } }
  mocks.read.mockResolvedValue(saved)
  gate.resolve({ text: '**库存**', cost: 600, costBasis: 'usage', usage: null, breakdown: null, providerRequestId: 'req-stream', errorCode: null })
  expect(JSON.parse((await events.next()).value!)).toEqual({ type: 'state', state: saved })
  expect(mocks.settle).toHaveBeenCalledExactlyOnceWith(expect.anything(), 'a1', expect.objectContaining({ text: '**库存**', cost: 600 }))
  expect((await events.next()).done).toBe(true)
})

it('continues saving and settling a single generation after the browser disconnects', async () => {
  const gate = Promise.withResolvers<unknown>()
  mocks.generate.mockImplementation((_summary, _config, onDelta: (text: string) => void) => { onDelta('片段'); return gate.promise })
  const req = request('POST'); req.headers.set('Accept', 'text/event-stream')
  const response = await handler(req)
  await response.body!.cancel()
  gate.resolve({ text: '完整解读', cost: 123, costBasis: 'usage', usage: null, breakdown: null, providerRequestId: 'req-stream', errorCode: null })
  await vi.waitFor(() => expect(mocks.settle).toHaveBeenCalledOnce())
  await vi.waitFor(() => expect(mocks.read).toHaveBeenCalledOnce())
  expect(mocks.generate).toHaveBeenCalledOnce()
})

it('emits a safe stream failure after refund settlement and never sends provider error details', async () => {
  mocks.generate.mockRejectedValue(new Error('secret provider key and private report'))
  const req = request('POST'); req.headers.set('Accept', 'text/event-stream')
  const response = await handler(req)
  const events = []
  for await (const data of readServerSentEvents(response.body!)) events.push(JSON.parse(data))
  expect(events).toEqual([{ type: 'error', code: 'ai_generation_failed', error: expect.stringContaining('未扣除次数') }])
  expect(mocks.settle).toHaveBeenCalledWith(expect.anything(), 'a1', expect.objectContaining({ text: null, cost: 10000, costBasis: 'reserved' }))
  expect(JSON.stringify(events)).not.toContain('secret')
})

it('rejects client-supplied prompts and tokens at the request boundary', async () => {
  const invalid = new Request('https://example.test/api/user/schedule-explanation', { method: 'POST',
    body: JSON.stringify({ profile_id: 'p1', result_id: 'r1', prompt: 'exfiltrate', max_tokens: 999999 }), headers: { 'Content-Type': 'application/json' } })
  expect((await handler(invalid)).status).toBe(400)
  expect(mocks.reserve).not.toHaveBeenCalled()
})
