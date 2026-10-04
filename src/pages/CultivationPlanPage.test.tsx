// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CultivationPlanPage from './CultivationPlanPage'
import type { CultivationData } from '../lib/cultivation-contract'

const mocks = vi.hoisted(() => ({ api: vi.fn(), session: vi.fn() }))
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
  vi.clearAllMocks()
  mocks.session.mockReturnValue({ authLoading: false, authStatus: 'authenticated', activeProfile: { id: 'one' }, profiles: [{ id: 'one', display_name: '档案一', status: 'active', skland_binding: {} }, { id: 'two', display_name: '档案二', status: 'active', skland_binding: {} }] })
  mocks.api.mockResolvedValue(sample())
})
afterEach(cleanup)

describe('cultivation tool interactions', () => {
  it('recalculates recommendation order locally and leaves potions opt-in', async () => {
    render(<MemoryRouter><CultivationPlanPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: '导入森空岛练度与仓库' }))
    await screen.findByRole('heading', { name: '建议培养顺序' })
    expect(screen.getAllByRole('heading', { level: 3 })[0].textContent).toBe('银灰')
    fireEvent.click(screen.getByRole('radio', { name: '满足材料优先' }))
    expect(screen.getAllByRole('heading', { level: 3 })[0].textContent).toBe('银灰')
    fireEvent.click(screen.getByRole('button', { name: '更新规划' }))
    expect(screen.getAllByRole('heading', { level: 3 })[0].textContent).toBe('桃金娘')
    expect(screen.getByRole('spinbutton', { name: /应急理智合剂/ })).toHaveValue(0)
    expect(mocks.api).toHaveBeenCalledOnce()
  })

  it('keeps the current plan while numeric fields are cleared and typed, then applies once', async () => {
    render(<MemoryRouter><CultivationPlanPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: '导入森空岛练度与仓库' }))
    await screen.findByRole('heading', { name: '建议培养顺序' })
    const budget = screen.getByRole('spinbutton', { name: '每日可用理智' })
    const prior = screen.getByRole('heading', { name: '每日刷取安排' }).parentElement?.textContent
    for (const value of ['', '0', '00', '000']) {
      fireEvent.change(budget, { target: { value } })
      expect(screen.getByRole('heading', { name: '每日刷取安排' }).parentElement?.textContent).toBe(prior)
    }
    fireEvent.click(screen.getByRole('button', { name: '更新规划' }))
    expect(budget).toHaveValue(0)
    expect(screen.getByRole('heading', { name: '每日刷取安排' }).parentElement?.textContent).not.toBe(prior)
    expect(screen.queryByText('设置已调整，点击更新规划后生效。')).not.toBeInTheDocument()
    expect(mocks.api).toHaveBeenCalledOnce()
  })

  it('ranks material claims by the whole batch deficit and refreshes suggestions only with the plan', async () => {
    const input = sample()
    input.specialItems = [{ id: 'voucher', name: '材料自选包', iconId: 'voucher', count: 2, scope: '领取材料', kind: 'materials', expiresAt: null, available: true, sourceUrl: 'https://prts.wiki/w/test', recommendations: [
      { key: 'unused', name: '其他材料', items: { unused: 1 }, demand: 0, communityRate: 0, warnings: [] },
      { key: 'rock', name: '源岩', items: { rock: 3 }, demand: 0, communityRate: 0, warnings: [] },
    ] }]
    mocks.api.mockResolvedValueOnce(input)
    render(<MemoryRouter><CultivationPlanPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: '导入森空岛练度与仓库' }))
    await screen.findByRole('heading', { name: '仓库养成道具' })
    fireEvent.click(screen.getByRole('button', { name: /材料自选包.*库存 2 份/ }))
    expect(screen.getByText('每份可减少本次缺口等效理智 · 15')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '推荐使用与领取' }).nextElementSibling?.textContent).toMatch(/^1源岩/)
    fireEvent.change(screen.getByRole('spinbutton', { name: '本次培养人数' }), { target: { value: '1' } })
    expect(screen.getByText('每份可减少本次缺口等效理智 · 15')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '更新规划' }))
    expect(screen.getByText('每份可减少本次缺口等效理智 · 10')).toBeInTheDocument()
  })

  it('discards a late response when the selected profile changes', async () => {
    let finish: (value: CultivationData) => void = () => {}
    mocks.api.mockImplementationOnce(() => new Promise<CultivationData>((resolve) => { finish = resolve }))
    render(<MemoryRouter><CultivationPlanPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: '导入森空岛练度与仓库' }))
    fireEvent.change(screen.getByRole('combobox', { name: '游戏档案' }), { target: { value: 'two' } })
    await act(async () => finish(sample()))
    await waitFor(() => expect(screen.queryByRole('heading', { name: '建议培养顺序' })).not.toBeInTheDocument())
    expect(mocks.api.mock.calls[0][1].signal.aborted).toBe(true)
  })
})
