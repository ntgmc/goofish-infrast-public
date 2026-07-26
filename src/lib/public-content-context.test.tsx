// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { cloneDefaultPublicContentSettings } from './public-content'
import { getSku } from './product-catalog'

const apiJson = vi.hoisted(() => vi.fn())
vi.mock('./api-client', () => ({ apiJson }))

import { PublicContentProvider, usePublicContent } from './public-content-context'
import PricingPage from '../pages/PricingPage'

describe('PublicContentProvider', () => {
  beforeEach(() => apiJson.mockReset())
  afterEach(() => cleanup())

  it('replaces defaults with the server document', async () => {
    const server = cloneDefaultPublicContentSettings()
    server.qq_group.number = '123456789'
    apiJson.mockResolvedValue(server)
    render(<PublicContentProvider><Probe /></PublicContentProvider>)
    expect(await screen.findByText('123456789')).toBeInTheDocument()
  })

  it('keeps bundled defaults when the server document is invalid', async () => {
    apiJson.mockResolvedValue({ version: 0 })
    render(<PublicContentProvider><Probe /></PublicContentProvider>)
    expect(screen.getByText('891655477')).toBeInTheDocument()
    expect(await screen.findByText('ready')).toBeInTheDocument()
    expect(screen.getByText('891655477')).toBeInTheDocument()
  })

  it('overrides public pricing without changing the product catalog', async () => {
    const server = cloneDefaultPublicContentSettings()
    server.pricing.plans.single_account_lifetime.display_price = '88 元展示价'
    apiJson.mockResolvedValue(server)
    render(<PublicContentProvider><MemoryRouter><PricingPage /></MemoryRouter></PublicContentProvider>)
    expect(await screen.findByText('88 元展示价')).toBeInTheDocument()
    expect(getSku('single_account_lifetime').display_price).toBe('49 元')
  })
})

function Probe() {
  const { content, status } = usePublicContent()
  return <><span>{content.qq_group.number}</span><span>{status}</span></>
}
