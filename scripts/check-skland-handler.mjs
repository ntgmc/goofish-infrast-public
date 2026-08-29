import * as esbuild from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const bundleDir = resolve('.cache/check-skland-handler')
await mkdir(bundleDir, { recursive: true })

const store = createMemoryStore()
globalThis.__sklandHandlerSmokeStore = store
process.env.SKLAND_CREDENTIAL_SECRET = 'check-skland-handler-secret'
process.env.DEPOT_SAMPLE_HASH_SECRET = 'check-depot-sample-secret'
process.env.FREE_PREVIEW_UID_HASH_SECRET = 'check-free-preview-secret-at-least-32-characters'
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
await assertArchivedProfile()
await assertLoginStart()
await assertPendingComplete()
await assertCompleteRequiresConfirmation()
await assertManualCredentialPreview()
await assertBlankDefaultUidCredentialPreview()
await assertMultiAccountSelection()
await assertManualCredentialConfirm()
await assertCookieCredentialPreview()
await assertEncodedCredentialPreview()
await assertInvalidCredentialPreview()
await assertOversizedCredentialPreview()
await assertConfirmImport()
await assertProfileImportTransactionRollback()
await assertNoConfigImportCreatesDefaultConfig()
await assertInventoryFailureStillImportsOperators()
await assertDepotValueConfirmDoesNotWriteWorkspace()
await assertRefreshImport()
await assertRefreshTransientFailurePreservesBinding()
await assertRefreshCredentialInvalid()
await assertRefreshPlayerCredentialInvalid()
await assertMatchingRebindResetsRisk()
await assertMismatchedRebindDoesNotLeakRiskCount()
await assertRepeatedMismatchFreezesProfile()
await assertAdminMismatchDoesNotTriggerRisk()
await assertSchemaChangeError()
await assertUnbindRouteRemoved()
await assertFreePreviewScanClaim()
await assertFreePreviewMultiAccountSelection()
await assertFreePreviewCredentialClaimAndUidUniqueness()

console.log('skland handler smoke check ok')

async function assertMissingSecret() {
  const previous = process.env.SKLAND_CREDENTIAL_SECRET
  delete process.env.SKLAND_CREDENTIAL_SECRET
  const result = await callSkland('/api/user/skland/login/start', { profile_id: 'profile-1' })
  process.env.SKLAND_CREDENTIAL_SECRET = previous
  if (
    result.status !== 503
    || result.body.error !== '森空岛服务配置无效，请联系管理员。'
    || result.body.code !== 'skland_service_not_configured'
    || result.body.recovery_action !== 'contact_support'
    || JSON.stringify(result.body).includes('SKLAND_CREDENTIAL_SECRET')
  ) {
    throw new Error(`missing secret: expected sanitized 503 configuration error, got ${result.status}`)
  }
}

async function assertInvalidProfile() {
  seedProfile({ id: 'profile-1', status: 'active' })
  const result = await callSkland('/api/user/skland/login/start', { profile_id: 'missing-profile' })
  if (result.status !== 404 || result.body.code !== 'profile_not_found') {
    throw new Error(`invalid profile: expected 404 profile_not_found, got ${result.status}`)
  }
}

async function assertFrozenProfile() {
  seedProfile({ id: 'frozen-profile', status: 'frozen' })
  const result = await callSkland('/api/user/skland/login/start', { profile_id: 'frozen-profile' })
  if (result.status !== 409 || result.body.code !== 'profile_unavailable') {
    throw new Error(`frozen profile: expected profile_unavailable conflict, got ${result.status}`)
  }
}

async function assertArchivedProfile() {
  seedProfile({ id: 'archived-profile', status: 'active', archivedAt: '2026-07-31T00:00:00.000Z' })
  const result = await callSkland('/api/user/skland/login/start', { profile_id: 'archived-profile' })
  if (result.status !== 409 || result.body.code !== 'profile_archived') {
    throw new Error(`archived profile: expected profile_archived conflict, got ${result.status}`)
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
  if (!store.profiles.get('profile-1')?.skland_pending_binding?.encrypted_cred?.startsWith('SKLAND-V2:active:')) {
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
  if (!store.profiles.get('profile-manual')?.skland_pending_binding?.encrypted_cred?.startsWith('SKLAND-V2:active:')) {
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

async function assertMultiAccountSelection() {
  seedProfile({ id: 'profile-multi-scan', status: 'active' })
  setFetchMode('multi-account')
  const scanSelection = await callSkland('/api/user/skland/login/complete', {
    profile_id: 'profile-multi-scan',
    scan_id: 'scan-1',
  })
  if (scanSelection.status !== 200 || scanSelection.body.status !== 'account_selection_required' || !scanSelection.body.selection_id) {
    throw new Error(`multi-account scan selection: invalid response ${scanSelection.status}`)
  }
  if (store.fetchCalls.some((url) => url.includes('/api/v1/game/player/info'))) {
    throw new Error('multi-account scan selection: should not read player info before account selection')
  }

  seedProfile({ id: 'profile-multi', status: 'active' })
  setFetchMode('multi-account')
  const beforeCount = store.workspaces.get('profile-multi')?.operators?.length
  const selection = await callSkland('/api/user/skland/credential/preview', {
    profile_id: 'profile-multi',
    credential_text: 'manual-skland-cred',
    source: 'manual',
  })
  assertNoSecretLeak(selection.body, 'multi-account selection response')
  if (
    selection.status !== 200
    || selection.body.status !== 'account_selection_required'
    || !selection.body.selection_id
    || selection.body.skland_accounts?.length !== 2
  ) {
    throw new Error(`multi-account selection: invalid response ${selection.status}: ${JSON.stringify(selection.body)}`)
  }
  if (selection.body.skland_accounts[0]?.uid !== '12345678' || !selection.body.skland_accounts[0]?.is_default) {
    throw new Error('multi-account selection: default account should be listed first and marked')
  }
  if (store.fetchCalls.some((url) => url.includes('/api/v1/game/player/info'))) {
    throw new Error('multi-account selection: should not read player info before an account is selected')
  }
  if (store.profiles.get('profile-multi')?.skland_pending_binding?.stage !== 'account_selection') {
    throw new Error('multi-account selection: encrypted selection state was not stored')
  }
  if (store.workspaces.get('profile-multi')?.operators?.length !== beforeCount) {
    throw new Error('multi-account selection: workspace changed before confirmation')
  }

  const preview = await callSkland('/api/user/skland/account/select', {
    profile_id: 'profile-multi',
    selection_id: selection.body.selection_id,
    uid: '87654321',
  })
  assertNoSecretLeak(preview.body, 'multi-account selected preview response')
  if (preview.status !== 200 || preview.body.status !== 'confirm_required' || preview.body.skland_preview?.uid !== '87654321') {
    throw new Error(`multi-account selection: selected preview invalid ${preview.status}: ${JSON.stringify(preview.body)}`)
  }
  if (!store.fetchCalls.some((url) => url.includes('/api/v1/game/player/info?uid=87654321'))) {
    throw new Error('multi-account selection: player info should use selected non-default uid')
  }

  const confirm = await callSkland('/api/user/skland/login/confirm', {
    profile_id: 'profile-multi',
    confirmation_id: preview.body.confirmation_id,
    idempotency_key: 'profile-multi-confirm',
  })
  if (confirm.status !== 200 || confirm.body.active_profile?.skland_binding?.uid !== '87654321') {
    throw new Error(`multi-account selection: final binding did not preserve selected uid ${confirm.status}: ${JSON.stringify(confirm.body)}`)
  }

  setFetchMode('multi-account')
  const rebind = await callSkland('/api/user/skland/credential/preview', {
    profile_id: 'profile-multi',
    credential_text: 'manual-skland-cred',
    source: 'manual',
  })
  if (rebind.status !== 200 || rebind.body.status !== 'confirm_required' || rebind.body.skland_preview?.uid !== '87654321') {
    throw new Error('multi-account rebind: an existing profile should automatically keep its bound uid')
  }
  if (rebind.body.selection_id) {
    throw new Error('multi-account rebind: an existing profile must not offer a uid switch')
  }
  const wrongStage = await callSkland('/api/user/skland/account/select', {
    profile_id: 'profile-multi',
    selection_id: rebind.body.confirmation_id,
    uid: '87654321',
  })
  if (wrongStage.status !== 400 || store.profiles.get('profile-multi')?.skland_pending_binding?.stage !== 'confirmation') {
    throw new Error('multi-account selection: confirmation records must not be accepted as selection records')
  }

  setFetchMode('multi-account')
  const refresh = await callSkland('/api/user/skland/import/refresh', { profile_id: 'profile-multi' })
  if (refresh.status !== 200 || refresh.body.active_profile?.skland_binding?.uid !== '87654321') {
    throw new Error('multi-account refresh: stored uid should remain bound when defaultUid points elsewhere')
  }
  if (!store.fetchCalls.some((url) => url.includes('/api/v1/game/player/info?uid=87654321'))) {
    throw new Error('multi-account refresh: player info should use the stored bound uid')
  }

  seedProfile({ id: 'depot-multi', status: 'active' })
  store.profiles.set('depot-multi', { ...store.profiles.get('depot-multi'), kind: 'depot_value' })
  store.workspaces.delete('depot-multi')
  setFetchMode('multi-account')
  const depotSelection = await callSkland('/api/user/skland/credential/preview', {
    profile_id: 'depot-multi',
    credential_text: 'manual-skland-cred',
    source: 'manual',
  })
  const depotPreview = await callSkland('/api/user/skland/account/select', {
    profile_id: 'depot-multi',
    selection_id: depotSelection.body.selection_id,
    uid: '87654321',
  })
  const depotConfirm = await callSkland('/api/user/skland/login/confirm', {
    profile_id: 'depot-multi',
    confirmation_id: depotPreview.body.confirmation_id,
    idempotency_key: 'depot-multi-confirm',
  })
  if (depotConfirm.status !== 200 || depotConfirm.body.active_profile?.skland_binding?.uid !== '87654321') {
    throw new Error('multi-account depot selection: selected uid was not saved')
  }
  if (store.workspaces.has('depot-multi')) {
    throw new Error('multi-account depot selection: depot confirmation should not write a workspace')
  }

  seedProfile({ id: 'profile-multi-invalid', status: 'active' })
  setFetchMode('multi-account')
  const invalidSelection = await callSkland('/api/user/skland/credential/preview', {
    profile_id: 'profile-multi-invalid',
    credential_text: 'manual-skland-cred',
  })
  const invalidUid = await callSkland('/api/user/skland/account/select', {
    profile_id: 'profile-multi-invalid',
    selection_id: invalidSelection.body.selection_id,
    uid: '99999999',
  })
  if (invalidUid.status !== 400 || store.profiles.get('profile-multi-invalid')?.skland_pending_binding) {
    throw new Error('multi-account selection: invalid uid should clear pending selection without importing')
  }

  seedProfile({ id: 'profile-multi-expired', status: 'active' })
  setFetchMode('multi-account')
  const expiredSelection = await callSkland('/api/user/skland/credential/preview', {
    profile_id: 'profile-multi-expired',
    credential_text: 'manual-skland-cred',
  })
  const expiredProfile = store.profiles.get('profile-multi-expired')
  store.profiles.set('profile-multi-expired', {
    ...expiredProfile,
    skland_pending_binding: {
      ...expiredProfile.skland_pending_binding,
      expires_at: '2000-01-01T00:00:00.000Z',
    },
  })
  const expired = await callSkland('/api/user/skland/account/select', {
    profile_id: 'profile-multi-expired',
    selection_id: expiredSelection.body.selection_id,
    uid: '87654321',
  })
  if (expired.status !== 400 || store.profiles.get('profile-multi-expired')?.skland_pending_binding) {
    throw new Error('multi-account selection: expired selection should be rejected and cleared')
  }
}

async function assertManualCredentialConfirm() {
  const pending = store.profiles.get('profile-manual')?.skland_pending_binding
  if (!pending) throw new Error('manual credential confirm: missing pending binding')
  setFetchMode('complete')
  const result = await callSkland('/api/user/skland/login/confirm', {
    profile_id: 'profile-manual',
    confirmation_id: pending.confirmation_id,
    idempotency_key: 'profile-manual-confirm',
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
  if (result.status !== 400 || !result.body.error) {
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
  if (result.status !== 400 || !result.body.error) {
    throw new Error(`oversized credential preview: expected 400 parse error, got ${result.status}`)
  }
}

async function assertConfirmImport() {
  setFetchMode('complete')
  const confirmationId = store.profiles.get('profile-1')?.skland_pending_binding?.confirmation_id
  const result = await callSkland('/api/user/skland/login/confirm', {
    profile_id: 'profile-1',
    confirmation_id: confirmationId,
    idempotency_key: 'profile-1-confirm',
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
  if (!store.profiles.get('profile-1')?.skland_binding?.encrypted_cred?.startsWith('SKLAND-V2:active:')) {
    throw new Error('confirm import: encrypted cred was not persisted')
  }
  const workspace = store.workspaces.get('profile-1')
  if (workspace?.operators?.length !== 2) {
    throw new Error('confirm import: workspace operators were not saved')
  }
  const cdkRecord = store.cdks.get('cdk/profile-1')
  if (!cdkRecord?.baseline_operator_fingerprint || cdkRecord.latest_operator_fingerprint?.owned_count !== 2) {
    throw new Error('confirm import: trusted operator fingerprint baseline was not saved')
  }
  if (workspace.config?.desc !== 'existing config') {
    throw new Error('confirm import: existing config was not preserved')
  }
  if (workspace.config?.product_requirements?.manufacturing_stations?.['Battle Record'] !== 2) {
    throw new Error('confirm import: existing manufacturing plan was not preserved')
  }
  if (
    workspace.config?.intermediate_inventory?.['Pure Gold'] !== 123 ||
    workspace.config?.intermediate_inventory?.['Originium Shard'] !== 45 ||
    workspace.config?.intermediate_inventory?.['Orirock Cube'] !== 7658 ||
    workspace.config?.auto_balance_source !== 'intermediate_inventory' ||
    workspace.config?.drones?.auto_strategy !== 'trading_priority'
  ) {
    throw new Error(`confirm import: intermediate inventory was not saved to config ${JSON.stringify(workspace.config)}`)
  }
  if (
    result.body.skland_import?.inventory_synced !== true ||
    result.body.skland_import?.config_saved !== true ||
    result.body.skland_import?.intermediate_inventory?.['Pure Gold'] !== 123 ||
    result.body.skland_import?.intermediate_inventory?.['Originium Shard'] !== 45 ||
    result.body.skland_import?.intermediate_inventory?.['Orirock Cube'] !== 7658
  ) {
    throw new Error(`confirm import: import summary missing inventory sync ${JSON.stringify(result.body.skland_import)}`)
  }
  if (
    Object.keys(workspace.elite_overrides ?? {}).length !== 0
    || ['last_result', 'result_history', 'archived_results'].some((field) => Object.hasOwn(workspace, field))
  ) {
    throw new Error('confirm import: workspace transient fields were not cleared')
  }
  const fetchCountBeforeReplay = store.fetchCalls.length
  const replay = await callSkland('/api/user/skland/login/confirm', {
    profile_id: 'profile-1',
    confirmation_id: confirmationId,
    idempotency_key: 'profile-1-confirm',
  })
  if (replay.status !== 200 || replay.body.replayed !== true || replay.body.skland_import?.uid !== '12345678') {
    throw new Error(`confirm import replay: expected saved response, got ${replay.status}`)
  }
  if (store.fetchCalls.length !== fetchCountBeforeReplay) {
    throw new Error('confirm import replay: must not call upstream after pending was consumed')
  }
}

async function assertProfileImportTransactionRollback() {
  seedProfile({ id: 'profile-transaction-rollback', status: 'active' })
  setFetchMode('complete')
  const preview = await callSkland('/api/user/skland/credential/preview', {
    profile_id: 'profile-transaction-rollback',
    credential_text: 'manual-skland-cred',
    source: 'manual',
  })
  const profileBefore = structuredClone(store.profiles.get('profile-transaction-rollback'))
  const workspaceBefore = structuredClone(store.workspaces.get('profile-transaction-rollback'))
  store.failNextProfileSave = true
  const failed = await callSkland('/api/user/skland/login/confirm', {
    profile_id: 'profile-transaction-rollback',
    confirmation_id: preview.body.confirmation_id,
    idempotency_key: 'profile-transaction-rollback-confirm',
  })
  if (failed.status !== 500 || failed.body.code !== 'skland_internal_error') {
    throw new Error(`profile transaction rollback: expected injected 500, got ${failed.status}`)
  }
  if (
    JSON.stringify(store.profiles.get('profile-transaction-rollback')) !== JSON.stringify(profileBefore)
    || JSON.stringify(store.workspaces.get('profile-transaction-rollback')) !== JSON.stringify(workspaceBefore)
    || store.inventoryOperations.has(`${store.user.id}:profile-transaction-rollback-confirm`)
  ) {
    throw new Error('profile transaction rollback: partial profile/workspace/operation state escaped rollback')
  }
  const retried = await callSkland('/api/user/skland/login/confirm', {
    profile_id: 'profile-transaction-rollback',
    confirmation_id: preview.body.confirmation_id,
    idempotency_key: 'profile-transaction-rollback-confirm',
  })
  if (retried.status !== 200 || retried.body.skland_import?.uid !== '12345678') {
    throw new Error(`profile transaction rollback: stable-key retry failed with ${retried.status}`)
  }
}

async function assertNoConfigImportCreatesDefaultConfig() {
  seedProfile({ id: 'profile-no-config', status: 'active' })
  store.workspaces.set('profile-no-config', {
    ...store.workspaces.get('profile-no-config'),
    config: null,
  })
  setFetchMode('complete')
  const preview = await callSkland('/api/user/skland/credential/preview', {
    profile_id: 'profile-no-config',
    credential_text: 'manual-skland-cred',
    source: 'manual',
  })
  const result = await callSkland('/api/user/skland/login/confirm', {
    profile_id: 'profile-no-config',
    confirmation_id: preview.body.confirmation_id,
    idempotency_key: 'profile-no-config-confirm',
  })
  if (result.status !== 200) {
    throw new Error(`no config import: expected success, got ${result.status}`)
  }
  const config = store.workspaces.get('profile-no-config')?.config
  if (
    config?.layout !== '2-4-3' ||
    config?.product_requirements?.trading_stations?.LMD !== 2 ||
    config?.intermediate_inventory?.['Pure Gold'] !== 123 ||
    config?.intermediate_inventory?.['Originium Shard'] !== 45
  ) {
    throw new Error(`no config import: default config was not created with inventory ${JSON.stringify(config)}`)
  }
}

async function assertInventoryFailureStillImportsOperators() {
  seedProfile({ id: 'profile-inventory-fail', status: 'active' })
  setFetchMode('inventory-fail')
  const preview = await callSkland('/api/user/skland/credential/preview', {
    profile_id: 'profile-inventory-fail',
    credential_text: 'manual-skland-cred',
    source: 'manual',
  })
  const result = await callSkland('/api/user/skland/login/confirm', {
    profile_id: 'profile-inventory-fail',
    confirmation_id: preview.body.confirmation_id,
    idempotency_key: 'profile-inventory-fail-confirm',
  })
  if (result.status !== 200 || result.body.skland_import?.operator_count !== 2) {
    throw new Error(`inventory failure import: expected operator import success, got ${result.status}`)
  }
  if (result.body.skland_import?.inventory_synced !== false || !result.body.skland_import?.inventory_warning) {
    throw new Error(`inventory failure import: expected inventory warning ${JSON.stringify(result.body.skland_import)}`)
  }
  const workspace = store.workspaces.get('profile-inventory-fail')
  if (workspace?.operators?.length !== 2) {
    throw new Error('inventory failure import: operators were not saved')
  }
  if (workspace.config?.auto_balance_source === 'intermediate_inventory') {
    throw new Error('inventory failure import: should not mark config as inventory-balanced without inventory')
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
    idempotency_key: 'depot-profile-confirm',
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
  const workspace = store.workspaces.get('profile-1')
  if (
    workspace?.config?.intermediate_inventory?.['Pure Gold'] !== 9 ||
    workspace?.config?.intermediate_inventory?.['Originium Shard'] !== 8 ||
    workspace?.config?.intermediate_inventory?.['Orirock Cube'] !== 76
  ) {
    throw new Error(`refresh import: intermediate inventory was not refreshed ${JSON.stringify(workspace?.config?.intermediate_inventory)}`)
  }
  if (['last_result', 'result_history', 'archived_results'].some((field) => Object.hasOwn(workspace, field))) {
    throw new Error('refresh import: workspace should not embed optimization results')
  }
}

async function assertRefreshTransientFailurePreservesBinding() {
  setFetchMode('temporary-fail')
  const result = await callSkland('/api/user/skland/import/refresh', { profile_id: 'profile-1' })
  assertNoSecretLeak(result.body, 'refresh transient failure response')
  if (
    result.status !== 502
    || result.body.code !== 'skland_player_data_failed'
    || !String(result.body.error).includes('未返回该角色的干员数据')
    || result.body.recovery_action !== 'retry'
  ) {
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

async function assertRefreshPlayerCredentialInvalid() {
  const profile = store.profiles.get('profile-1')
  store.profiles.set('profile-1', {
    ...profile,
    skland_binding: {
      ...profile.skland_binding,
      credential_status: 'available',
      credential_invalid_at: null,
      credential_invalid_reason: null,
    },
  })
  setFetchMode('player-expired')
  const result = await callSkland('/api/user/skland/import/refresh', { profile_id: 'profile-1' })
  assertNoSecretLeak(result.body, 'refresh player credential invalid response')
  if (result.status !== 400 || result.body.code !== 'skland_credential_invalid' || result.body.recovery_action !== 'rebind') {
    throw new Error(`refresh player credential invalid: expected rebind error, got ${result.status}`)
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
    idempotency_key: 'profile-1-rebind-confirm',
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
  if (blocked.status !== 409 || blocked.body.code !== 'profile_unavailable') {
    throw new Error('repeated mismatch: frozen profile should block future Skland operations')
  }
}

async function assertAdminMismatchDoesNotTriggerRisk() {
  seedProfile({ id: 'admin-profile', status: 'active', permission: 'ultimate' })
  const profile = store.profiles.get('admin-profile')
  store.profiles.set('admin-profile', {
    ...profile,
    skland_binding: { uid: '12345678' },
  })
  setFetchMode('mismatch')
  const behaviorRiskEventCountBefore = store.requestBehaviorEvents.length
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await callSkland('/api/user/skland/login/complete', { profile_id: 'admin-profile', scan_id: 'scan-1' })
    if (result.status !== 200 || result.body.status !== 'account_mismatch') {
      throw new Error(`admin mismatch: expected account_mismatch, got ${result.status}`)
    }
  }
  const updatedProfile = store.profiles.get('admin-profile')
  if (
    updatedProfile?.status !== 'active'
    || updatedProfile.skland_binding?.uid !== '12345678'
    || updatedProfile.skland_risk !== null
    || store.requestBehaviorEvents.length !== behaviorRiskEventCountBefore
  ) {
    throw new Error('admin mismatch: should preserve the bound account without risk counting, audit, or freezing')
  }
}

async function assertSchemaChangeError() {
  seedProfile({ id: 'schema-profile', status: 'active' })
  setFetchMode('complete')
  await callSkland('/api/user/skland/login/complete', { profile_id: 'schema-profile', scan_id: 'scan-1' })
  await callSkland('/api/user/skland/login/confirm', {
    profile_id: 'schema-profile',
    confirmation_id: store.profiles.get('schema-profile')?.skland_pending_binding?.confirmation_id,
    idempotency_key: 'schema-profile-confirm',
  })
  setFetchMode('bad-info')
  const result = await callSkland('/api/user/skland/import/refresh', { profile_id: 'schema-profile' })
  if (
    result.status !== 502
    || result.body.code !== 'skland_player_data_invalid'
    || !String(result.body.error).includes('未包含可识别的干员')
    || result.body.recovery_action !== 'retry'
  ) {
    throw new Error(`schema change: expected retryable upstream error, got ${result.status}`)
  }
}

async function assertUnbindRouteRemoved() {
  const result = await callSkland('/api/user/skland/binding', { profile_id: 'schema-profile' }, { method: 'DELETE' })
  if (result.status !== 404) {
    throw new Error(`unbind route: expected 404 after route removal, got ${result.status}`)
  }
}

async function assertFreePreviewScanClaim() {
  const profileCountBefore = store.profiles.size
  const voucherGrantCountBefore = store.limitedVoucherGrantCalls.length
  const declarationUsageCountBefore = store.personalUseDeclarationUsageEvents.length
  const behaviorRiskEventCountBefore = store.behaviorRiskEvents.length
  setFetchMode('blank-default-uid')
  const start = await callSkland('/api/user/skland/free-preview/login/start', {})
  if (start.status !== 200 || start.body.scan_id !== 'scan-1' || !start.body.qr_data_url?.startsWith('data:image/png;base64,')) {
    throw new Error(`免费档案扫码开始：响应无效 ${start.status}`)
  }

  const complete = await callSkland('/api/user/skland/free-preview/login/complete', {
    scan_id: 'scan-1',
    display_name: '免费扫码领取',
  })
  assertNoSecretLeak(complete.body, '免费档案扫码完成响应')
  if (complete.status !== 200 || complete.body.status !== 'confirm_required' || !complete.body.confirmation_id) {
    throw new Error(`免费档案扫码完成：预期需要确认，实际 ${complete.status}`)
  }
  if (complete.body.skland_preview?.uid !== '130761348' || complete.body.skland_preview?.operator_count !== 2) {
    throw new Error(`免费档案扫码完成：预览无效 ${JSON.stringify(complete.body.skland_preview)}`)
  }
  if (store.profiles.size !== profileCountBefore) {
    throw new Error('免费档案扫码完成：确认前不应创建档案')
  }

  const personalUseAcceptance = store.personalUseAcceptance
  store.personalUseAcceptance = null
  const blocked = await callSkland('/api/user/skland/free-preview/login/confirm', {
    confirmation_id: complete.body.confirmation_id,
    idempotency_key: 'free-scan-confirm',
  })
  if (blocked.status !== 428 || blocked.body.code !== 'personal_use_confirmation_required') {
    throw new Error(`免费档案扫码确认：缺少个人使用确认时应被拒绝，实际 ${blocked.status}`)
  }
  if (store.profiles.size !== profileCountBefore) {
    throw new Error('免费档案扫码确认：缺少个人使用确认时不应创建档案')
  }
  if (
    store.personalUseDeclarationUsageEvents.length !== declarationUsageCountBefore
    || store.behaviorRiskEvents.length !== behaviorRiskEventCountBefore
  ) {
    throw new Error('免费档案扫码确认：缺少个人使用确认时不应写入审计事件')
  }
  store.personalUseAcceptance = personalUseAcceptance

  const confirm = await callSkland('/api/user/skland/free-preview/login/confirm', {
    confirmation_id: complete.body.confirmation_id,
    idempotency_key: 'free-scan-confirm',
  })
  assertNoSecretLeak(confirm.body, '免费档案扫码确认响应')
  if (confirm.status !== 200 || confirm.body.active_profile?.kind !== 'free_preview') {
    throw new Error(`免费档案扫码确认：预期 free_preview 档案，实际 ${confirm.status}`)
  }
  if (confirm.body.active_profile?.skland_binding?.uid !== '130761348' || confirm.body.skland_import?.operator_count !== 2) {
    throw new Error('免费档案扫码确认：缺少绑定或导入摘要')
  }
  const declarationUsage = store.personalUseDeclarationUsageEvents.at(-1)
  if (
    store.personalUseDeclarationUsageEvents.length !== declarationUsageCountBefore + 1
    || declarationUsage?.userId !== store.user.id
    || declarationUsage?.profileId !== confirm.body.active_profile.id
    || declarationUsage?.action !== 'free_preview_claim'
  ) {
    throw new Error('免费档案扫码确认：未写入一次准确的个人使用声明审计事件')
  }
  const behaviorRiskEvent = store.behaviorRiskEvents.at(-1)
  if (
    store.behaviorRiskEvents.length !== behaviorRiskEventCountBefore + 1
    || behaviorRiskEvent?.eventType !== 'bind'
    || behaviorRiskEvent?.userId !== store.user.id
    || behaviorRiskEvent?.profileId !== confirm.body.active_profile.id
  ) {
    throw new Error('免费档案扫码确认：未在事务内写入一次准确的绑定风险事件')
  }
  const replay = await callSkland('/api/user/skland/free-preview/login/confirm', {
    confirmation_id: complete.body.confirmation_id,
    idempotency_key: 'free-scan-confirm',
  })
  if (replay.status !== 200 || replay.body.replayed !== true || replay.body.active_profile?.id !== confirm.body.active_profile?.id) {
    throw new Error(`免费档案扫码确认：幂等响应重放失败 ${replay.status}`)
  }
  if (
    store.personalUseDeclarationUsageEvents.length !== declarationUsageCountBefore + 1
    || store.behaviorRiskEvents.length !== behaviorRiskEventCountBefore + 1
  ) {
    throw new Error('免费档案扫码确认：幂等响应重放不应重复写入审计事件')
  }
  const profileId = confirm.body.active_profile.id
  if (store.workspaces.get(profileId)?.operators?.length !== 2) {
    throw new Error('免费档案扫码确认：干员未写入工作区')
  }
  const voucherGrantCall = store.limitedVoucherGrantCalls.at(-1)
  if (store.limitedVoucherGrantCalls.length !== voucherGrantCountBefore + 1 || voucherGrantCall?.userId !== store.user.id) {
    throw new Error('免费档案扫码确认：未触发限时 CDK 道具发放')
  }
  const entitlement = {
    first_generated_at: '2026-01-01T00:00:00.000Z',
    revision_count: 2,
    revision_limit: 3,
    revision_window_hours: 24,
    confirmed_at: null,
    locked_at: null,
    lock_reason: null,
    strong_reorder_bonus: null,
  }
  store.workspaces.set(profileId, {
    ...store.workspaces.get(profileId),
    free_schedule_entitlement: entitlement,
  })
  setFetchMode('blank-default-uid')
  const refresh = await callSkland('/api/user/skland/import/refresh', { profile_id: profileId })
  if (refresh.status !== 200) {
    throw new Error(`免费档案森空岛刷新：预期 200，实际 ${refresh.status}`)
  }
  if (JSON.stringify(store.workspaces.get(profileId)?.free_schedule_entitlement) !== JSON.stringify(entitlement)) {
    throw new Error('免费档案森空岛刷新：不应重置免费完整排班权益')
  }
}

async function assertFreePreviewMultiAccountSelection() {
  const originalUser = store.user
  store.user = {
    ...originalUser,
    id: 'user-free-multi',
    email: 'free-multi@example.test',
  }
  try {
    const profileCountBefore = store.profiles.size
    setFetchMode('multi-account')
    const selection = await callSkland('/api/user/skland/free-preview/credential/preview', {
      credential_text: 'manual-skland-cred',
      source: 'bookmarklet',
      display_name: '免费多账号领取',
    })
    assertNoSecretLeak(selection.body, 'free preview multi-account selection response')
    if (selection.status !== 200 || selection.body.status !== 'account_selection_required' || !selection.body.selection_id) {
      throw new Error(`免费档案多账号选择：预期选择账号，实际 ${selection.status}`)
    }
    if (store.profiles.size !== profileCountBefore) {
      throw new Error('免费档案多账号选择：选择前不应创建档案')
    }
    const preview = await callSkland('/api/user/skland/free-preview/account/select', {
      selection_id: selection.body.selection_id,
      uid: '12345678',
    })
    if (preview.status !== 200 || preview.body.status !== 'confirm_required' || preview.body.skland_preview?.uid !== '12345678') {
      throw new Error(`免费档案多账号选择：所选预览无效 ${preview.status}`)
    }
    const confirm = await callSkland('/api/user/skland/free-preview/login/confirm', {
      confirmation_id: preview.body.confirmation_id,
      idempotency_key: 'free-multi-confirm',
    })
    if (confirm.status !== 200 || confirm.body.active_profile?.skland_binding?.uid !== '12345678') {
      throw new Error(`免费档案多账号选择：最终绑定 UID 无效 ${confirm.status}`)
    }
  } finally {
    store.user = originalUser
  }
}

async function assertFreePreviewCredentialClaimAndUidUniqueness() {
  const originalUser = store.user
  store.user = {
    ...originalUser,
    id: 'user-free-credential',
    email: 'free-credential@example.test',
  }
  try {
    const profileCountBefore = store.profiles.size
    setFetchMode('mismatch')
    const preview = await callSkland('/api/user/skland/free-preview/credential/preview', {
      credential_text: 'manual-skland-cred',
      source: 'manual',
      display_name: '免费手动领取',
    })
    assertNoSecretLeak(preview.body, '免费档案凭据预览响应')
    if (preview.status !== 200 || preview.body.status !== 'confirm_required' || !preview.body.confirmation_id) {
      throw new Error(`免费档案凭据预览：预期需要确认，实际 ${preview.status}`)
    }
    if (store.profiles.size !== profileCountBefore) {
      throw new Error('免费档案凭据预览：确认前不应创建档案')
    }

    const confirm = await callSkland('/api/user/skland/free-preview/login/confirm', {
      confirmation_id: preview.body.confirmation_id,
      idempotency_key: 'free-credential-confirm',
    })
    assertNoSecretLeak(confirm.body, '免费档案凭据确认响应')
    if (confirm.status !== 200 || confirm.body.active_profile?.kind !== 'free_preview') {
      throw new Error(`免费档案凭据确认：预期 free_preview 档案，实际 ${confirm.status}`)
    }
    if (confirm.body.active_profile?.skland_binding?.uid !== '87654321') {
      throw new Error('免费档案凭据确认：预期 mismatch-mode UID 绑定')
    }

    store.user = {
      ...originalUser,
      id: 'user-free-duplicate',
      email: 'free-duplicate@example.test',
    }
    setFetchMode('mismatch')
    const duplicate = await callSkland('/api/user/skland/free-preview/credential/preview', {
      credential_text: 'SK_OAUTH_CRED_KEY=manual-skland-cred',
      source: 'bookmarklet',
      display_name: '重复免费领取',
    })
    if (duplicate.status !== 409 || duplicate.body.code !== 'free_preview_uid_claimed') {
      throw new Error(`免费档案重复 UID：预期 409 领取拦截，实际 ${duplicate.status}`)
    }
    assertNoSecretLeak(duplicate.body, '免费档案重复领取响应')
  } finally {
    store.user = originalUser
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

function seedProfile({ id, status, archivedAt = null, permission = 'advanced' }) {
  const now = '2026-01-01T00:00:00.000Z'
  const cdkKey = `cdk/${id}`
  store.profiles.set(id, {
    version: 1,
    id,
    user_id: 'user-1',
    cdk_key: cdkKey,
    cdk_code_hash: `hash-${id}`,
    cdk_order_hash: null,
    permission,
    kind: 'cdk',
    status,
    archived_at: archivedAt,
    display_name: id,
    note: '',
    skland_binding: null,
    skland_pending_binding: null,
    skland_risk: null,
    created_at: now,
    updated_at: now,
  })
  store.cdks.set(cdkKey, {
    code_hash: id,
    permission,
    status: 'used',
  })
  store.workspaces.set(id, {
    version: 1,
    profile_id: id,
    operators: [{ id: 'char_old', name: '旧干员', own: true, elite: 0, rarity: 3 }],
    config: {
      layout: '2-4-3',
      desc: 'existing config',
      schedule_mode: 'maa',
      dormitory_rule: 'fixed',
      trading_stations_count: 2,
      manufacturing_stations_count: 4,
      product_requirements: {
        trading_stations: { LMD: 2 },
        manufacturing_stations: { 'Pure Gold': 2, 'Battle Record': 2 },
      },
      Fiammetta: { enable: true },
      drones: { enable: true, auto: true, order: 'pre', targets: ['LMD', 'Pure Gold', 'LMD'] },
    },
    elite_overrides: { char_old: 2 },
    saved_configs: [],
    free_schedule_entitlement: null,
    free_preview_normalized_activity_id: null,
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
      if (mode === 'multi-account') {
        return jsonResponse({
          code: 0,
          message: 'OK',
          data: {
            list: [{
              appCode: 'arknights',
              defaultUid: '12345678',
              bindingList: [{
                uid: '12345678',
                nickName: '默认博士',
                channelName: '官服',
              }, {
                uid: '87654321',
                nickName: '另一个博士',
                channelName: 'B服',
              }],
            }, {
              appCode: 'endfield',
              bindingList: [{ uid: '434207645', nickName: '终末地博士', channelName: '官服' }],
            }],
          },
        })
      }
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
      if (mode === 'player-expired') {
        return jsonResponse({ code: 10001, message: 'CREDENTIAL_EXPIRED', data: null })
      }
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
    if (textUrl.endsWith('/api/v1/game/cultivate/info')) {
      if (mode === 'inventory-fail') {
        return jsonResponse({ code: 1, message: 'TEMPORARY_UNAVAILABLE', data: null })
      }
      return jsonResponse({
        code: 0,
        message: 'OK',
        data: {
          items: {
            3003: { name: '赤金' },
            30012: { name: '固源岩' },
            shard_item: { id: 'shard_item', name: '源石碎片' },
          },
        },
      })
    }
    if (textUrl.includes('/api/v1/game/cultivate/player')) {
      if (mode === 'inventory-fail') {
        return jsonResponse({ code: 1, message: 'TEMPORARY_UNAVAILABLE', data: null })
      }
      return jsonResponse({
        code: 0,
        message: 'OK',
        data: {
          items: [
            { id: '3003', count: mode === 'refresh' ? 9 : 123 },
            { id: '30012', count: mode === 'refresh' ? 76 : 7658 },
            { id: 'shard_item', count: mode === 'refresh' ? 8 : 45 },
          ],
        },
      })
    }
    throw new Error(`unexpected fetch ${textUrl}`)
  }
}

function assertNoSecretLeak(value, label) {
  const serialized = JSON.stringify(value)
  for (const secret of ['account-token', 'skland-token', 'skland-cred', 'manual-skland-cred', 'mismatch-cred', 'ignored-token', 'SKLAND-V1:', 'SKLAND-V2:']) {
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
    cdks: new Map(),
    freePreviewClaims: new Map(),
    freePreviewPendingClaims: new Map(),
    lifetimeVoucherPendingBindings: new Map(),
    inventoryOperations: new Map(),
    failNextProfileSave: false,
    limitedVoucherGrantCalls: [],
    personalUseAcceptance: {
      id: 'personal-use-acceptance-1',
      user_id: 'user-1',
      declaration_id: 'personal_use_v1',
      declaration_version: 'V1.0',
      content_hash: 'a'.repeat(64),
      action: 'free_preview_claim',
      client_ip: '127.0.0.1',
      accepted_at: '2026-01-01T00:00:00.000Z',
      profile_id: null,
      account_deleted_at: null,
      retain_until: null,
    },
    personalUseDeclarationUsageEvents: [],
    behaviorRiskEvents: [],
    requestBehaviorEvents: [],
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
    external: ['pg', 'qrcode'],
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
      build.onResolve({ filter: /(^|[\\/])layered-auth-rate-limit(\.ts)?$/ }, () => ({
        path: 'memory-layered-auth-rate-limit',
        namespace: 'skland-smoke',
      }))
      build.onResolve({ filter: /(^|[\\/])persistent-rate-limit(\.ts)?$/ }, () => ({
        path: 'memory-persistent-rate-limit',
        namespace: 'skland-smoke',
      }))
      build.onResolve({ filter: /(^|[\\/])postgres(\.ts)?$/ }, () => ({
        path: 'memory-postgres',
        namespace: 'skland-smoke',
      }))
      build.onResolve({ filter: /(^|[\\/])personal-use-declaration-store(\.ts)?$/ }, () => ({
        path: 'memory-personal-use-declaration-store',
        namespace: 'skland-smoke',
      }))
      build.onResolve({ filter: /(^|[\\/])behavior-risk[\\/]service(\.ts)?$/ }, () => ({
        path: 'memory-behavior-risk-service',
        namespace: 'skland-smoke',
      }))
      build.onResolve({ filter: /(^|[\\/])inventory-store(\.ts)?$/ }, () => ({
        path: 'memory-inventory-store',
        namespace: 'skland-smoke',
      }))
      build.onLoad({ filter: /.*/, namespace: 'skland-smoke' }, (args) => ({
        contents: args.path === 'memory-user-store'
          ? memoryUserStoreModule()
          : args.path === 'memory-user-auth'
            ? memoryUserAuthModule()
            : args.path === 'memory-usage-stats'
              ? memoryUsageStatsModule()
              : args.path === 'memory-layered-auth-rate-limit'
                ? `export async function reserveSklandAttemptLayered() { return { allowed: true, attempt: { retainFailure() {} } } }`
                : args.path === 'memory-persistent-rate-limit'
                  ? `export class RateLimitStoreError extends Error {}`
                  : args.path === 'memory-postgres'
                    ? memoryPostgresModule()
                  : args.path === 'memory-personal-use-declaration-store'
                    ? memoryPersonalUseDeclarationStoreModule()
                    : args.path === 'memory-behavior-risk-service'
                      ? memoryBehaviorRiskServiceModule()
                    : args.path === 'memory-inventory-store'
                      ? memoryInventoryStoreModule()
                      : memoryLicenseUtilsModuleFixed(),
        loader: 'js',
      }))
    },
  }
}

function memoryUsageStatsModule() {
  return `
    export async function recordUsageEvent() {}
    export async function countSuccessfulUsageEventsForProfileInRange() { return 0 }
    export async function getScheduleGenerateDurationStatsByBucket() { return { p95_ms: 0, sample_count: 0 } }
  `
}

function memoryPostgresModule() {
  return `
    const store = globalThis.__sklandHandlerSmokeStore
    const result = (rows = [], rowCount = rows.length) => ({ rows, rowCount })

    export function hasDatabaseUrl() { return false }
    export function getPool() { return { query: execute } }
    export async function query(text, values = []) { return execute(text, values) }
    export async function withTransaction(work) {
      const snapshot = {
        profiles: structuredClone([...store.profiles]),
        workspaces: structuredClone([...store.workspaces]),
        freePreviewClaims: structuredClone([...store.freePreviewClaims]),
        freePreviewPendingClaims: structuredClone([...store.freePreviewPendingClaims]),
        lifetimeVoucherPendingBindings: structuredClone([...store.lifetimeVoucherPendingBindings]),
        inventoryOperations: structuredClone([...store.inventoryOperations]),
        personalUseAcceptance: structuredClone(store.personalUseAcceptance),
        personalUseDeclarationUsageEvents: structuredClone(store.personalUseDeclarationUsageEvents),
        behaviorRiskEvents: structuredClone(store.behaviorRiskEvents),
      }
      try {
        return await work({ query: execute })
      } catch (error) {
        restore(store.profiles, snapshot.profiles)
        restore(store.workspaces, snapshot.workspaces)
        restore(store.freePreviewClaims, snapshot.freePreviewClaims)
        restore(store.freePreviewPendingClaims, snapshot.freePreviewPendingClaims)
        restore(store.lifetimeVoucherPendingBindings, snapshot.lifetimeVoucherPendingBindings)
        restore(store.inventoryOperations, snapshot.inventoryOperations)
        store.personalUseAcceptance = snapshot.personalUseAcceptance
        restoreArray(store.personalUseDeclarationUsageEvents, snapshot.personalUseDeclarationUsageEvents)
        restoreArray(store.behaviorRiskEvents, snapshot.behaviorRiskEvents)
        throw error
      }
    }

    async function execute(text, values = []) {
      const sql = text.replace(/\\s+/g, ' ').trim().toLowerCase()
      if (sql.startsWith('select request_hash, response_json from inventory_operations')) {
        const operation = store.inventoryOperations.get(values[0] + ':' + values[1])
        return result(operation ? [{ request_hash: operation.request_hash, response_json: operation.response_json }] : [])
      }
      if (sql.startsWith('insert into inventory_operations')) {
        const key = values[1] + ':' + values[2]
        if (store.inventoryOperations.has(key)) return result([], 0)
        store.inventoryOperations.set(key, {
          id: values[0], user_id: values[1], idempotency_key: values[2], operation_type: values[3],
          request_hash: values[4], response_json: null, created_at: values[5], completed_at: null,
        })
        return result([], 1)
      }
      if (sql.startsWith('update inventory_operations set response_json')) {
        const operation = [...store.inventoryOperations.values()].find((item) => item.id === values[0])
        if (!operation) return result([], 0)
        operation.response_json = JSON.parse(values[1])
        operation.completed_at = values[2]
        return result([], 1)
      }
      if (sql.includes('pg_advisory_xact_lock')) return result([{ pg_advisory_xact_lock: null }], 1)
      if (sql.startsWith('select record_json from user_game_accounts where id =')) {
        const profile = store.profiles.get(values[0])
        return result(profile && profile.user_id === values[1] ? [{ record_json: profile }] : [])
      }
      if (sql.startsWith('select record_json from user_game_accounts') && sql.includes("kind = 'free_preview'")) {
        return result([...store.profiles.values()]
          .filter((profile) => profile.user_id === values[0] && profile.kind === 'free_preview')
          .map((record_json) => ({ record_json })))
      }
      if (sql.startsWith('select record_json from user_game_accounts') && sql.includes("skland_binding'->>'uid'")) {
        return result([...store.profiles.values()]
          .filter((profile) => profile.skland_binding?.uid === values[0])
          .map((record_json) => ({ record_json })))
      }
      if (sql.startsWith('insert into user_game_accounts')) {
        if (store.failNextProfileSave) {
          store.failNextProfileSave = false
          throw new Error('injected profile save failure')
        }
        const profile = JSON.parse(values[11])
        store.profiles.set(profile.id, profile)
        return result([], 1)
      }
      if (sql.startsWith('insert into free_preview_claims')) {
        if (store.freePreviewClaims.has(values[0])) return result([], 0)
        store.freePreviewClaims.set(values[0], JSON.parse(values[4]))
        return result([], 1)
      }
      if (sql.startsWith('select profile_id from free_preview_claims')) {
        const claim = store.freePreviewClaims.get(values[0])
        return result(claim ? [{ profile_id: claim.profile_id }] : [])
      }
      if (sql.startsWith('select record_json from free_preview_pending_claims')) {
        const pending = store.freePreviewPendingClaims.get(values[1])
        return result(pending?.user_id === values[0] ? [{ record_json: pending }] : [])
      }
      if (sql.startsWith('delete from free_preview_pending_claims')) {
        const pending = store.freePreviewPendingClaims.get(values[1])
        if (pending?.user_id !== values[0]) return result([], 0)
        store.freePreviewPendingClaims.delete(values[1])
        return result([], 1)
      }
      if (sql.startsWith('delete from lifetime_voucher_pending_bindings')) {
        const pending = store.lifetimeVoucherPendingBindings.get(values[1])
        if (pending?.user_id !== values[0]) return result([], 0)
        store.lifetimeVoucherPendingBindings.delete(values[1])
        return result([], 1)
      }
      throw new Error('unexpected postgres query: ' + sql)
    }

    function restore(target, entries) {
      target.clear()
      for (const [key, value] of entries) target.set(key, value)
    }

    function restoreArray(target, items) {
      target.splice(0, target.length, ...items)
    }
  `
}

function memoryInventoryStoreModule() {
  return `
    const store = globalThis.__sklandHandlerSmokeStore
    export class InventoryError extends Error {
      constructor(code, message, status = 409) {
        super(message)
        this.name = 'InventoryError'
        this.code = code
        this.status = status
      }
    }
    export async function getItemBalance() { return 0 }
    export async function grantFreePreviewLimitedVoucher(userId, now) {
      store.limitedVoucherGrantCalls.push({ userId, now: now.toISOString() })
      return 'limited-voucher-grant-' + store.limitedVoucherGrantCalls.length
    }
    export async function markOnboardingTaskComplete() {}
    export async function reserveItemsInTransaction() { return [] }
    export async function commitReservedItemsInTransaction() {}
  `
}

function memoryPersonalUseDeclarationStoreModule() {
  return `
    const store = globalThis.__sklandHandlerSmokeStore
    export async function getPersonalUseDeclarationAcceptance() {
      return store.personalUseAcceptance
    }
    export async function attachPersonalUseDeclarationAcceptanceToProfileInTransaction(_client, _userId, profileId) {
      if (store.personalUseAcceptance) store.personalUseAcceptance.profile_id = profileId
    }
    export async function recordPersonalUseDeclarationUsageInTransaction(_client, input) {
      store.personalUseDeclarationUsageEvents.push(input)
      return input
    }
  `
}

function memoryBehaviorRiskServiceModule() {
  return `
    const store = globalThis.__sklandHandlerSmokeStore
    export async function recordAuthenticatedRequestBehaviorEvent() { return false }
    export async function recordRequestBehaviorEvent(input) {
      const { req: _req, ...event } = input
      store.requestBehaviorEvents.push(event)
      return true
    }
    export async function recordRequestBehaviorEventInTransaction(_client, input) {
      const { req: _req, ...event } = input
      store.behaviorRiskEvents.push(event)
      return true
    }
  `
}

function memoryUserStoreModule() {
  return `
    const store = globalThis.__sklandHandlerSmokeStore
    export async function insertUserAccountForRegistrationInTransaction() {}
export function emptyWorkspace(profileId) {
return { version: 1, profile_id: profileId, operators: null, config: null, elite_overrides: {}, saved_configs: [], free_schedule_entitlement: null, free_preview_normalized_activity_id: null, updated_at: new Date().toISOString() }
}
    export async function listProfilesForUser(userId) {
      return [...store.profiles.values()].filter((profile) => profile.user_id === userId)
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
    export async function updateProfileWorkspaceAtomically(profileId, updater) {
      const current = store.workspaces.get(profileId) ?? null
      const next = normalizeWorkspace(await updater(current ? normalizeWorkspace(current) : null))
      store.workspaces.set(profileId, next)
      return next
    }
    export async function updateProfileWorkspaceInTransaction(_client, profileId, updater) {
      const current = store.workspaces.get(profileId) ?? null
      const next = normalizeWorkspace(await updater(current ? normalizeWorkspace(current) : null))
      store.workspaces.set(profileId, next)
      return next
    }
    export async function saveUserProfile(profile) {
      store.profiles.set(profile.id, profile)
    }
    export function isDepotValueProfile(profile) {
      return profile?.kind === 'depot_value'
    }
    export function isFreePreviewProfile(profile) {
      return profile?.kind === 'free_preview'
    }
    export function normalizeProfileKind(profile) {
      return ['free_preview', 'depot_value', 'metered_personal', 'metered_commercial'].includes(profile?.kind)
        ? profile.kind
        : 'cdk'
    }
    export async function getFreePreviewClaim(uidHash) {
      return store.freePreviewClaims.get(uidHash) ?? null
    }
    export async function claimFreePreviewUid(claim) {
      const existing = store.freePreviewClaims.get(claim.uid_hash)
      if (existing) return { ok: false, claim: existing }
      store.freePreviewClaims.set(claim.uid_hash, claim)
      return { ok: true, claim }
    }
    export async function deleteFreePreviewClaim(uidHash, profileId) {
      const existing = store.freePreviewClaims.get(uidHash)
      if (!existing) return
      if (profileId && existing.profile_id !== profileId) return
      store.freePreviewClaims.delete(uidHash)
    }
    export async function saveFreePreviewPendingClaim(claim) {
      store.freePreviewPendingClaims.set(claim.confirmation_id, claim)
    }
    export async function getFreePreviewPendingClaim(userId, confirmationId) {
      const pending = store.freePreviewPendingClaims.get(confirmationId)
      return pending?.user_id === userId ? pending : null
    }
    export async function deleteFreePreviewPendingClaim(userId, confirmationId) {
      const pending = store.freePreviewPendingClaims.get(confirmationId)
      if (pending?.user_id === userId) store.freePreviewPendingClaims.delete(confirmationId)
    }
    export async function saveLifetimeVoucherPendingBinding(binding) {
      store.lifetimeVoucherPendingBindings.set(binding.confirmation_id, binding)
    }
    export async function getLifetimeVoucherPendingBinding(userId, confirmationId) {
      const pending = store.lifetimeVoucherPendingBindings.get(confirmationId)
      return pending?.user_id === userId ? pending : null
    }
    export async function deleteLifetimeVoucherPendingBinding(userId, confirmationId) {
      const pending = store.lifetimeVoucherPendingBindings.get(confirmationId)
      if (pending?.user_id === userId) store.lifetimeVoucherPendingBindings.delete(confirmationId)
    }
    function normalizeWorkspace(workspace) {
      return {
        ...emptyWorkspace(workspace.profile_id),
        operators: Array.isArray(workspace.operators) ? workspace.operators : null,
        config: workspace.config ?? null,
        elite_overrides: workspace.elite_overrides ?? {},
        saved_configs: Array.isArray(workspace.saved_configs) ? workspace.saved_configs.slice(0, 20) : [],
        free_schedule_entitlement: workspace.free_schedule_entitlement ?? null,
        free_preview_normalized_activity_id: workspace.free_preview_normalized_activity_id ?? null,
        updated_at: workspace.updated_at ?? new Date().toISOString(),
      }
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
    export function scheduleInvitationSettlement() {}
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
        latest_result: null,
        saved_configs: workspace?.saved_configs ?? [],
        result_history: [],
        archived_results: [],
        result_history_next_cursor: null,
        archived_results_next_cursor: null,
        free_schedule_entitlement: workspace?.free_schedule_entitlement ?? null,
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
    export function validateConfig(config) {
      if (!config || typeof config !== 'object' || !config.layout || !config.product_requirements) {
        return { ok: false, message: 'invalid config' }
      }
      if (!Number.isInteger(config.trading_stations_count) || !Number.isInteger(config.manufacturing_stations_count)) {
        return { ok: false, message: 'invalid station counts' }
      }
      const trading = config.product_requirements.trading_stations
      const manufacturing = config.product_requirements.manufacturing_stations
      if (!isCountRecord(trading) || !isCountRecord(manufacturing)) {
        return { ok: false, message: 'invalid product requirements' }
      }
      if (sumCounts(trading) !== config.trading_stations_count || sumCounts(manufacturing) !== config.manufacturing_stations_count) {
        return { ok: false, message: 'product count mismatch' }
      }
      return { ok: true, config }
    }
    export function resolveConfigForPermission(permission, config) {
      return { ok: true, config }
    }
    export function resolveFreePreviewConfig(config) {
      return { ok: true, config }
    }
    function isCountRecord(value) {
      if (!value || typeof value !== 'object') return false
      return Object.values(value).every((item) => Number.isInteger(item) && item >= 0)
    }
    function sumCounts(counts) {
      return Object.values(counts).reduce((sum, value) => sum + value, 0)
    }
  `
}

function memoryLicenseUtilsModuleFixed() {
  return `
    const store = globalThis.__sklandHandlerSmokeStore
    export function buildOperatorFingerprint(operators) {
      const snapshot = Object.fromEntries(operators.map((operator) => [String(operator.id || operator.name), {
        name: operator.name,
        own: Boolean(operator.own),
        elite: Number(operator.elite) || 0,
        rarity: Number(operator.rarity) || 0,
      }]))
      return { hash: 'c'.repeat(64), owned_count: operators.filter((operator) => operator.own).length, operators: snapshot }
    }
    export async function getCdkRecordStore() {
      return { get: async (key) => store.cdks.get(key) ?? null }
    }
    export function isProfileCdkRecord(record) {
      return (record.cdk_type ?? 'profile') === 'profile'
    }
    export function getCdkProfileDuration(record) {
      return record?.profile_duration === 'month' || record?.profile_duration === 'half_year' || record?.profile_duration === 'year'
        ? record.profile_duration
        : 'lifetime'
    }
    export function getCdkProfileExpiresAt() { return null }
    export function formatRiskFreezeMessage(message) { return message }
    export function getCdkScheduleQuotaLimit() { return null }
    export function getCdkScenarioQuotaLimit() { return null }
    export function getCdkType(record) {
      return record.cdk_type ?? 'profile'
    }
    export function getCdkBalanceAmount(record) {
      return getCdkType(record) === 'balance' && typeof record.balance_amount === 'string'
        ? record.balance_amount
        : null
    }
    export function getCdkItemCode(record) {
      return getCdkType(record) === 'item' && typeof record.item_code === 'string'
        ? record.item_code
        : null
    }
    export function getCdkItemExpiresAt(record) {
      return getCdkType(record) === 'item' && typeof record.item_expires_at === 'string'
        ? record.item_expires_at
        : null
    }
    export async function getRiskControlSettings() {
      return { operator_data_risk_enabled: true, updated_at: null }
    }
    export function normalizePermissionMode(permission) {
      return permission ?? 'advanced'
    }
    export async function recordOperatorFingerprint(record, fingerprint) {
      const entry = [...store.cdks.entries()].find(([, current]) => current === record)
      if (!entry) return record
      const next = {
        ...record,
        baseline_operator_fingerprint: record.baseline_operator_fingerprint ?? fingerprint,
        latest_operator_fingerprint: fingerprint,
      }
      store.cdks.set(entry[0], next)
      return next
    }
    export function validateOperators(operators) {
      if (!Array.isArray(operators) || operators.length === 0) {
        return { ok: false, message: 'operator data is empty' }
      }
      for (const operator of operators) {
        if (!operator || typeof operator.id !== 'string' || typeof operator.name !== 'string' || operator.own !== true || typeof operator.elite !== 'number' || typeof operator.rarity !== 'number') {
          return { ok: false, message: 'invalid operator data' }
        }
      }
      return { ok: true, operators }
    }
    export function validateConfig(config) {
      if (!config || typeof config !== 'object' || !config.layout || !config.product_requirements) {
        return { ok: false, message: 'invalid config' }
      }
      if (!Number.isInteger(config.trading_stations_count) || !Number.isInteger(config.manufacturing_stations_count)) {
        return { ok: false, message: 'invalid station counts' }
      }
      const trading = config.product_requirements.trading_stations
      const manufacturing = config.product_requirements.manufacturing_stations
      if (!isCountRecord(trading) || !isCountRecord(manufacturing)) {
        return { ok: false, message: 'invalid product requirements' }
      }
      if (sumCounts(trading) !== config.trading_stations_count || sumCounts(manufacturing) !== config.manufacturing_stations_count) {
        return { ok: false, message: 'product count mismatch' }
      }
      return { ok: true, config }
    }
    export function resolveConfigForPermission(permission, config) {
      return { ok: true, config }
    }
    export function resolveFreePreviewConfig(config) {
      return validateConfig(config)
    }
    export function requireEnv(name) {
      const value = process.env[name] || 'secret'
      if (!value) throw new Error(name + ' is required')
      return value
    }
    function isCountRecord(value) {
      if (!value || typeof value !== 'object') return false
      return Object.values(value).every((item) => Number.isInteger(item) && item >= 0)
    }
    function sumCounts(counts) {
      return Object.values(counts).reduce((sum, value) => sum + value, 0)
    }
  `
}
