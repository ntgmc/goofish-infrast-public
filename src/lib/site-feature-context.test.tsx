// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { DEFAULT_SITE_FEATURE_SETTINGS, normalizeSiteFeatureSettings, computeEffectiveSiteFeatures } from './site-features'

const { apiJson } = vi.hoisted(() => ({ apiJson: vi.fn() }))
vi.mock('./api-client', () => ({ apiJson }))

import { FeatureRoute } from '../components/FeatureUnavailablePage'
import { SiteFeatureProvider } from './site-feature-context'

beforeEach(() => apiJson.mockReset())

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('SiteFeatureProvider', () => {
  it.each(['wrapped failure', 'late success'])('ignores a cancelled initialization response: %s', async (outcome) => {
    let resolveCancelled!: (settings: typeof DEFAULT_SITE_FEATURE_SETTINGS) => void
    let rejectCancelled!: (error: Error) => void
    const cancelled = new Promise((resolve, reject) => { resolveCancelled = resolve; rejectCancelled = reject })
    let resolveCurrent!: (settings: typeof DEFAULT_SITE_FEATURE_SETTINGS) => void
    const current = new Promise((resolve) => { resolveCurrent = resolve })
    apiJson.mockReturnValueOnce(cancelled).mockReturnValueOnce(current)
    render(<StrictMode><MemoryRouter><SiteFeatureProvider>
      <FeatureRoute feature="v2"><p>V2 available</p></FeatureRoute>
    </SiteFeatureProvider></MemoryRouter></StrictMode>)
    await waitFor(() => expect(apiJson).toHaveBeenCalledTimes(2))
    expect(apiJson.mock.calls[0][1].signal.aborted).toBe(true)
    await act(async () => {
      if (outcome === 'wrapped failure') rejectCancelled(Object.assign(new Error('Request was cancelled'), { name: 'ApiError' }))
      else resolveCancelled(DEFAULT_SITE_FEATURE_SETTINGS)
    })
    expect(screen.getByRole('status')).toHaveTextContent('正在获取服务开放状态…')
    expect(screen.queryByRole('heading', { name: '暂时无法获取服务状态' })).not.toBeInTheDocument()
    expect(screen.queryByText('V2 available')).not.toBeInTheDocument()
    await act(async () => resolveCurrent(DEFAULT_SITE_FEATURE_SETTINGS))
    expect(await screen.findByText('V2 available')).toBeInTheDocument()
  })

  it('fills new switches from legacy settings while preserving disabled parents', async () => {
    apiJson.mockResolvedValueOnce({ version: 1, features: { tools: false, login: false }, updated_at: null })
    render(<MemoryRouter><SiteFeatureProvider>
      <FeatureRoute feature="v2"><p>V2 available</p></FeatureRoute>
      <FeatureRoute feature="cultivation_plan"><p>Cultivation available</p></FeatureRoute>
      <FeatureRoute feature="notifications"><p>Notifications available</p></FeatureRoute>
    </SiteFeatureProvider></MemoryRouter>)
    expect(await screen.findByText('V2 available')).toBeInTheDocument()
    expect(screen.queryByText('Cultivation available')).not.toBeInTheDocument()
    expect(screen.queryByText('Notifications available')).not.toBeInTheDocument()
    const settings = normalizeSiteFeatureSettings({ features: { schedule_generation: false, inventory: false } })
    expect(settings.features.manual_schedule).toBe(true)
    expect(computeEffectiveSiteFeatures(settings)).toMatchObject({
      manual_schedule: false, scenario_comparison: false, maa_export: false, full_result_export: true,
    })
  })
  it('keeps retired billing closed when an older server returns an enabled setting', async () => {
    apiJson.mockResolvedValueOnce({
      ...DEFAULT_SITE_FEATURE_SETTINGS,
      features: { ...DEFAULT_SITE_FEATURE_SETTINGS.features, metered_billing: true },
    })
    render(
      <MemoryRouter>
        <SiteFeatureProvider>
          <FeatureRoute feature="metered_billing"><p>Retired billing</p></FeatureRoute>
          <FeatureRoute feature="schedule_generation"><p>Scheduling available</p></FeatureRoute>
        </SiteFeatureProvider>
      </MemoryRouter>,
    )
    expect(await screen.findByText('Scheduling available')).toBeInTheDocument()
    expect(screen.queryByText('Retired billing')).not.toBeInTheDocument()
  })

  it('fails closed and exposes a retry before rendering protected content', async () => {
    const user = userEvent.setup()
    apiJson
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(DEFAULT_SITE_FEATURE_SETTINGS)

    render(
      <MemoryRouter>
        <SiteFeatureProvider>
          <FeatureRoute feature="login"><p>受控内容</p></FeatureRoute>
        </SiteFeatureProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('heading', { name: '暂时无法获取服务状态' })).toBeInTheDocument()
    expect(screen.queryByText('受控内容')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重新获取' }))
    expect(await screen.findByText('受控内容')).toBeInTheDocument()
  })
})
