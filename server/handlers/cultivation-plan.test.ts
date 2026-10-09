import { beforeEach, describe, expect, it, vi } from 'vitest'
import handler from './cultivation-plan'
import { planningFixture } from '../../scripts/prts-planning-fixture.mjs'
import { prtsSnapshotSchema } from '../cultivation/catalog'

const mocks = vi.hoisted(() => ({ session: vi.fn(), snapshot: vi.fn(), player: vi.fn(), inventory: vi.fn(), pricing: vi.fn(), gate: vi.fn() }))
vi.mock('./user-auth', () => ({ requireUserSession: mocks.session, jsonResponse: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }) }))
vi.mock('../feature-gate', () => ({ requireSiteFeatures: mocks.gate }))
vi.mock('../cultivation/references', () => ({ getCultivationStatistics: async () => ({ status: 'unavailable', updatedAt: null, operators: {} }) }))
vi.mock('../cultivation/special-items', async (original) => ({ ...await original<typeof import('../cultivation/special-items')>(), getSpecialItemCatalog: async () => ({ parserVersion: 4, status: 'fresh', updatedAt: '', items: [], itemNames: {}, itemIcons: {}, excludedOperators: [], skillIcons: {} }) }))
vi.mock('../cultivation/catalog', async (original) => ({ ...await original<typeof import('../cultivation/catalog')>(), readPrtsSnapshot: mocks.snapshot }))
vi.mock('./material-value', async (original) => ({ ...await original<typeof import('./material-value')>(), getYituliuPricing: mocks.pricing }))
vi.mock('./skland-client', () => ({
  decryptSklandCredential: () => 'private-credential',
  SklandClientError: class extends Error {},
  SklandClient: class { getGamePlayerInfo = mocks.player; getCultivatePlayer = mocks.inventory },
}))

const request = (body: unknown = { profile_id: 'mine' }) => new Request('http://local/api/cultivation-plan', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.gate.mockResolvedValue(null)
  mocks.session.mockResolvedValue({ profiles: [{ id: 'mine', status: 'active', skland_binding: { uid: 'player-uid', encrypted_cred: 'encrypted' } }] })
  mocks.snapshot.mockResolvedValue(prtsSnapshotSchema.parse(planningFixture()))
  mocks.player.mockResolvedValue({ data: { chars: [{ charId: 'char_test', evolvePhase: 0, level: 1, mainSkillLvl: 1, skills: [{ skillId: 's1', specializeLevel: 0 }], equip: [], potentialRank: 0 }] } })
  mocks.inventory.mockResolvedValue({ items: [{ id: 'rock', count: 2 }] })
  mocks.pricing.mockResolvedValue({ status: 'fresh', prices: new Map([['rock', 5], ['book', 2]]), fetched_at: '', age_ms: 0, snapshot_id: '', valuation_version: '' })
})

describe('cultivation planning authorization and data boundary', () => {
  it('requires a session and never reads an unrelated profile or upstream data', async () => {
    mocks.session.mockResolvedValueOnce(null)
    expect((await handler(request())).status).toBe(401)
    expect((await handler(request({ profile_id: 'someone-else' }))).status).toBe(404)
    expect(mocks.player).not.toHaveBeenCalled()
  })

  it('rejects invalid inputs, archived profiles, and unavailable seed data', async () => {
    expect((await handler(request({ profile_id: 'mine', mode: 'invalid' }))).status).toBe(400)
    expect((await handler(request({ profile_id: 'mine', recommendation: { scope: 'invalid' } }))).status).toBe(400)
    expect((await handler(request({ profile_id: 'mine', recommendation: { coverage: 2 } }))).status).toBe(400)
    mocks.session.mockResolvedValueOnce({ profiles: [{ id: 'mine', status: 'active', archived_at: '2026-01-01' }] })
    expect((await handler(request())).status).toBe(403)
    mocks.snapshot.mockRejectedValueOnce(new Error('ENOENT'))
    const unavailable = await handler(request())
    expect(unavailable.status).toBe(503)
    expect(await unavailable.json()).toMatchObject({ code: 'prts_data_unavailable' })
    expect(mocks.player).not.toHaveBeenCalled()
  })

  it('returns current cultivation data without UID or credentials and disables response caching', async () => {
    const response = await handler(request({ profile_id: 'mine', recommendation: { stageId: 'main_01' } }))
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const text = await response.text()
    expect(text).not.toContain('private-credential')
    expect(text).not.toContain('player-uid')
    expect(JSON.parse(text).recommendation.query).toMatchObject({ stageId: 'main_01', coverage: 0.8 })
    expect(JSON.parse(text).candidates[0]).toMatchObject({ operatorId: 'char_test', items: { rock: 2, book: 6, exp: 300, '4001': 130 } })
  })
})
