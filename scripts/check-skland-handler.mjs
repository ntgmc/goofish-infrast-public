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
await assertCompleteRequiresConfirmation()
await assertManualCredentialPreview()
await assertBlankDefaultUidCredentialPreview()
await assertManualCredentialConfirm()
await assertCookieCredentialPreview()
await assertEncodedCredentialPreview()
await assertInvalidCredentialPreview()
await assertOversizedCredentialPreview()
await assertConfirmImport()
await assertDepotValueConfirmDoesNotWriteWorkspace()
await assertRefreshImport()
await assertRefreshTransientFailurePreservesBinding()
await assertRefreshCredentialInvalid()
await assertMatchingRebindResetsRisk()
await assertMismatchedRebindDoesNotLeakRiskCount()
await assertRepeatedMismatchFreezesProfile()
await assertSchemaChangeError()
await assertUnbindRouteRemoved()

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

async function assertCompleteRequiresConfirmation() {
  setFetchMode('complete')
  const beforeCount = store.workspaces.get('profile-1')?.operators?.length
  const result = await callSkland('/api/user/skland/login/complete', {
    profile_id: 'profile-1',
    scan_id: 'scan-1',
  })
  assertNoSecretLeak(result.body, 'complete confirmation response')
  if (result.status !== 200 || result.body.status !== 'confirm_required' || !result.body.confirmation_id) {
    throw new Error(`complete confirmation: expected confirm_required, got ${result.status}`)
  }
  if (result.body.skland_preview?.uid !== '12345678' || result.body.skland_preview?.operator_count !== 2) {
    throw new Error('complete confirmation: invalid preview payload')
  }
  if (store.workspaces.get('profile-1')?.operators?.length !== beforeCount) {
    throw new Error('complete confirmation: workspace should not be imported before confirm')
  }
  if (store.profiles.get('profile-1')?.skland_binding) {
    throw new Error('complete confirmation: binding should not be finalized before confirm')
  }
  if (!store.profiles.get('profile-1')?.skland_pending_binding?.encrypted_cred?.startsWith('SKLAND-V1:')) {
    throw new Error('complete confirmation: pending encrypted cred was not saved')
  }
}

async function assertManualCredentialPreview() {
  seedProfile({ id: 'profile-manual', status: 'active' })
  setFetchMode('complete')
  const beforeCount = store.workspaces.get('profile-manual')?.operators?.length
  const result = await callSkland('/api/user/skland/credential/preview', {
    profile_id: 'profile-manual',
    credential_text: 'manual-skland-cred',
    source: 'manual',
  })
  assertNoSecretLeak(result.body, 'manual credential preview response')
  if (result.status !== 200 || result.body.status !== 'confirm_required' || !result.body.confirmation_id) {
    throw new Error(`manual credential preview: expected confirm_required, got ${result.status}`)
  }
  if (store.workspaces.get('profile-manual')?.operators?.length !== beforeCount) {
    throw new Error('manual credential preview: workspace should not be imported before confirm')
  }
  if (!store.profiles.get('profile-manual')?.skland_pending_binding?.encrypted_cred?.startsWith('SKLAND-V1:')) {
    throw new Error('manual credential preview: pending encrypted cred was not saved')
  }
}

async function assertBlankDefaultUidCredentialPreview() {
  seedProfile({ id: 'profile-blank-default-uid', status: 'active' })
  setFetchMode('blank-default-uid')
  const result = await callSkland('/api/user/skland/credential/preview', {
    profile_id: 'profile-blank-default-uid',
    credential_text: 'manual-skland-cred',
    source: 'manual',
  })
  assertNoSecretLeak(result.body, 'blank defaultUid credential preview response')
  if (result.status !== 200 || result.body.status !== 'confirm_required' || !result.body.confirmation_id) {
    throw new Error(`blank defaultUid preview: expected confirm_required, got ${result.status}`)
  }
  if (
    result.body.skland_preview?.uid !== '130761348'
    || result.body.skland_preview?.nickname !== 'Blank Default Doctor'
    || result.body.skland_preview?.channel_name !== '官服'
  ) {
    throw new Error(`blank defaultUid preview: invalid preview ${JSON.stringify(result.body.skland_preview)}`)
  }
  if (!store.fetchCalls.some((url) => url.includes('/api/v1/game/player/info?uid=130761348'))) {
    throw new Error('blank defaultUid preview: should read Arknights player info by bindingList uid')
  }
  if (store.fetchCalls.some((url) => url.includes('/api/v1/game/player/info?uid=434207645'))) {
    throw new Error('blank defaultUid preview: should ignore Endfield uid')
  }
}

async function assertManualCredentialConfirm() {
  const pending = store.profiles.get('profile-manual')?.skland_pending_binding
  if (!pending) throw new Error('manual credential confirm: missing pending binding')
  setFetchMode('complete')
  const result = await callSkland('/api/user/skland/login/confirm', {
    profile_id: 'profile-manual',
    confirmation_id: pending.confirmation_id,
  })
  assertNoSecretLeak(result.body, 'manual credential confirm response')
  if (result.status !== 200 || result.body.skland_import?.operator_count !== 2) {
    throw new Error(`manual credential confirm: invalid import summary ${result.status}: ${JSON.stringify(result.body)}`)
  }
  if (store.profiles.get('profile-manual')?.skland_pending_binding) {
    throw new Error('manual credential confirm: pending binding was not cleared')
  }
}

async function assertCookieCredentialPreview() {
  seedProfile({ id: 'profile-cookie', status: 'active' })
  setFetchMode('complete')
  const result = await callSkland('/api/user/skland/credential/preview', {
    profile_id: 'profile-cookie',
    credential_text: 'foo=bar; SK_OAUTH_CRED_KEY=manual-skland-cred; SK_TOKEN_CACHE_KEY=ignored-token',
    source: 'bookmarklet',
  })
  assertNoSecretLeak(result.body, 'cookie credential preview response')
  if (result.status !== 200 || result.body.status !== 'confirm_required' || !result.body.confirmation_id) {
    throw new Error(`cookie credential preview: expected confirm_required, got ${result.status}`)
  }
}

async function assertEncodedCredentialPreview() {
  seedProfile({ id: 'profile-encoded', status: 'active' })
  setFetchMode('complete')
  const result = await callSkland('/api/user/skland/credential/preview', {
    profile_id: 'profile-encoded',
    credential_text: `SK_OAUTH_CRED_KEY=${encodeURIComponent('manual-skland-cred')}`,
    source: 'bookmarklet',
  })
  assertNoSecretLeak(result.body, 'encoded credential preview response')
  if (result.status !== 200 || result.body.status !== 'confirm_required' || !result.body.confirmation_id) {
    throw new Error(`encoded credential preview: expected confirm_required, got ${result.status}`)
  }
}

async function assertInvalidCredentialPreview() {
  seedProfile({ id: 'profile-invalid-credential', status: 'active' })
  setFetchMode('complete')
  const result = await callSkland('/api/user/skland/credential/preview', {
    profile_id: 'profile-invalid-credential',
    credential_text: 'bad',
    source: 'manual',
  })
  if (result.status !== 400 || !result.body.error?.includes('未识别到森空岛凭据')) {
    throw new Error(`invalid credential preview: expected 400 parse error, got ${result.status}`)
  }
  if (JSON.stringify(result.body).includes('bad')) {
    throw new Error('invalid credential preview: leaked raw credential text')
  }
}

async function assertOversizedCredentialPreview() {
  seedProfile({ id: 'profile-oversized-credential', status: 'active' })
  setFetchMode('complete')
  const result = await callSkland('/api/user/skland/credential/preview', {
    profile_id: 'profile-oversized-credential',
    credential_text: 'x'.repeat(17 * 1024),
    source: 'manual',
  })
  if (result.status !== 400 || !result.body.error?.includes('未识别到森空岛凭据')) {
    throw new Error(`oversized credential preview: expected 400 parse error, got ${result.status}`)
  }
}

async function assertConfirmImport() {
  setFetchMode('complete')
  const confirmationId = store.profiles.get('profile-1')?.skland_pending_binding?.confirmation_id
  const result = await callSkland('/api/user/skland/login/confirm', {
    profile_id: 'profile-1',
    confirmation_id: confirmationId,
  })
  assertNoSecretLeak(result.body, 'confirm import response')
  if (result.status !== 200 || result.body.skland_import?.operator_count !== 2) {
    throw new Error(`confirm import: invalid import summary ${result.status}`)
  }
  if (result.body.active_profile?.skland_binding?.encrypted_cred !== undefined) {
    throw new Error('confirm import: leaked encrypted_cred in public profile')
  }
  if (result.body.active_profile?.skland_binding?.credential_status !== 'available') {
    throw new Error('confirm import: public binding should report available credential')
  }
  if (result.body.active_profile?.skland_binding?.credential_invalid_at !== null) {
    throw new Error('confirm import: public binding should not have invalid timestamp')
  }
  if (store.profiles.get('profile-1')?.skland_pending_binding) {
    throw new Error('confirm import: pending binding was not cleared')
  }
  if (!store.profiles.get('profile-1')?.skland_binding?.encrypted_cred?.startsWith('SKLAND-V1:')) {
    throw new Error('confirm import: encrypted cred was not persisted')
  }
  const workspace = store.workspaces.get('profile-1')
  if (workspace?.operators?.length !== 2) {
    throw new Error('confirm import: workspace operators were not saved')
  }
  if (workspace.config?.desc !== 'existing config') {
    throw new Error('confirm import: existing config was not preserved')
  }
  if (Object.keys(workspace.elite_overrides ?? {}).length !== 0 || workspace.last_result !== null) {
    throw new Error('confirm import: workspace transient fields were not cleared')
  }
}

async function assertDepotValueConfirmDoesNotWriteWorkspace() {
  seedProfile({ id: 'depot-profile', status: 'active' })
  store.profiles.set('depot-profile', {
    ...store.profiles.get('depot-profile'),
    kind: 'depot_value',
    cdk_key: null,
    cdk_code_hash: null,
    cdk_order_hash: null,
    permission: 'growth',
  })
  store.workspaces.delete('depot-profile')
  setFetchMode('complete')
  const preview = await callSkland('/api/user/skland/credential/preview', {
    profile_id: 'depot-profile',
    credential_text: 'manual-skland-cred',
    source: 'manual',
  })
  if (preview.status !== 200 || preview.body.status !== 'confirm_required') {
    throw new Error(`depot confirm: expected confirm_required preview, got ${preview.status}`)
  }
  const result = await callSkland('/api/user/skland/login/confirm', {
    profile_id: 'depot-profile',
    confirmation_id: preview.body.confirmation_id,
  })
  assertNoSecretLeak(result.body, 'depot confirm response')
  if (result.status !== 200 || !result.body.active_profile?.skland_binding) {
    throw new Error(`depot confirm: expected public binding in auth payload, got ${result.status}`)
  }
  if (result.body.active_profile.skland_binding.credential_status !== 'available') {
    throw new Error('depot confirm: public binding should report available credential')
  }
  if (result.body.skland_import) {
    throw new Error('depot confirm: should not return workspace import summary')
  }
  if (store.workspaces.has('depot-profile')) {
    throw new Error('depot confirm: should not create or write workspace')
  }
  if (store.profiles.get('depot-profile')?.skland_pending_binding) {
    throw new Error('depot confirm: pending binding was not cleared')
  }
  const refresh = await callSkland('/api/user/skland/import/refresh', { profile_id: 'depot-profile' })
  if (refresh.status !== 403) {
    throw new Error(`depot refresh: expected 403, got ${refresh.status}`)
  }
}

async function assertRefreshImport() {
  setFetchMode('refresh')
  const result = await callSkland('/api/user/skland/import/refresh', { profile_id: 'profile-1' })
  assertNoSecretLeak(result.body, 'refresh response')
  if (result.status !== 200 || result.body.skland_import?.operator_count !== 1) {
    throw new Error(`refresh import: invalid response ${result.status}`)
  }
  if (result.body.active_profile?.skland_binding?.credential_status !== 'available') {
    throw new Error('refresh import: public binding should report available credential')
  }
  if (result.body.active_profile?.skland_binding?.last_imported_at !== result.body.skland_import?.imported_at) {
    throw new Error('refresh import: public binding should expose latest imported timestamp')
  }
  if (store.profiles.get('profile-1')?.skland_binding?.credential_status !== 'available') {
    throw new Error('refresh import: stored binding should reset credential status to available')
  }
  if (store.fetchCalls.some((url) => url.includes('hypergryph.com'))) {
    throw new Error('refresh import: should not call Hypergryph APIs')
  }
}

async function assertRefreshTransientFailurePreservesBinding() {
  setFetchMode('temporary-fail')
  const result = await callSkland('/api/user/skland/import/refresh', { profile_id: 'profile-1' })
  assertNoSecretLeak(result.body, 'refresh transient failure response')
  if (result.status !== 400 || result.body.code !== 'skland_refresh_failed' || result.body.recovery_action !== 'retry') {
    throw new Error(`refresh transient failure: expected retry error, got ${result.status}`)
  }
  const binding = store.profiles.get('profile-1')?.skland_binding
  if (binding?.credential_status !== 'available' || binding.credential_invalid_at !== null || binding.credential_invalid_reason !== null) {
    throw new Error('refresh transient failure: should preserve available credential status')
  }
}

async function assertRefreshCredentialInvalid() {
  setFetchMode('expired')
  const result = await callSkland('/api/user/skland/import/refresh', { profile_id: 'profile-1' })
  assertNoSecretLeak(result.body, 'refresh invalid credential response')
  if (result.status !== 400 || result.body.code !== 'skland_credential_invalid' || result.body.recovery_action !== 'rebind') {
    throw new Error(`refresh invalid credential: expected rebind error, got ${result.status}`)
  }
  const publicBinding = result.body.active_profile?.skland_binding
  if (publicBinding?.credential_status !== 'invalid' || publicBinding.credential_invalid_reason !== 'expired_or_revoked') {
    throw new Error('refresh invalid credential: public binding should report invalid credential')
  }
  if (!publicBinding.credential_invalid_at) {
    throw new Error('refresh invalid credential: public binding should include invalid timestamp')
  }
  const storedBinding = store.profiles.get('profile-1')?.skland_binding
  if (storedBinding?.credential_status !== 'invalid' || storedBinding.credential_invalid_reason !== 'expired_or_revoked') {
    throw new Error('refresh invalid credential: stored binding should be marked invalid')
  }
}

async function assertMatchingRebindResetsRisk() {
  store.profiles.set('profile-1', {
    ...store.profiles.get('profile-1'),
    skland_risk: {
      uid_mismatch_count: 2,
      last_mismatch_uid: '87654321',
      last_mismatch_nickname: '扫错账号',
      last_mismatch_at: '2026-01-02T00:00:00.000Z',
    },
  })
  setFetchMode('complete')
  const complete = await callSkland('/api/user/skland/login/complete', {
    profile_id: 'profile-1',
    scan_id: 'scan-1',
  })
  if (complete.status !== 200 || complete.body.status !== 'confirm_required') {
    throw new Error('matching rebind: expected confirm_required')
  }
  const confirm = await callSkland('/api/user/skland/login/confirm', {
    profile_id: 'profile-1',
    confirmation_id: complete.body.confirmation_id,
  })
  if (confirm.status !== 200 || store.profiles.get('profile-1')?.skland_risk?.uid_mismatch_count !== 0) {
    throw new Error('matching rebind: expected risk counter reset after confirm')
  }
  if (store.profiles.get('profile-1')?.skland_binding?.credential_status !== 'available') {
    throw new Error('matching rebind: expected credential status reset after confirm')
  }
}

async function assertMismatchedRebindDoesNotLeakRiskCount() {
  setFetchMode('mismatch')
  const beforeOperators = store.workspaces.get('profile-1')?.operators?.length
  const result = await callSkland('/api/user/skland/login/complete', {
    profile_id: 'profile-1',
    scan_id: 'scan-1',
  })
  if (result.status !== 200 || result.body.status !== 'account_mismatch') {
    throw new Error(`mismatched rebind: expected account_mismatch, got ${result.status}`)
  }
  if (JSON.stringify(result.body).includes('mismatch_count') || JSON.stringify(result.body).includes('remaining')) {
    throw new Error('mismatched rebind: leaked risk count or remaining attempts')
  }
  if (result.body.confirmation_id || store.profiles.get('profile-1')?.skland_pending_binding) {
    throw new Error('mismatched rebind: should not create confirmation')
  }
  if (store.workspaces.get('profile-1')?.operators?.length !== beforeOperators) {
    throw new Error('mismatched rebind: should not import operators')
  }
}

async function assertRepeatedMismatchFreezesProfile() {
  setFetchMode('mismatch')
  await callSkland('/api/user/skland/login/complete', { profile_id: 'profile-1', scan_id: 'scan-1' })
  const result = await callSkland('/api/user/skland/login/complete', { profile_id: 'profile-1', scan_id: 'scan-1' })
  if (result.status !== 200 || result.body.status !== 'frozen' || store.profiles.get('profile-1')?.status !== 'frozen') {
    throw new Error(`repeated mismatch: expected frozen profile, got ${result.status}`)
  }
  const blocked = await callSkland('/api/user/skland/login/start', { profile_id: 'profile-1' })
  if (blocked.status !== 400 || !blocked.body.error?.includes('状态不可用')) {
    throw new Error('repeated mismatch: frozen profile should block future Skland operations')
  }
}

async function assertSchemaChangeError() {
  seedProfile({ id: 'schema-profile', status: 'active' })
  setFetchMode('complete')
  await callSkland('/api/user/skland/login/complete', { profile_id: 'schema-profile', scan_id: 'scan-1' })
  await callSkland('/api/user/skland/login/confirm', {
    profile_id: 'schema-profile',
    confirmation_id: store.profiles.get('schema-profile')?.skland_pending_binding?.confirmation_id,
  })
  setFetchMode('bad-info')
  const result = await callSkland('/api/user/skland/import/refresh', { profile_id: 'schema-profile' })
  if (result.status !== 400 || !result.body.error?.includes('干员数据')) {
    throw new Error(`schema change: expected clear operator data error, got ${result.status}`)
  }
}

async function assertUnbindRouteRemoved() {
  const result = await callSkland('/api/user/skland/binding', { profile_id: 'schema-profile' }, { method: 'DELETE' })
  if (result.status !== 404) {
    throw new Error(`unbind route: expected 404 after route removal, got ${result.status}`)
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
  const response = path === '/api/user/skland/binding'
    ? new Response(JSON.stringify({ error: 'API route not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
    : await handler(request)
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
    kind: 'cdk',
    status,
    display_name: id,
    note: '',
    skland_binding: null,
    skland_pending_binding: null,
    skland_risk: null,
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
    saved_configs: [],
    result_history: [],
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
      return jsonResponse({ message: 'OK', data: { cred: mode === 'mismatch' ? 'mismatch-cred' : 'skland-cred' } })
    }
    if (textUrl.endsWith('/api/v1/auth/refresh')) {
      if (mode === 'expired') {
        return jsonResponse({ code: 10001, message: 'CREDENTIAL_EXPIRED', data: null })
      }
      return jsonResponse({ code: 0, message: 'OK', data: { token: 'skland-token' }, timestamp: 1700000000 })
    }
    if (textUrl.endsWith('/api/v1/game/player/binding')) {
      const mismatch = mode === 'mismatch'
      if (mode === 'blank-default-uid') {
        return jsonResponse({
          code: 0,
          message: 'OK',
          data: {
            list: [{
              appCode: 'arknights',
              defaultUid: '',
              bindingList: [{
                uid: '130761348',
                nickName: 'Blank Default Doctor',
                channelName: '官服',
              }],
            }, {
              appCode: 'endfield',
              bindingList: [{
                uid: '434207645',
                nickName: '',
                channelName: '官服',
                roles: [{ roleId: '1384481039', nickname: 'Endfield Doctor' }],
                defaultRole: { roleId: '1384481039', nickname: 'Endfield Doctor' },
              }],
            }],
          },
        })
      }
      return jsonResponse({
        code: 0,
        message: 'OK',
        data: {
          list: [{
            appCode: 'arknights',
            defaultUid: mismatch ? '87654321' : '12345678',
            bindingList: [{
              uid: mismatch ? '87654321' : '12345678',
              nickName: mismatch ? '扫错账号' : '博士',
              channelName: '官服',
            }],
          }],
        },
      })
    }
    if (textUrl.includes('/api/v1/game/player/info')) {
      if (mode === 'temporary-fail') {
        return jsonResponse({ code: 1, message: 'TEMPORARY_UNAVAILABLE', data: null })
      }
      if (mode === 'bad-info') {
        return jsonResponse({ code: 0, message: 'OK', data: { chars: [{ charId: 'token_1', name: '召唤物' }] } })
      }
      return jsonResponse({
        code: 0,
        message: 'OK',
      data: {
        chars: mode === 'refresh'
          ? [{ charId: 'char_002_amiya', name: '阿米娅', evolvePhase: 2, level: 80, potentialRank: 5, rarity: 0 }]
          : [
            { charId: 'char_002_amiya', name: '阿米娅', evolvePhase: 2, level: 80, potentialRank: 5, rarity: 0 },
            { charId: 'char_010_chen', name: '陈', evolvePhase: 1, level: 70, potentialRank: 2, rarity: 0 },
            { charId: 'token_10002_kalts_mon3tr', name: 'Mon3tr', evolvePhase: 0, rarity: 5 },
          ],
        charInfoMap: {
          char_002_amiya: { name: '阿米娅', rarity: 4 },
          char_010_chen: { name: '陈', rarity: 5 },
        },
      },
    })
    }
    throw new Error(`unexpected fetch ${textUrl}`)
  }
}

function assertNoSecretLeak(value, label) {
  const serialized = JSON.stringify(value)
  for (const secret of ['account-token', 'skland-token', 'skland-cred', 'manual-skland-cred', 'mismatch-cred', 'ignored-token', 'SKLAND-V1:']) {
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
      build.onResolve({ filter: /(^|[\\/])usage-stats(\.ts)?$/ }, () => ({
        path: 'memory-usage-stats',
        namespace: 'skland-smoke',
      }))
      build.onLoad({ filter: /.*/, namespace: 'skland-smoke' }, (args) => ({
        contents: args.path === 'memory-user-store'
          ? memoryUserStoreModule()
          : args.path === 'memory-user-auth'
            ? memoryUserAuthModule()
            : args.path === 'memory-usage-stats'
              ? memoryUsageStatsModule()
              : memoryLicenseUtilsModule(),
        loader: 'js',
      }))
    },
  }
}

function memoryUsageStatsModule() {
  return `
    export async function recordUsageEvent() {}
  `
}

function memoryUserStoreModule() {
  return `
    const store = globalThis.__sklandHandlerSmokeStore
    export function emptyWorkspace(profileId) {
      return { version: 1, profile_id: profileId, operators: null, config: null, elite_overrides: {}, last_result: null, saved_configs: [], result_history: [], updated_at: new Date().toISOString() }
    }
    export async function getProfileForUser(userId, profileId) {
      const profile = store.profiles.get(profileId)
      return profile?.user_id === userId ? profile : null
    }
    export async function getProfileWorkspace(profileId) {
      const workspace = store.workspaces.get(profileId) ?? null
      return workspace ? normalizeWorkspace(workspace) : null
    }
    export async function saveProfileWorkspace(workspace) {
      store.workspaces.set(workspace.profile_id, normalizeWorkspace(workspace))
    }
    export async function saveUserProfile(profile) {
      store.profiles.set(profile.id, profile)
    }
    export function isDepotValueProfile(profile) {
      return profile?.kind === 'depot_value'
    }
    function normalizeWorkspace(workspace) {
      return { ...emptyWorkspace(workspace.profile_id), ...workspace, saved_configs: Array.isArray(workspace.saved_configs) ? workspace.saved_configs.slice(0, 20) : [], result_history: Array.isArray(workspace.result_history) ? workspace.result_history.slice(0, 10) : [] }
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
        operator_count: countOwnedOperators(workspace?.operators),
        updated_at: workspace?.updated_at ?? profile.updated_at,
        created_at: profile.created_at,
      }
    }
    function countOwnedOperators(operators) {
      return operators?.filter((operator) => operator.own !== false).length ?? 0
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
    function normalizeWorkspace(workspace) {
      return { ...emptyWorkspace(workspace.profile_id), ...workspace, saved_configs: Array.isArray(workspace.saved_configs) ? workspace.saved_configs.slice(0, 20) : [], result_history: Array.isArray(workspace.result_history) ? workspace.result_history.slice(0, 10) : [] }
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
