// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CultivationPlanPage from './CultivationPlanPage'
import Cultivation from './v2/pages/Cultivation'
import type { CultivationData } from '../lib/cultivation-contract'
import { copy } from '../copy'

const text = copy.tools.cultivation
const mocks = vi.hoisted(() => ({ api: vi.fn(), session: vi.fn(), snapshot: vi.fn(), refresh: vi.fn() }))
vi.mock('../hooks/useSklandSnapshot', () => ({ useSklandSnapshot: mocks.snapshot }))
vi.mock('../lib/api-client', () => ({ apiJson: mocks.api }))
vi.mock('./tool/useToolSession', () => ({ useToolSession: mocks.session }))
vi.mock('../components/ThemeSwitcher', () => ({ default: () => null }))

const sample = (): CultivationData => ({
  candidates: [
    { key: 'a', operatorId: 'a', name: '银灰', skillId: 's1', current: { elite: 0, level: 1, skillLevel: 1, masteries: {}, modules: {}, potential: 1 }, target: { elite: 1, level: 1, skill: 1, skillLevel: 7, moduleId: null, moduleLevel: 0, potential: 1 }, frequency: 10, fixedFrequency: 10, stageCount: 3, examples: [123], items: { rock: 3 }, warnings: [], satisfied: false },
    { key: 'b', operatorId: 'b', name: '桃金娘', skillId: 's1', current: { elite: 0, level: 1, skillLevel: 1, masteries: {}, modules: {}, potential: 1 }, target: { elite: 1, level: 1, skill: 1, skillLevel: 7, moduleId: null, moduleLevel: 0, potential: 1 }, frequency: 2, fixedFrequency: 2, stageCount: 1, examples: [456], items: { rock: 1 }, warnings: [], satisfied: false },
  ], inventory: { rock: 1 }, recipes: {}, prices: { rock: 5 }, itemNames: { rock: '源岩' }, farms: { rock: [{ stage: '1-7', sanity: 6, quantity: 1, days: [1, 2, 3, 4, 5, 6, 7] }] },
  potions: [{ key: 'p', name: '应急理智合剂', count: 1, sanity: 60, expiresAt: null }], stats: { homeworks: 10, owned: 2, missingOperators: 0, incomplete: 0 }, warnings: [], updatedAt: '2026-10-04T00:00:00Z', importedAt: '2026-10-04T00:00:00Z', pricingStatus: 'fresh',
})

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  mocks.snapshot.mockReturnValue({ data: null, busy: false, error: '', refresh: mocks.refresh })
  mocks.session.mockReturnValue({ authLoading: false, authStatus: 'authenticated', activeProfile: { id: 'one' }, profiles: [{ id: 'one', display_name: '档案一', status: 'active', skland_binding: {} }, { id: 'two', display_name: '档案二', status: 'active', skland_binding: {} }] })
  mocks.api.mockResolvedValue(sample())
})
afterEach(cleanup)

const content = (v2: boolean) => <MemoryRouter>{v2 ? <Cultivation session={mocks.session()} /> : <CultivationPlanPage />}</MemoryRouter>

describe('homework training recommendations', () => {
  it('recalculates from shared snapshot versions without refreshing upstream or replacing input drafts', async () => {
    mocks.snapshot.mockReturnValue({ data: { version: '1' }, busy: false, error: '', refresh: mocks.refresh })
    const page = render(content(false))
    await screen.findByRole('heading', { name: text.suggestions })
    fireEvent.click(screen.getByText(text.parameters))
    fireEvent.change(screen.getByRole('spinbutton', { name: text.limit }), { target: { value: '12' } })
    mocks.snapshot.mockReturnValue({ data: { version: '2' }, busy: false, error: '', refresh: mocks.refresh })
    page.rerender(content(false))
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2))
    expect(mocks.refresh).not.toHaveBeenCalled()
    expect(screen.getByRole('spinbutton', { name: text.limit })).toHaveValue(12)
  })

  it.each([false, true])('recommends from homework and imports targets without material or calendar UI in V2=%s', async (v2) => {
    mocks.session.mockReturnValue({ ...mocks.session(), user: { id: 'doctor' } })
    render(content(v2))
    fireEvent.click(screen.getByRole('button', { name: copy.skland.refresh }))
    await screen.findByRole('button', { name: copy.cultivationProjects.importBatch })
    expect(screen.getAllByRole('heading', { level: 3 })[0]).toHaveTextContent('银灰')
    expect(screen.queryByText('源岩', { exact: false })).not.toBeInTheDocument()
    expect(screen.queryByText(/缺口等效理智|预计材料备齐|每日刷取安排|本次培养材料统计/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByText(text.parameters))
    expect(screen.queryByRole('spinbutton', { name: '每日可用理智' })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: '满足材料优先' })).not.toBeInTheDocument()
    expect(screen.queryByText('使用仓库理智药')).not.toBeInTheDocument()
    const limit = screen.getByRole('spinbutton', { name: text.limit })
    fireEvent.change(limit, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: text.apply }))
    expect(screen.getByText(text.invalidSettings)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: copy.cultivationProjects.importSuggestion })).toHaveLength(2)
    fireEvent.change(limit, { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: text.apply }))
    expect(screen.getAllByRole('button', { name: copy.cultivationProjects.importSuggestion })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: copy.cultivationProjects.importBatch }))
    expect(await screen.findByText(copy.cultivationProjects.imported(1, 0))).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('maatool:cultivation-projects:doctor:one')!)).toHaveLength(1)
    expect(mocks.api).toHaveBeenCalledOnce()
  })

  it.each([false, true])('keeps training voucher recommendations while omitting material-package deficit analysis in V2=%s', async (v2) => {
    const input = sample()
    input.specialItems = [
      { id: 'materials', name: '材料自选包', iconId: 'pack', count: 2, scope: '领取材料', kind: 'materials', expiresAt: null, available: true, sourceUrl: 'https://prts.wiki/w/test', recommendations: [] },
      { id: 'voucher', name: '特训邀请函', iconId: 'voucher', count: 1, scope: '提升精英阶段', kind: 'elite', expiresAt: null, available: true, sourceUrl: 'https://prts.wiki/w/test', recommendations: [{ key: 'a', operatorId: 'a', name: '银灰', demand: 10, communityRate: 0.8, items: { rock: 3 }, warnings: [] }] },
    ]
    mocks.api.mockResolvedValueOnce(input)
    render(content(v2))
    fireEvent.click(screen.getByRole('button', { name: copy.skland.refresh }))
    if (v2) fireEvent.click(await screen.findByRole('button', { name: text.views.special }))
    fireEvent.click(await screen.findByRole('button', { name: /特训邀请函.*库存 1 份/ }))
    expect(screen.queryByRole('button', { name: /材料自选包/ })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: text.specialRecommendations }).nextElementSibling).toHaveTextContent('银灰')
    expect(screen.queryByText(/等效理智/)).not.toBeInTheDocument()
  })

  it.each([false, true])('lets users choose selector versions without claiming package stock in V2=%s', async (v2) => {
    const input = sample()
    const selector = { id: 'selector', name: '干员调用凭证', iconId: 'selector', count: null, scope: '可选择能天使、推进之王', kind: 'selector' as const, expiresAt: null, available: true, sourceUrl: 'https://prts.wiki/w/test', recommendations: [
      { key: 'owned', operatorId: 'owned', name: '能天使', owned: true, demand: 100, communityRate: 0.9, items: {}, warnings: [] },
      { key: 'new', operatorId: 'new', name: '推进之王', owned: false, demand: 1, communityRate: 0.5, items: {}, warnings: [] },
    ] }
    input.specialItems = [selector, { ...selector, id: 'selector2', scope: '可选择艾雅法拉', recommendations: [{ ...selector.recommendations[1], key: 'other', name: '艾雅法拉' }] }]
    mocks.api.mockResolvedValueOnce(input)
    render(content(v2))
    fireEvent.click(screen.getByRole('button', { name: copy.skland.refresh }))
    if (v2) fireEvent.click(await screen.findByRole('button', { name: text.views.special }))
    const first = await screen.findByRole('button', { name: /干员调用凭证.*可选择能天使、推进之王/ })
    const second = screen.getByRole('button', { name: /干员调用凭证.*可选择艾雅法拉/ })
    expect(first).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('heading', { name: text.specialRecommendations })).not.toBeInTheDocument()
    fireEvent.click(first)
    expect(first).toHaveAttribute('aria-pressed', 'true')
    const recommendations = screen.getByRole('heading', { name: text.specialRecommendations }).nextElementSibling!
    expect(within(recommendations as HTMLElement).getAllByRole('listitem')[0]).toHaveTextContent('推进之王')
    fireEvent.click(second)
    expect(first).toHaveAttribute('aria-pressed', 'false')
    expect(second).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { name: text.specialRecommendations }).nextElementSibling).toHaveTextContent('艾雅法拉')
    expect(screen.queryByText(/库存.*份|已过期|有效期至/)).not.toBeInTheDocument()
    expect(mocks.api).toHaveBeenCalledOnce()
  })

  it('restores URL filters, searches the full stage catalog, and applies a query with the current snapshot', async () => {
    const input = sample()
    input.recommendation = { query: { scope: 'history', days: 0, coverage: 0.8, stageId: '', activity: '', category: '', profession: '', rarity: 0, rarityGroup: 'high', search: '', includeClosed: false, includeAlternatives: true, includeUncertain: false }, families: 3, withoutActions: 0,
      stages: Array.from({ length: 1002 }, (_, index) => ({ id: `main_${index}`, name: `测试关卡${index}`, activity: '测试活动', category: '主线' })), professions: ['WARRIOR'] }
    mocks.api.mockResolvedValue(input)
    render(<MemoryRouter initialEntries={['/tools/cultivation-plan?cultivation_scope=history&cultivation_days=0']}><CultivationPlanPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: copy.skland.refresh }))
    await screen.findByRole('heading', { name: text.suggestions })
    expect(mocks.api.mock.calls[0][1].json.recommendation).toMatchObject({ scope: 'history', days: 0 })
    fireEvent.click(screen.getByText(text.parameters))
    fireEvent.click(screen.getByText(text.moreFilters))
    const stage = screen.getByRole('combobox', { name: text.stage })
    fireEvent.focus(stage)
    expect(screen.getAllByRole('option', { hidden: false }).filter((row) => row.tagName === 'LI')).toHaveLength(51)
    fireEvent.change(stage, { target: { value: '1001 main' } })
    fireEvent.keyDown(stage, { key: 'Enter' })
    expect(stage).toHaveValue('测试关卡1001')
    expect(mocks.api).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: text.apply }))
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2))
    expect(mocks.api.mock.calls[1][1].json).toMatchObject({ profile_id: 'one', recommendation: { stageId: 'main_1001', scope: 'history' } })
    fireEvent.click(screen.getByRole('button', { name: text.clearFilter(text.stage) }))
    expect(stage).toHaveValue('')
  })

  it.each([false, true])('keeps filters expanded when cleared and applies rarity groups in V2=%s', async (v2) => {
    const input = sample()
    Object.assign(input.candidates[0], {
      current: { elite: 2, level: 60, skillLevel: 7, masteries: { s1: 1 }, modules: {}, potential: 1 },
      target: { elite: 2, level: 50, skill: 1, skillLevel: 10, moduleId: 'mod_x', moduleLevel: null, potential: 1 }, moduleName: '测试模组',
      evidence: { status: 'current', families: 1224, recentFamilies: 10, recentStages: 3, usageShare: 1, coverage: 1, completeness: { training: 0.38, skill: 0.53, module: 0 } },
    })
    input.recommendation = { query: { scope: 'recent', days: 180, coverage: 0.8, stageId: '', activity: '', category: '', profession: '', rarity: 0, rarityGroup: 'high', search: '', includeClosed: false, includeAlternatives: true, includeUncertain: false }, families: 1, withoutActions: 0,
      stages: [{ id: 'main_01', name: '1-1', activity: '第一章', category: '主线' }], professions: [] }
    mocks.api.mockResolvedValue(input)
    render(content(v2))
    fireEvent.click(screen.getByRole('button', { name: copy.skland.refresh }))
    const conditions = (await screen.findByText(text.parameters)).closest('details')!
    expect(conditions.open).toBe(false)
    fireEvent.click(screen.getByText(text.parameters))
    const rarity = screen.getByRole('combobox', { name: text.rarity })
    expect(rarity).toHaveValue('high')
    const upgrades = screen.getAllByRole('list', { name: text.upgrades })[0]
    expect(upgrades).toHaveTextContent('1技能 · 专精3')
    expect(upgrades).toHaveTextContent('测试模组 · 1级')
    expect(upgrades).not.toHaveTextContent('精2 Lv.50')
    expect(screen.getAllByText('来源完整度：等级 38% · 技能 53% · 模组 0%')[0].closest('details')!.open).toBe(false)
    const disclosure = screen.getByText(text.moreFilters).closest('details')!
    fireEvent.click(screen.getByText(text.moreFilters))
    await waitFor(() => expect(disclosure.open).toBe(true))
    const search = within(disclosure).getByRole('textbox', { name: text.search })
    fireEvent.change(search, { target: { value: '银灰' } })
    fireEvent.change(search, { target: { value: '' } })
    expect(disclosure.open).toBe(true)
    const activity = screen.getByRole('combobox', { name: text.activity })
    fireEvent.focus(activity)
    fireEvent.change(activity, { target: { value: '第一章' } })
    fireEvent.keyDown(activity, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: text.clearFilter(text.activity) }))
    expect(disclosure.open).toBe(true)
    expect(activity).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('option', { name: '第一章' })).toBeInTheDocument()
    fireEvent.blur(activity)
    fireEvent.change(rarity, { target: { value: 'low' } })
    fireEvent.click(screen.getByRole('button', { name: text.apply }))
    await waitFor(() => expect(mocks.api).toHaveBeenCalledTimes(2))
    expect(mocks.api.mock.calls[1][1].json.recommendation).toMatchObject({ rarity: 0, rarityGroup: 'low' })
    fireEvent.click(screen.getByText(text.parameters))
    expect(conditions.open).toBe(false)
    expect(conditions.querySelector('summary')).toHaveTextContent('1–3星')
    fireEvent.click(screen.getByText(text.parameters))
    expect(rarity).toHaveValue('low')
  })

  it.each([false, true])('imports selected targets with their skill levels into the chosen profile in V2=%s', async (v2) => {
    mocks.session.mockReturnValue({ ...mocks.session(), user: { id: 'doctor' } })
    const input = sample()
    input.candidates[0].target = { ...input.candidates[0].target, elite: 2, level: 60, skill: 3, skillLevel: 10, moduleId: 'mod_x', moduleLevel: 3 }
    input.candidates[0].skillId = 's3'
    mocks.api.mockResolvedValue(input)
    render(content(v2))
    fireEvent.change(screen.getByRole('combobox', { name: text.profile }), { target: { value: 'two' } })
    fireEvent.click(screen.getByRole('button', { name: copy.skland.refresh }))
    fireEvent.click(await screen.findByRole('button', { name: copy.cultivationProjects.importBatch }))
    expect(await screen.findByText(copy.cultivationProjects.imported(2, 0))).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('maatool:cultivation-projects:doctor:two')!)).toEqual([
      { operatorId: 'a', elite: 2, level: 60, skill: 3, skillLevel: 10, paused: false, deadline: '' },
      { operatorId: 'b', elite: 1, level: 1, skill: 1, skillLevel: 7, paused: false, deadline: '' },
    ])
    expect(localStorage.getItem('maatool:cultivation-projects:doctor:one')).toBeNull()
    expect(screen.getByRole('link', { name: copy.cultivationProjects.openProjects })).toHaveAttribute('href', '/v2?section=cultivation-projects&profile_id=two')
    expect(screen.getAllByText(copy.cultivationProjects.importScopeHint).length).toBeGreaterThan(0)
    expect(mocks.api).toHaveBeenCalledOnce()
  })

  it('discards a late response when the selected profile changes', async () => {
    let finish: (value: CultivationData) => void = () => {}
    mocks.api.mockImplementationOnce(() => new Promise<CultivationData>((resolve) => { finish = resolve }))
    render(content(false))
    fireEvent.click(screen.getByRole('button', { name: copy.skland.refresh }))
    await waitFor(() => expect(mocks.api).toHaveBeenCalledOnce())
    fireEvent.change(screen.getByRole('combobox', { name: text.profile }), { target: { value: 'two' } })
    await act(async () => finish(sample()))
    await waitFor(() => expect(screen.queryByRole('heading', { name: text.suggestions })).not.toBeInTheDocument())
    expect(mocks.api.mock.calls[0][1].signal.aborted).toBe(true)
  })
})
