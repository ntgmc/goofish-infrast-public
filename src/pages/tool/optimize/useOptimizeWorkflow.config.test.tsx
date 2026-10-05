// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { CONFIG_PRESETS, normalizeConfig } from '../../../lib/config'
import type { UserGameAccount } from '../../../lib/types'
import { createAccountLicense } from '../tool-utils'
import { useOptimizeWorkflow, type Props } from './useOptimizeWorkflow'

vi.mock('../../../lib/api-client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../lib/api-client')>(),
  apiJson: vi.fn(async () => ({ stacks: [], capacities: [], balances: [] })),
}))

afterEach(cleanup)

it.each(['cdk', 'free_preview'] as const)('retains explicit inventory balance settings for %s profiles', async (kind) => {
  const profile: UserGameAccount = {
    id: 'inventory-config', user_id: 'user', kind, permission: 'growth', status: 'active',
    cdk_order_hash: null, display_name: '库存配置', note: '', operator_count: 0,
    updated_at: null, created_at: '2026-10-01T00:00:00Z',
  }
  const config = normalizeConfig(CONFIG_PRESETS['243'])
  const setConfigOverride = vi.fn()
  const props: Props = {
    profileId: profile.id, profile, license: createAccountLicense(profile, [], config), workspace: null,
    setLicense: vi.fn(), eliteOverrides: {}, configOverride: null, setConfigOverride,
    configSyncStatus: 'idle', flushConfigSave: vi.fn(async () => true), retryConfigSave: vi.fn(),
    onWorkspacePatch: vi.fn(), onWorkspaceUpdated: vi.fn(), section: 'config', onSectionChange: vi.fn(),
    onReset: vi.fn(), onLogout: vi.fn(), announcement: null, redeemedNotice: null, onProfileUpgraded: vi.fn(),
  }
  const { result } = renderHook(() => useOptimizeWorkflow(props))
  await waitFor(() => expect(result.current.licenseSyncing).toBe(false))
  for (const enabled of [true, false]) {
    act(() => result.current.updateConfig((draft) => {
      draft.allow_product_rebalance = enabled
      draft.auto_balance_source = enabled ? 'intermediate_inventory' : 'limited_config'
      draft.intermediate_inventory = { 'Pure Gold': 20 }
    }))
    expect(setConfigOverride).toHaveBeenLastCalledWith(expect.objectContaining({
      allow_product_rebalance: enabled,
      auto_balance_source: enabled ? 'intermediate_inventory' : 'limited_config',
      intermediate_inventory: expect.objectContaining({ 'Pure Gold': 20 }),
    }))
  }
})

it.each(['252', '252-1', '252-full'])('retains the %s preset selected by a free preview profile', async (preset) => {
  const profile: UserGameAccount = {
    id: 'free-config', user_id: 'user', kind: 'free_preview', permission: 'growth',
    status: 'active', cdk_order_hash: null, display_name: '免费预览', note: '',
    operator_count: 0, updated_at: null, created_at: '2026-10-01T00:00:00Z',
  }
  const config = normalizeConfig(CONFIG_PRESETS['243'])
  const setConfigOverride = vi.fn()
  const props: Props = {
    profileId: profile.id, profile, license: createAccountLicense(profile, [], config),
    workspace: null, setLicense: vi.fn(), eliteOverrides: {}, configOverride: null,
    setConfigOverride, configSyncStatus: 'idle', flushConfigSave: vi.fn(async () => true),
    retryConfigSave: vi.fn(), onWorkspacePatch: vi.fn(), onWorkspaceUpdated: vi.fn(),
    section: 'config', onSectionChange: vi.fn(), onReset: vi.fn(), onLogout: vi.fn(),
    announcement: null, redeemedNotice: null, onProfileUpgraded: vi.fn(),
  }
  const { result } = renderHook(() => useOptimizeWorkflow(props))
  await waitFor(() => expect(result.current.licenseSyncing).toBe(false))
  act(() => result.current.updateConfig((draft) => Object.assign(draft, CONFIG_PRESETS[preset])))
  expect(setConfigOverride).toHaveBeenLastCalledWith(expect.objectContaining({
    layout: '2-5-2',
    desc: CONFIG_PRESETS[preset].desc,
    trading_station_levels: CONFIG_PRESETS[preset].trading_station_levels,
    manufacturing_station_levels: CONFIG_PRESETS[preset].manufacturing_station_levels,
  }))
})
