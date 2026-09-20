// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import PaidCapabilityPreview, { LockedResultPreview, LockedScenarioPreview } from './PaidCapabilityPreview'

afterEach(cleanup)

it('shows benefits by default and offers a working preview for every feature', async () => {
  const onOpen = vi.fn()
  const user = userEvent.setup()
  render(<MemoryRouter><PaidCapabilityPreview onOpen={onOpen} showScenarioLab /></MemoryRouter>)
  expect(screen.getByText('免费版够用，高级版更高效：按需解锁排班增强能力').closest('details')).toHaveAttribute('open')
  expect(screen.getAllByRole('button', { name: /^查看功能：/ })).toHaveLength(6)
  await user.click(screen.getByRole('button', { name: '查看功能：自定义基建与班次' }))
  expect(onOpen).toHaveBeenLastCalledWith('config')
  await user.click(screen.getByRole('button', { name: '查看功能：场景对比实验室' }))
  expect(onOpen).toHaveBeenLastCalledWith('lab')
  const recompute = screen.getByRole('button', { name: '查看功能：增量重算与优先处理' })
  await user.click(recompute)
  expect(recompute).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('button', { name: '增量重算与优先处理 · 高级版可用' })).toBeDisabled()
  expect(onOpen).toHaveBeenCalledTimes(2)
  await user.click(recompute)
  expect(recompute).toHaveAttribute('aria-expanded', 'false')
  await user.click(screen.getByRole('button', { name: '查看功能：MAA 干员识别文件导入' }))
  expect(screen.getByRole('button', { name: 'MAA 干员识别文件导入 · 高级版可用' })).toBeDisabled()
  expect(screen.getByText(/免费档案在高级体验期或使用导出体验券时/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '比较价格与权益' })).toHaveAttribute('href', '/pricing')
})

it('does not offer a lab destination when the service is disabled', async () => {
  const onOpen = vi.fn()
  render(<MemoryRouter><PaidCapabilityPreview onOpen={onOpen} showScenarioLab={false} /></MemoryRouter>)
  await userEvent.setup().click(screen.getByRole('button', { name: '查看功能：场景对比实验室' }))
  expect(screen.getByText('场景对比当前暂停开放，可先了解方案权益，恢复后再使用。')).toBeInTheDocument()
  expect(onOpen).not.toHaveBeenCalled()
})

it('shows a disabled scenario form and catalog quotas without starting a task', () => {
  render(<MemoryRouter><LockedScenarioPreview /></MemoryRouter>)
  expect(screen.getByRole('textbox', { name: '当前方案' })).toBeDisabled()
  expect(screen.getByRole('combobox', { name: '额外配置' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '运行场景对比' })).toBeDisabled()
  expect(screen.getByText('30 天含 1 次；90 天含 3 次；365 天含 8 次；终身卡不限次数。')).toBeInTheDocument()
})

it('shows export and ROI previews before a first result without fabricated metrics', () => {
  render(<MemoryRouter><LockedResultPreview /></MemoryRouter>)
  expect(screen.getByRole('button', { name: '下载完整计算 JSON' })).toBeDisabled()
  expect(screen.getByText('培养成本 / 每日产出提升 / 回本周期')).toBeInTheDocument()
  expect(screen.getByText('生成并完成分析后可查看实际数值')).toBeInTheDocument()
})
