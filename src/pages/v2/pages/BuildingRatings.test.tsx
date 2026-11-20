// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { buildingRatingCharacter, buildingRatingCombos } from '../../../lib/building-skill-ratings'
import { CONFIG_PRESETS } from '../../../lib/config'
import RouteLifecycle from '../../../components/RouteLifecycle'
import type { V2Session } from '../OptionsDrawer'
import BuildingRatings from './BuildingRatings'

const pack = buildingRatingCombos.find((combo) => combo.id === 'shamare')!
const operators = pack.variants[0].members.map((member) => ({ id: member.id, name: buildingRatingCharacter(member.id).name, own: true, elite: member.elite, level: member.level, rarity: 4 }))
const session = {
  authStatus: 'authenticated', user: { id: 'user' }, activeProfile: { id: 'profile', display_name: '测试档案' },
  workspace: { operators, config: { ...CONFIG_PRESETS['243'], trading_station_levels: [3, 3] } },
} as unknown as V2Session

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('keeps typing focused without scrolling when search updates the route', async () => {
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { callback(0); return 1 })
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
  const user = userEvent.setup()
  const router = createMemoryRouter([{ path: '/v2', element: <><RouteLifecycle /><main tabIndex={-1} data-route-focus><BuildingRatings session={session} /></main></> }], { initialEntries: ['/v2?section=building-ratings'] })
  render(<RouterProvider router={router} />)
  scroll.mockClear()
  const search = screen.getByRole('searchbox', { name: '搜索干员或组合' })
  await user.type(search, '明椒')
  expect(search).toHaveValue('明椒')
  expect(search).toHaveFocus()
  expect(scroll).not.toHaveBeenCalled()
  await act(async () => router.navigate('/v2?section=building-ratings&kind=combo&q=凛视'))
  expect(search).toHaveValue('凛视')
  await act(async () => router.navigate(-1))
  expect(search).toHaveValue('明椒')
  await act(async () => router.navigate(1))
  expect(search).toHaveValue('凛视')
})

it('keeps filters cleared when another edit arrives before the route transition has rendered', async () => {
  render(<MemoryRouter initialEntries={['/v2?section=building-ratings&kind=single&room=power&grade=S']}><BuildingRatings session={session} /></MemoryRouter>)
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: '清空筛选' }))
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索干员或组合' }), { target: { value: '明椒' } })
  })
  expect(await screen.findByText('明椒', { selector: '.v2-rating-identity > strong' })).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: '设施' })).toHaveValue('')
  expect(screen.getByRole('combobox', { name: '等级' })).toHaveValue('')
})

it('requires grade and readiness to match the same variant instead of combining different variants', () => {
  const snowsant = buildingRatingCombos.find((combo) => combo.id === 'snowsant')!.variants.find((variant) => variant.score === 96)!
  const matched = { ...session, workspace: { ...session.workspace!, operators: snowsant.members.map((member) => ({ id: member.id, name: buildingRatingCharacter(member.id).name, own: true, elite: member.elite, level: member.level, rarity: 4 })) } }
  render(<MemoryRouter initialEntries={['/v2?section=building-ratings&kind=combo&q=雪雉&grade=S&owned=ready']}><BuildingRatings session={matched} /></MemoryRouter>)
  // The SSS Proviso variant is usable, while the S variant needs unowned Heidi.
  expect(screen.getByText('没有匹配的项目，试试其他干员、用途或等级。')).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: '设施' })).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: '档案对照' })).toBeEnabled()
})

it('renders the matched package and retains the profile on a related-combination link', async () => {
  const page = render(<MemoryRouter initialEntries={['/v2?section=building-ratings&kind=combo&q=巫恋&grade=SSS&owned=ready']}><BuildingRatings session={session} /></MemoryRouter>)
  expect(page.container.querySelector('#rating-shamare')).toBeInTheDocument()
  page.unmount()
  render(<MemoryRouter initialEntries={['/v2?section=building-ratings&profile_id=profile&q=明椒']}><BuildingRatings session={session} /></MemoryRouter>)
  await userEvent.click(screen.getByRole('button', { name: '查看明椒的评级详情' }))
  expect(screen.getByRole('link', { name: '巫恋大单组' })).toHaveAttribute('href', expect.stringContaining('profile_id=profile'))
})

it('opens the matching variant and releases the modal before another card is opened', async () => {
  const user = userEvent.setup()
  render(<MemoryRouter initialEntries={['/v2?section=building-ratings&kind=combo&q=巫恋&grade=SSS&owned=ready']}><BuildingRatings session={session} /></MemoryRouter>)
  const card = screen.getByRole('button', { name: '查看巫恋大单组的评级详情' })
  await user.click(card)
  expect(screen.getByRole('dialog', { name: '巫恋大单组' })).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: '组合变体' })).toHaveValue('0')
  expect(screen.getAllByRole('region', { name: /变体/ })).toHaveLength(1)
  await user.selectOptions(screen.getByRole('combobox', { name: '组合变体' }), '3')
  expect(screen.getByRole('region', { name: '变体 4' })).toHaveTextContent('明椒')
  const heading = screen.getByRole('dialog').querySelector('header')!
  expect(within(heading).getByAltText('明椒')).toBeInTheDocument()
  await user.selectOptions(screen.getByRole('combobox', { name: '组合变体' }), '10')
  expect(within(heading).getByText('87 分')).toBeInTheDocument()
  expect(within(heading).queryByText('98 分')).not.toBeInTheDocument()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(card).toHaveFocus()
  await user.click(card)
  expect(screen.getByRole('combobox', { name: '组合变体' })).toHaveValue('0')
})
