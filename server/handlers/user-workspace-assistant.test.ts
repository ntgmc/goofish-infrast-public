import { beforeEach, expect, it, vi } from 'vitest'
import handler from './user-workspace-assistant'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), profile: vi.fn(), authorization: vi.fn(), monthly: vi.fn(), config: vi.fn(), read: vi.fn(), reserve: vi.fn(), settle: vi.fn(), generate: vi.fn() }))
vi.mock('./user-auth', () => ({ requireUserSession: mocks.auth, jsonResponse: (value: unknown, status = 200) => Response.json(value, { status }) }))
vi.mock('./user-schedule-explanation', () => ({ hasMonthlyAiQuota: mocks.monthly }))
vi.mock('./profile-authorization', () => ({ resolveProfileAuthorization: mocks.authorization }))
vi.mock('../storage/user-store', () => ({ getProfileForUser: mocks.profile }))
vi.mock('../storage/ai-settings-store', () => ({ getScheduleExplanationConfig: mocks.config }))
vi.mock('../storage/schedule-explanation-store', () => ({ readScheduleExplanation: mocks.read, reserveScheduleExplanation: mocks.reserve, settleScheduleExplanation: mocks.settle }))
vi.mock('../schedule-explanation', () => ({ generateAiText: mocks.generate }))

const state = { explanation: null, pending: false, available: true, reason: null, quota: { kind: 'monthly', limit: 10, remaining: 10, resets_at: null }, provider: '测试供应商' }
const body = { task: 'cultivation', profile_id: 'private-profile', question: '哪项最容易备齐？', candidates: [{ key: 'candidate-1', title: '练度目标', facts: ['缺两类材料'] }] }
const call = (value: unknown = body) => handler(new Request('https://site.test/api/user/workspace-assistant', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://site.test' }, body: JSON.stringify(value) }))
const generate = (text: string) => ({ text, cost: 700, costBasis: 'usage', usage: null, breakdown: null, errorCode: null, providerRequestId: 'req-1' })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ user: { id: 'private-user' } })
  mocks.profile.mockResolvedValue({ id: 'private-profile' })
  mocks.authorization.mockResolvedValue({ ok: true })
  mocks.monthly.mockResolvedValue(true)
  mocks.config.mockResolvedValue({ reservation: 900, provider: '测试供应商' })
  mocks.read.mockResolvedValue(state)
  mocks.reserve.mockResolvedValue({ state, attemptId: 'a1' })
  mocks.generate.mockResolvedValue(generate('{"keys":["candidate-1"]}'))
})

it('checks ownership, request shape and quota before sending anything to a provider', async () => {
  mocks.auth.mockResolvedValueOnce(null)
  expect((await call()).status).toBe(401)
  mocks.profile.mockResolvedValueOnce(null)
  expect((await call()).status).toBe(404)
  expect(mocks.profile).toHaveBeenCalledWith('private-user', 'private-profile')
  mocks.authorization.mockResolvedValueOnce({ ok: false, status: 403, code: 'profile_frozen' })
  expect((await call()).status).toBe(403)
  expect((await call({ ...body, candidates: [...body.candidates, ...body.candidates] })).status).toBe(400)
  expect(mocks.reserve).not.toHaveBeenCalled()
  const availability = await handler(new Request('https://site.test/api/user/workspace-assistant?profile_id=private-profile'))
  expect(await availability.json()).toEqual(state)
  expect(mocks.reserve).not.toHaveBeenCalled()
  mocks.reserve.mockResolvedValueOnce({ state: { ...state, available: false, reason: 'quota' }, attemptId: null })
  expect(await (await call()).json()).toMatchObject({ reply: null, state: { reason: 'quota' } })
  expect(mocks.generate).not.toHaveBeenCalled()
})

it('sends the intended summary without identifiers and only returns candidate keys from that request', async () => {
  const valid = await call()
  expect(await valid.json()).toMatchObject({ reply: { keys: ['candidate-1'] } })
  expect(mocks.generate).toHaveBeenCalledWith(JSON.stringify({ question: body.question, candidates: body.candidates }), expect.anything(), expect.stringContaining('不代表干员战斗强度'))
  expect(mocks.settle).toHaveBeenCalledWith(expect.objectContaining({ monthly: true, resultId: null }), 'a1', expect.objectContaining({ text: '{"keys":["candidate-1"]}', cost: 700 }))
  mocks.generate.mockResolvedValueOnce(generate('{"keys":["unknown"]}'))
  const unsupported = await call()
  expect(unsupported.status).toBe(502)
  expect(mocks.settle).toHaveBeenLastCalledWith(expect.anything(), 'a1', expect.objectContaining({ text: null, errorCode: 'incomplete_output', cost: 700 }))
})
