// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
    expect(await screen.findByText('error')).toBeInTheDocument()
    expect(screen.getByText('fallback')).toBeInTheDocument()
    expect(screen.getByText('891655477')).toBeInTheDocument()
  })

  it('overrides public pricing without changing the product catalog', async () => {
    const server = cloneDefaultPublicContentSettings()
    server.pricing.plans.single_account_lifetime.original_price = '88 元 / 长期'
    server.pricing.plans.single_account_lifetime.discount_fold = 10
    apiJson.mockResolvedValue(server)
    render(<PublicContentProvider><MemoryRouter><PricingPage /></MemoryRouter></PublicContentProvider>)
    expect(await screen.findByText('88 元 / 长期')).toBeInTheDocument()
    expect((getSku('single_account_lifetime') as unknown as { original_display_price: string }).original_display_price).toBe('59 元 / 长期')
  })

  it('exposes fallback state on network failure and retries successfully', async () => {
    const user = userEvent.setup()
    const server = cloneDefaultPublicContentSettings()
    server.qq_group.number = '123456789'
    apiJson.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(server)
    render(<PublicContentProvider><Probe /></PublicContentProvider>)
    expect(await screen.findByText('error')).toBeInTheDocument()
    expect(screen.getByText('fallback')).toBeInTheDocument()
    expect(screen.getByText('891655477')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'refresh' }))
    expect(await screen.findByText('123456789')).toBeInTheDocument()
    expect(screen.getByText('remote')).toBeInTheDocument()
  })

  it('keeps the last remote document when refresh fails', async () => {
    const user = userEvent.setup()
    const server = cloneDefaultPublicContentSettings()
    server.qq_group.number = '123456789'
    apiJson.mockResolvedValueOnce(server).mockRejectedValueOnce(new Error('offline'))
    render(<PublicContentProvider><Probe /></PublicContentProvider>)
    expect(await screen.findByText('123456789')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'refresh' }))
    expect(await screen.findByText('error')).toBeInTheDocument()
    expect(screen.getByText('remote')).toBeInTheDocument()
    expect(screen.getByText('123456789')).toBeInTheDocument()
  })

  it('keeps the last remote document when a refresh returns an incompatible document', async () => {
    const user = userEvent.setup()
    const server = cloneDefaultPublicContentSettings()
    server.qq_group.number = '123456789'
    apiJson.mockResolvedValueOnce(server).mockResolvedValueOnce({ version: 0 })
    render(<PublicContentProvider><Probe /></PublicContentProvider>)
    expect(await screen.findByText('123456789')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'refresh' }))
    expect(await screen.findByText('error')).toBeInTheDocument()
    expect(screen.getByText('remote')).toBeInTheDocument()
    expect(screen.getByText('123456789')).toBeInTheDocument()
  })

  it('ignores an older request that resolves after a newer refresh', async () => {
    let resolveFirst!: (value: ReturnType<typeof cloneDefaultPublicContentSettings>) => void
    const first = new Promise<ReturnType<typeof cloneDefaultPublicContentSettings>>((resolve) => { resolveFirst = resolve })
    const newer = cloneDefaultPublicContentSettings()
    newer.qq_group.number = '222222222'
    apiJson.mockReturnValueOnce(first).mockResolvedValueOnce(newer)
    render(<PublicContentProvider><Probe /></PublicContentProvider>)
    await act(async () => screen.getByRole('button', { name: 'refresh' }).click())
    expect(await screen.findByText('222222222')).toBeInTheDocument()
    const older = cloneDefaultPublicContentSettings()
    older.qq_group.number = '111111111'
    await act(async () => resolveFirst(older))
    await waitFor(() => expect(screen.queryByText('111111111')).not.toBeInTheDocument())
    expect(screen.getByText('222222222')).toBeInTheDocument()
  })
})

function Probe() {
  const { content, status, isFallback, refresh } = usePublicContent()
  return <><span>{content.qq_group.number}</span><span>{status}</span><span>{isFallback ? 'fallback' : 'remote'}</span><button type="button" onClick={() => void refresh()}>refresh</button></>
}
