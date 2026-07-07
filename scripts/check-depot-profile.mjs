import * as esbuild from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const bundleDir = resolve('.cache/check-depot-profile')
await mkdir(bundleDir, { recursive: true })
process.env.MAA_ADMIN_SECRET = 'check-depot-profile-secret'
process.env.CDK_HASH_SECRET = 'check-depot-profile-cdk-secret'

const store = createMemoryStore()
globalThis.__depotProfileSmokeStore = store

const profileHandler = await bundleHandler('server/handlers/user-profiles.ts')
const workspaceHandler = await bundleHandler('server/handlers/user-workspace.ts')
const optimizeHandler = await bundleHandler('server/handlers/optimize.ts')

await assertRequiresLogin()
await assertCreateAndReuseDepotProfile()
await assertDepotProfileCannotUseWorkspace()
await assertDepotProfileCannotOptimize()

console.log('depot profile smoke check ok')

async function assertRequiresLogin() {
  const result = await call(profileHandler, '/api/user/profiles/depot-value', {}, { auth: false })
  if (result.status !== 401) {
    throw new Error(`depot profile auth: expected 401, got ${result.status}`)
  }
}

async function assertCreateAndReuseDepotProfile() {
  const first = await call(profileHandler, '/api/user/profiles/depot-value')
  if (first.status !== 200 || first.body.depot_profile?.kind !== 'depot_value') {
    throw new Error(`depot profile create: invalid response ${first.status}`)
  }
  const saved = store.profiles.get(first.body.depot_profile.id)
  if (!saved || saved.kind !== 'depot_value' || saved.cdk_key !== null || saved.cdk_code_hash !== null || saved.cdk_order_hash !== null) {
    throw new Error('depot profile create: saved record should be depot-only without CDK fields')
  }
  if (store.workspaces.has(saved.id)) {
    throw new Error('depot profile create: should not create a workspace')
  }

  const second = await call(profileHandler, '/api/user/profiles/depot-value')
  if (second.status !== 200 || second.body.depot_profile.id !== saved.id || store.profiles.size !== 1) {
    throw new Error('depot profile reuse: repeated call should reuse one depot profile')
  }
  assertNoPrivateProfileFields(second.body.depot_profile)
}

async function assertDepotProfileCannotUseWorkspace() {
  const profileId = [...store.profiles.values()][0]?.id
  const result = await call(workspaceHandler, '/api/user/workspace', { profile_id: profileId, operators: [], config: {} }, { method: 'PATCH' })
  if (result.status !== 403 || store.workspaces.has(profileId)) {
    throw new Error(`depot workspace guard: expected 403 and no workspace, got ${result.status}`)
  }
}

async function assertDepotProfileCannotOptimize() {
  const profileId = [...store.profiles.values()][0]?.id
  const result = await call(optimizeHandler, '/api/optimize', {
    profile_id: profileId,
    operators: [],
    config: {},
    ignore_elite: false,
    license: null,
  })
  if (result.status !== 403 || !result.body.error) {
    throw new Error(`depot optimize guard: expected 403 depot guard, got ${result.status}`)
  }
}

async function call(handler, path, body = {}, init = {}) {
  const request = new Request(`http://local${path}`, {
    method: init.method ?? 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: init.auth === false ? '' : 'maa_session=test-session',
    },
    body: JSON.stringify(body),
  })
  const response = await handler(request)
  return { status: response.status, body: await response.json() }
}

function assertNoPrivateProfileFields(profile) {
  const serialized = JSON.stringify(profile)
  for (const key of ['cdk_key', 'cdk_code_hash', 'encrypted_cred']) {
    if (serialized.includes(key)) throw new Error(`public depot profile leaked ${key}`)
  }
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
    name: 'depot-profile-memory-store',
    setup(build) {
      build.onResolve({ filter: /(^|[\\/])user-store(\.ts)?$/ }, () => ({
        path: 'memory-user-store',
        namespace: 'depot-profile-smoke',
      }))
      build.onResolve({ filter: /(^|[\\/])user-auth(\.ts)?$/ }, () => ({
        path: 'memory-user-auth',
        namespace: 'depot-profile-smoke',
      }))
      build.onResolve({ filter: /(^|[\\/])license-utils(\.ts)?$/ }, () => ({
        path: 'memory-license-utils',
        namespace: 'depot-profile-smoke',
      }))
      build.onResolve({ filter: /(^|[\\/])usage-stats(\.ts)?$/ }, () => ({
        path: 'memory-usage-stats',
        namespace: 'depot-profile-smoke',
      }))
      build.onLoad({ filter: /.*/, namespace: 'depot-profile-smoke' }, (args) => ({
        contents: args.path === 'memory-user-store'
          ? memoryUserStoreModule()
          : args.path === 'memory-license-utils'
            ? memoryLicenseUtilsModule()
            : args.path === 'memory-usage-stats'
              ? memoryUsageStatsModule()
            : memoryUserAuthModule(),
        loader: 'js',
      }))
    },
  }
}

function memoryUserStoreModule() {
  return `
    const store = globalThis.__depotProfileSmokeStore
    export function emptyWorkspace(profileId) {
      return { version: 1, profile_id: profileId, operators: null, config: null, elite_overrides: {}, last_result: null, updated_at: new Date().toISOString() }
    }
    export async function getOrCreateDepotValueProfile(user) {
      const existing = [...store.profiles.values()].find((profile) => profile.user_id === user.id && profile.kind === 'depot_value')
      if (existing) return existing
      const now = new Date().toISOString()
      const profile = {
        version: 1,
        id: 'depot-user-1',
        user_id: user.id,
        kind: 'depot_value',
        cdk_key: null,
        cdk_code_hash: null,
        cdk_order_hash: null,
        permission: 'growth',
        status: 'active',
        display_name: '仓库分析',
        note: '用于森空岛仓库价值分析，不解锁排班工作台。',
        skland_binding: null,
        skland_pending_binding: null,
        skland_risk: null,
        created_at: now,
        updated_at: now,
      }
      store.profiles.set(profile.id, profile)
      return profile
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
    export function isFreePreviewProfile(profile) {
      return profile?.kind === 'free_preview'
    }
    export async function listProfilesForUser(userId) {
      return [...store.profiles.values()].filter((profile) => profile.user_id === userId)
    }
    export async function saveProfileWorkspace(workspace) {
      store.workspaces.set(workspace.profile_id, workspace)
    }
    export async function saveWorkspace(workspace) {
      store.workspaces.set(workspace.profile_id, workspace)
    }
    export async function saveUserProfile(profile) {
      store.profiles.set(profile.id, profile)
    }
    export function toPublicProfile(profile, workspace) {
      return {
        id: profile.id,
        user_id: profile.user_id,
        kind: profile.kind || 'cdk',
        permission: profile.permission,
        status: profile.status,
        cdk_order_hash: profile.cdk_order_hash,
        display_name: profile.display_name,
        note: profile.note,
        skland_binding: profile.skland_binding ? {
          uid: profile.skland_binding.uid,
          nickname: profile.skland_binding.nickname,
          channel_name: profile.skland_binding.channel_name,
          bound_at: profile.skland_binding.bound_at,
          last_imported_at: profile.skland_binding.last_imported_at,
          credential_status: profile.skland_binding.credential_status === 'invalid' ? 'invalid' : 'available',
          credential_invalid_at: profile.skland_binding.credential_invalid_at ?? null,
          credential_invalid_reason: profile.skland_binding.credential_invalid_reason === 'expired_or_revoked' || profile.skland_binding.credential_invalid_reason === 'credential_format_invalid' ? profile.skland_binding.credential_invalid_reason : null,
        } : null,
        operator_count: workspace?.operators?.filter((operator) => operator.own !== false).length ?? 0,
        updated_at: workspace?.updated_at ?? profile.updated_at,
        created_at: profile.created_at,
      }
    }
    export function toPublicWorkspace(workspace) {
      return {
        profile_id: workspace?.profile_id ?? null,
        operators: workspace?.operators ?? null,
        config: workspace?.config ?? null,
        elite_overrides: workspace?.elite_overrides ?? {},
        last_result: workspace?.last_result ?? null,
        updated_at: workspace?.updated_at ?? null,
      }
    }
  `
}

function memoryUsageStatsModule() {
  return `
    export async function recordUsageEvent() {}
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
    export function getPermissionMode(license) { return license?.permission ?? 'growth' }
    export async function getCdkRecordStore() { return { get: async () => null, set: async () => undefined } }
    export async function getRiskControlSettings() { return { operator_data_risk_enabled: true, device_risk_enabled: false, updated_at: null } }
    export async function findCdkRecordByLicenseOrderHash() { return null }
    export async function incrementCdkScheduleGenerateCount() {}
    export function normalizePermissionMode(permission) { return permission ?? 'growth' }
    export async function recordSoftBlockedRiskEvent() { return { message: 'blocked', frozen: false } }
    export function resolveConfigForPermission(_permission, config) { return { ok: true, config } }
    export function resolveFreePreviewConfig(config) { return { ok: true, config } }
    export function requireEnv() { return 'secret' }
    export function shouldFreezeBindingRisk() { return false }
    export function validateConfig(config) { return { ok: true, config } }
    export function validateLicenseForRequest() { return { ok: false, status: 400, message: 'license not needed in depot guard' } }
    export function validateOperators(operators) { return { ok: true, operators: Array.isArray(operators) ? operators : [] } }
    export function verifyLicenseSignature() { return true }
  `
}

function memoryUserAuthModule() {
  return `
    const store = globalThis.__depotProfileSmokeStore
    export function jsonResponse(body, status = 200, headers = {}) {
      return new Response(status === 204 ? null : JSON.stringify(body), {
        status,
        headers: {
          ...(status === 204 ? {} : { 'Content-Type': 'application/json' }),
          ...headers,
        },
      })
    }
    export async function requireUserSession(req) {
      if (!req.headers.get('cookie')?.includes('maa_session=test-session')) return null
      return { user: store.user, session: {}, tokenHash: 'test', profiles: [...store.profiles.values()], activeProfile: [...store.profiles.values()][0] ?? null, cdkRecord: null }
    }
    export async function buildAuthPayload(user, activeProfileId) {
      const profiles = [...store.profiles.values()]
      const active = profiles.find((profile) => profile.id === activeProfileId) ?? profiles.find((profile) => profile.kind !== 'depot_value') ?? profiles[0] ?? null
      return {
        user: toPublicUser(user),
        profiles: profiles.map((profile) => toPublicProfile(profile, store.workspaces.get(profile.id) ?? null)),
        active_profile: active ? toPublicProfile(active, store.workspaces.get(active.id) ?? null) : null,
        workspace: active ? toPublicWorkspace(store.workspaces.get(active.id) ?? null) : null,
        announcement_unread_count: 0,
      }
    }
    export async function redeemProfileCdk() {
      return { ok: false, status: 400, message: 'not implemented in smoke test' }
    }
    export async function createOrReusePreviewProfile() {
      return { ok: false, status: 400, message: 'not implemented in smoke test' }
    }
    export async function upgradePreviewProfileWithCdk() {
      return { ok: false, status: 400, message: 'not implemented in smoke test' }
    }
    export function toPublicUser(user) {
      return {
        id: user.id,
        email: user.email,
        permission: user.permission,
        status: user.status,
        cdk_status: 'none',
        cdk_order_hash: null,
        created_at: user.created_at,
      }
    }
    function toPublicProfile(profile, workspace) {
      return {
        id: profile.id,
        user_id: profile.user_id,
        kind: profile.kind || 'cdk',
        permission: profile.permission,
        status: profile.status,
        cdk_order_hash: profile.cdk_order_hash,
        display_name: profile.display_name,
        note: profile.note,
        skland_binding: profile.skland_binding ? {
          uid: profile.skland_binding.uid,
          nickname: profile.skland_binding.nickname,
          channel_name: profile.skland_binding.channel_name,
          bound_at: profile.skland_binding.bound_at,
          last_imported_at: profile.skland_binding.last_imported_at,
          credential_status: profile.skland_binding.credential_status === 'invalid' ? 'invalid' : 'available',
          credential_invalid_at: profile.skland_binding.credential_invalid_at ?? null,
          credential_invalid_reason: profile.skland_binding.credential_invalid_reason === 'expired_or_revoked' || profile.skland_binding.credential_invalid_reason === 'credential_format_invalid' ? profile.skland_binding.credential_invalid_reason : null,
        } : null,
        operator_count: workspace?.operators?.filter((operator) => operator.own !== false).length ?? 0,
        updated_at: workspace?.updated_at ?? profile.updated_at,
        created_at: profile.created_at,
      }
    }
    function toPublicWorkspace(workspace) {
      return {
        profile_id: workspace?.profile_id ?? null,
        operators: workspace?.operators ?? null,
        config: workspace?.config ?? null,
        elite_overrides: workspace?.elite_overrides ?? {},
        last_result: workspace?.last_result ?? null,
        updated_at: workspace?.updated_at ?? null,
      }
    }
  `
}

function createMemoryStore() {
  return {
    user: {
      version: 1,
      id: 'user-1',
      email: 'doctor@example.test',
      permission: 'growth',
      status: 'active',
      cdk_key: null,
      cdk_code_hash: null,
      cdk_order_hash: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    profiles: new Map(),
    workspaces: new Map(),
  }
}
