// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { copy } from '../../../copy'
import type { CultivationData } from '../../../lib/cultivation-contract'
import { MaterialNeeds } from './ProjectMaterials'

vi.mock('../../../lib/motion-preference', () => ({ useAppReducedMotion: () => true }))
afterEach(cleanup)
const text = copy.cultivationProjects

it('opens complete synthesis routes, follows later materials, and restores the original list and keyboard focus', async () => {
  const data = {
    itemNames: { '3243': '狙击双芯片', '3242': '狙击芯片组', '3252': '术师芯片组', '32001': '芯片助剂', '4006': '采购凭证', later: '后续材料', final: '最终材料' },
    recipes: { '3243': { count: 1, items: { '3242': 2, '32001': 1 } }, '3242': { count: 2, items: { '3252': 3 } }, '3252': { count: 2, items: { '3242': 3 } }, later: { count: 1, items: { '3243': 1 } }, final: { count: 1, items: { later: 1 } } },
    farms: { '3242': [{ stage: 'PR-B-2' }], '4006': [{ stage: 'AP-5' }] },
  } as unknown as CultivationData
  const user = userEvent.setup()
  render(<MaterialNeeds items={{ '3243': 4 }} data={data} />)
  await user.click(screen.getByRole('button', { name: text.viewMaterial('狙击双芯片') }))
  const route = await screen.findByRole('region', { name: text.materialRoute('狙击双芯片') })
  expect(within(route).getByText(text.requiredAmount('8'))).toBeInTheDocument()
  expect(within(route).getByText(text.requiredAmount('360'))).toBeInTheDocument()
  expect(within(route).getByText(text.farmSource('PR-B-2'))).toBeInTheDocument()
  expect(within(route).getByText(text.farmSource('AP-5'))).toBeInTheDocument()
  expect(within(route).getByText('最终材料')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: text.backToMaterials })).toHaveFocus()
  await user.click(within(route).getByRole('button', { name: text.viewMaterial('最终材料') }))
  await screen.findByRole('region', { name: text.materialRoute('最终材料') })
  await user.keyboard('{Escape}')
  const restored = await screen.findByRole('button', { name: text.viewMaterial('狙击双芯片') })
  expect(restored).toHaveFocus()
  expect(screen.queryByRole('region')).not.toBeInTheDocument()
  await user.click(restored)
  await user.click(await screen.findByRole('button', { name: text.backToMaterials }))
  expect(await screen.findByRole('button', { name: text.viewMaterial('狙击双芯片') })).toHaveFocus()
})
