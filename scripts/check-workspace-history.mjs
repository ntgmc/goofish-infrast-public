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

const sampleConfig = {
  layout: '3-3-3',
  desc: '333 搓玉流',
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

const sampleOperators = [
  { id: 'char_002_amiya', name: '阿米娅', own: true, elite: 2, rarity: 4 },
  { id: 'char_010_chen', name: '陈', own: true, elite: 1, rarity: 5 },
]

await assertRequiresLogin()
await assertSavedConfigActions()
await assertSavedConfigLimitAndPermission()
await assertOptimizeHistory()
await assertOperatorsPatchKeepsHistory()

console.log('workspace history smoke check ok')

async function assertRequiresLogin() {
  const result = await call(workspaceHandler, '/api/user/workspace?profile_id=profile-1', undefined, { method: 'GET', auth: false })
  if (result.status !== 401) {
    throw new Error(`workspace auth: expected 401, got ${result.status}`)
  }
}

async function assertSavedConfigActions() {
  store.workspaces.set('profile-1', emptyWorkspace('profile-1'))

  const saved = await call(workspaceHandler, '/api/user/workspace', {
    profile_id: 'profile-1',
    saved_config_action: { type: 'save', name: ' 243 刷钱 ', config: sampleConfig },
  }, { method: 'PATCH' })
  if (saved.status !== 200 || saved.body.workspace.saved_configs[0]?.name !== '243 刷钱') {
    throw new Error(`saved config save: invalid response ${saved.status}`)
  }
  const savedId = saved.body.workspace.saved_configs[0].id

  const duplicate = await call(workspaceHandler, '/api/user/workspace', {
    profile_id: 'profile-1',
    saved_config_action: { type: 'save', name: '243 刷钱', config: sampleConfig },
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
    saved_config_action: { type: 'rename', id: savedId, name: '333 搓玉' },
  }, { method: 'PATCH' })
  if (renamed.status !== 200 || renamed.body.workspace.saved_configs[0]?.name !== '333 搓玉') {
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
      name: `方案 ${index}`,
      config: sampleConfig,
      created_at: now,
      updated_at: now,
      last_used_at: null,
    })),
  })

  const tooMany = await call(workspaceHandler, '/api/user/workspace', {
    profile_id: 'profile-1',
    saved_config_action: { type: 'save', name: '第 21 套', config: sampleConfig },
  }, { method: 'PATCH' })
  if (tooMany.status !== 400) {
    throw new Error(`saved config limit: expected 400, got ${tooMany.status}`)
  }

  store.workspaces.set('profile-1', emptyWorkspace('profile-1'))
  const forbidden = await call(workspaceHandler, '/api/user/workspace', {
    profile_id: 'profile-1',
    saved_config_action: { type: 'save', name: '越权配置', config: { ...sampleConfig, permission_blocked: true } },
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
      name: '333 搓玉',
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
  if (workspace.result_history[0].name !== '333 搓玉' || workspace.result_history[0].source !== 'generated') {
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
  if (path === 'memory-usage-stats') return 'export async function recordUsageEvent() {}'
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
    export async function getProfileForUser(userId, profileId) {
      const profile = store.profiles.get(profileId)
      return profile?.user_id === userId ? profile : null
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
      return { id: profile.id, user_id: profile.user_id, kind: profile.kind, permission: profile.permission, status: profile.status, cdk_order_hash: profile.cdk_order_hash, display_name: profile.display_name, note: profile.note, operator_count: workspace?.operators?.length ?? 0, updated_at: workspace?.updated_at ?? profile.updated_at, created_at: profile.created_at }
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
    export async function buildAuthPayload(user, activeProfileId) {
      const active = store.profiles.get(activeProfileId) ?? store.profiles.get('profile-1') ?? null
      return {
        user: { id: user.id, email: user.email, permission: user.permission, status: user.status, cdk_status: 'used', cdk_order_hash: null, created_at: user.created_at },
        profiles: [...store.profiles.values()].map((profile) => ({ id: profile.id, user_id: profile.user_id, kind: profile.kind, permission: profile.permission, status: profile.status, cdk_order_hash: profile.cdk_order_hash, display_name: profile.display_name, note: profile.note, operator_count: store.workspaces.get(profile.id)?.operators?.length ?? 0, updated_at: profile.updated_at, created_at: profile.created_at })),
        active_profile: active ? { id: active.id, user_id: active.user_id, kind: active.kind, permission: active.permission, status: active.status, cdk_order_hash: active.cdk_order_hash, display_name: active.display_name, note: active.note, operator_count: store.workspaces.get(active.id)?.operators?.length ?? 0, updated_at: active.updated_at, created_at: active.created_at } : null,
        workspace: active ? toPublicWorkspace(store.workspaces.get(active.id) ?? null) : null,
        announcement_unread_count: 0,
      }
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
    export function resolveConfigForPermission(_permission, config) { return config?.permission_blocked ? { ok: false, message: 'permission blocked' } : { ok: true, config } }
    export function requireEnv() { return 'secret' }
    export function shouldFreezeBindingRisk() { return false }
    export function validateConfig(config) { return config && typeof config === 'object' ? { ok: true, config } : { ok: false, message: 'invalid config' } }
    export function validateLicenseForRequest(license) { return license ? { ok: true, license } : { ok: false, message: 'invalid license' } }
    export function validateOperators(operators) { return Array.isArray(operators) ? { ok: true, operators } : { ok: false, message: 'invalid operators' } }
    export function verifyLicenseSignature() { return true }
  `
}

function memoryOptimizerModule() {
  return `
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
          planTimes: '3班',
          plans: [{ name: 'A', rooms: {} }],
          raw_results: [{ total_efficiency: ignoreElite ? 200 : 100, assignment_detail: [] }],
          total_efficiency: ignoreElite ? 200 : 100,
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
      display_name: '主号',
      note: '',
      created_at: now,
      updated_at: now,
    }]]),
    workspaces: new Map(),
  }
}

function emptyWorkspace(profileId) {
  return { version: 1, profile_id: profileId, operators: null, config: null, elite_overrides: {}, last_result: null, saved_configs: [], result_history: [], updated_at: new Date().toISOString() }
}
