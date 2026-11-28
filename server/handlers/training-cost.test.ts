import { beforeEach, expect, it, vi } from 'vitest'
import type { UserGameAccountRecord } from '../storage/user-store'
import { attachTrainingCostsToUpgradeSuggestions } from './training-cost'
import { isUpgradeSuggestionCompleted } from '../../src/lib/upgrade-suggestion-completion'

const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), info: vi.fn(), character: vi.fn() }))
vi.mock('../skland-snapshot', async (load) => ({ ...await load<typeof import('../skland-snapshot')>(), getSklandSnapshot: mocks.snapshot }))
vi.mock('./skland-client', () => ({
  decryptSklandCredential: () => 'test',
  SklandClient: class {
    getCultivateInfo = mocks.info
    getCultivateCharacter = mocks.character
  },
}))
vi.mock('./material-value', async (load) => ({ ...await load<typeof import('./material-value')>(),
  getYituliuPricing: async () => ({ status: 'fresh', prices: new Map(), fetched_at: null, age_ms: 0, snapshot_id: 'test', valuation_version: 'test' }),
}))

const profile = { id: 'profile', user_id: 'user', skland_binding: { encrypted_cred: 'test' } } as UserGameAccountRecord
const params = { profile, operators: [{ id: 'char_test', name: '测试干员', rarity: 2, elite: 0, level: 1, own: true }],
  suggestions: [{ type: 'single', id: 'char_test', name: '测试干员', current: 0, target: 1, gain: 1 }] }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.info.mockResolvedValue({ items: {} })
  mocks.character.mockResolvedValue({ evolvePhaseCost: [{ items: [] }] })
})

it('reuses the current shared inventory and normalizes counts exactly as the backpack does', async () => {
  mocks.snapshot.mockResolvedValue({ inventory: { data: { items: [], characters: [] } } })
  const [before] = await attachTrainingCostsToUpgradeSuggestions(params)
  expect(before.training_cost).toMatchObject({ status: 'available', sources: { skland: 'ok' } })
  expect(before.training_cost.missing.cash).toBeGreaterThan(0)
  mocks.snapshot.mockResolvedValue({ inventory: { data: { data: {
    items: [{ itemId: '4001', have: '500000' }, { id: '4001', quantity: 500000 }, { itemId: '2004', quantity: '1000000' }],
    characters: [],
  } } } })
  const [after] = await attachTrainingCostsToUpgradeSuggestions(params)
  expect(after.training_cost).toMatchObject({ status: 'available', missing: { cash: 0, exp: 0, materials: [], equivalent_sanity: 0 } })
  expect(mocks.snapshot).toHaveBeenLastCalledWith(profile, ['inventory'])
  expect(params.suggestions[0]).not.toHaveProperty('training_cost')
})

it.each([1, 2])('recognizes refreshed elite %s as completing an old elite-one suggestion', async (elite) => {
  mocks.snapshot.mockResolvedValue({ inventory: { data: { items: [],
    characters: [{ id: 'char_test', evolvePhase: elite, level: 1 }],
  } } })
  const [result] = await attachTrainingCostsToUpgradeSuggestions({ ...params, operators: [{ ...params.operators[0], rarity: 3 }] })
  expect(result.training_cost.operators[0]).toMatchObject({ current_elite: elite, totals: { cash: 0, exp: 0, materials: [] } })
  expect(isUpgradeSuggestionCompleted(result)).toBe(true)
})

it.each(['expired', 'malformed'])('keeps %s inventory unavailable instead of treating it as empty stock', async (reason) => {
  if (reason === 'expired') mocks.snapshot.mockRejectedValueOnce(new Error('库存过期'))
  else mocks.snapshot.mockResolvedValueOnce({ inventory: { data: { items: [{ id: '4001', count: -1 }] } } })
  const [result] = await attachTrainingCostsToUpgradeSuggestions(params)
  expect(result.training_cost).toMatchObject({ status: 'unavailable', sources: { skland: 'unavailable' } })
  expect(mocks.character).not.toHaveBeenCalled()
})
