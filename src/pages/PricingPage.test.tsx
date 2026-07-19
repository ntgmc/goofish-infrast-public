// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import PricingPage from './PricingPage'

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
    expect(supportPageLink).toHaveClass('inline-flex', 'items-center')
    const table = screen.getByRole('table')
    expect(within(table).getByText('支持，保存到同一账号工作区')).toBeInTheDocument()
    expect(within(table).getByText('更换游戏账号')).toBeInTheDocument()
    expect(within(table).getByText('不支持自行更换；需人工核验')).toBeInTheDocument()
  })
})
