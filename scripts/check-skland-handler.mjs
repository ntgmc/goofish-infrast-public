import * as esbuild from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const bundleDir = resolve('.cache/check-skland-handler')
await mkdir(bundleDir, { recursive: true })

const store = createMemoryStore()
globalThis.__sklandHandlerSmokeStore = store
process.env.SKLAND_CREDENTIAL_SECRET = 'check-skland-handler-secret'
const originalConsoleError = console.error
console.error = (...args) => {
  if (String(args[0] ?? '').startsWith('user skland error:')) return
  originalConsoleError(...args)
}

const handlerModule = await import(`${pathToFileURL(await bundleHandler()).href}?t=${Date.now()}`)
const handler = handlerModule.default ?? handlerModule

await assertMissingSecret()
await assertInvalidProfile()
await assertFrozenProfile()
await assertLoginStart()
await assertPendingComplete()
await assertCompleteImport()
await assertRefreshImport()
await assertSchemaChangeError()
await assertUnbindKeepsOperators()

console.log('skland handler smoke check ok')

async function assertMissingSecret() {
  const previous = process.env.SKLAND_CREDENTIAL_SECRET
  delete process.env.SKLAND_CREDENTIAL_SECRET
  const result = await callSkland('/api/user/skland/login/start', { profile_id: 'profile-1' })
  process.env.SKLAND_CREDENTIAL_SECRET = previous
  if (result.status !== 500 || !result.body.error?.includes('SKLAND_CREDENTIAL_SECRET')) {
    throw new Error(`missing secret: expected 500 config error, got ${result.status}`)
  }
}

async function assertInvalidProfile() {
  seedProfile({ id: 'profile-1', status: 'active' })
  const result = await callSkland('/api/user/skland/login/start', { profile_id: 'missing-profile' })
  if (result.status !== 400 || !result.body.error) {
    throw new Error(`invalid profile: expected 400 error, got ${result.status}`)
  }
}

async function assertFrozenProfile() {
  seedProfile({ id: 'frozen-profile', status: 'frozen' })
  const result = await callSkland('/api/user/skland/login/start', { profile_id: 'frozen-profile' })
  if (result.status !== 400 || !result.body.error?.includes('状态不可用')) {
    throw new Error(`frozen profile: expected unavailable profile error, got ${result.status}`)
  }
}

async function assertLoginStart() {
  setFetchMode('start')
  const result = await callSkland('/api/user/skland/login/start', { profile_id: 'profile-1' })
  if (result.status !== 200 || result.body.scan_id !== 'scan-1' || !result.body.qr_data_url?.startsWith('data:image/png;base64,')) {
    throw new Error(`login start: invalid response ${result.status}`)
  }
}

async function assertPendingComplete() {
  setFetchMode('pending')
  const result = await callSkland('/api/user/skland/login/complete', {
    profile_id: 'profile-1',
    scan_id: 'scan-1',
  })
  if (result.status !== 202 || result.body.status !== 'pending') {
    throw new Error(`pending complete: expected 202 pending, got ${result.status}`)
  }
}

async function assertCompleteImport() {
  setFetchMode('complete')
  const result = await callSkland('/api/user/skland/login/complete', {
    profile_id: 'profile-1',
    scan_id: 'scan-1',
  })
  assertNoSecretLeak(result.body, 'complete import response')
  if (result.status !== 200 || result.body.skland_import?.operator_count !== 2) {
    throw new Error(`complete import: invalid import summary ${result.status}`)
  }
  if (result.body.active_profile?.skland_binding?.encrypted_cred !== undefined) {
    throw new Error('complete import: leaked encrypted_cred in public profile')
  }

  const workspace = store.workspaces.get('profile-1')
  if (workspace?.operators?.length !== 2) {
    throw new Error('complete import: workspace operators were not saved')
  }
  if (workspace.config?.desc !== 'existing config') {
    throw new Error('complete import: existing config was not preserved')
  }
  if (Object.keys(workspace.elite_overrides ?? {}).length !== 0 || workspace.last_result !== null) {
    throw new Error('complete import: workspace transient fields were not cleared')
  }
  if (!store.profiles.get('profile-1')?.skland_binding?.encrypted_cred?.startsWith('SKLAND-V1:')) {
    throw new Error('complete import: encrypted cred was not persisted')
  }
}

async function assertRefreshImport() {
  setFetchMode('refresh')
  const result = await callSkland('/api/user/skland/import/refresh', { profile_id: 'profile-1' })
  assertNoSecretLeak(result.body, 'refresh response')
  if (result.status !== 200 || result.body.skland_import?.operator_count !== 1) {
    throw new Error(`refresh import: invalid response ${result.status}`)
  }
  if (store.fetchCalls.some((url) => url.includes('hypergryph.com'))) {
    throw new Error('refresh import: should not call Hypergryph APIs')
  }
}

async function assertSchemaChangeError() {
  setFetchMode('bad-info')
  const result = await callSkland('/api/user/skland/import/refresh', { profile_id: 'profile-1' })
  if (result.status !== 400 || !result.body.error?.includes('干员数据')) {
    throw new Error(`schema change: expected clear operator data error, got ${result.status}`)
  }
}

async function assertUnbindKeepsOperators() {
  const beforeCount = store.workspaces.get('profile-1')?.operators?.length
  const result = await callSkland('/api/user/skland/binding', { profile_id: 'profile-1' }, { method: 'DELETE' })
  if (result.status !== 200 || store.profiles.get('profile-1')?.skland_binding) {
    throw new Error(`unbind: expected binding removed, got ${result.status}`)
  }
  if (store.workspaces.get('profile-1')?.operators?.length !== beforeCount) {
    throw new Error('unbind: imported operators should be kept')
  }
}

async function callSkland(path, body, init = {}) {
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

function seedProfile({ id, status }) {
  const now = '2026-01-01T00:00:00.000Z'
  store.profiles.set(id, {
    version: 1,
    id,
    user_id: 'user-1',
    cdk_key: `cdk/${id}`,
    cdk_code_hash: `hash-${id}`,
    cdk_order_hash: null,
    permission: 'advanced',
    status,
    display_name: id,
    note: '',
    created_at: now,
    updated_at: now,
  })
  store.workspaces.set(id, {
    version: 1,
    profile_id: id,
    operators: [{ id: 'char_old', name: '旧干员', own: true, elite: 0, rarity: 3 }],
    config: { desc: 'existing config' },
    elite_overrides: { char_old: 2 },
    last_result: { stale: true },
    updated_at: now,
  })
}

function setFetchMode(mode) {
  store.fetchCalls = []
  globalThis.fetch = async (url) => {
    const textUrl = String(url)
    store.fetchCalls.push(textUrl)
    if (textUrl.endsWith('/general/v1/gen_scan/login')) {
      return jsonResponse({ status: 0, msg: 'OK', data: { scanId: 'scan-1' } })
    }
    if (textUrl.includes('/general/v1/scan_status')) {
      return jsonResponse(mode === 'pending'
        ? { status: 0, data: {} }
        : { status: 0, data: { scanCode: 'scan-code-1' } })
    }
    if (textUrl.endsWith('/user/auth/v1/token_by_scan_code')) {
      return jsonResponse({ status: 0, msg: 'OK', data: { token: 'account-token' } })
    }
    if (textUrl.endsWith('/user/oauth2/v2/grant')) {
      return jsonResponse({ msg: 'OK', data: { code: 'oauth-code' } })
    }
    if (textUrl.endsWith('/web/v1/user/auth/generate_cred_by_code')) {
      return jsonResponse({ message: 'OK', data: { cred: 'skland-cred' } })
    }
    if (textUrl.endsWith('/api/v1/auth/refresh')) {
      return jsonResponse({ code: 0, message: 'OK', data: { token: 'skland-token' }, timestamp: 1700000000 })
    }
    if (textUrl.endsWith('/api/v1/game/player/binding')) {
      return jsonResponse({
        code: 0,
        message: 'OK',
        data: {
          list: [{
            appCode: 'arknights',
            defaultUid: '12345678',
            bindingList: [{ uid: '12345678', nickName: '博士', channelName: '官服' }],
          }],
        },
      })
    }
    if (textUrl.includes('/api/v1/game/player/info')) {
      if (mode === 'bad-info') {
        return jsonResponse({ code: 0, message: 'OK', data: { chars: [{ charId: 'token_1', name: '召唤物' }] } })
      }
      return jsonResponse({
        code: 0,
        message: 'OK',
        data: {
          chars: mode === 'refresh'
            ? [{ charId: 'char_002_amiya', name: '阿米娅', evolvePhase: 2, level: 80, potentialRank: 5, rarity: 4 }]
            : [
                { charId: 'char_002_amiya', name: '阿米娅', evolvePhase: 2, level: 80, potentialRank: 5, rarity: 4 },
                { charId: 'char_010_chen', name: '陈', evolvePhase: 1, level: 70, potentialRank: 2, rarity: 5 },
                { charId: 'token_10002_kalts_mon3tr', name: 'Mon3tr', evolvePhase: 0, rarity: 5 },
              ],
        },
      })
    }
    throw new Error(`unexpected fetch ${textUrl}`)
  }
}

function assertNoSecretLeak(value, label) {
  const serialized = JSON.stringify(value)
  for (const secret of ['account-token', 'skland-token', 'skland-cred', 'SKLAND-V1:']) {
    if (serialized.includes(secret)) {
      throw new Error(`${label}: leaked ${secret}`)
    }
  }
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function createMemoryStore() {
  return {
    user: {
      version: 1,
      id: 'user-1',
      email: 'doctor@example.test',
      permission: 'advanced',
      status: 'active',
      cdk_key: null,
      cdk_code_hash: null,
      cdk_order_hash: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
    profiles: new Map(),
    workspaces: new Map(),
    fetchCalls: [],
  }
}

async function bundleHandler() {
  const outputPath = resolve(bundleDir, 'server-handlers-user-skland.mjs')
  const result = await esbuild.build({
    entryPoints: ['server/handlers/user-skland.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    external: ['qrcode'],
    plugins: [memoryStorePlugin()],
  })
  await writeFile(outputPath, result.outputFiles[0].text, 'utf8')
  return outputPath
}

function memoryStorePlugin() {
  return {
    name: 'skland-handler-memory-store',
    setup(build) {
      build.onResolve({ filter: /(^|[\\/])user-store(\.ts)?$/ }, () => ({
        path: 'memory-user-store',
        namespace: 'skland-smoke',
      }))
      build.onResolve({ filter: /(^|[\\/])user-auth(\.ts)?$/ }, () => ({
        path: 'memory-user-auth',
        namespace: 'skland-smoke',
      }))
      build.onResolve({ filter: /(^|[\\/])license-utils(\.ts)?$/ }, () => ({
        path: 'memory-license-utils',
        namespace: 'skland-smoke',
      }))
      build.onLoad({ filter: /.*/, namespace: 'skland-smoke' }, (args) => ({
        contents: args.path === 'memory-user-store'
          ? memoryUserStoreModule()
          : args.path === 'memory-user-auth'
            ? memoryUserAuthModule()
            : memoryLicenseUtilsModule(),
        loader: 'js',
      }))
    },
  }
}

function memoryUserStoreModule() {
  return `
    const store = globalThis.__sklandHandlerSmokeStore
    export function emptyWorkspace(profileId) {
      return { version: 1, profile_id: profileId, operators: null, config: null, elite_overrides: {}, last_result: null, updated_at: new Date().toISOString() }
    }
    export async function getProfileForUser(userId, profileId) {
      const profile = store.profiles.get(profileId)
      return profile?.user_id === userId ? profile : null
    }
    export async function getProfileWorkspace(profileId) {
      return store.workspaces.get(profileId) ?? null
    }
    export async function saveProfileWorkspace(workspace) {
      store.workspaces.set(workspace.profile_id, workspace)
    }
    export async function saveUserProfile(profile) {
      store.profiles.set(profile.id, profile)
    }
  `
}

function memoryUserAuthModule() {
  return `
    const store = globalThis.__sklandHandlerSmokeStore
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
      return { user: store.user, session: {}, tokenHash: 'test', profiles: [...store.profiles.values()], activeProfile: store.profiles.get('profile-1') ?? null, cdkRecord: null }
    }
    export async function buildAuthPayload(user, activeProfileId) {
      const records = [...store.profiles.values()]
      const active = records.find((profile) => profile.id === activeProfileId) ?? records[0] ?? null
      const workspace = active ? store.workspaces.get(active.id) ?? null : null
      return {
        user: { id: user.id, email: user.email, permission: user.permission, status: user.status, cdk_status: 'none', cdk_order_hash: null, created_at: user.created_at },
        profiles: records.map((profile) => toPublicProfile(profile, store.workspaces.get(profile.id) ?? null)),
        active_profile: active ? toPublicProfile(active, workspace) : null,
        workspace: workspace ? toPublicWorkspace(workspace) : null,
        announcement_unread_count: 0,
      }
    }
    function toPublicProfile(profile, workspace) {
      return {
        id: profile.id,
        user_id: profile.user_id,
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
        } : null,
        operator_count: workspace?.operators?.length ?? 0,
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

function memoryLicenseUtilsModule() {
  return `
    export function validateOperators(operators) {
      if (!Array.isArray(operators) || operators.length === 0) {
        return { ok: false, message: '干员数据为空。' }
      }
      for (const operator of operators) {
        if (!operator || typeof operator.id !== 'string' || typeof operator.name !== 'string' || operator.own !== true || typeof operator.elite !== 'number' || typeof operator.rarity !== 'number') {
          return { ok: false, message: '干员数据格式不正确。' }
        }
      }
      return { ok: true, operators }
    }
  `
}
