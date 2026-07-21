// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SITE_FEATURE_SETTINGS, computeEffectiveSiteFeatures } from '../../../lib/site-features'

const { adminApiJson } = vi.hoisted(() => ({ adminApiJson: vi.fn() }))
vi.mock('../../../lib/admin-api-client', () => ({ adminApiJson }))

import FeatureSettingsSection from './FeatureSettingsSection'

describe('FeatureSettingsSection', () => {
  beforeEach(() => {
    adminApiJson.mockResolvedValue({
      settings: DEFAULT_SITE_FEATURE_SETTINGS,
      effective_features: computeEffectiveSiteFeatures(DEFAULT_SITE_FEATURE_SETTINGS),
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('preserves child switches and displays effective dependency state', async () => {
    const user = userEvent.setup()
    render(<FeatureSettingsSection />)
    const tools = await screen.findByRole('checkbox', { name: /公开工具中心/ })
    const depot = screen.getByRole('checkbox', { name: /基建价值分析/ })
    expect(tools).toBeChecked()
    expect(depot).toBeChecked()
    await user.click(tools)
    expect(depot).toBeChecked()
    expect(screen.getAllByText(/上级功能关闭/).length).toBeGreaterThan(0)
  })

  it('saves the complete feature map', async () => {
    const user = userEvent.setup()
    render(<FeatureSettingsSection />)
    await screen.findByRole('checkbox', { name: /全站业务/ })
    await user.click(screen.getByRole('checkbox', { name: /用户注册/ }))
    await user.click(screen.getByRole('button', { name: '保存功能开关' }))
    await waitFor(() => expect(adminApiJson).toHaveBeenLastCalledWith('/api/admin/feature-settings', expect.objectContaining({
      method: 'PUT',
      json: { features: expect.objectContaining({ registration: false, login: true, site: true }) },
    })))
  })
})
