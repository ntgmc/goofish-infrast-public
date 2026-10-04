// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cloneDefaultPublicContentSettings } from './lib/public-content'
import { DEFAULT_SITE_FEATURE_SETTINGS, type SiteFeatureKey } from './lib/site-features'

const apiJson = vi.hoisted(() => vi.fn())
const apiVoid = vi.hoisted(() => vi.fn())
const toolMount = vi.hoisted(() => vi.fn())
const toolUnmount = vi.hoisted(() => vi.fn())
vi.mock('./lib/api-client', async (importOriginal) => ({
  ...await importOriginal<typeof import('./lib/api-client')>(),
  apiJson,
  apiVoid,
}))
vi.mock('./pages/ToolPage', async () => {
  const { useEffect } = await import('react')
  return {
    default: () => {
      useEffect(() => {
        toolMount()
        return () => { toolUnmount() }
      }, [])
      return <main data-route-focus>Tool workspace</main>
    },
  }
})
vi.mock('./pages/DepotValuePage', () => ({ default: () => null }))
vi.mock('./pages/AdminSetupPage', () => ({ default: () => null }))
vi.mock('./pages/AdminPage', () => ({ default: () => null }))
vi.mock('./pages/v2/V2Page', () => ({ default: () => <main>V2 test workspace</main> }))

import App from './App'

describe('App public content routing', () => {
  beforeEach(() => {
    apiVoid.mockReset().mockResolvedValue(undefined)
    toolMount.mockReset()
    toolUnmount.mockReset()
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
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

  it('reuses loaded public content across public navigation and history', async () => {
    const router = createMemoryRouter([{ path: '*', element: <App /> }], { initialEntries: ['/faq'] })
    render(<RouterProvider router={router} />)
    await waitFor(() => expect(apiJson.mock.calls.filter(([url]) => url === '/api/site/public-content')).toHaveLength(1))

    await act(async () => router.navigate('/privacy'))
    await waitFor(() => expect(document.title).toContain('隐私'))
    await act(async () => router.navigate(-1))
    await waitFor(() => expect(router.state.location.pathname).toBe('/faq'))

    expect(apiJson.mock.calls.filter(([url]) => url === '/api/site/public-content')).toHaveLength(1)
  })

  it('keeps one tool session across tool routes and releases it when leaving', async () => {
    const router = createMemoryRouter([{ path: '*', element: <App /> }], { initialEntries: ['/faq'] })
    render(<RouterProvider router={router} />)
    await screen.findByRole('heading', { level: 1 })

    await act(async () => router.navigate('/tool/profiles'))
    expect(await screen.findByText('Tool workspace')).toBeInTheDocument()
    await act(async () => router.navigate('/tool/settings'))

    expect(toolMount).toHaveBeenCalledTimes(1)
    expect(screen.getAllByText('Tool workspace')).toHaveLength(1)
    await act(async () => router.navigate('/faq'))
    expect(toolUnmount).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Tool workspace')).not.toBeInTheDocument()
  })

  it('opens the separate V2 test route without indexing it', async () => {
    render(<MemoryRouter initialEntries={['/v2']}><App /></MemoryRouter>)
    expect(await screen.findByText('V2 test workspace')).toBeInTheDocument()
    await waitFor(() => expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow'))
  })

  it('keeps V2 service-state failures and retries in the V2 loading screen', async () => {
    let requests = 0
    const original = apiJson.getMockImplementation()!
    apiJson.mockImplementation((url: string) => {
      if (url === '/api/site/features' && ++requests === 1) return Promise.reject(new Error('offline'))
      return original(url)
    })
    render(<MemoryRouter initialEntries={['/v2']}><App /></MemoryRouter>)
    expect(await screen.findByRole('alert')).toHaveTextContent('相关功能当前不可用，请稍后重新获取服务状态。')
    expect(document.querySelector('.v2-loading-screen')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '暂时无法获取服务状态' })).not.toBeInTheDocument()
    await act(async () => screen.getByRole('button', { name: '重新获取' }).click())
    expect(await screen.findByText('V2 test workspace')).toBeInTheDocument()
  })

  it.each([
    ['/v2', 'v2'], ['/tools/manual-schedule', 'manual_schedule'], ['/tools/cultivation-plan', 'cultivation_plan'],
    ['/faq', 'faq'], ['/support', 'support'], ['/pricing', 'pricing'], ['/changelog', 'changelog'],
    ['/thanks', 'thanks'], ['/status', 'service_status'],
  ] satisfies Array<[string, SiteFeatureKey]>)('blocks direct visits to the disabled page %s', async (route, feature) => {
    const original = apiJson.getMockImplementation()!
    apiJson.mockImplementation((url: string) => url === '/api/site/features'
      ? Promise.resolve({ ...DEFAULT_SITE_FEATURE_SETTINGS,
        features: { ...DEFAULT_SITE_FEATURE_SETTINGS.features, [feature]: false } })
      : original(url))
    render(<MemoryRouter initialEntries={[route]}><App /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: '该功能暂未开放' })).toBeInTheDocument()
    expect(screen.queryByText('V2 test workspace')).not.toBeInTheDocument()
  })

  it('hides disabled V2 and public page links while preserving legal pages', async () => {
    const original = apiJson.getMockImplementation()!
    apiJson.mockImplementation((url: string) => url === '/api/site/features'
      ? Promise.resolve({ ...DEFAULT_SITE_FEATURE_SETTINGS, features: { ...DEFAULT_SITE_FEATURE_SETTINGS.features,
        v2: false, pricing: false, changelog: false, thanks: false, service_status: false, faq: false } })
      : original(url))
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>)
    await screen.findByRole('button', { name: '开始排班' })
    await waitFor(() => expect(screen.queryByRole('link', { name: '体验 V2 测试版' })).not.toBeInTheDocument())
    for (const href of ['/v2', '/pricing', '/changelog', '/thanks', '/status', '/faq']) {
      expect(document.querySelector(`a[href="${href}"]`)).toBeNull()
    }
    expect(document.querySelector('a[href="/privacy"]')).toBeInTheDocument()
  })
})
