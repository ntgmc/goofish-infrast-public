// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '../../../test/query-render'
import { afterEach, expect, it, vi } from 'vitest'
import { CONFIG_PRESETS, normalizeConfig } from '../../../lib/config'
import { getFacilityIds } from '../../../lib/facility-layout'
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

it('downgrades expired profiles with a cached paid license and restores rights after renewal', async () => {
  const profile: UserGameAccount = {
    id: 'expired-config', user_id: 'user', kind: 'cdk', permission: 'advanced', status: 'active',
    cdk_order_hash: null, display_name: '已到期', note: '', operator_count: 0,
    updated_at: null, created_at: '2020-01-01', expires_at: '2099-01-01',
  }
  const props: Props = {
    profileId: profile.id, profile, license: createAccountLicense(profile, [], normalizeConfig(CONFIG_PRESETS['243'])),
    workspace: null, setLicense: vi.fn(), eliteOverrides: {}, configOverride: null, setConfigOverride: vi.fn(),
    configSyncStatus: 'idle', flushConfigSave: vi.fn(async () => true), retryConfigSave: vi.fn(),
    onWorkspacePatch: vi.fn(), onWorkspaceUpdated: vi.fn(), section: 'config', onSectionChange: vi.fn(),
    onReset: vi.fn(), onLogout: vi.fn(), announcement: null, redeemedNotice: null, onProfileUpgraded: vi.fn(),
  }
  const { result, rerender } = renderHook((input: Props) => useOptimizeWorkflow(input), { initialProps: props })
  await waitFor(() => expect(result.current.licenseSyncing).toBe(false))
  expect(result.current.userCanDownloadFullResult).toBe(true)
  rerender({ ...props, profile: { ...profile, expires_at: '2020-01-01' } })
  expect(result.current).toMatchObject({
    permission: 'recommended', isPreviewProfile: true, isRestrictedPreview: true,
    userCanEditConfig: false, userCanDownloadFullResult: false, userCanExportMaaWithoutCoupon: false,
    userCanViewFullData: false, userCanUseUpgradeFeatures: false, userHasScenarioLabCapability: false,
  })
  rerender(props)
  expect(result.current.userCanDownloadFullResult).toBe(true)
  expect(result.current.userCanUseUpgradeFeatures).toBe(true)
})

it.each(['243', '333', '252', '252-1', '252-full'])('retains the %s preset and map selected by a free preview profile', async (preset) => {
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
  const facility_layout = getFacilityIds(CONFIG_PRESETS[preset]).reverse()
  act(() => result.current.updateConfig((draft) => Object.assign(draft, CONFIG_PRESETS[preset], { facility_layout })))
  expect(setConfigOverride).toHaveBeenLastCalledWith(expect.objectContaining({
    layout: CONFIG_PRESETS[preset].layout,
    facility_layout,
    desc: CONFIG_PRESETS[preset].desc,
    ...(CONFIG_PRESETS[preset].trading_station_levels && { trading_station_levels: CONFIG_PRESETS[preset].trading_station_levels }),
    ...(CONFIG_PRESETS[preset].manufacturing_station_levels && { manufacturing_station_levels: CONFIG_PRESETS[preset].manufacturing_station_levels }),
  }))
})
