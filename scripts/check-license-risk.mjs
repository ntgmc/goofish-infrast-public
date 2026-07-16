import * as esbuild from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const bundleDir = resolve('.cache/check-license-risk')
await mkdir(bundleDir, { recursive: true })

const store = createMemoryCdkRecordStore()
const riskSettingsStore = createMemoryRiskControlSettingsStore()
globalThis.__maaCdkRecordStoreForTesting = store
globalThis.__maaRiskControlSettingsStoreForTesting = riskSettingsStore

const modulePath = await bundleModule('server/handlers/license-utils.ts')
const licenseUtils = await import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`)

const baselineOperators = [
  { id: 'char_001', name: '高星干员', own: true, elite: 2, rarity: 5 },
  { id: 'char_002', name: '普通干员', own: true, elite: 1, rarity: 3 },
]
const regressedOperators = [
  { id: 'char_001', name: '高星干员', own: false, elite: 2, rarity: 5 },
  { id: 'char_002', name: '普通干员', own: true, elite: 1, rarity: 3 },
]

let operatorRiskRecord = createRecord('operator-risk')
operatorRiskRecord.baseline_operator_fingerprint = licenseUtils.buildOperatorFingerprint(baselineOperators)
operatorRiskRecord.latest_operator_fingerprint = operatorRiskRecord.baseline_operator_fingerprint
await store.create(`cdk/${operatorRiskRecord.code_hash}.json`, operatorRiskRecord)
for (let index = 0; index < 3; index += 1) {
  const result = await licenseUtils.recordAdvancedOperatorUpdate(
    operatorRiskRecord,
    regressedOperators,
    requestWithUserAgent('operator-risk-agent'),
    'activation-token-operator-risk',
  )
  if (index < 2 && (result.ok || result.profile_freeze_required || result.record.status === 'frozen')) {
    throw new Error('operator risk should soft-block before threshold without freezing cdk')
  }
  if (index === 2) {
    if (result.ok || !result.profile_freeze_required) {
      throw new Error('operator risk threshold should request profile freeze')
    }
    if (result.record.status === 'frozen') {
      throw new Error('operator risk threshold must not freeze cdk record')
    }
  }
  operatorRiskRecord = result.record
}

let defaultDeviceRiskRecord = createRecord('device-risk-default-off')
await store.create(`cdk/${defaultDeviceRiskRecord.code_hash}.json`, defaultDeviceRiskRecord)
for (const userAgent of ['agent-a', 'agent-b', 'agent-c']) {
  const result = await licenseUtils.recordAdvancedOperatorUpdate(
    defaultDeviceRiskRecord,
    baselineOperators,
    requestWithUserAgent(userAgent),
    'activation-token-device-risk-default-off',
  )
  defaultDeviceRiskRecord = result.record
}
if (defaultDeviceRiskRecord.status === 'frozen') {
  throw new Error('device risk should be disabled by default')
}

await riskSettingsStore.set({ operator_data_risk_enabled: false, device_risk_enabled: false, updated_at: null })
let disabledOperatorRiskRecord = createRecord('operator-risk-disabled')
disabledOperatorRiskRecord.baseline_operator_fingerprint = licenseUtils.buildOperatorFingerprint(baselineOperators)
disabledOperatorRiskRecord.latest_operator_fingerprint = disabledOperatorRiskRecord.baseline_operator_fingerprint
await store.create(`cdk/${disabledOperatorRiskRecord.code_hash}.json`, disabledOperatorRiskRecord)
const disabledOperatorResult = await licenseUtils.recordAdvancedOperatorUpdate(
  disabledOperatorRiskRecord,
  regressedOperators,
  requestWithUserAgent('operator-risk-disabled-agent'),
  'activation-token-operator-risk-disabled',
)
if (!disabledOperatorResult.ok || disabledOperatorResult.profile_freeze_required || disabledOperatorResult.record.status === 'frozen') {
  throw new Error('disabled operator risk should allow regressed operator data')
}

await riskSettingsStore.set({ operator_data_risk_enabled: true, device_risk_enabled: true, updated_at: null })
let enabledDeviceRiskRecord = createRecord('device-risk-enabled')
await store.create(`cdk/${enabledDeviceRiskRecord.code_hash}.json`, enabledDeviceRiskRecord)
for (const userAgent of ['agent-a', 'agent-b', 'agent-c']) {
  const result = await licenseUtils.recordAdvancedOperatorUpdate(
    enabledDeviceRiskRecord,
    baselineOperators,
    requestWithUserAgent(userAgent),
    'activation-token-device-risk-enabled',
  )
  enabledDeviceRiskRecord = result.record
}
if (enabledDeviceRiskRecord.status !== 'frozen') {
  throw new Error('enabled user-agent churn risk should freeze cdk record')
}

const resetRecord = await licenseUtils.resetDeviceBindingAndUnfreeze(enabledDeviceRiskRecord, 'verified device replacement')
if (resetRecord.status !== 'used' || resetRecord.activation_token_hash || (resetRecord.user_agent_events?.length ?? 0) !== 0 || (resetRecord.ip_prefix_events?.length ?? 0) !== 0) {
  throw new Error('reviewed device reset should clear binding signals and unfreeze the record')
}
if (resetRecord.risk_events?.at(-1)?.type !== 'admin_device_binding_reset') {
  throw new Error('reviewed device reset should append an audit event')
}

let baselineRecoveryRecord = createRecord('operator-baseline-recovery')
baselineRecoveryRecord.status = 'frozen'
baselineRecoveryRecord.latest_operator_fingerprint = licenseUtils.buildOperatorFingerprint(regressedOperators)
await store.create(`cdk/${baselineRecoveryRecord.code_hash}.json`, baselineRecoveryRecord)
baselineRecoveryRecord = await licenseUtils.acceptLatestOperatorBaselineAndUnfreeze(baselineRecoveryRecord, 'verified operator snapshot')
if (!baselineRecoveryRecord || baselineRecoveryRecord.status !== 'used' || baselineRecoveryRecord.baseline_operator_fingerprint?.hash !== baselineRecoveryRecord.latest_operator_fingerprint?.hash) {
  throw new Error('reviewed operator recovery should accept the latest snapshot and unfreeze the record')
}
if (baselineRecoveryRecord.risk_events?.at(-1)?.type !== 'admin_operator_baseline_accepted') {
  throw new Error('reviewed operator recovery should append an audit event')
}

console.log('license risk smoke check ok')

function createRecord(codeHash) {
  return {
    version: 1,
    code_hash: codeHash,
    permission: 'advanced',
    status: 'used',
    created_at: '2026-01-01T00:00:00.000Z',
    used_at: '2026-01-01T00:00:00.000Z',
    order_note: null,
    license_order_hash: `${codeHash}-order`,
    operator_count: baselineOperators.length,
    config_desc: null,
    account_id: 'user-1',
    profile_id: `${codeHash}-profile`,
  }
}

function requestWithUserAgent(userAgent) {
  return new Request('http://local/api/license-status', {
    method: 'POST',
    headers: { 'User-Agent': userAgent },
  })
}

function createMemoryCdkRecordStore() {
  const records = new Map()
  return {
    get: async (key) => records.get(key) ?? null,
    getByLicenseOrderHash: async (orderHash) => [...records.values()].find((record) => record.license_order_hash === orderHash) ?? null,
    create: async (key, record) => {
      if (records.has(key)) throw new Error('CDK record already exists')
      records.set(key, record)
    },
    mutate: async (key, mutate, options) => {
      const current = records.get(key) ?? null
      if (!current || current.status === 'revoked' || (options?.allowedStatuses && !options.allowedStatuses.includes(current.status))) return current
      const next = mutate(current)
      if (next) records.set(key, next)
      return records.get(key)
    },
    incrementScheduleGenerateCount: async (key) => {
      const current = records.get(key)
      if (!current || current.status !== 'used') return false
      records.set(key, { ...current, schedule_generate_count: (current.schedule_generate_count ?? 0) + 1 })
      return true
    },
    set: async (key, record) => {
      records.set(key, record)
    },
    delete: async (key) => {
      records.delete(key)
    },
    list: async (prefix) => [...records.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, record]) => record),
  }
}

function createMemoryRiskControlSettingsStore() {
  let settings = null
  return {
    get: async () => settings,
    set: async (next) => {
      settings = {
        operator_data_risk_enabled: next.operator_data_risk_enabled !== false,
        device_risk_enabled: next.device_risk_enabled === true,
        updated_at: new Date().toISOString(),
      }
      return settings
    },
  }
}

async function bundleModule(entryPoint) {
  const outputPath = resolve(bundleDir, `${entryPoint.replace(/[\\/.:]/g, '-')}.mjs`)
  const result = await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    external: ['pg'],
  })
  await writeFile(outputPath, result.outputFiles[0].text, 'utf8')
  return outputPath
}
