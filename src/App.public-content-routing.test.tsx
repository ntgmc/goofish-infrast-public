// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cloneDefaultPublicContentSettings } from './lib/public-content'
import { DEFAULT_SITE_FEATURE_SETTINGS } from './lib/site-features'

const apiJson = vi.hoisted(() => vi.fn())
const apiVoid = vi.hoisted(() => vi.fn())
vi.mock('./lib/api-client', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/api-client')>(),
  apiJson,
  apiVoid,
}))
vi.mock('./pages/ToolPage', () => ({ default: () => null }))
vi.mock('./pages/DepotValuePage', () => ({ default: () => null }))
vi.mock('./pages/AdminSetupPage', () => ({ default: () => null }))
vi.mock('./pages/AdminPage', () => ({ default: () => null }))
vi.mock('./pages/v2/V2Page', () => ({ default: () => <main>V2 test workspace</main> }))

import App from './App'

describe('App public content routing', () => {
  beforeEach(() => {
    apiVoid.mockReset().mockResolvedValue(undefined)
    apiJson.mockReset().mockImplementation(async (url: string) => {
      if (url === '/api/site/features') return DEFAULT_SITE_FEATURE_SETTINGS
      if (url === '/api/site/public-content') return cloneDefaultPublicContentSettings()
      throw new Error(`Unexpected request: ${url}`)
    })
  })

  afterEach(() => cleanup())

  it.each([
    '/reset-password',
    '/account-safety',
    '/tool/profiles',
    '/tools/depot-value',
    '/admin/setup',
    '/admin/features',
    '/v2',
  ])('does not load public content for non-content route %s', async (route) => {
    render(<MemoryRouter initialEntries={[route]}><App /></MemoryRouter>)
    await waitFor(() => expect(apiJson).toHaveBeenCalledWith('/api/site/features', expect.any(Object)))
    expect(apiJson.mock.calls.some(([url]) => url === '/api/site/public-content')).toBe(false)
  })

  it.each([
    '/',
    '/changelog',
    '/faq',
    '/support',
    '/pricing',
    '/thanks',
    '/privacy',
    '/terms',
    '/disclaimer',
    '/status',
  ])('loads public content for content route %s', async (route) => {
    render(<MemoryRouter initialEntries={[route]}><App /></MemoryRouter>)
    await waitFor(() => expect(apiJson.mock.calls.some(([url]) => url === '/api/site/public-content')).toBe(true))
  })

  it('keeps V1 as the default and exposes V2 only through its test entry', async () => {
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
    expect(await screen.findByRole('link', { name: '体验 V2 测试版' })).toHaveAttribute('href', '/v2')
    expect(screen.queryByText('V2 test workspace')).not.toBeInTheDocument()
  })

  it('opens the separate V2 test route without indexing it', async () => {
    render(<MemoryRouter initialEntries={['/v2']}><App /></MemoryRouter>)
    expect(await screen.findByText('V2 test workspace')).toBeInTheDocument()
    await waitFor(() => expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow'))
  })
})
