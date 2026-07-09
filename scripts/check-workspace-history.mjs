import * as esbuild from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const bundleDir = resolve('.cache/check-workspace-history')
await mkdir(bundleDir, { recursive: true })
process.env.NODE_ENV = 'test'

const store = createMemoryStore()
globalThis.__workspaceHistorySmokeStore = store
globalThis.__maaOptimizeJobStoreForTesting = createMemoryOptimizeJobStore()

const workspaceHandler = await bundleHandler('server/handlers/user-workspace.ts')
const optimizeHandler = await bundleHandler('server/handlers/optimize.ts')
const profilesHandler = await bundleHandler('server/handlers/user-profiles.ts')

const sampleConfig = {
  layout: '3-3-3',
  desc: '333 orundum',
  schedule_mode: 'maa',
  dormitory_rule: 'fixed',
  trading_stations_count: 3,
  manufacturing_stations_count: 3,
  product_requirements: {
    trading_stations: { LMD: 2, Orundum: 1 },
    manufacturing_stations: { 'Pure Gold': 2, 'Originium Shard': 1 },
  },
  Fiammetta: { enable: true },
  drones: { enable: true, auto: true, order: 'pre', targets: ['LMD', 'Pure Gold'] },
}

const free333OrundumConfig = {
  layout: '3-3-3',
  desc: '333 orundum',
  schedule_mode: 'maa',
  dormitory_rule: 'fixed',
  trading_stations_count: 3,
  manufacturing_stations_count: 3,
  product_requirements: {
    trading_stations: { LMD: 2, Orundum: 1 },
    manufacturing_stations: { 'Pure Gold': 2, 'Originium Shard': 1 },
  },
}

const free333RoundTripConfig = {
  ...free333OrundumConfig,
  Fiammetta: { enable: true },
  drones: { enable: true, auto: true, order: 'pre', targets: ['LMD', 'Pure Gold', 'LMD'] },
}

const free243BalancedConfig = {
  layout: '2-4-3',
  desc: '243 balanced',
  schedule_mode: 'rotation',
  dormitory_rule: 'fixed',
  trading_stations_count: 2,
  manufacturing_stations_count: 4,
  product_requirements: {
    trading_stations: { LMD: 2 },
    manufacturing_stations: { 'Pure Gold': 2, 'Battle Record': 2 },
  },
  Fiammetta: { enable: false },
}

const free243OrundumInventoryConfig = {
  layout: '2-4-3',
  desc: '243 orundum inventory assist',
  schedule_mode: 'maa',
  dormitory_rule: 'maa_autofill',
  trading_stations_count: 2,
  manufacturing_stations_count: 4,
  product_requirements: {
    trading_stations: { LMD: 2 },
    manufacturing_stations: { 'Pure Gold': 2, 'Originium Shard': 2 },
  },
  intermediate_inventory: { 'Pure Gold': 123, 'Originium Shard': 45 },
  auto_balance_source: 'intermediate_inventory',
  drones: { enable: true, auto: true, auto_strategy: 'trading_priority' },
}

const sampleOperators = [
  { id: 'char_002_amiya', name: 'Amiya', own: true, elite: 2, rarity: 4 },
  { id: 'char_010_chen', name: 'Chen', own: true, elite: 1, rarity: 5 },
]

await assertRequiresLogin()
await assertPreviewProfileLifecycle()
await assertSavedConfigActions()
await assertOrirockInventoryPersistence()
await assertSavedConfigLimitAndPermission()
await assertOptimizeHistory()
await assertFreePreviewWorkspaceAndOptimizeLimits()
await assertFreeScheduleEntitlementLifecycle()
await assertOperatorsPatchKeepsHistory()

console.log('workspace history smoke check ok')

async function assertRequiresLogin() {
  const result = await call(workspaceHandler, '/api/user/workspace?profile_id=profile-1', undefined, { method: 'GET', auth: false })
  if (result.status !== 401) {
    throw new Error(`workspace auth: expected 401, got ${result.status}`)
  }
}

async function assertPreviewProfileLifecycle() {
  const unauthenticated = await call(profilesHandler, '/api/user/profiles/preview', {}, { method: 'POST', auth: false })
  if (unauthenticated.status !== 401) {
    throw new Error(`preview profile auth: expected 401, got ${unauthenticated.status}`)
  }

  const denied = await call(profilesHandler, '/api/user/profiles/preview', {
    display_name: '免费个人排班',
  })
  if (denied.status !== 400 || [...store.profiles.values()].some((profile) => profile.kind === 'free_preview')) {
    throw new Error(`preview profile create: expected Skland claim requirement, got ${denied.status}`)
  }

  const preview = seedFreePreviewProfile('preview-life', { bound: true })
  store.workspaces.set(preview.id, {
    ...emptyWorkspace(preview.id),
    operators: sampleOperators,
    config: free333OrundumConfig,
  })

  const reused = await call(profilesHandler, '/api/user/profiles/preview', {
    display_name: '更新后的免费个人排班',
  })
  if (reused.status !== 200 || reused.body?.active_profile?.id !== preview.id) {
    throw new Error('preview profile reuse: expected existing preview profile')
  }

  store.cdks.set('UPGRADE-CDK', {
    status: 'unused',
    permission: 'advanced',
    license_order_hash: 'order-upgrade',
  })

  const upgraded = await call(profilesHandler, '/api/user/profiles/redeem', {
    profile_id: preview.id,
    cdk: 'UPGRADE-CDK',
  })
  const activeProfile = upgraded.body?.active_profile
  if (upgraded.status !== 200 || activeProfile?.id !== preview.id || activeProfile.kind !== 'cdk' || activeProfile.permission !== 'advanced') {
    throw new Error(`preview profile upgrade: expected same profile converted to cdk, got ${upgraded.status}`)
  }
  const upgradedStored = store.profiles.get(preview.id)
  if (!upgradedStored || upgradedStored.kind !== 'cdk' || !upgradedStored.skland_binding || upgradedStored.cdk_order_hash !== 'order-upgrade') {
    throw new Error('preview profile upgrade: stored profile was not converted while preserving Skland binding')
  }
  const usedCdk = store.cdks.get('UPGRADE-CDK')
  if (usedCdk?.status !== 'used' || usedCdk.profile_id !== preview.id || usedCdk.account_id !== store.user.id) {
    throw new Error('preview profile upgrade: CDK was not consumed and bound')
  }
  const keptWorkspace = store.workspaces.get(preview.id)
  if (keptWorkspace?.operators?.length !== sampleOperators.length || keptWorkspace.config?.desc !== free333OrundumConfig.desc) {
    throw new Error('preview profile upgrade: workspace data should be preserved')
  }
}

async function assertSavedConfigActions() {
  store.workspaces.set('profile-1', emptyWorkspace('profile-1'))

  const saved = await call(workspaceHandler, '/api/user/workspace', {
    profile_id: 'profile-1',
    saved_config_action: { type: 'save', name: ' 243 LMD ', config: sampleConfig },
  }, { method: 'PATCH' })
  if (saved.status !== 200 || saved.body.workspace.saved_configs[0]?.name !== '243 LMD') {
    throw new Error(`saved config save: invalid response ${saved.status}`)
  }
  const savedId = saved.body.workspace.saved_configs[0].id

  const duplicate = await call(workspaceHandler, '/api/user/workspace', {
    profile_id: 'profile-1',
    saved_config_action: { type: 'save', name: '243 LMD', config: sampleConfig },
  }, { method: 'PATCH' })
  if (duplicate.status !== 400) {
    throw new Error(`saved config duplicate: expected 400, got ${duplicate.status}`)
  }

  const emptyName = await call(workspaceHandler, '/api/user/workspace', {
    profile_id: 'profile-1',
    saved_config_action: { type: 'save', name: '   ', config: sampleConfig },
  }, { method: 'PATCH' })
  if (emptyName.status !== 400) {
    throw new Error(`saved config empty name: expected 400, got ${emptyName.status}`)
  }

  const renamed = await call(workspaceHandler, '/api/user/workspace', {
    profile_id: 'profile-1',
    saved_config_action: { type: 'rename', id: savedId, name: '333 orundum' },
  }, { method: 'PATCH' })
  if (renamed.status !== 200 || renamed.body.workspace.saved_configs[0]?.name !== '333 orundum') {
    throw new Error('saved config rename: name not updated')
  }

  const touched = await call(workspaceHandler, '/api/user/workspace', {
    profile_id: 'profile-1',
    saved_config_action: { type: 'touch', id: savedId },
  }, { method: 'PATCH' })
  if (touched.status !== 200 || !touched.body.workspace.saved_configs[0]?.last_used_at) {
    throw new Error('saved config touch: last_used_at missing')
  }

  const deleted = await call(workspaceHandler, '/api/user/workspace', {
    profile_id: 'profile-1',
    saved_config_action: { type: 'delete', id: savedId },
  }, { method: 'PATCH' })
  if (deleted.status !== 200 || deleted.body.workspace.saved_configs.length !== 0) {
    throw new Error('saved config delete: item should be removed')
  }
}

async function assertOrirockInventoryPersistence() {
  store.workspaces.set('profile-1', emptyWorkspace('profile-1'))
  const config = {
    ...sampleConfig,
    intermediate_inventory: { 'Pure Gold': 123, 'Originium Shard': 45, 'Orirock Cube': 7658 },
    auto_balance_source: 'intermediate_inventory',
    drones: { ...sampleConfig.drones, auto_strategy: 'trading_priority' },
  }
  const savedWorkspace = await call(workspaceHandler, '/api/user/workspace', {
    profile_id: 'profile-1',
    config,
  }, { method: 'PATCH' })
  if (
    savedWorkspace.status !== 200 ||
    savedWorkspace.body.workspace.config?.intermediate_inventory?.['Orirock Cube'] !== 7658
  ) {
    throw new Error(`orirock workspace persistence failed: ${JSON.stringify(savedWorkspace.body)}`)
  }

  const savedConfig = await call(workspaceHandler, '/api/user/workspace', {
    profile_id: 'profile-1',
    saved_config_action: { type: 'save', name: 'orirock inventory', config },
  }, { method: 'PATCH' })
  if (
    savedConfig.status !== 200 ||
    savedConfig.body.workspace.saved_configs[0]?.config?.intermediate_inventory?.['Orirock Cube'] !== 7658
  ) {
    throw new Error(`orirock saved config persistence failed: ${JSON.stringify(savedConfig.body)}`)
  }
}
async function assertSavedConfigLimitAndPermission() {
  const now = new Date().toISOString()
  store.workspaces.set('profile-1', {
    ...emptyWorkspace('profile-1'),
    saved_configs: Array.from({ length: 20 }, (_, index) => ({
      id: `saved-${index}`,
      name: `config ${index}`,
      config: sampleConfig,
      created_at: now,
      updated_at: now,
      last_used_at: null,
    })),
  })

  const tooMany = await call(workspaceHandler, '/api/user/workspace', {
    profile_id: 'profile-1',
    saved_config_action: { type: 'save', name: 'config 21', config: sampleConfig },
  }, { method: 'PATCH' })
  if (tooMany.status !== 400) {
    throw new Error(`saved config limit: expected 400, got ${tooMany.status}`)
  }

  store.workspaces.set('profile-1', emptyWorkspace('profile-1'))
  const forbidden = await call(workspaceHandler, '/api/user/workspace', {
    profile_id: 'profile-1',
    saved_config_action: { type: 'save', name: 'forbidden config', config: { ...sampleConfig, permission_blocked: true } },
  }, { method: 'PATCH' })
  if (forbidden.status !== 403) {
    throw new Error(`saved config permission: expected 403, got ${forbidden.status}`)
  }
}

async function assertOptimizeHistory() {
  const now = new Date().toISOString()
  store.workspaces.set('profile-1', {
    ...emptyWorkspace('profile-1'),
    operators: sampleOperators,
    config: sampleConfig,
    saved_configs: [{
      id: 'match-config',
      name: '333 orundum',
      config: sampleConfig,
      created_at: now,
      updated_at: now,
      last_used_at: null,
    }],
  })

  const generated = await call(optimizeHandler, '/api/optimize', {
    profile_id: 'profile-1',
    license: null,
    operators: sampleOperators,
    config: sampleConfig,
    ignore_elite: false,
  })
  const workspace = store.workspaces.get('profile-1')
  if (generated.status !== 200 || !workspace?.last_result || workspace.result_history.length !== 1) {
    throw new Error(`optimize history: expected stored last_result and one history item, got ${generated.status}`)
  }
  if (workspace.result_history[0].name !== '333 orundum' || workspace.result_history[0].source !== 'generated') {
    throw new Error('optimize history: saved config name/source not used')
  }
  if (!workspace.saved_configs[0].last_used_at) {
    throw new Error('optimize history: matching saved config should be touched')
  }

  const suggestionsOnly = await call(optimizeHandler, '/api/optimize', {
    profile_id: 'profile-1',
    license: null,
    operators: sampleOperators,
    config: sampleConfig,
    ignore_elite: true,
    suggestions_only: true,
    upgrade_task_payload: {
      tasks: [],
      baselineScore: 0,
    },
  })
  if (suggestionsOnly.status !== 200 || store.workspaces.get('profile-1')?.result_history.length !== 1) {
    throw new Error('optimize suggestions_only: should not append history')
  }
}

async function assertFreePreviewWorkspaceAndOptimizeLimits() {
  const unboundPreview = seedFreePreviewProfile('preview-unbound', { bound: false })
  store.workspaces.set(unboundPreview.id, {
    ...emptyWorkspace(unboundPreview.id),
    operators: sampleOperators,
    config: free333OrundumConfig,
  })

  const unboundSave = await call(workspaceHandler, '/api/user/workspace', {
    profile_id: unboundPreview.id,
    config: free333OrundumConfig,
  }, { method: 'PATCH' })
  if (unboundSave.status !== 403) {
    throw new Error(`免费档案未绑定保存：预期 403，实际 ${unboundSave.status}`)
  }

  const unboundOptimize = await call(optimizeHandler, '/api/optimize', {
    profile_id: unboundPreview.id,
    license: null,
    operators: sampleOperators,
    config: free333OrundumConfig,
    ignore_elite: false,
  })
  if (unboundOptimize.status !== 403) {
    throw new Error(`免费档案未绑定生成：预期 403，实际 ${unboundOptimize.status}`)
  }

  const preview = seedFreePreviewProfile('preview-bound', { bound: true })
  store.workspaces.set(preview.id, {
    ...emptyWorkspace(preview.id),
    operators: sampleOperators,
    config: free333OrundumConfig,
  })

  const operatorsPatch = await call(workspaceHandler, '/api/user/workspace', {
    profile_id: preview.id,
    operators: sampleOperators,
  }, { method: 'PATCH' })
  if (operatorsPatch.status !== 403) {
    throw new Error(`免费档案手动修改干员：预期 403，实际 ${operatorsPatch.status}`)
  }

  await assertFreeConfigPatchStatus(preview.id, { ...free333OrundumConfig, trading_stations_count: 4 }, 403, 'custom station count')
  await assertFreeConfigPatchStatus(preview.id, {
    ...free333OrundumConfig,
    product_requirements: {
      trading_stations: { LMD: 1, Orundum: 2 },
      manufacturing_stations: { 'Pure Gold': 1, 'Originium Shard': 2 },
    },
  }, 403, 'custom product ratio')
  await assertFreeConfigPatchStatus(preview.id, { ...free333OrundumConfig, optimizer_search: { max_iterations: 999 } }, 403, 'optimizer_search')
  await assertFreeConfigPatchStatus(preview.id, { ...free333OrundumConfig, drones: { enable: true, auto: true, targets: ['LMD'] } }, 403, '高级无人机策略')

  await assertFreeConfigPatchStatus(preview.id, free243BalancedConfig, 200, '243 balanced')
  await assertFreeConfigPatchStatus(preview.id, free243OrundumInventoryConfig, 200, '243 orundum with inventory assist')
  await assertFreeConfigPatchStatus(preview.id, free333OrundumConfig, 200, '333 orundum')

  await assertFreePreviewModeRoundTrip()

  const beforeHistoryCount = store.workspaces.get(preview.id)?.result_history.length ?? 0
  const suggestionsOnly = await call(optimizeHandler, '/api/optimize', {
    profile_id: preview.id,
    license: null,
    operators: sampleOperators,
    config: free333OrundumConfig,
    ignore_elite: true,
    suggestions_only: true,
    upgrade_task_payload: {
      tasks: [],
      baselineScore: 0,
    },
  })
  if (suggestionsOnly.status !== 403 || store.workspaces.get(preview.id)?.result_history.length !== beforeHistoryCount) {
    throw new Error(`免费档案 suggestions_only：预期 403 且不追加历史，实际 ${suggestionsOnly.status}`)
  }

  const unboundReorder = await call(optimizeHandler, '/api/optimize/reorder-check', {
    profile_id: unboundPreview.id,
    config: free333OrundumConfig,
  })
  if (unboundReorder.status !== 403) {
    throw new Error(`免费档案未绑定重排检测：预期 403，实际 ${unboundReorder.status}`)
  }

  const cdkReorder = await call(optimizeHandler, '/api/optimize/reorder-check', {
    profile_id: 'profile-1',
    config: free333OrundumConfig,
  })
  if (cdkReorder.status !== 403) {
    throw new Error(`CDK 档案重排检测：预期 403，实际 ${cdkReorder.status}`)
  }

  const noBaselinePreview = seedFreePreviewProfile('preview-reorder-no-baseline', { bound: true })
  store.workspaces.set(noBaselinePreview.id, {
    ...emptyWorkspace(noBaselinePreview.id),
    operators: sampleOperators,
    config: free333OrundumConfig,
  })
  const noBaselineReorder = await call(optimizeHandler, '/api/optimize/reorder-check', {
    profile_id: noBaselinePreview.id,
    config: free333OrundumConfig,
  })
  if (noBaselineReorder.status !== 409) {
    throw new Error(`免费档案无历史基线重排检测：预期 409，实际 ${noBaselineReorder.status}`)
  }

  const generated = await call(optimizeHandler, '/api/optimize', {
    profile_id: preview.id,
    license: null,
    operators: sampleOperators,
    config: free333OrundumConfig,
    ignore_elite: false,
  })
  if (generated.status !== 200) {
    throw new Error(`免费档案生成排班：预期 200，实际 ${generated.status}`)
  }
  assertFreePreviewResult(generated.body, '免费档案生成响应')

  const workspace = store.workspaces.get(preview.id)
  if (!workspace?.last_result || workspace.result_history.length !== beforeHistoryCount + 1) {
    throw new Error('免费档案生成：预期受限结果写入历史')
  }
  assertFreePreviewResult(workspace.last_result, '免费档案保存的 last_result')
  assertFreePreviewResult(workspace.result_history[0].result, '免费档案保存的历史结果')

  const reorderBeforeHistoryCount = workspace.result_history.length
  const reorderBeforeLastResult = workspace.last_result
  const noNeedReorder = await call(optimizeHandler, '/api/optimize/reorder-check', {
    profile_id: preview.id,
    config: free333OrundumConfig,
    baseline_history_id: workspace.result_history[0].id,
  })
  if (noNeedReorder.status !== 200 || noNeedReorder.body?.recommendation !== 'no_need') {
    throw new Error(`免费档案无变化重排检测：预期 200 no_need，实际 ${noNeedReorder.status}`)
  }
  assertReorderCheckResult(noNeedReorder.body, '免费档案无变化重排检测')
  const reorderWorkspace = store.workspaces.get(preview.id)
  if (reorderWorkspace?.result_history.length !== reorderBeforeHistoryCount || reorderWorkspace.last_result !== reorderBeforeLastResult) {
    throw new Error('免费档案重排检测：不应写入 last_result 或历史')
  }

  const invalidConfigReorder = await call(optimizeHandler, '/api/optimize/reorder-check', {
    profile_id: preview.id,
    config: { ...free333OrundumConfig, trading_stations_count: 4 },
    baseline_history_id: workspace.result_history[0].id,
  })
  if (invalidConfigReorder.status !== 403) {
    throw new Error(`免费档案非法配置重排检测：预期 403，实际 ${invalidConfigReorder.status}`)
  }

  await assertReorderRecommendationFromBaseline('preview-reorder-recommended', cloneWithRoomOperator(workspace.last_result, 'power', 0, { id: 'old-power', name: 'Old Power' }), 'recommended')
  await assertReorderRecommendationFromBaseline('preview-reorder-strong', cloneWithRoomOperator(workspace.last_result, 'trading', 0, { id: 'old-trade', name: 'Old Trader' }), 'strongly_recommended')
  await assertReorderQuotaLimit(workspace.last_result)

  const previewEvents = store.usageEvents.filter((event) => event.profile_id === preview.id)
  if (!previewEvents.some((event) => event.event === 'schedule_generate' && event.status === 'success')) {
    throw new Error('免费档案生成：缺少 schedule_generate 统计事件')
  }
  if (!previewEvents.some((event) => event.event === 'free_preview' && event.status === 'success')) {
    throw new Error('免费档案生成：缺少 free_preview 统计事件')
  }
}

async function assertFreePreviewModeRoundTrip() {
  const preview = seedFreePreviewProfile('preview-mode-round-trip', { bound: true })
  store.workspaces.set(preview.id, {
    ...emptyWorkspace(preview.id),
    operators: sampleOperators,
    config: free333RoundTripConfig,
  })

  const rotationConfig = { ...free333RoundTripConfig, schedule_mode: 'rotation' }
  const rotation = await call(workspaceHandler, '/api/user/workspace', {
    profile_id: preview.id,
    config: rotationConfig,
  }, { method: 'PATCH' })
  const storedRotation = store.workspaces.get(preview.id)?.config
  if (rotation.status !== 200 || !storedRotation?.Fiammetta?.enable || !storedRotation?.drones?.enable) {
    throw new Error(`免费档案模式往返：轮换配置未保留休眠设置，实际 ${rotation.status}`)
  }

  const maa = await call(workspaceHandler, '/api/user/workspace', {
    profile_id: preview.id,
    config: free333RoundTripConfig,
  }, { method: 'PATCH' })
  const storedMaa = store.workspaces.get(preview.id)?.config
  if (maa.status !== 200 || storedMaa?.schedule_mode !== 'maa' || !storedMaa.Fiammetta?.enable || !storedMaa.drones?.enable) {
    throw new Error(`免费档案模式往返：切回 MAA 后设置丢失，实际 ${maa.status}`)
  }

  const generated = await call(optimizeHandler, '/api/optimize', {
    profile_id: preview.id,
    license: null,
    operators: sampleOperators,
    config: free333RoundTripConfig,
    ignore_elite: false,
  })
  if (generated.status !== 200) {
    throw new Error(`免费档案模式往返：切回 MAA 后生成失败，实际 ${generated.status}`)
  }
}

async function assertFreeScheduleEntitlementLifecycle() {
  await assertFreeScheduleRevisionLimit()
  await assertFreeScheduleConfirmLocks()
  await assertFreeScheduleWindowExpiry()
  await assertStrongReorderBonusGeneration()
}

async function assertFreeScheduleRevisionLimit() {
  const profile = seedFreePreviewProfile('preview-entitlement-revisions', { bound: true })
  store.workspaces.set(profile.id, {
    ...emptyWorkspace(profile.id),
    operators: sampleOperators,
    config: free333OrundumConfig,
  })

  const first = await generateFreeSchedule(profile.id)
  if (first.status !== 200) throw new Error(`免费完整排班首次生成：预期 200，实际 ${first.status}`)
  assertEntitlementState(profile.id, {
    revision_count: 1,
    locked: false,
    label: '免费完整排班首次生成',
  })
  if (first.body?.preview_limit?.free_schedule_entitlement?.revision_count !== 1) {
    throw new Error('免费完整排班首次生成：响应缺少权益状态')
  }

  const second = await generateFreeSchedule(profile.id)
  if (second.status !== 200) throw new Error(`免费完整排班第 2 次修正：预期 200，实际 ${second.status}`)
  assertEntitlementState(profile.id, {
    revision_count: 2,
    locked: false,
    label: '免费完整排班第 2 次修正',
  })

  const third = await generateFreeSchedule(profile.id)
  if (third.status !== 200) throw new Error(`免费完整排班第 3 次修正：预期 200，实际 ${third.status}`)
  assertEntitlementState(profile.id, {
    revision_count: 3,
    locked: true,
    lock_reason: 'revision_limit',
    label: '免费完整排班第 3 次修正',
  })

  const beforeBlocked = store.workspaces.get(profile.id)
  const blocked = await generateFreeSchedule(profile.id)
  const afterBlocked = store.workspaces.get(profile.id)
  if (blocked.status !== 403) throw new Error(`免费完整排班第 4 次生成：预期 403，实际 ${blocked.status}`)
  if (afterBlocked?.result_history.length !== beforeBlocked?.result_history.length || afterBlocked?.last_result !== beforeBlocked?.last_result) {
    throw new Error('免费完整排班第 4 次生成：不应写入 last_result 或历史')
  }
}

async function assertFreeScheduleConfirmLocks() {
  const profile = seedFreePreviewProfile('preview-entitlement-confirm', { bound: true })
  store.workspaces.set(profile.id, {
    ...emptyWorkspace(profile.id),
    operators: sampleOperators,
    config: free333OrundumConfig,
  })

  const generated = await generateFreeSchedule(profile.id)
  if (generated.status !== 200) throw new Error(`免费完整排班确认前生成：预期 200，实际 ${generated.status}`)
  const historyId = store.workspaces.get(profile.id)?.result_history[0]?.id
  const confirmed = await call(workspaceHandler, '/api/user/workspace/free-schedule/confirm', {
    profile_id: profile.id,
    result_history_id: historyId,
  }, { method: 'POST' })
  if (confirmed.status !== 200) throw new Error(`免费完整排班确认接口：预期 200，实际 ${confirmed.status}`)
  assertEntitlementState(profile.id, {
    revision_count: 1,
    locked: true,
    lock_reason: 'confirmed',
    label: '免费完整排班确认接口',
  })

  const beforeBlocked = store.workspaces.get(profile.id)
  const blocked = await generateFreeSchedule(profile.id)
  if (blocked.status !== 403) throw new Error(`免费完整排班确认后生成：预期 403，实际 ${blocked.status}`)
  if (store.workspaces.get(profile.id)?.result_history.length !== beforeBlocked?.result_history.length) {
    throw new Error('免费完整排班确认后生成：不应写入历史')
  }
}

async function assertFreeScheduleWindowExpiry() {
  const profile = seedFreePreviewProfile('preview-entitlement-expired', { bound: true })
  const firstGeneratedAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
  store.workspaces.set(profile.id, {
    ...emptyWorkspace(profile.id),
    operators: sampleOperators,
    config: free333OrundumConfig,
    free_schedule_entitlement: createFreeScheduleEntitlement({
      first_generated_at: firstGeneratedAt,
      revision_count: 1,
    }),
  })

  const blocked = await generateFreeSchedule(profile.id)
  if (blocked.status !== 403) throw new Error(`免费完整排班确认期过期生成：预期 403，实际 ${blocked.status}`)
  assertEntitlementState(profile.id, {
    revision_count: 1,
    locked: true,
    lock_reason: 'window_expired',
    label: '免费完整排班确认期过期生成',
  })
}

async function assertStrongReorderBonusGeneration() {
  const profile = seedFreePreviewProfile('preview-entitlement-bonus', { bound: true })
  const baselineResult = cloneWithRoomOperator(
    createBaselineOptimizeResult(),
    'trading',
    0,
    { id: 'old-trade', name: 'Old Trade' },
  )
  const historyItem = createHistoryItem(profile.id, baselineResult)
  const lockedEntitlement = createFreeScheduleEntitlement({
    first_generated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    revision_count: 3,
    locked_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    lock_reason: 'revision_limit',
  })
  store.workspaces.set(profile.id, {
    ...emptyWorkspace(profile.id),
    operators: sampleOperators,
    config: free333OrundumConfig,
    last_result: baselineResult,
    result_history: [historyItem],
    free_schedule_entitlement: lockedEntitlement,
  })

  const beforeCheck = store.workspaces.get(profile.id)
  const checked = await call(optimizeHandler, '/api/optimize/reorder-check', {
    profile_id: profile.id,
    config: free333OrundumConfig,
    baseline_history_id: historyItem.id,
  })
  if (checked.status !== 200 || checked.body?.recommendation !== 'strongly_recommended') {
    throw new Error(`强烈建议重排 bonus 授予：预期 200 strongly_recommended，实际 ${checked.status} ${checked.body?.recommendation}`)
  }
  const granted = store.workspaces.get(profile.id)?.free_schedule_entitlement?.strong_reorder_bonus
  if (!granted || granted.used_at) throw new Error('强烈建议重排 bonus 授予：预期写入未使用的当月 bonus')
  if (store.workspaces.get(profile.id)?.result_history.length !== beforeCheck?.result_history.length) {
    throw new Error('强烈建议重排检测：不应写入排班历史')
  }

  const bonusGenerate = await generateFreeSchedule(profile.id)
  if (bonusGenerate.status !== 200) throw new Error(`强烈建议重排 bonus 生成：预期 200，实际 ${bonusGenerate.status}`)
  const usedBonus = store.workspaces.get(profile.id)?.free_schedule_entitlement?.strong_reorder_bonus
  if (!usedBonus?.used_at) throw new Error('强烈建议重排 bonus 生成：预期标记 used_at')

  const beforeSecondBonus = store.workspaces.get(profile.id)
  const blocked = await generateFreeSchedule(profile.id)
  if (blocked.status !== 403) throw new Error(`强烈建议重排 bonus 二次生成：预期 403，实际 ${blocked.status}`)
  if (store.workspaces.get(profile.id)?.result_history.length !== beforeSecondBonus?.result_history.length) {
    throw new Error('强烈建议重排 bonus 二次生成：不应写入历史')
  }
}

function createBaselineOptimizeResult() {
  return {
    author: 'test',
    title: 'baseline',
    description: 'test baseline',
    schedule_mode: 'maa',
    buildingType: 333,
    planTimes: '3 shifts',
    plans: [{ name: 'A', rooms: createTestRooms() }],
    raw_results: [],
    daily_production: {
      manufacturing: { 'Pure Gold': 1 },
      trading: { LMD: 1 },
      consumption: {},
      net: {},
      drones: {},
    },
  }
}

function createTestRooms() {
  const room = (id, name, product) => ({
    id,
    name,
    product,
    operators: [{ id: 'char_002_amiya', name: 'Amiya' }],
    final_efficiency: 1.23,
    efficiency: 1.23,
  })
  return {
    trading: [
      room('trade-1', 'Trading 1', 'LMD'),
      room('trade-2', 'Trading 2', 'LMD'),
    ],
    manufacture: [
      room('mfg-1', 'Factory 1', 'Pure Gold'),
      room('mfg-2', 'Factory 2', 'Originium Shard'),
    ],
    power: [
      room('power-1', 'Power 1', ''),
    ],
    dormitory: [
      { id: 'dorm-1', name: 'Dorm 1', operators: [] },
    ],
  }
}

async function generateFreeSchedule(profileId) {
  return call(optimizeHandler, '/api/optimize', {
    profile_id: profileId,
    license: null,
    operators: sampleOperators,
    config: free333OrundumConfig,
    ignore_elite: false,
  })
}

function createFreeScheduleEntitlement(overrides = {}) {
  return {
    first_generated_at: null,
    revision_count: 0,
    revision_limit: 3,
    revision_window_hours: 24,
    confirmed_at: null,
    locked_at: null,
    lock_reason: null,
    strong_reorder_bonus: null,
    ...overrides,
  }
}

function assertEntitlementState(profileId, expected) {
  const entitlement = store.workspaces.get(profileId)?.free_schedule_entitlement
  if (!entitlement) throw new Error(`${expected.label}：缺少免费完整排班权益状态`)
  if (entitlement.revision_count !== expected.revision_count) {
    throw new Error(`${expected.label}：revision_count 预期 ${expected.revision_count}，实际 ${entitlement.revision_count}`)
  }
  if (entitlement.revision_limit !== 3 || entitlement.revision_window_hours !== 24) {
    throw new Error(`${expected.label}：权益限制元数据错误`)
  }
  if (expected.locked) {
    if (!entitlement.locked_at || entitlement.lock_reason !== expected.lock_reason) {
      throw new Error(`${expected.label}：预期锁定为 ${expected.lock_reason}，实际 ${entitlement.lock_reason}`)
    }
  } else if (entitlement.locked_at || entitlement.lock_reason) {
    throw new Error(`${expected.label}：不应锁定权益`)
  }
}

async function assertFreeConfigPatchStatus(profileId, config, expectedStatus, label) {
  const result = await call(workspaceHandler, '/api/user/workspace', {
    profile_id: profileId,
    config,
  }, { method: 'PATCH' })
  if (result.status !== expectedStatus) {
    throw new Error(`免费档案配置 ${label}：预期 ${expectedStatus}，实际 ${result.status}`)
  }
}

async function assertOperatorsPatchKeepsHistory() {
  const before = store.workspaces.get('profile-1')
  if (!before?.last_result || before.result_history.length !== 1 || before.saved_configs.length !== 1) {
    throw new Error('operators patch precondition failed')
  }
  const updated = await call(workspaceHandler, '/api/user/workspace', {
    profile_id: 'profile-1',
    operators: sampleOperators,
  }, { method: 'PATCH' })
  const workspace = updated.body.workspace
  if (updated.status !== 200 || workspace.last_result !== null) {
    throw new Error('operators patch: last_result should be cleared')
  }
  if (workspace.result_history.length !== 1 || workspace.saved_configs.length !== 1) {
    throw new Error('operators patch: history and saved configs should be kept')
  }
}

function assertFreePreviewResult(result, label) {
  if (!result || typeof result !== 'object') {
    throw new Error(`${label}: missing result`)
  }
  if (result.preview_limit?.mode !== 'full_rotation_without_export' || result.preview_limit.hidden_room_count !== 0) {
    throw new Error(`${label}: missing full rotation preview metadata`)
  }
  if (countVisibleRooms(result.plans) <= 3) {
    throw new Error(`${label}: expected complete visible plans, got ${countVisibleRooms(result.plans)} rooms`)
  }
  if (!Array.isArray(result.raw_results) || result.raw_results.length !== 0) {
    throw new Error(`${label}: raw_results should be empty`)
  }
  for (const key of ['daily_production', 'maa_default_comparison', 'upgrade_suggestions', 'current_result', 'upgrade_task_payload', 'raw_total_efficiency', 'total_efficiency']) {
    if (key in result) {
      throw new Error(`${label}: leaked ${key}`)
    }
  }
}

function assertReorderCheckResult(result, label) {
  if (!result || typeof result !== 'object') {
    throw new Error(`${label}: missing result`)
  }
  if (!['no_need', 'recommended', 'strongly_recommended'].includes(result.recommendation)) {
    throw new Error(`${label}: invalid recommendation`)
  }
  if (!result.estimated_gain_range || !['equivalent_sanity_per_day', 'room_change_only'].includes(result.estimated_gain_range.unit)) {
    throw new Error(`${label}: invalid gain range`)
  }
  if (!result.quota || result.quota.limit !== 2 || result.quota.timezone !== 'Asia/Shanghai') {
    throw new Error(`${label}: invalid quota`)
  }
  if (!result.baseline?.history_id || !result.baseline.created_at) {
    throw new Error(`${label}: missing baseline metadata`)
  }
  for (const key of ['plans', 'raw_results', 'assignment_detail', 'daily_production', 'upgrade_suggestions', 'maa_default_comparison', 'current_result', 'upgrade_task_payload']) {
    if (key in result) {
      throw new Error(`${label}: leaked ${key}`)
    }
  }
}

async function assertReorderRecommendationFromBaseline(profileId, baselineResult, expectedRecommendation) {
  const profile = seedFreePreviewProfile(profileId, { bound: true })
  const historyItem = createHistoryItem(profileId, baselineResult)
  store.workspaces.set(profile.id, {
    ...emptyWorkspace(profile.id),
    operators: sampleOperators,
    config: free333OrundumConfig,
    last_result: baselineResult,
    result_history: [historyItem],
  })
  const checked = await call(optimizeHandler, '/api/optimize/reorder-check', {
    profile_id: profile.id,
    config: free333OrundumConfig,
    baseline_history_id: historyItem.id,
  })
  if (checked.status !== 200 || checked.body?.recommendation !== expectedRecommendation) {
    throw new Error(`免费档案重排检测 ${expectedRecommendation}：预期 200 ${expectedRecommendation}，实际 ${checked.status} ${checked.body?.recommendation}`)
  }
  assertReorderCheckResult(checked.body, `免费档案重排检测 ${expectedRecommendation}`)
  const bonus = store.workspaces.get(profile.id)?.free_schedule_entitlement?.strong_reorder_bonus
  if (expectedRecommendation === 'strongly_recommended') {
    if (!bonus || bonus.used_at) throw new Error('免费档案强烈建议重排：预期授予未使用的当月额外生成权益')
  } else if (bonus) {
    throw new Error(`免费档案重排检测 ${expectedRecommendation}：不应授予额外生成权益`)
  }
}

async function assertReorderQuotaLimit(baselineResult) {
  const profile = seedFreePreviewProfile('preview-reorder-quota', { bound: true })
  const historyItem = createHistoryItem(profile.id, baselineResult)
  store.workspaces.set(profile.id, {
    ...emptyWorkspace(profile.id),
    operators: sampleOperators,
    config: free333OrundumConfig,
    last_result: baselineResult,
    result_history: [historyItem],
  })

  const failedBeforeQuota = await call(optimizeHandler, '/api/optimize/reorder-check', {
    profile_id: profile.id,
    config: { ...free333OrundumConfig, optimizer_search: { max_iterations: 999 } },
    baseline_history_id: historyItem.id,
  })
  if (failedBeforeQuota.status !== 403) {
    throw new Error(`免费档案重排检测额度预检失败：预期 403，实际 ${failedBeforeQuota.status}`)
  }

  for (let index = 0; index < 2; index++) {
    const checked = await call(optimizeHandler, '/api/optimize/reorder-check', {
      profile_id: profile.id,
      config: free333OrundumConfig,
      baseline_history_id: historyItem.id,
    })
    if (checked.status !== 200 || checked.body?.quota?.used !== index + 1) {
      throw new Error(`免费档案重排检测额度成功 ${index + 1}：预期已用 ${index + 1}，实际 ${checked.status}`)
    }
  }

  const exceeded = await call(optimizeHandler, '/api/optimize/reorder-check', {
    profile_id: profile.id,
    config: free333OrundumConfig,
    baseline_history_id: historyItem.id,
  })
  if (exceeded.status !== 429 || exceeded.body?.code !== 'reorder_check_quota_exceeded' || exceeded.body?.quota?.remaining !== 0) {
    throw new Error(`免费档案重排检测额度耗尽：预期 429 且包含额度信息，实际 ${exceeded.status}`)
  }
}

function createHistoryItem(profileId, result) {
  const now = new Date().toISOString()
  return {
    id: `history-${profileId}`,
    name: `History ${profileId}`,
    created_at: now,
    config: free333OrundumConfig,
    result,
    operator_count: sampleOperators.length,
    source: 'generated',
  }
}

function cloneWithRoomOperator(result, roomType, roomIndex, operator) {
  const cloned = JSON.parse(JSON.stringify(result))
  const room = cloned?.plans?.[0]?.rooms?.[roomType]?.[roomIndex]
  if (!room) throw new Error(`test baseline missing ${roomType} room ${roomIndex}`)
  room.operators = [operator]
  return cloned
}

function countVisibleRooms(plans) {
  if (!Array.isArray(plans)) return 0
  let count = 0
  for (const plan of plans) {
    for (const rooms of Object.values(plan?.rooms ?? {})) {
      if (!Array.isArray(rooms)) continue
      count += rooms.filter((room) => Array.isArray(room?.operators) && room.operators.length > 0).length
    }
  }
  return count
}

async function call(handler, path, body = {}, init = {}) {
  const method = init.method ?? 'POST'
  const requestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      cookie: init.auth === false ? '' : 'maa_session=test-session',
    },
  }
  if (method !== 'GET' && method !== 'HEAD') {
    requestInit.body = JSON.stringify(body)
  }
  const response = await handler(new Request('http://local' + path, requestInit))
  const text = await response.text()
  const parsed = text ? JSON.parse(text) : null
  if (path === '/api/optimize' && response.status === 202 && parsed?.job_id) {
    return await waitForOptimizeJob(handler, parsed.job_id)
  }
  return { status: response.status, body: parsed }
}

async function waitForOptimizeJob(handler, jobId) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5))
    const response = await handler(new Request('http://local/api/optimize/job?id=' + encodeURIComponent(jobId), {
      method: 'GET',
      headers: { cookie: 'maa_session=test-session' },
    }))
    const text = await response.text()
    const body = text ? JSON.parse(text) : null
    if (body?.status === 'succeeded') return { status: 200, body: body.result }
    if (body?.status === 'failed') return { status: 500, body }
  }
  throw new Error('optimize job did not finish')
}
async function bundleHandler(entryPoint) {
  const outputPath = resolve(bundleDir, `${entryPoint.replace(/[\\/.:]/g, '-')}.mjs`)
  const result = await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: 'node',
    format: 'esm',
    external: ['pg'],
    write: false,
    plugins: [memoryStorePlugin()],
  })
  await writeFile(outputPath, result.outputFiles[0].text, 'utf8')
  const module = await import(`${pathToFileURL(outputPath).href}?t=${Date.now()}-${Math.random()}`)
  return module.default ?? module
}

function memoryStorePlugin() {
  return {
    name: 'workspace-history-memory-store',
    setup(build) {
      build.onResolve({ filter: /(^|[\\/])user-store(\.ts)?$/ }, () => ({
        path: 'memory-user-store',
        namespace: 'workspace-history-smoke',
      }))
      build.onResolve({ filter: /(^|[\\/])user-auth(\.ts)?$/ }, () => ({
        path: 'memory-user-auth',
        namespace: 'workspace-history-smoke',
      }))
      build.onResolve({ filter: /(^|[\\/])license-utils(\.ts)?$/ }, () => ({
        path: 'memory-license-utils',
        namespace: 'workspace-history-smoke',
      }))
      build.onResolve({ filter: /(^|[\\/])usage-stats(\.ts)?$/ }, () => ({
        path: 'memory-usage-stats',
        namespace: 'workspace-history-smoke',
      }))
      build.onResolve({ filter: /(^|[\\/])training-cost(\.ts)?$/ }, () => ({
        path: 'memory-training-cost',
        namespace: 'workspace-history-smoke',
      }))
      build.onResolve({ filter: /(^|[\\/])optimizer(\.ts)?$/ }, () => ({
        path: 'memory-optimizer',
        namespace: 'workspace-history-smoke',
      }))
      build.onResolve({ filter: /build-meta$/ }, () => ({
        path: 'memory-build-meta',
        namespace: 'workspace-history-smoke',
      }))
      build.onLoad({ filter: /.*/, namespace: 'workspace-history-smoke' }, (args) => ({
        contents: memoryModule(args.path),
        loader: 'js',
      }))
    },
  }
}

function memoryModule(path) {
  if (path === 'memory-user-store') return memoryUserStoreModule()
  if (path === 'memory-user-auth') return memoryUserAuthModule()
  if (path === 'memory-license-utils') return memoryLicenseUtilsModule()
  if (path === 'memory-usage-stats') return memoryUsageStatsModule()
  if (path === 'memory-training-cost') return 'export async function attachTrainingCostsToUpgradeSuggestions({ suggestions }) { return suggestions }'
  if (path === 'memory-optimizer') return memoryOptimizerModule()
  return 'export const APP_BUILD_META = { frontend_version: "test", backend_version: "test", data_version: "test", generated_at: "test", source_summary: "test" }'
}

function memoryUsageStatsModule() {
  return `
    export async function recordUsageEvent(event, payload = {}) {
      const now = new Date().toISOString()
      globalThis.__workspaceHistorySmokeStore.usageEvents.push({ id: 'usage-' + globalThis.__workspaceHistorySmokeStore.usageEvents.length, event, created_at: now, date: now.slice(0, 10), ...payload })
    }
export async function countSuccessfulUsageEventsForProfileInRange(event, profileId, startAt, endAt) {
  return globalThis.__workspaceHistorySmokeStore.usageEvents.filter((record) =>
    record.event === event &&
    record.profile_id === profileId &&
    record.status !== 'failure' &&
    record.created_at >= startAt &&
    record.created_at < endAt
  ).length
}
export async function getScheduleGenerateDurationStatsByBucket(bucket, startAt, endAt) {
  const durations = globalThis.__workspaceHistorySmokeStore.usageEvents
    .filter((record) =>
      record.event === 'schedule_generate' &&
      record.status !== 'failure' &&
      record.estimate_bucket === bucket &&
      record.created_at >= startAt &&
      record.created_at < endAt &&
      Number.isFinite(record.duration_ms)
    )
    .map((record) => Math.max(0, Math.round(record.duration_ms)))
    .sort((left, right) => left - right)
  const index = Math.min(durations.length - 1, Math.max(0, Math.ceil(0.95 * durations.length) - 1))
  return { p95_ms: durations[index] ?? 0, sample_count: durations.length }
}
`
}

function memoryUserStoreModule() {
  return `
    const store = globalThis.__workspaceHistorySmokeStore
export function emptyWorkspace(profileId) {
return { version: 1, profile_id: profileId, operators: null, config: null, elite_overrides: {}, last_result: null, saved_configs: [], result_history: [], free_schedule_entitlement: null, updated_at: new Date().toISOString() }
}
    export async function listProfilesForUser(userId) {
      return [...store.profiles.values()].filter((profile) => profile.user_id === userId)
    }
    export async function getProfileForUser(userId, profileId) {
      const profile = store.profiles.get(profileId)
      return profile?.user_id === userId ? profile : null
    }
    export async function saveUserProfile(profile) {
      store.profiles.set(profile.id, profile)
    }
    export async function getOrCreateDepotValueProfile(user) {
      const existing = [...store.profiles.values()].find((profile) => profile.user_id === user.id && profile.kind === 'depot_value')
      if (existing) return existing
      const now = new Date().toISOString()
      const profile = { version: 1, id: 'depot-' + user.id, user_id: user.id, kind: 'depot_value', cdk_key: null, cdk_code_hash: null, cdk_order_hash: null, permission: 'growth', status: 'active', display_name: 'Depot analysis', note: '', created_at: now, updated_at: now }
      store.profiles.set(profile.id, profile)
      return profile
    }
    export async function getProfileWorkspace(profileId) {
      return store.workspaces.get(profileId) ?? null
    }
    export async function getWorkspace(profileId) {
      return store.workspaces.get(profileId) ?? null
    }
    export function isDepotValueProfile(profile) {
      return profile?.kind === 'depot_value'
    }
    export function isFreePreviewProfile(profile) {
      return profile?.kind === 'free_preview'
    }
    export async function saveProfileWorkspace(workspace) {
      store.workspaces.set(workspace.profile_id, normalizeWorkspace(workspace))
    }
    export async function saveWorkspace(workspace) {
      store.workspaces.set(workspace.profile_id, normalizeWorkspace(workspace))
    }
    export function toPublicWorkspace(workspace) {
      const normalized = workspace ? normalizeWorkspace(workspace) : null
      return {
        profile_id: normalized?.profile_id ?? null,
        operators: normalized?.operators ?? null,
        config: normalized?.config ?? null,
        elite_overrides: normalized?.elite_overrides ?? {},
        last_result: normalized?.last_result ?? null,
        saved_configs: normalized?.saved_configs ?? [],
result_history: normalized?.result_history ?? [],
free_schedule_entitlement: normalized?.free_schedule_entitlement ?? null,
updated_at: normalized?.updated_at ?? null,
}
    }
    export function toPublicProfile(profile, workspace) {
      return {
        id: profile.id,
        user_id: profile.user_id,
        kind: profile.kind,
        permission: profile.permission,
        status: profile.status,
        cdk_order_hash: profile.cdk_order_hash,
        display_name: profile.display_name,
        note: profile.note,
        skland_binding: profile.skland_binding ? { uid: profile.skland_binding.uid, nickname: profile.skland_binding.nickname, channel_name: profile.skland_binding.channel_name, bound_at: profile.skland_binding.bound_at, last_imported_at: profile.skland_binding.last_imported_at, credential_status: 'available', credential_invalid_at: null, credential_invalid_reason: null } : null,
        operator_count: workspace?.operators?.length ?? 0,
        updated_at: workspace?.updated_at ?? profile.updated_at,
        created_at: profile.created_at,
      }
    }
    function normalizeWorkspace(workspace) {
      return { ...emptyWorkspace(workspace.profile_id), ...workspace, saved_configs: Array.isArray(workspace.saved_configs) ? workspace.saved_configs.slice(0, 20) : [], result_history: Array.isArray(workspace.result_history) ? workspace.result_history.slice(0, 10) : [] }
    }
  `
}

function memoryUserAuthModule() {
  return `
    const store = globalThis.__workspaceHistorySmokeStore
    export function jsonResponse(body, status = 200, headers = {}) {
      return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { ...(status === 204 ? {} : { 'Content-Type': 'application/json' }), ...headers } })
    }
    export async function requireUserSession(req) {
      if (!req.headers.get('cookie')?.includes('maa_session=test-session')) return null
      const activeProfile = store.profiles.get('profile-1') ?? null
      return { user: store.user, session: {}, tokenHash: 'test', profiles: [...store.profiles.values()], activeProfile, cdkRecord: null }
    }
    export async function createOrReusePreviewProfile(user, displayNameValue, noteValue) {
      const existing = [...store.profiles.values()].find((profile) => profile.user_id === user.id && profile.kind === 'free_preview')
      const displayName = normalizeDisplayName(displayNameValue)
      const note = normalizeNote(noteValue)
      if (existing) {
        const updated = { ...existing, display_name: displayName || existing.display_name, note: note || existing.note, updated_at: new Date().toISOString() }
        store.profiles.set(updated.id, updated)
        return { ok: true, profile: updated }
      }
      return { ok: false, status: 400, message: '免费个人排班档案必须通过森空岛登录领取。' }
    }
    export async function upgradePreviewProfileWithCdk(user, profileIdValue, cdkValue, displayNameValue, noteValue) {
      const profileId = typeof profileIdValue === 'string' ? profileIdValue.trim() : ''
      const profile = store.profiles.get(profileId)
      if (!profile || profile.user_id !== user.id) return { ok: false, status: 404, message: '档案不存在。' }
      if (profile.kind !== 'free_preview') return { ok: false, status: 400, message: '只有免费个人排班档案可以原地升级。' }
      const cdk = typeof cdkValue === 'string' ? cdkValue.trim() : ''
      if (!cdk) return { ok: false, status: 400, message: '缺少 CDK。' }
      const record = store.cdks.get(cdk)
      if (!record) return { ok: false, status: 404, message: 'CDK 不存在。' }
      if (record.status !== 'unused') return { ok: false, status: 409, message: 'CDK 已被使用。' }
      const now = new Date().toISOString()
      const displayName = normalizeDisplayName(displayNameValue)
      const note = normalizeNote(noteValue)
      const upgraded = { ...profile, kind: 'cdk', cdk_key: 'cdk/' + cdk + '.json', cdk_code_hash: 'hash-' + cdk, cdk_order_hash: record.license_order_hash || 'order-' + profile.id, permission: record.permission || 'growth', display_name: displayName || profile.display_name, note: note || profile.note, updated_at: now }
      store.profiles.set(upgraded.id, upgraded)
      if (!store.workspaces.has(upgraded.id)) store.workspaces.set(upgraded.id, emptyWorkspace(upgraded.id))
      store.cdks.set(cdk, { ...record, status: 'used', used_at: now, account_id: user.id, profile_id: upgraded.id, license_order_hash: upgraded.cdk_order_hash })
      return { ok: true, profile: upgraded }
    }
    export async function redeemProfileCdk(user, cdkValue, displayNameValue, noteValue) {
      const cdk = typeof cdkValue === 'string' ? cdkValue.trim() : ''
      if (!cdk) return { ok: false, status: 400, message: '缺少 CDK。' }
      const record = store.cdks.get(cdk) || { status: 'unused', permission: 'growth', license_order_hash: 'order-' + cdk }
      if (record.status !== 'unused') return { ok: false, status: 409, message: 'CDK 已被使用。' }
      const now = new Date().toISOString()
      const id = 'cdk-profile-' + (++store.profileCounter)
      const profile = { version: 1, id, user_id: user.id, kind: 'cdk', cdk_key: 'cdk/' + cdk + '.json', cdk_code_hash: 'hash-' + cdk, cdk_order_hash: record.license_order_hash, permission: record.permission, status: 'active', display_name: normalizeDisplayName(displayNameValue) || 'Account', note: normalizeNote(noteValue), created_at: now, updated_at: now }
      store.profiles.set(id, profile)
      store.workspaces.set(id, emptyWorkspace(id))
      store.cdks.set(cdk, { ...record, status: 'used', used_at: now, account_id: user.id, profile_id: id })
      return { ok: true, profile }
    }
    export async function buildAuthPayload(user, activeProfileId) {
      const active = store.profiles.get(activeProfileId) ?? store.profiles.get('profile-1') ?? null
      return {
        user: toPublicUser(user),
        profiles: [...store.profiles.values()].map(toPublicProfile),
        active_profile: active ? toPublicProfile(active) : null,
        workspace: active ? toPublicWorkspace(store.workspaces.get(active.id) ?? null) : null,
        announcement_unread_count: 0,
      }
    }
    export function toPublicUser(user) {
      return { id: user.id, email: user.email, permission: user.permission, status: user.status, cdk_status: user.cdk_key ? 'used' : 'none', cdk_order_hash: user.cdk_order_hash ?? null, created_at: user.created_at }
    }
    function toPublicProfile(profile) {
      const workspace = store.workspaces.get(profile.id) ?? null
      return { id: profile.id, user_id: profile.user_id, kind: profile.kind, permission: profile.permission, status: profile.status, cdk_order_hash: profile.cdk_order_hash, display_name: profile.display_name, note: profile.note, skland_binding: profile.skland_binding ? { uid: profile.skland_binding.uid, nickname: profile.skland_binding.nickname, channel_name: profile.skland_binding.channel_name, bound_at: profile.skland_binding.bound_at, last_imported_at: profile.skland_binding.last_imported_at, credential_status: 'available', credential_invalid_at: null, credential_invalid_reason: null } : null, operator_count: workspace?.operators?.length ?? 0, updated_at: workspace?.updated_at ?? profile.updated_at, created_at: profile.created_at }
    }
    function toPublicWorkspace(workspace) {
      return {
        profile_id: workspace?.profile_id ?? null,
        operators: workspace?.operators ?? null,
        config: workspace?.config ?? null,
        elite_overrides: workspace?.elite_overrides ?? {},
        last_result: workspace?.last_result ?? null,
        saved_configs: workspace?.saved_configs ?? [],
        result_history: workspace?.result_history ?? [],
        updated_at: workspace?.updated_at ?? null,
      }
    }
    function emptyWorkspace(profileId) {
      return { version: 1, profile_id: profileId, operators: null, config: null, elite_overrides: {}, last_result: null, saved_configs: [], result_history: [], updated_at: new Date().toISOString() }
    }
    function normalizeDisplayName(value) {
      return typeof value === 'string' ? value.trim().slice(0, 40) : ''
    }
    function normalizeNote(value) {
      return typeof value === 'string' ? value.trim().slice(0, 500) : ''
    }
  `
}

function memoryLicenseUtilsModule() {
  return `
    export function canUseUpgradeFeatures() { return true }
    export function canonicalJson(obj) {
      if (obj === null || typeof obj !== 'object') return JSON.stringify(obj)
      if (Array.isArray(obj)) return '[' + obj.map(canonicalJson).join(',') + ']'
      return '{' + Object.keys(obj).sort().map((key) => JSON.stringify(key) + ':' + canonicalJson(obj[key])).join(',') + '}'
    }
    export function evaluateClientBindingRisk() { return { ok: true } }
    export function evaluateOperatorRisk() { return { ok: true } }
    export function formatBindingBlockMessage() { return 'blocked' }
    export function formatOperatorRiskBlockMessage() { return 'blocked' }
    export function formatRiskFreezeMessage(message) { return message }
    export async function freezeCdkRecord(record) { return record }
    export function getPermissionMode(license) { return license?.permission ?? 'advanced' }
    export async function getCdkRecordStore() { return { get: async () => null, set: async () => undefined } }
    export async function getRiskControlSettings() { return { operator_data_risk_enabled: true, device_risk_enabled: false, updated_at: null } }
    export async function findCdkRecordByLicenseOrderHash() { return null }
    export async function incrementCdkScheduleGenerateCount() {}
    export function normalizePermissionMode(permission) { return permission ?? 'advanced' }
    export async function recordSoftBlockedRiskEvent() { return { message: 'blocked', frozen: false } }
    export function resolveConfigForPermission(_permission, config) {
      if (config?.permission_blocked) return { ok: false, message: 'permission blocked' }
      return validateConfig(config)
    }
    export function resolveFreePreviewConfig(config) {
      const valid = validateConfig(config)
      if (!valid.ok) return valid
      if (config.permission_blocked) return { ok: false, message: 'permission blocked' }
      if (config.optimizer_search) return { ok: false, message: '免费个人排班不允许设置 optimizer_search' }
      if (!matchesFreePreset(config)) return { ok: false, message: '免费个人排班仅支持预设布局' }
      if (hasForbiddenDroneConfig(config)) return { ok: false, message: '免费个人排班不允许高级无人机策略' }
      return { ok: true, config: { ...config, optimizer_search: undefined } }
    }
    export function requireEnv() { return 'secret' }
    export function shouldFreezeBindingRisk() { return false }
    export function validateConfig(config) {
      if (!config || typeof config !== 'object') return { ok: false, message: 'invalid config' }
      if (!Number.isInteger(config.trading_stations_count) || !Number.isInteger(config.manufacturing_stations_count)) return { ok: false, message: 'invalid station counts' }
      return { ok: true, config }
    }
    export function validateLicenseForRequest(license) { return license ? { ok: true, license } : { ok: false, message: 'invalid license' } }
    export function validateOperators(operators) { return Array.isArray(operators) ? { ok: true, operators } : { ok: false, message: 'invalid operators' } }
    export function verifyLicenseSignature() { return true }
    function matchesFreePreset(config) {
      return matchesPreset(config, {
        layout: '2-4-3',
        trading: { LMD: 2 },
        manufacturing: { 'Pure Gold': 2, 'Battle Record': 2 },
        tradingCount: 2,
        manufacturingCount: 4,
      }) || matchesPreset(config, {
        layout: '2-4-3',
        trading: { LMD: 2 },
        manufacturing: { 'Pure Gold': 2, 'Originium Shard': 2 },
        tradingCount: 2,
        manufacturingCount: 4,
      }) || matchesPreset(config, {
        layout: '3-3-3',
        trading: { LMD: 2, Orundum: 1 },
        manufacturing: { 'Pure Gold': 2, 'Originium Shard': 1 },
        tradingCount: 3,
        manufacturingCount: 3,
      })
    }
    function matchesPreset(config, preset) {
      return config.layout === preset.layout
        && config.trading_stations_count === preset.tradingCount
        && config.manufacturing_stations_count === preset.manufacturingCount
        && sameCounts(config.product_requirements?.trading_stations, preset.trading)
        && sameCounts(config.product_requirements?.manufacturing_stations, preset.manufacturing)
    }
    function sameCounts(actual, expected) {
      const normalize = (value) => Object.fromEntries(Object.entries(value ?? {}).filter(([, count]) => Number(count) > 0).sort(([a], [b]) => a.localeCompare(b)))
      return JSON.stringify(normalize(actual)) === JSON.stringify(normalize(expected))
    }
    function hasForbiddenDroneConfig(config) {
      if (!config.drones) return false
      const drone = config.drones
      if (drone.enable === false) return false
      const presetDrone = drone.enable === true
        && drone.auto === true
        && (drone.order ?? 'pre') === 'pre'
        && JSON.stringify(drone.targets ?? []) === JSON.stringify(['LMD', 'Pure Gold', 'LMD'])
        && !drone.auto_strategy
        && !drone.auto_target_product
      const inventoryAssist = config.auto_balance_source === 'intermediate_inventory'
        && config.intermediate_inventory
        && drone.enable === true
        && drone.auto === true
        && drone.auto_strategy === 'trading_priority'
        && !drone.targets
        && !drone.order
        && !drone.auto_target_product
      return !(presetDrone || inventoryAssist)
    }
  `
}

function memoryOptimizerModule() {
  return `
    const previewRooms = {
      trading: [
        room('trade-1', 'Trading 1', 'LMD'),
        room('trade-2', 'Trading 2', 'LMD'),
      ],
      manufacture: [
        room('mfg-1', 'Factory 1', 'Pure Gold'),
        room('mfg-2', 'Factory 2', 'Originium Shard'),
      ],
      power: [
        room('power-1', 'Power 1', ''),
      ],
      dormitory: [
        { id: 'dorm-1', name: 'Dorm 1', operators: [] },
      ],
    }
    function room(id, name, product) {
      return { id, name, product, operators: [{ id: 'char_002_amiya', name: 'Amiya' }], final_efficiency: 1.23, efficiency: 1.23 }
    }
    export class WorkplaceOptimizer {
      constructor(operators, config) {
        this.operators = operators
        this.config = config
      }
      getOptimalAssignments(_unused, ignoreElite) {
        return {
          author: 'test',
          title: ignoreElite ? 'potential' : 'current',
          description: 'test result',
          schedule_mode: this.config.schedule_mode ?? 'maa',
          buildingType: 243,
          planTimes: '3 shifts',
          plans: [{ name: 'A', rooms: previewRooms }],
          raw_results: [{ totalEfficiency: ignoreElite ? 200 : 100, assignmentDetail: [{ room: 'trade-1' }] }],
          daily_production: {
            manufacturing: { 'Pure Gold': 1 },
            trading: { LMD: 1 },
            consumption: {},
            net: {},
            drones: {},
          },
          total_efficiency: ignoreElite ? 200 : 100,
        }
      }
      simulateMaaDefaultAssignments() {
        return {
          plans: [{ name: 'Default', rooms: previewRooms }],
          raw_results: [{ totalEfficiency: 50, assignmentDetail: [] }],
          daily_production: {
            manufacturing: { 'Pure Gold': 0.5 },
            trading: { LMD: 0.5 },
            consumption: {},
            net: {},
            drones: {},
          },
          shift_hours: [8, 16, 24],
        }
      }
      calculateDailyProduction() {
        return {
          manufacturing: { 'Pure Gold': 1 },
          trading: { LMD: 1 },
          consumption: {},
          net: {},
          drones: {},
        }
      }
      calculateUpgradeTargetSuggestions() { return [] }
      collectUpgradeTasks() { return [] }
      simulateUpgradeTasks() { return [] }
      _calculateDailyTotalScore() { return 0 }
      extractFiammettaTargets() { return [] }
    }
  `
}

function seedFreePreviewProfile(id, { bound }) {
  const now = new Date().toISOString()
  const profile = {
    version: 1,
    id,
    user_id: store.user.id,
    kind: 'free_preview',
    cdk_key: null,
    cdk_code_hash: null,
    cdk_order_hash: null,
    permission: 'growth',
    status: 'active',
    display_name: '免费个人排班',
    note: '',
    skland_binding: bound ? {
      uid: `${id}-uid`,
      nickname: `${id}-doctor`,
      channel_name: 'official',
      encrypted_cred: 'SKLAND-V1:test',
      bound_at: now,
      last_imported_at: now,
      credential_status: 'available',
      credential_invalid_at: null,
      credential_invalid_reason: null,
    } : null,
    skland_pending_binding: null,
    skland_risk: null,
    created_at: now,
    updated_at: now,
  }
  store.profiles.set(id, profile)
  return profile
}

function createMemoryOptimizeJobStore() {
  const records = new Map()
  const clone = (value) => JSON.parse(JSON.stringify(value))
  const activeStatuses = new Set(['queued', 'running'])
  return {
    records,
    createJob: async (input) => {
      const now = input.created_at || new Date().toISOString()
      const record = { id: input.id, status: 'queued', priority: input.priority, owner_key: input.owner_key, permission: input.permission, source: input.source, payload_json: clone(input.payload_json), result_json: null, error_message: null, attempt_count: 0, lock_token: null, lock_expires_at: null, created_at: now, started_at: null, finished_at: null, updated_at: now }
      records.set(record.id, record)
      return clone(record)
    },
    getJob: async (id) => records.has(id) ? clone(records.get(id)) : null,
    findActiveByOwnerKey: async (ownerKey) => [...records.values()].filter((job) => job.owner_key === ownerKey && activeStatuses.has(job.status)).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] || null,
    getQueuePosition: async (id) => {
      const job = records.get(id)
      if (!job || job.status !== 'queued') return null
      return [...records.values()].filter((candidate) => candidate.status === 'queued' && (candidate.priority > job.priority || (candidate.priority === job.priority && Date.parse(candidate.created_at) < Date.parse(job.created_at)))).length + 1
    },
    claimNextJob: async (lockToken, lockExpiresAt, maxAttempts) => {
      const next = [...records.values()].filter((job) => job.status === 'queued' && job.attempt_count < maxAttempts).sort((a, b) => b.priority - a.priority || Date.parse(a.created_at) - Date.parse(b.created_at))[0]
      if (!next) return null
      const now = new Date().toISOString()
      next.status = 'running'
      next.attempt_count += 1
      next.lock_token = lockToken
      next.lock_expires_at = lockExpiresAt
      next.started_at ||= now
      next.updated_at = now
      return clone(next)
    },
    markSucceeded: async (id, lockToken, result) => {
      const job = records.get(id)
      if (!job || job.lock_token !== lockToken) return
      const now = new Date().toISOString()
      job.status = 'succeeded'
      job.result_json = clone(result)
      job.lock_token = null
      job.lock_expires_at = null
      job.finished_at = now
      job.updated_at = now
    },
    markFailed: async (id, lockToken, message) => {
      const job = records.get(id)
      if (!job || job.lock_token !== lockToken) return
      const now = new Date().toISOString()
      job.status = 'failed'
      job.error_message = message
      job.lock_token = null
      job.lock_expires_at = null
      job.finished_at = now
      job.updated_at = now
    },
    heartbeat: async () => undefined,
    resetExpiredRunningJobs: async () => undefined,
    cleanupOldJobs: async () => undefined,
  }
}
function createMemoryStore() {
  const now = new Date().toISOString()
  return {
    user: { id: 'user-1', email: 'user@example.com', permission: 'advanced', status: 'active', created_at: now },
    profiles: new Map([['profile-1', {
      version: 1,
      id: 'profile-1',
      user_id: 'user-1',
      kind: 'cdk',
      cdk_key: null,
      cdk_code_hash: null,
      cdk_order_hash: 'order-1',
      permission: 'advanced',
      status: 'active',
      display_name: 'Main',
      note: '',
      skland_binding: null,
      skland_pending_binding: null,
      skland_risk: null,
      created_at: now,
      updated_at: now,
    }]]),
    workspaces: new Map(),
    cdks: new Map(),
    usageEvents: [],
    profileCounter: 0,
  }
}

function emptyWorkspace(profileId) {
  return { version: 1, profile_id: profileId, operators: null, config: null, elite_overrides: {}, last_result: null, saved_configs: [], result_history: [], free_schedule_entitlement: null, updated_at: new Date().toISOString() }
}
