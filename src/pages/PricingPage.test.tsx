// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SITE_FEATURES } from '../lib/site-features'
import { copy } from '../copy'
import PricingPage from './PricingPage'
import { cloneDefaultPublicContentSettings, PUBLIC_PRICING_PLAN_IDS } from '../lib/public-content'
import * as publicContentContext from '../lib/public-content-context'

const featureState = vi.hoisted(() => ({ status: 'ready', meteredBilling: true }))
vi.mock('../lib/site-feature-context', () => ({
  useSiteFeatures: () => ({ status: featureState.status, features: { ...DEFAULT_SITE_FEATURES, metered_billing: featureState.meteredBilling }, updatedAt: null, retry: vi.fn() }),
}))
let content = cloneDefaultPublicContentSettings()
beforeEach(() => {
  content = cloneDefaultPublicContentSettings()
  vi.spyOn(publicContentContext, 'usePublicContent').mockImplementation(() => ({ content, status: 'ready', isFallback: false, refresh: async () => undefined }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); featureState.status = 'ready'; featureState.meteredBilling = true })

const text = copy.public

describe('public V2 pricing', () => {
  it('opens the configured upgrade listing and disables purchases when cleared', () => {
    content.pricing.lifetime_upgrade = { ...content.pricing.lifetime_upgrade, purchase_url: 'https://example.com/lifetime-upgrade', service_fee: '5 元' }
    const page = render(<MemoryRouter><PricingPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: text.pricing_upgrade_purchase }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByRole('link', { name: text.purchase.open })).toHaveAttribute('href', 'https://example.com/lifetime-upgrade')
    expect(dialog.getByRole('link', { name: text.purchase.open })).toHaveAttribute('rel', 'noopener noreferrer')
    expect(dialog.getByText(/另收 5 元手续费/)).toBeInTheDocument()
    expect(dialog.getByRole('link', { name: text.pricing_upgrade_contact })).toHaveAttribute('href', '/v2?section=support')
    fireEvent.click(screen.getByRole('button', { name: copy.v2.close }))
    content.pricing.lifetime_upgrade.purchase_url = ''
    page.rerender(<MemoryRouter><PricingPage /></MemoryRouter>)
    expect(screen.getByRole('button', { name: text.pricing_upgrade_unavailable })).toBeDisabled()
  })

  it('keeps archive gifts and unavailable purchase states visible', () => {
    render(<MemoryRouter><PricingPage /></MemoryRouter>)
    expect(screen.getAllByRole('button', { name: text.pricing_purchase_unavailable })).toHaveLength(4)
    expect(screen.getAllByText(text.pricing_cards.archive_gift(1)).length).toBeGreaterThanOrEqual(3)
    expect(screen.getAllByText(text.pricing_cards.archive_gift(3)).length).toBeGreaterThanOrEqual(1)
  })

  it('opens each configured plan with purchase terms and V2 redemption', () => {
    const ids = PUBLIC_PRICING_PLAN_IDS.filter((id) => id !== 'free_preview')
    ids.forEach((id) => { content.pricing.plans[id].purchase_url = `https://example.com/${id}` })
    render(<MemoryRouter><PricingPage /></MemoryRouter>)
    for (const id of ids) {
      const button = screen.getByRole('button', { name: text.pricing_purchase_labels[id] })
      expect(button).toHaveAccessibleDescription(expect.stringContaining(content.pricing.plans[id].account_scope))
      fireEvent.click(button)
      const dialog = within(screen.getByRole('dialog'))
      const link = dialog.getByRole('link', { name: text.purchase.open })
      expect(link).toHaveAttribute('href', `https://example.com/${id}`)
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
      expect(dialog.getByRole('link', { name: text.purchase.redeem_action })).toHaveAttribute('href', '/v2?section=add-account&mode=cdk')
      fireEvent.click(screen.getByRole('button', { name: copy.v2.close }))
    }
  })

  it.each(['loading', 'error', 'ready'])('keeps retired metered billing closed while %s', (status) => {
    featureState.status = status
    render(<MemoryRouter><PricingPage /></MemoryRouter>)
    expect(screen.queryByText(/积分|商用版|按次排班|按次计费/)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: text.pricing_choice.intro })).toBeInTheDocument()
  })
})
