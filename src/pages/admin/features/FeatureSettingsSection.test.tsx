// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../lib/api-client'
import { DEFAULT_SITE_FEATURE_SETTINGS, SITE_FEATURE_KEYS, computeEffectiveSiteFeatures } from '../../../lib/site-features'

const { adminApiJson } = vi.hoisted(() => ({ adminApiJson: vi.fn() }))
vi.mock('../../../lib/admin-api-client', () => ({ adminApiJson }))

import FeatureSettingsSection from './FeatureSettingsSection'

describe('FeatureSettingsSection', () => {
  beforeEach(() => {
    const settings = { ...DEFAULT_SITE_FEATURE_SETTINGS, revision: 2 }
    adminApiJson.mockReset()
    adminApiJson.mockResolvedValue({
      settings,
      effective_features: computeEffectiveSiteFeatures(settings),
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
    const savedSettings = {
      ...DEFAULT_SITE_FEATURE_SETTINGS,
      features: { ...DEFAULT_SITE_FEATURE_SETTINGS.features, registration: false },
      revision: 3,
    }
    adminApiJson.mockResolvedValueOnce({
      settings: savedSettings,
      effective_features: computeEffectiveSiteFeatures(savedSettings),
    })
    await user.click(screen.getByRole('button', { name: '保存功能开关' }))
    await waitFor(() => expect(adminApiJson).toHaveBeenLastCalledWith('/api/admin/feature-settings', expect.objectContaining({
      method: 'PUT',
      json: { features: expect.objectContaining({ registration: false, login: true, site: true }), expected_revision: 2 },
    })))
    await user.click(screen.getByRole('checkbox', { name: /登录与普通会话/ }))
    await user.click(screen.getByRole('button', { name: '保存功能开关' }))
    await waitFor(() => expect(adminApiJson).toHaveBeenLastCalledWith('/api/admin/feature-settings', expect.objectContaining({
      method: 'PUT',
      json: { features: expect.objectContaining({ registration: false, login: false }), expected_revision: 3 },
    })))
  })

  it('renders every shared feature key exactly once, including metered billing', async () => {
    render(<FeatureSettingsSection />)
    const keys = (await screen.findAllByRole('checkbox')).map((input) => input.getAttribute('name'))
    expect(keys).toHaveLength(SITE_FEATURE_KEYS.length)
    expect(new Set(keys)).toEqual(new Set(SITE_FEATURE_KEYS))
  })

  it('does not expose settings or save when the initial load fails', async () => {
    const user = userEvent.setup()
    adminApiJson.mockRejectedValueOnce(new Error('数据库不可用'))
    render(<FeatureSettingsSection />)
    expect(await screen.findByRole('alert')).toHaveTextContent('数据库不可用')
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存功能开关' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重新加载' }))
    expect(await screen.findAllByRole('checkbox')).toHaveLength(SITE_FEATURE_KEYS.length)
    expect(screen.getByRole('button', { name: '保存功能开关' })).toBeInTheDocument()
  })

  it('keeps the local draft when a stale revision conflicts', async () => {
    const user = userEvent.setup()
    render(<FeatureSettingsSection />)
    const registration = await screen.findByRole('checkbox', { name: /用户注册/ })
    await user.click(registration)
    adminApiJson.mockRejectedValueOnce(new ApiError('conflict', 409, { code: 'settings_conflict' }, '/api/admin/feature-settings'))
    await user.click(screen.getByRole('button', { name: '保存功能开关' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('线上功能开关已被其他管理员更新')
    expect(registration).not.toBeChecked()
    const reload = screen.getByRole('button', { name: '重新加载线上配置' })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await user.click(reload)
    expect(confirm).toHaveBeenCalledOnce()
    expect(adminApiJson).toHaveBeenCalledTimes(2)
    expect(registration).not.toBeChecked()

    confirm.mockReturnValue(true)
    await user.click(reload)
    await waitFor(() => expect(adminApiJson).toHaveBeenCalledTimes(3))
  })
})
