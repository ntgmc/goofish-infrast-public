import * as esbuild from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const bundleDir = resolve('.cache/check-workspace-history')
await mkdir(bundleDir, { recursive: true })

const store = createMemoryStore()
globalThis.__workspaceHistorySmokeStore = store

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
await assertSavedConfigLimitAndPermission()
await assertOptimizeHistory()
await assertFreePreviewWorkspaceAndOptimizeLimits()
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
    display_name: 'free preview',
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
    display_name: 'Updated free preview',
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
    throw new Error(`free preview unbound save: expected 403, got ${unboundSave.status}`)
  }

  const unboundOptimize = await call(optimizeHandler, '/api/optimize', {
    profile_id: unboundPreview.id,
    license: null,
    operators: sampleOperators,
    config: free333OrundumConfig,
    ignore_elite: false,
  })
  if (unboundOptimize.status !== 403) {
    throw new Error(`free preview unbound optimize: expected 403, got ${unboundOptimize.status}`)
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
    throw new Error(`free preview operators patch: expected 403, got ${operatorsPatch.status}`)
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
  await assertFreeConfigPatchStatus(preview.id, { ...free333OrundumConfig, drones: { enable: true, auto: true, targets: ['LMD'] } }, 403, 'advanced drone strategy')

  await assertFreeConfigPatchStatus(preview.id, free243BalancedConfig, 200, '243 balanced')
  await assertFreeConfigPatchStatus(preview.id, free243OrundumInventoryConfig, 200, '243 orundum with inventory assist')
  await assertFreeConfigPatchStatus(preview.id, free333OrundumConfig, 200, '333 orundum')

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
    throw new Error(`free preview suggestions_only: expected 403 without history append, got ${suggestionsOnly.status}`)
  }

  const generated = await call(optimizeHandler, '/api/optimize', {
    profile_id: preview.id,
    license: null,
    operators: sampleOperators,
    config: free333OrundumConfig,
    ignore_elite: false,
  })
  if (generated.status !== 200) {
    throw new Error(`free preview optimize: expected 200, got ${generated.status}`)
  }
  assertFreePreviewResult(generated.body, 'free preview optimize response')

  const workspace = store.workspaces.get(preview.id)
  if (!workspace?.last_result || workspace.result_history.length !== beforeHistoryCount + 1) {
    throw new Error('free preview optimize: expected limited result stored in history')
  }
  assertFreePreviewResult(workspace.last_result, 'free preview stored last_result')
  assertFreePreviewResult(workspace.result_history[0].result, 'free preview stored history')

  const previewEvents = store.usageEvents.filter((event) => event.profile_id === preview.id)
  if (!previewEvents.some((event) => event.event === 'schedule_generate' && event.status === 'success')) {
    throw new Error('free preview optimize: missing schedule_generate usage event')
  }
  if (!previewEvents.some((event) => event.event === 'free_preview' && event.status === 'success')) {
    throw new Error('free preview optimize: missing free_preview usage event')
  }
}

async function assertFreeConfigPatchStatus(profileId, config, expectedStatus, label) {
  const result = await call(workspaceHandler, '/api/user/workspace', {
    profile_id: profileId,
    config,
  }, { method: 'PATCH' })
  if (result.status !== expectedStatus) {
    throw new Error(`free preview config ${label}: expected ${expectedStatus}, got ${result.status}`)
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
  const response = await handler(new Request(`http://local${path}`, requestInit))
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}

async function bundleHandler(entryPoint) {
  const outputPath = resolve(bundleDir, `${entryPoint.replace(/[\\/.:]/g, '-')}.mjs`)
  const result = await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: 'node',
    format: 'esm',
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
  if (path === 'memory-usage-stats') return 'export async function recordUsageEvent(event, payload = {}) { globalThis.__workspaceHistorySmokeStore.usageEvents.push({ event, ...payload }) }'
  if (path === 'memory-training-cost') return 'export async function attachTrainingCostsToUpgradeSuggestions({ suggestions }) { return suggestions }'
  if (path === 'memory-optimizer') return memoryOptimizerModule()
  return 'export const APP_BUILD_META = { frontend_version: "test", backend_version: "test", data_version: "test", generated_at: "test", source_summary: "test" }'
}

function memoryUserStoreModule() {
  return `
    const store = globalThis.__workspaceHistorySmokeStore
    export function emptyWorkspace(profileId) {
      return { version: 1, profile_id: profileId, operators: null, config: null, elite_overrides: {}, last_result: null, saved_configs: [], result_history: [], updated_at: new Date().toISOString() }
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
      return { ok: false, status: 400, message: 'Free preview profiles must be claimed with Skland login.' }
    }
    export async function upgradePreviewProfileWithCdk(user, profileIdValue, cdkValue, displayNameValue, noteValue) {
      const profileId = typeof profileIdValue === 'string' ? profileIdValue.trim() : ''
      const profile = store.profiles.get(profileId)
      if (!profile || profile.user_id !== user.id) return { ok: false, status: 404, message: 'Profile does not exist.' }
      if (profile.kind !== 'free_preview') return { ok: false, status: 400, message: 'Only free preview profiles can be upgraded in place.' }
      const cdk = typeof cdkValue === 'string' ? cdkValue.trim() : ''
      if (!cdk) return { ok: false, status: 400, message: 'Missing CDK.' }
      const record = store.cdks.get(cdk)
      if (!record) return { ok: false, status: 404, message: 'CDK does not exist.' }
      if (record.status !== 'unused') return { ok: false, status: 409, message: 'CDK has already been used.' }
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
      if (!cdk) return { ok: false, status: 400, message: 'Missing CDK.' }
      const record = store.cdks.get(cdk) || { status: 'unused', permission: 'growth', license_order_hash: 'order-' + cdk }
      if (record.status !== 'unused') return { ok: false, status: 409, message: 'CDK has already been used.' }
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
      if (config.optimizer_search) return { ok: false, message: 'optimizer_search is not allowed for free preview' }
      if (!matchesFreePreset(config)) return { ok: false, message: 'free preview only supports preset layouts' }
      if (hasForbiddenDroneConfig(config)) return { ok: false, message: 'advanced drone strategy is not allowed for free preview' }
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
      const inventoryAssist = config.auto_balance_source === 'intermediate_inventory'
        && config.intermediate_inventory
        && drone.enable === true
        && drone.auto === true
        && drone.auto_strategy === 'trading_priority'
        && !drone.targets
        && !drone.order
        && !drone.auto_target_product
      return !inventoryAssist
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
    display_name: 'Free preview',
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
  return { version: 1, profile_id: profileId, operators: null, config: null, elite_overrides: {}, last_result: null, saved_configs: [], result_history: [], updated_at: new Date().toISOString() }
}
