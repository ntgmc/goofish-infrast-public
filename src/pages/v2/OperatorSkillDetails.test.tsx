// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it } from 'vitest'
import { copy } from '../../copy'
import { buildingRatingCharacter, buildingRatingCombos } from '../../lib/building-skill-ratings'
import type { LicenseOperator } from '../../lib/types'
import OperatorSkillDetails from './OperatorSkillDetails'
import { SAMPLE_CONFIG } from './sample-result'

const text = copy.v2.operatorManagement
const provs: LicenseOperator = { id: 'char_4032_provs', name: '但书', own: true, elite: 0, level: 1, rarity: 5 }
const peper: LicenseOperator = { id: 'char_4071_peper', name: '明椒', own: true, elite: 0, level: 1, rarity: 4 }
afterEach(cleanup)

it('defaults to actual unlocked training, lets future ratings be inspected, and refreshes the default after training changes', async () => {
  const user = userEvent.setup()
  const mount = (operator: LicenseOperator) => <MemoryRouter><OperatorSkillDetails operator={operator} operators={[operator]} config={SAMPLE_CONFIG} /></MemoryRouter>
  const page = render(mount(provs))
  const stage = screen.getByRole('combobox', { name: text.ratingStage('贸易站') })
  expect(stage).toHaveValue('0')
  expect(screen.queryByText('违约索赔·β')).not.toBeInTheDocument()
  const trained = { ...provs, elite: 2 }
  page.rerender(mount(trained))
  expect(stage).toHaveValue('1')
  expect(screen.getByText('违约索赔·β').closest('.v2-skill')).toHaveClass('v2-skill-active')
  page.rerender(mount(provs))
  await user.selectOptions(stage, '1')
  expect(screen.getByText('违约索赔·β').closest('.v2-skill')).toHaveClass('v2-skill-locked')
  expect(within(stage).getByRole('option', { selected: true })).toHaveTextContent(copy.buildingRatings.memberStates.locked)
})

it('uses the full roster for combo readiness while restricting every variant to the operator being inspected', async () => {
  const user = userEvent.setup()
  const shamare = buildingRatingCombos.find((combo) => combo.id === 'shamare')!
  const roster: LicenseOperator[] = shamare.variants.flatMap((variant) => variant.members).map((member) => ({ id: member.id, name: buildingRatingCharacter(member.id).name, own: true, elite: 2, level: 80, rarity: 5 }))
  render(<MemoryRouter><OperatorSkillDetails operator={peper} operators={[...roster.filter((operator) => operator.id !== peper.id), peper]} config={SAMPLE_CONFIG} /></MemoryRouter>)
  await user.click(screen.getByRole('tab', { name: copy.buildingRatings.combo }))
  const combo = screen.getByText(shamare.title).closest('details')!
  expect(combo.querySelector('.v2-rating-state')).toHaveTextContent(copy.buildingRatings.membersOwned)
  await user.click(within(combo).getByText(shamare.title))
  const picker = within(combo).getByRole('combobox', { name: copy.buildingRatings.chooseVariant })
  const variants = shamare.variants.filter((variant) => variant.members.some((member) => member.id === peper.id))
  expect(within(picker).getAllByRole('option')).toHaveLength(variants.length)
  expect(within(picker).getByRole('option', { selected: true })).toHaveTextContent('87 分')
  for (let index = 0; index < variants.length; index++) {
    await user.selectOptions(picker, String(index))
    expect(within(combo).getAllByText('明椒').length).toBeGreaterThan(0)
    expect(combo.querySelectorAll('.v2-rating-member')).toHaveLength(variants[index].members.length)
  }
})

it('keeps the inspected warehouse partner in the team while changing their companion', async () => {
  const user = userEvent.setup()
  const snake: LicenseOperator = { id: 'char_150_snakek', name: '蛇屠箱', own: true, elite: 0, level: 1, rarity: 4 }
  render(<MemoryRouter><OperatorSkillDetails operator={snake} operators={[snake]} config={SAMPLE_CONFIG} /></MemoryRouter>)
  await user.click(screen.getByRole('tab', { name: copy.buildingRatings.combo }))
  const combo = screen.getByText('红云仓库组').closest('details')!
  await user.click(within(combo).getByText('红云仓库组'))
  expect(within(combo).getByText('固定核心：')).toHaveTextContent('红云')
  const selectors = within(combo).getAllByRole('combobox', { name: /搭档/ })
  for (const selector of selectors) {
    const noir = within(selector).queryByRole('option', { name: /黑角/ })
    if (noir && !noir.hasAttribute('disabled')) { await user.selectOptions(selector, noir); break }
  }
  expect(within(combo).getByText('干员生产力 +76% · 仓库 +28 格')).toBeInTheDocument()
  expect(combo.querySelectorAll('.v2-rating-member')).toHaveLength(3)
  expect(within(combo).getAllByText('蛇屠箱').length).toBeGreaterThan(0)
})

it('offers only valid recipes when the inspected partner has a recipe-specific warehouse effect', async () => {
  const user = userEvent.setup()
  const click: LicenseOperator = { id: 'char_328_cammou', name: '卡达', own: true, elite: 1, level: 1, rarity: 4 }
  render(<MemoryRouter><OperatorSkillDetails operator={click} operators={[click]} config={SAMPLE_CONFIG} /></MemoryRouter>)
  await user.click(screen.getByRole('tab', { name: copy.buildingRatings.combo }))
  const combo = screen.getByText('红云仓库组').closest('details')!
  await user.click(within(combo).getByText('红云仓库组'))
  const recipe = within(combo).getByRole('combobox', { name: '生产配方' })
  expect(recipe).toHaveValue('exp')
  expect(within(recipe).getAllByRole('option')).toHaveLength(1)
  expect(within(recipe).getByRole('option')).toHaveTextContent('作战记录')
})

it('does not label an unowned operator’s skills as unlocked and keeps missing level distinct from locked', async () => {
  const user = userEvent.setup()
  const missing = { ...provs, own: false, elite: 2 }
  const page = render(<MemoryRouter><OperatorSkillDetails operator={missing} operators={[missing]} config={null} /></MemoryRouter>)
  await user.click(screen.getByRole('tab', { name: text.skillTab }))
  expect(screen.queryByText(/已解锁/)).not.toBeInTheDocument()
  expect(screen.getAllByText(/未拥有/).length).toBeGreaterThan(0)
  page.unmount()
  const robot: LicenseOperator = { id: 'char_286_cast3', name: 'Castle-3', elite: 0, own: true, rarity: 1 }
  render(<MemoryRouter><OperatorSkillDetails operator={robot} operators={[robot]} config={null} /></MemoryRouter>)
  const manufacture = screen.getByRole('region', { name: /制造站/ })
  expect(within(manufacture).getAllByText(copy.buildingRatings.memberStates.unknown, { exact: false }).length).toBeGreaterThan(0)
  expect(within(manufacture).queryByText(copy.buildingRatings.memberStates.locked)).not.toBeInTheDocument()
  cleanup()
  const durin: LicenseOperator = { id: 'char_501_durin', name: '杜林', elite: 0, own: true, rarity: 2 }
  render(<MemoryRouter><OperatorSkillDetails operator={durin} operators={[durin]} config={null} /></MemoryRouter>)
  const stages = screen.getByRole('combobox', { name: text.ratingStage('宿舍') })
  expect(within(stages).getByRole('option', { selected: true })).toHaveTextContent(copy.buildingRatings.memberStates.unknown)
  expect(screen.queryByText(text.currentRating)).not.toBeInTheDocument()
})
