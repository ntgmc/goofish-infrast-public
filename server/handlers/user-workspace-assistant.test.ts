import { beforeEach, expect, it, vi } from 'vitest'
import handler from './user-workspace-assistant'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), profile: vi.fn(), authorization: vi.fn(), config: vi.fn(), read: vi.fn(), reserve: vi.fn(), settle: vi.fn(), generate: vi.fn() }))
vi.mock('./user-auth', () => ({ requireUserSession: mocks.auth, jsonResponse: (value: unknown, status = 200) => Response.json(value, { status }) }))
vi.mock('./profile-authorization', () => ({ resolveProfileAuthorization: mocks.authorization }))
vi.mock('../storage/user-store', () => ({ getProfileForUser: mocks.profile }))
vi.mock('../storage/ai-settings-store', () => ({ getScheduleExplanationConfig: mocks.config }))
vi.mock('../storage/schedule-explanation-store', () => ({ readScheduleExplanation: mocks.read, reserveScheduleExplanation: mocks.reserve, settleScheduleExplanation: mocks.settle }))
vi.mock('../schedule-explanation', () => ({ generateAiText: mocks.generate }))

const state = { explanation: null, pending: false, available: true, reason: null, credits: { service: 'cultivation', price: '3.00', charge: '3.00', available: '5.00' }, provider: '测试供应商' }
const body = { task: 'cultivation', profile_id: 'private-profile', question: '哪项最容易备齐？', candidates: [{ key: 'candidate-1', title: '练度目标', facts: ['缺两类材料'] }] }
const call = (value: unknown = body) => handler(new Request('https://site.test/api/user/workspace-assistant', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://site.test' }, body: JSON.stringify(value) }))
const generate = (text: string) => ({ text, cost: 700, costBasis: 'usage', usage: null, breakdown: null, errorCode: null, providerRequestId: 'req-1' })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ user: { id: 'private-user' } })
  mocks.profile.mockResolvedValue({ id: 'private-profile' })
  mocks.authorization.mockResolvedValue({ ok: true })
  mocks.config.mockResolvedValue({ enabled: true, reservation: 900, provider: '测试供应商' })
  mocks.read.mockResolvedValue(state)
  mocks.reserve.mockResolvedValue({ state, attemptId: 'a1' })
  mocks.generate.mockResolvedValue(generate('{"keys":["candidate-1"]}'))
})

it('checks ownership, request shape and points availability before sending anything to a provider', async () => {
  mocks.auth.mockResolvedValueOnce(null)
  expect((await call()).status).toBe(401)
  mocks.profile.mockResolvedValueOnce(null)
  expect((await call()).status).toBe(404)
  expect(mocks.profile).toHaveBeenCalledWith('private-user', 'private-profile')
  mocks.authorization.mockResolvedValueOnce({ ok: false, status: 403, code: 'profile_frozen' })
  expect((await call()).status).toBe(403)
  expect((await call({ ...body, candidates: [...body.candidates, ...body.candidates] })).status).toBe(400)
  expect(mocks.reserve).not.toHaveBeenCalled()
  const availability = await handler(new Request('https://site.test/api/user/workspace-assistant?profile_id=private-profile&task=cultivation'))
  expect(await availability.json()).toEqual(state)
  expect(mocks.reserve).not.toHaveBeenCalled()
  mocks.reserve.mockResolvedValueOnce({ state: { ...state, available: false, reason: 'balance' }, attemptId: null })
  expect(await (await call()).json()).toMatchObject({ reply: null, state: { reason: 'balance' } })
  expect(mocks.generate).not.toHaveBeenCalled()
})

it('checks the requested task on reads and blocks disabled tasks before reserving AI usage', async () => {
  const disabled = { ...state, available: false, reason: 'disabled' }
  mocks.config.mockImplementation(async (feature: string) => ({ enabled: feature === 'ai_change_summary' }))
  mocks.read.mockImplementation(async ({ config }) => config.enabled ? state : disabled)
  const read = (task: string) => handler(new Request(`https://site.test/api/user/workspace-assistant?profile_id=private-profile&task=${task}`))
  expect((await read('unknown')).status).toBe(400)
  expect(await (await read('comparison')).json()).toEqual(disabled)
  expect(await (await read('changes')).json()).toEqual(state)
  expect(await (await call()).json()).toEqual({ reply: null, state: disabled })
  expect(mocks.config.mock.calls.map(([feature]) => feature)).toEqual(['ai_goal_comparison', 'ai_change_summary', 'ai_cultivation_advisor'])
  expect(mocks.reserve).not.toHaveBeenCalled()
  expect(mocks.generate).not.toHaveBeenCalled()
})

it('sends the intended summary without identifiers and only returns candidate keys from that request', async () => {
  const valid = await call({ ...body, accepted_points: '3.00' })
  expect(mocks.reserve).toHaveBeenCalledWith(expect.objectContaining({ service: 'cultivation', acceptedPoints: '3.00' }))
  expect(await valid.json()).toMatchObject({ reply: { keys: ['candidate-1'] } })
  expect(mocks.generate).toHaveBeenCalledWith(JSON.stringify({ question: body.question, candidates: body.candidates }), expect.anything(), expect.stringContaining('不代表干员战斗强度'))
  expect(mocks.settle).toHaveBeenCalledWith(expect.objectContaining({ resultId: null }), 'a1', expect.objectContaining({ text: '{"keys":["candidate-1"]}', cost: 700 }))
  mocks.generate.mockResolvedValueOnce(generate('{"keys":["unknown"]}'))
  const unsupported = await call()
  expect(unsupported.status).toBe(502)
  expect(mocks.settle).toHaveBeenLastCalledWith(expect.anything(), 'a1', expect.objectContaining({ text: null, errorCode: 'incomplete_output', cost: 700 }))
})
