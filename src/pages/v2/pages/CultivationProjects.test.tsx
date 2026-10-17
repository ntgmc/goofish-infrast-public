// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { copy } from '../../../copy'
import { CONFIG_PRESETS } from '../../../lib/config'
import type { CultivationData } from '../../../lib/cultivation-contract'
import type { CultivationProject } from '../../../lib/cultivation-projects'
import type { V2Session } from '../OptionsDrawer'
import CultivationProjects from './CultivationProjects'
import UpgradeSuggestions from '../../../components/UpgradeSuggestions'
import type { UpgradeSuggestion } from '../../../lib/types'

const mocks = vi.hoisted(() => ({ api: vi.fn(), result: vi.fn() }))
vi.mock('../../../lib/api-client', () => ({ apiJson: mocks.api }))
vi.mock('../../tool/optimize/optimization-api', () => ({ fetchResultHistoryDetail: mocks.result }))
const text = copy.cultivationProjects
const data = (projects: CultivationProject[] = []): CultivationData => ({
  candidates: projects.map((project) => ({ operatorId: project.operatorId, key: project.operatorId, name: '测试干员',
    current: { elite: 0, level: 1, skillLevel: 1, masteries: {}, modules: {}, potential: 1 },
    target: { ...project, moduleId: null, moduleLevel: 0, potential: 1 }, skillId: 's1', items: { exp: 500, '4001': 900 },
    warnings: [], satisfied: false, frequency: 0, fixedFrequency: 0, stageCount: 0, examples: [] })),
  projectOperators: [{ id: 'char_test', name: '测试干员', rarity: 6, skills: ['s1'], maxLevels: [50, 80, 90],
    current: { elite: 0, level: 1, skillLevel: 1, masteries: {}, modules: {}, potential: 1 } }],
  inventory: {}, itemNames: { exp: '作战经验', '4001': '龙门币' }, prices: {}, recipes: {}, farms: {}, potions: [],
  stats: { homeworks: 0, owned: 1, missingOperators: 0, incomplete: 0 }, updatedAt: '2026-10-06T00:00:00Z', importedAt: '2026-10-06T00:00:00Z', pricingStatus: 'fresh', warnings: [],
})
function session(id = 'mine'): V2Session {
  return { user: { id: 'user1' }, authStatus: 'authenticated', authLoading: false, activeProfile: { id, display_name: id, status: 'active', skland_binding: {} },
    workspace: { profile_id: id, result_history: ['normal', 'temporary'].map((id) => ({ id, name: id, created_at: '2026-10-06T00:00:00Z', source: 'generated' })) },
    license: { permission: 'ultimate', config: CONFIG_PRESETS['243'] }, setConfigOverride: vi.fn(), configSyncStatus: 'idle',
  } as unknown as V2Session
}
beforeEach(() => {
  localStorage.clear()
  mocks.api.mockImplementation(async (_url, options) => data(options.json.projects))
  mocks.result.mockImplementation(async (_profile, id) => ({ id, config: CONFIG_PRESETS['243'], result: {
    daily_production: { manufacturing: { 'Battle Record': id === 'temporary' ? 0.5 : 0.1 }, trading: { LMD: id === 'temporary' ? 100 : 300 }, net: { 'Pure Gold': 0 } },
  } }))
})
afterEach(() => { cleanup(); vi.resetAllMocks() })

it('turns a selected goal into an income-linked route and changes configuration only on an explicit action', async () => {
  const user = userEvent.setup()
  const current = session()
  render(<MemoryRouter><CultivationProjects session={current} onConfig={vi.fn()} /></MemoryRouter>)
  await user.click(screen.getByRole('button', { name: text.import }))
  await user.selectOptions(await screen.findByRole('combobox', { name: text.operator }), 'char_test')
  await user.click(screen.getByRole('button', { name: text.add }))
  await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2))
  expect(screen.getByRole('combobox', { name: text.operator })).toHaveValue('')
  expect(screen.getByRole('button', { name: text.add })).toBeDisabled()
  const budget = screen.getByRole('spinbutton', { name: text.dailySanity })
  await user.clear(budget)
  await user.type(budget, '0')
  await user.selectOptions(screen.getByRole('combobox', { name: text.temporary }), 'temporary')
  expect(await screen.findByText(text.temporaryBetter(1))).toBeInTheDocument()
  expect(current.setConfigOverride).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: text.apply }))
  expect(current.setConfigOverride).toHaveBeenCalledWith(CONFIG_PRESETS['243'])
  expect(JSON.parse(localStorage.getItem('maatool:cultivation-projects:user1:mine')!)).toMatchObject([{ operatorId: 'char_test', elite: 2, level: 60, skillLevel: 7 }])
  expect(localStorage.getItem('maatool:cultivation-projects:user1:mine')).not.toContain('inventory')
  await user.click(screen.getByRole('button', { name: text.pause }))
  expect(screen.getByText(text.paused)).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: text.route })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: text.resume }))
  expect(await screen.findByRole('heading', { name: text.route })).toBeInTheDocument()
})

it('aborts the previous profile import and isolates saved goals when the account changes', async () => {
  let finish!: (result: CultivationData) => void
  let signal: AbortSignal | undefined
  mocks.api.mockImplementationOnce((_url, options) => { signal = options.signal; return new Promise<CultivationData>((resolve) => { finish = resolve }) })
  const user = userEvent.setup()
  const view = render(<MemoryRouter><CultivationProjects session={session('first')} onConfig={vi.fn()} /></MemoryRouter>)
  await user.click(screen.getByRole('button', { name: text.import }))
  view.rerender(<MemoryRouter><CultivationProjects session={session('second')} onConfig={vi.fn()} /></MemoryRouter>)
  expect(signal?.aborted).toBe(true)
  await act(async () => finish(data()))
  expect(screen.queryByRole('combobox', { name: text.operator })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: text.import })).toBeEnabled()
  expect(localStorage.getItem('maatool:cultivation-projects:user1:second')).toBeNull()
})

it('imports a bundle from training suggestions into an already mounted project page and preserves existing goals', async () => {
  const user = userEvent.setup()
  const saved: CultivationProject = { operatorId: 'char_saved', elite: 2, level: 90, skill: 3, skillLevel: 10, paused: true, deadline: '2026-11-01' }
  localStorage.setItem('maatool:cultivation-projects:user1:mine', JSON.stringify([saved]))
  const suggestion: UpgradeSuggestion = { type: 'bundle', name: '组合培养建议', gain: 1, ops: [
    { id: 'char_saved', name: '已有干员', target: 1 }, { id: 'char_test', name: '测试干员', target: 2 },
  ] }
  render(<MemoryRouter><CultivationProjects session={session()} onConfig={vi.fn()} /><UpgradeSuggestions suggestions={[suggestion]} projectScope={{ userId: 'user1', profileId: 'mine' }} /></MemoryRouter>)
  await user.click(screen.getByRole('button', { name: text.import }))
  await screen.findByRole('combobox', { name: text.operator })
  await user.click(screen.getByRole('button', { name: text.importSuggestion }))
  expect(await screen.findByText(text.imported(1, 1))).toBeInTheDocument()
  expect(screen.getByRole('link', { name: text.openProjects })).toHaveAttribute('href', '/v2?section=cultivation-projects&profile_id=mine')
  expect(screen.getByRole('button', { name: `${text.remove} 测试干员` })).toBeInTheDocument()
  expect(screen.getAllByText(text.pendingRefresh).length).toBeGreaterThan(0)
  const goals = JSON.parse(localStorage.getItem('maatool:cultivation-projects:user1:mine')!)
  expect(goals).toEqual([saved, { operatorId: 'char_test', elite: 2, level: 1, skill: 1, skillLevel: 1, paused: false, deadline: '' }])
  await user.click(screen.getByRole('button', { name: text.refresh }))
  await waitFor(() => expect(mocks.api).toHaveBeenLastCalledWith('/api/cultivation-plan', expect.objectContaining({ json: { profile_id: 'mine', projects: goals } })))
  await user.click(screen.getByRole('button', { name: text.importSuggestion }))
  expect(await screen.findByText(text.imported(0, 2))).toBeInTheDocument()
  expect(JSON.parse(localStorage.getItem('maatool:cultivation-projects:user1:mine')!)).toEqual(goals)
})

it('keeps imports in their own account and profile and reports storage failure without losing existing data', async () => {
  const user = userEvent.setup()
  const suggestions: UpgradeSuggestion[] = [{ type: 'single', name: '测试干员', id: 'char_test', target: 2, gain: 1 }]
  const original = '[broken'
  localStorage.setItem('maatool:cultivation-projects:user1:other', original)
  render(<MemoryRouter><CultivationProjects session={session()} onConfig={vi.fn()} /><UpgradeSuggestions suggestions={suggestions} projectScope={{ userId: 'user1', profileId: 'other' }} /></MemoryRouter>)
  await user.click(screen.getByRole('button', { name: text.importSuggestion }))
  expect(await screen.findByRole('alert')).toHaveTextContent(text.importFailed)
  expect(localStorage.getItem('maatool:cultivation-projects:user1:other')).toBe(original)
  expect(localStorage.getItem('maatool:cultivation-projects:user1:mine')).toBeNull()
  localStorage.removeItem('maatool:cultivation-projects:user1:other')
  await user.click(screen.getByRole('button', { name: text.importSuggestion }))
  expect(await screen.findByText(text.imported(1, 0))).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: `${text.remove} 测试干员` })).not.toBeInTheDocument()
  expect(localStorage.getItem('maatool:cultivation-projects:user1:mine')).toBeNull()
})
