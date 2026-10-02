// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
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
import { cloneDefaultPublicContentSettings, PUBLIC_PRICING_PLAN_IDS } from '../lib/public-content'
import * as publicContentContext from '../lib/public-content-context'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  featureState.status = 'ready'
  featureState.meteredBilling = true
})

describe('PricingPage', () => {
  it('uses the configured manual upgrade listing and disables it when cleared', () => {
    const content = cloneDefaultPublicContentSettings()
    content.pricing.lifetime_upgrade = { purchase_url: 'https://example.com/lifetime-upgrade', service_fee: '5 元' }
    vi.spyOn(publicContentContext, 'usePublicContent').mockReturnValue({
      content,
      status: 'ready',
      isFallback: false,
      refresh: async () => undefined,
    })

    const { rerender } = render(<MemoryRouter><PricingPage /></MemoryRouter>)
    const link = screen.getByRole('link', { name: '前往闲鱼补差价' })
    expect(link).toHaveAttribute('href', 'https://example.com/lifetime-upgrade')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByText(/另收 5 元手续费/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '联系客服确认补款' })).toHaveAttribute('href', '/support')

    content.pricing.lifetime_upgrade.purchase_url = ''
    rerender(<MemoryRouter><PricingPage /></MemoryRouter>)
    expect(screen.queryByRole('link', { name: '前往闲鱼补差价' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '升级商品待上架' })).toBeDisabled()
  })

  it('shows automatic archive gifts and disables unconfigured purchases without using the global purchase URL', () => {
    render(<MemoryRouter><PricingPage /></MemoryRouter>)
    const buttons = screen.getAllByRole('button', { name: '暂未开放购买' })
    expect(buttons).toHaveLength(4)
    buttons.forEach((button) => {
      expect(button).toBeDisabled()
    })
    expect(screen.getAllByText('赠送 1 个封存资格，绑定后自动生效，续费不叠加。')).toHaveLength(3)
    expect(screen.getByText('赠送 3 个封存资格，绑定后自动生效。')).toBeInTheDocument()
  })

  it('links each plan to its own purchase URL and disables only cleared plans', () => {
    const content = cloneDefaultPublicContentSettings()
    const ids = PUBLIC_PRICING_PLAN_IDS.filter((id) => id !== 'free_preview')
    const labels = ['购买 30 天', '购买 90 天', '购买 365 天', '购买终身卡']
    ids.forEach((id) => { content.pricing.plans[id].purchase_url = `https://example.com/${id}` })
    vi.spyOn(publicContentContext, 'usePublicContent').mockReturnValue({
      content, status: 'ready', isFallback: false, refresh: async () => undefined,
    })
    const { rerender } = render(<MemoryRouter><PricingPage /></MemoryRouter>)
    ids.forEach((id, index) => {
      const link = screen.getByRole('link', { name: labels[index] })
      expect(link).toHaveAttribute('href', `https://example.com/${id}`)
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })
    content.pricing.plans.single_account_half_year.purchase_url = ''
    rerender(<MemoryRouter><PricingPage /></MemoryRouter>)
    expect(screen.queryByRole('link', { name: '购买 90 天' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '暂未开放购买' })).toBeDisabled()
    expect(screen.getByRole('link', { name: '购买 30 天' })).toBeInTheDocument()
  })

  it('hides metered prices and capabilities when metered billing is closed', () => {
    featureState.meteredBilling = false
    render(<MemoryRouter><PricingPage /></MemoryRouter>)
    expect(screen.getByText('暂未开放')).toBeInTheDocument()
    expect(screen.queryByText('1200–1800 积分/次')).not.toBeInTheDocument()
    expect(screen.queryByText(/按次档案包含高级版单次结果/)).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '积分如何扣除' })).not.toBeInTheDocument()
    expect(screen.queryByRole('table', { name: '商用等级与单次费用' })).not.toBeInTheDocument()
  })

  it.each([
    ['loading', '正在确认按次计费开放状态…'],
    ['error', '暂时无法确认按次排班是否开放，请稍后重试。'],
  ] as const)('fails closed while feature state is %s', (status, message) => {
    featureState.status = status
    render(<MemoryRouter><PricingPage /></MemoryRouter>)
    expect(screen.getByText(new RegExp(message))).toBeInTheDocument()
    expect(screen.queryByText('1200–1800 积分/次')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '商用版规则' })).not.toBeInTheDocument()
  })
})
