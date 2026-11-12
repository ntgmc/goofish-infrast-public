// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { copy } from '../../../copy'
import type { CultivationData } from '../../../lib/cultivation-contract'
import { MaterialBrowser, MaterialButton, MaterialNeeds } from './ProjectMaterials'

vi.mock('../../../lib/motion-preference', () => ({ useAppReducedMotion: () => true }))
afterEach(cleanup)
const text = copy.cultivationProjects

it('keeps source materials mounted and returns focus to the selected occurrence after closing the dialog', async () => {
  const data = { itemNames: { rock: '固源岩' }, recipes: {}, farms: {} } as unknown as CultivationData
  const user = userEvent.setup()
  render(<MaterialBrowser data={data}>{(select) => <>
    <MaterialButton id="rock" count={1} data={data} onSelect={select} />
    <MaterialButton id="rock" count={2} data={data} onSelect={select} />
  </>}</MaterialBrowser>)
  const buttons = screen.getAllByRole('button', { name: text.viewMaterial('固源岩') })
  await user.click(buttons[1])
  const dialog = await screen.findByRole('dialog', { name: text.materialRoute('固源岩') })
  expect(buttons[0]).toBeInTheDocument()
  expect(buttons[1]).toBeInTheDocument()
  expect(within(dialog).getByRole('button', { name: copy.v2.close })).toHaveFocus()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(buttons[1]).toHaveFocus()
  expect(buttons[0]).not.toHaveFocus()
})

it('opens all recipe tiers in a dialog, keeps currencies in notes, follows products and closes back to the original material', async () => {
  const data = {
    itemNames: { '3243': '狙击双芯片', '3242': '狙击芯片组', '3252': '术师芯片组', '32001': '芯片助剂', '4006': '采购凭证', '4001': '龙门币', later: '后续材料', final: '最终材料' },
    recipes: { '3243': { count: 1, items: { '3242': 2, '32001': 1, '4001': 100 } }, '3242': { count: 2, items: { '3252': 3 } }, '3252': { count: 2, items: { '3242': 3 } }, later: { count: 1, items: { '3243': 1 } }, final: { count: 1, items: { later: 1 } } },
    farms: { '3242': [{ stage: 'PR-B-2' }], '4006': [{ stage: 'AP-5' }] },
  } as unknown as CultivationData
  const user = userEvent.setup()
  render(<MaterialNeeds items={{ '3243': 4 }} data={data} />)
  const opener = screen.getByRole('button', { name: text.viewMaterial('狙击双芯片') })
  await user.click(opener)
  const dialog = await screen.findByRole('dialog', { name: text.materialRoute('狙击双芯片') })
  expect(within(dialog).getByText(text.requiredAmount('8'))).toBeInTheDocument()
  expect(within(dialog).getByText('采购凭证 × 360')).toBeInTheDocument()
  expect(within(dialog).getByText('龙门币 × 400')).toBeInTheDocument()
  expect(within(dialog).queryByRole('button', { name: text.viewMaterial('龙门币') })).not.toBeInTheDocument()
  expect(within(dialog).getByText(text.farmSource('PR-B-2'))).toBeInTheDocument()
  expect(within(dialog).getByText(text.farmSource('AP-5'))).toBeInTheDocument()
  expect(within(dialog).getByRole('region', { name: text.routeDiagram })).toHaveAttribute('tabindex', '0')
  expect(within(dialog).getByText(text.lowTier)).toBeInTheDocument()
  expect(within(dialog).getByText(text.highTier)).toBeInTheDocument()
  await user.click(within(dialog).getByRole('button', { name: text.viewMaterial('最终材料') }))
  expect(await screen.findByRole('dialog', { name: text.materialRoute('最终材料') })).toBe(dialog)
  await user.keyboard('{Escape}')
  expect(opener).toHaveFocus()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await user.click(opener)
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: copy.v2.close }))
  expect(opener).toHaveFocus()
})
