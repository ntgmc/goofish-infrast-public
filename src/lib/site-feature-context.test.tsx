// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { DEFAULT_SITE_FEATURE_SETTINGS } from './site-features'

const { apiJson } = vi.hoisted(() => ({ apiJson: vi.fn() }))
vi.mock('./api-client', () => ({ apiJson }))

import { FeatureRoute } from '../components/FeatureUnavailablePage'
import { SiteFeatureProvider } from './site-feature-context'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('SiteFeatureProvider', () => {
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
