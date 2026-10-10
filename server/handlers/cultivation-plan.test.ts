import { beforeEach, describe, expect, it, vi } from 'vitest'
import handler from './cultivation-plan'
import { CultivationReadError } from '../cultivation/worker-client'

const mocks = vi.hoisted(() => ({ session: vi.fn(), read: vi.fn(), gate: vi.fn() }))
vi.mock('./user-auth', () => ({ requireUserSession: mocks.session, jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }) }))
vi.mock('../feature-gate', () => ({ requireSiteFeatures: mocks.gate }))
vi.mock('../cultivation/worker-client', async (original) => ({ ...await original<typeof import('../cultivation/worker-client')>(), readCultivationPlan: mocks.read }))
vi.mock('./skland-client', () => ({ decryptSklandCredential: () => 'private-credential' }))

const request = (body: unknown = { profile_id: 'mine' }) => new Request('http://local/api/cultivation-plan', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.gate.mockResolvedValue(null)
  mocks.session.mockResolvedValue({ profiles: [{ id: 'mine', status: 'active', skland_binding: { uid: 'player-uid', encrypted_cred: 'encrypted' } }] })
  mocks.read.mockResolvedValue(new TextEncoder().encode(JSON.stringify({ candidates: [], recommendation: { query: { rarityGroup: 'high' } } })).buffer)
})

describe('cultivation planning authorization and data boundary', () => {
  it('requires a session and never reads an unrelated profile or upstream data', async () => {
    mocks.session.mockResolvedValueOnce(null)
    expect((await handler(request())).status).toBe(401)
    expect((await handler(request({ profile_id: 'someone-else' }))).status).toBe(404)
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it('rejects invalid inputs and archived profiles before starting a reader', async () => {
    for (const body of [{ profile_id: 'mine', mode: 'invalid' }, ...[{ scope: 'invalid' }, { coverage: 2 }, { rarityGroup: 'invalid' }].map((recommendation) => ({ profile_id: 'mine', recommendation }))]) {
      expect((await handler(request(body))).status).toBe(400)
    }
    mocks.session.mockResolvedValueOnce({ profiles: [{ id: 'mine', status: 'active', archived_at: '2026-01-01' }] })
    expect((await handler(request())).status).toBe(403)
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it.each([
    [503, 'prts_data_unavailable'], [503, 'cultivation_busy'], [503, 'cultivation_unavailable'], [504, 'cultivation_timeout'], [502, 'invalid_credential'],
  ])('returns a retryable HTTP boundary for reader failure %s/%s', async (status, code) => {
    mocks.read.mockRejectedValueOnce(new CultivationReadError('读取暂不可用。', status, code))
    const response = await handler(request())
    expect(response.status).toBe(status)
    expect(await response.json()).toMatchObject({ code })
  })

  it('passes filters and request cancellation to the isolated reader and keeps personal data uncached', async () => {
    const req = request({ profile_id: 'mine', recommendation: { stageId: 'main_01', rarityGroup: 'low' } })
    const response = await handler(req)
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(mocks.read).toHaveBeenCalledWith({ credential: 'private-credential', uid: 'player-uid',
      query: expect.objectContaining({ stageId: 'main_01', rarityGroup: 'low', coverage: 0.8 }),
    }, req.signal)
    const text = await response.text()
    expect(text).not.toContain('private-credential')
    expect(text).not.toContain('player-uid')
    expect(JSON.parse(text).candidates).toEqual([])
  })
})
