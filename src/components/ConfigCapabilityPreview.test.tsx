// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { CONFIG_PRESETS, normalizeConfig } from '../lib/config'
import ConfigCapabilityPreview from './ConfigCapabilityPreview'

afterEach(cleanup)

it('shows the full configuration without allowing edits and preserves free controls', async () => {
  const user = userEvent.setup()
  const config = normalizeConfig(CONFIG_PRESETS['252'])
  const before = structuredClone(config)
  const onFreeAction = vi.fn()
  render(<MemoryRouter><ConfigCapabilityPreview config={config} enabled>
    <button onClick={onFreeAction}>免费配置操作</button>
  </ConfigCapabilityPreview></MemoryRouter>)
  const preview = screen.getByRole('group', { name: '高级配置只读预览' })
  expect(within(preview).getByRole('region', { name: '排班模式' })).toBeInTheDocument()
  expect(within(preview).getByRole('region', { name: '产物数量' })).toBeInTheDocument()
  const controls = preview.querySelectorAll('button, input, select')
  expect(controls.length).toBeGreaterThan(10)
  controls.forEach((control) => expect(control).toBeDisabled())
  const input = preview.querySelector('input')
  if (input) fireEvent.change(input, { target: { value: '99' } })
  expect(config).toEqual(before)
  expect(screen.getByRole('link', { name: '比较价格与权益' })).toHaveAttribute('href', '/pricing')
  await user.click(screen.getByRole('button', { name: '当前免费配置' }))
  await user.click(screen.getByRole('button', { name: '免费配置操作' }))
  expect(onFreeAction).toHaveBeenCalledOnce()
  expect(screen.queryByRole('group', { name: '高级配置只读预览' })).not.toBeInTheDocument()
})

it('keeps the paid editor available after the entitlement changes', () => {
  const config = normalizeConfig(CONFIG_PRESETS['243'])
  const view = render(<MemoryRouter><ConfigCapabilityPreview config={config} enabled><button>编辑配置</button></ConfigCapabilityPreview></MemoryRouter>)
  view.rerender(<MemoryRouter><ConfigCapabilityPreview config={config} enabled={false}><button>编辑配置</button></ConfigCapabilityPreview></MemoryRouter>)
  expect(screen.getByRole('button', { name: '编辑配置' })).toBeEnabled()
  expect(screen.queryByText('自定义基建 · 只读预览')).not.toBeInTheDocument()
})
