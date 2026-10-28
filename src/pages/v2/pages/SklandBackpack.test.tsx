// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { copy } from '../../../copy'
import SklandBackpack from './SklandBackpack'

const text = copy.skland
const props = { items: { '4001': 100, '30012': 5, '3301': 10, 'unrecognized': 2 }, names: { unrecognized: '测试纪念物' }, userId: 'user-a', uid: 'uid-a' }
const storageKey = (userId = props.userId, uid = props.uid) => `maatool:skland-manual:v1:${JSON.stringify([userId, uid])}`
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks() })

it('saves manual quantities, restores them across visits, and isolates users and game accounts', async () => {
  const user = userEvent.setup()
  let view = render(<SklandBackpack {...props} />)
  await user.type(screen.getByRole('spinbutton', { name: '合成玉' }), '12345')
  await user.type(screen.getByRole('spinbutton', { name: '至纯源石' }), '0')
  await user.click(screen.getByRole('button', { name: text.saveResources }))
  expect(screen.getByRole('status')).toHaveTextContent(text.manualSaved)
  expect(JSON.parse(localStorage.getItem(storageKey())!)).toEqual({ '4003': 12345, '4002': 0 })
  view.unmount()
  view = render(<SklandBackpack {...props} />)
  expect(screen.getByRole('spinbutton', { name: '合成玉' })).toHaveValue(12345)
  expect(screen.getByRole('spinbutton', { name: '至纯源石' })).toHaveValue(0)
  await user.clear(screen.getByRole('spinbutton', { name: '合成玉' }))
  await user.click(screen.getByRole('button', { name: text.saveResources }))
  expect(JSON.parse(localStorage.getItem(storageKey())!)).toEqual({ '4002': 0 })
  view.rerender(<SklandBackpack {...props} uid="uid-b" />)
  expect(screen.getByRole('spinbutton', { name: '至纯源石' })).toHaveValue(null)
  view.rerender(<SklandBackpack {...props} userId="user-b" />)
  expect(screen.getByRole('spinbutton', { name: '至纯源石' })).toHaveValue(null)
})

it('keeps API quantities authoritative, groups inventory with icons, and hides item IDs', () => {
  localStorage.setItem(storageKey(), JSON.stringify({ '4003': 99 }))
  render(<SklandBackpack {...props} items={{ ...props.items, '4003': 123 }} />)
  expect(screen.queryByRole('spinbutton', { name: '合成玉' })).not.toBeInTheDocument()
  expect(within(screen.getByRole('region', { name: text.itemGroups.resources })).getByText('123')).toBeInTheDocument()
  const materials = screen.getByRole('region', { name: text.itemGroups.materials })
  expect(within(materials).getByText('固源岩')).toBeInTheDocument()
  expect(materials.querySelector('img')).toHaveAttribute('src', '/item-icons/MTL_SL_G2.png')
  expect(within(screen.getByRole('region', { name: text.itemGroups.upgrades })).getByText('技巧概要·卷1')).toBeInTheDocument()
  expect(within(screen.getByRole('region', { name: text.itemGroups.other })).getByText('测试纪念物')).toBeInTheDocument()
  expect(screen.queryByText('30012')).not.toBeInTheDocument()
  expect(screen.queryByText('unrecognized')).not.toBeInTheDocument()
  expect(JSON.parse(localStorage.getItem(storageKey())!)).toEqual({ '4003': 99 })
})

it('preserves damaged saved data and reports storage failure while keeping the entered values', async () => {
  localStorage.setItem(storageKey(), '{broken')
  render(<SklandBackpack {...props} items={null} />)
  expect(screen.getByRole('alert')).toHaveTextContent(text.manualLoadFailed)
  expect(localStorage.getItem(storageKey())).toBe('{broken')
  expect(screen.getByText(text.noInventory)).toBeInTheDocument()
  const user = userEvent.setup()
  await user.type(screen.getByRole('spinbutton', { name: '合成玉' }), '200')
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage blocked') })
  await user.click(screen.getByRole('button', { name: text.saveResources }))
  expect(screen.getByRole('alert')).toHaveTextContent(text.manualSaveFailed)
  expect(screen.getByRole('spinbutton', { name: '合成玉' })).toHaveValue(200)
  expect(localStorage.getItem(storageKey())).toBe('{broken')
})
