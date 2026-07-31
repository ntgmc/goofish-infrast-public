// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

const featureState = vi.hoisted(() => ({
  status: 'ready' as 'loading' | 'ready' | 'error',
  meteredBilling: true,
}))
vi.mock('../lib/site-feature-context', () => ({
  useSiteFeatures: () => ({ status: featureState.status, features: { metered_billing: featureState.meteredBilling }, updatedAt: null, retry: vi.fn() }),
}))
import PricingPage from './PricingPage'

afterEach(() => {
  cleanup()
  featureState.status = 'ready'
  featureState.meteredBilling = true
})

describe('PricingPage', () => {
  it('renders the two public SKUs and full disclosure policy', () => {
    render(<MemoryRouter><PricingPage /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: '价格与权益' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '免费预览' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '单账号终身版 CDK' })).toBeInTheDocument()
    expect(screen.getByText('49 元')).toBeInTheDocument()
    expect(screen.queryByText('单次重置卡')).not.toBeInTheDocument()
    expect(screen.queryByText('Admin卡')).not.toBeInTheDocument()
    expect(screen.getByText(/长期更新.*维护同一账号/)).toBeInTheDocument()
    expect(screen.getByText(/干员归属、练度或干员池出现异常变化时可能先拦截/)).toBeInTheDocument()
    expect(screen.queryByText(/滚动 7 天窗口，最多成功更新 2 次/)).not.toBeInTheDocument()
    expect(screen.queryByText(/设备 Token、浏览器 User-Agent 和网络 IP 前缀/)).not.toBeInTheDocument()
    expect(screen.getByText(/2 个工作日内首次响应/)).toBeInTheDocument()
    const contactLinks = screen.getAllByRole('link', { name: '联系客服' })
    const supportPageLink = contactLinks.find((link) => link.getAttribute('href') === '/support')
    expect(supportPageLink).toHaveClass('hidden', 'items-center', 'sm:inline-flex')
    const table = screen.getByRole('table')
    expect(within(table).getByText('支持，保存到同一账号工作区')).toBeInTheDocument()
    expect(within(table).getByText('更换游戏账号')).toBeInTheDocument()
    expect(within(table).getByText('不支持自行更换；需人工核验')).toBeInTheDocument()
  })

  it('keeps support and home links in the compact mobile menu', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><PricingPage /></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: '更多操作' }))
    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: '联系客服' })).toHaveAttribute('href', '/support')
    expect(within(menu).getByRole('menuitem', { name: '返回首页' })).toHaveAttribute('href', '/')
  })

  it('hides metered prices and capabilities when metered billing is closed', () => {
    featureState.meteredBilling = false
    render(<MemoryRouter><PricingPage /></MemoryRouter>)
    expect(screen.getByText('暂未开放')).toBeInTheDocument()
    expect(screen.queryByText('600–900 积分/次')).not.toBeInTheDocument()
    expect(screen.queryByText(/按次档案包含高级版单次结果/)).not.toBeInTheDocument()
  })

  it.each([
    ['loading', '正在确认按次计费开放状态…'],
    ['error', '暂时无法确认按次计费开放状态'],
  ] as const)('fails closed while feature state is %s', (status, message) => {
    featureState.status = status
    render(<MemoryRouter><PricingPage /></MemoryRouter>)
    expect(screen.getByText(new RegExp(message))).toBeInTheDocument()
    expect(screen.queryByText('600–900 积分/次')).not.toBeInTheDocument()
  })
})
