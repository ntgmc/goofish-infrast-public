// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it } from 'vitest'
import { buildingRatingCharacter, buildingRatingCombos } from '../../../lib/building-skill-ratings'
import { CONFIG_PRESETS } from '../../../lib/config'
import type { V2Session } from '../OptionsDrawer'
import BuildingRatings from './BuildingRatings'

const pack = buildingRatingCombos.find((combo) => combo.id === 'shamare')!
const operators = pack.variants[0].members.map((member) => ({ id: member.id, name: buildingRatingCharacter(member.id).name, own: true, elite: member.elite, level: member.level, rarity: 4 }))
const session = {
  authStatus: 'authenticated', user: { id: 'user' }, activeProfile: { id: 'profile', display_name: '测试档案' },
  workspace: { operators, config: { ...CONFIG_PRESETS['243'], trading_station_levels: [3, 3] } },
} as unknown as V2Session

afterEach(cleanup)

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

it('renders the matched package and retains the profile on a related-combination link', () => {
  const page = render(<MemoryRouter initialEntries={['/v2?section=building-ratings&kind=combo&q=巫恋&grade=SSS&owned=ready']}><BuildingRatings session={session} /></MemoryRouter>)
  expect(page.container.querySelector('#rating-shamare')).toBeInTheDocument()
  page.unmount()
  render(<MemoryRouter initialEntries={['/v2?section=building-ratings&profile_id=profile&q=明椒']}><BuildingRatings session={session} /></MemoryRouter>)
  expect(screen.getByRole('link', { name: '巫恋大单组' })).toHaveAttribute('href', expect.stringContaining('profile_id=profile'))
})
