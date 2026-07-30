import * as esbuild from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const bundleDir = resolve('.cache/check-license-risk')
await mkdir(bundleDir, { recursive: true })

const store = createMemoryCdkRecordStore()
globalThis.__maaCdkRecordStoreForTesting = store

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

let record = createRecord('operator-risk')
await store.create(`cdk/${record.code_hash}.json`, record)

const initial = licenseUtils.evaluateOperatorRisk(record, baselineOperators)
if (!initial.ok) throw new Error('operator risk should accept the first valid snapshot')
record = await licenseUtils.recordOperatorFingerprint(record, initial.fingerprint)
if (
  record.baseline_operator_fingerprint?.hash !== initial.fingerprint.hash
  || record.latest_operator_fingerprint?.hash !== initial.fingerprint.hash
) {
  throw new Error('operator risk should persist the first valid snapshot as baseline and latest')
}

const regressedVariants = [
  regressedOperators,
  [...regressedOperators, { id: 'char_003', name: '未拥有干员 A', own: false, elite: 0, rarity: 4 }],
  [...regressedOperators, { id: 'char_004', name: '未拥有干员 B', own: false, elite: 0, rarity: 5 }],
]
for (const [index, operators] of regressedVariants.entries()) {
  const risk = licenseUtils.evaluateOperatorRisk(record, operators)
  if (risk.ok || risk.event.type !== 'operator_ownership_regression') {
    throw new Error('operator risk should reject a missing owned high-rarity operator')
  }
  const blocked = await licenseUtils.recordSoftBlockedRiskEvent(
    record,
    risk.event,
    licenseUtils.formatOperatorRiskBlockMessage(risk.event.reason),
    risk.fingerprint,
  )
  if (blocked.frozen || blocked.record.status !== 'used') {
    throw new Error('operator risk should never freeze an authorization automatically')
  }
  if (blocked.reviewRecommended !== (index === 2)) {
    throw new Error('operator risk should recommend review only after enough different anomaly fingerprints')
  }
  record = blocked.record

  if (index === 0) {
    const countBeforeRetry = record.risk_events?.length ?? 0
    const retried = await licenseUtils.recordSoftBlockedRiskEvent(
      record,
      risk.event,
      licenseUtils.formatOperatorRiskBlockMessage(risk.event.reason),
      risk.fingerprint,
    )
    if ((retried.record.risk_events?.length ?? 0) !== countBeforeRetry) {
      throw new Error('operator risk should deduplicate retries for the same fingerprint in one five-minute window')
    }
    record = retried.record
  }
}

const recovered = await licenseUtils.acceptLatestOperatorBaselineAndUnfreeze(record, 'verified operator snapshot')
if (!recovered || recovered.status !== 'used' || recovered.baseline_operator_fingerprint?.hash !== recovered.latest_operator_fingerprint?.hash) {
  throw new Error('reviewed recovery should accept the latest operator snapshot and unfreeze the record')
}
if (recovered.risk_events?.at(-1)?.type !== 'admin_operator_baseline_changed') {
  throw new Error('reviewed recovery should append an audit event')
}

const fewerOperators = baselineOperators
const moreOperators = [
  ...baselineOperators,
  { id: 'char_003', name: '普通干员 A', own: true, elite: 1, rarity: 3 },
  { id: 'char_004', name: '普通干员 B', own: true, elite: 1, rarity: 3 },
  { id: 'char_005', name: '普通干员 C', own: true, elite: 1, rarity: 3 },
]
let rollbackRecord = createRecord('operator-rollback')
await store.create(`cdk/${rollbackRecord.code_hash}.json`, rollbackRecord)
rollbackRecord = await licenseUtils.recordOperatorFingerprint(
  rollbackRecord,
  licenseUtils.buildOperatorFingerprint(moreOperators),
)
const rollbackRisk = licenseUtils.evaluateOperatorRisk(rollbackRecord, fewerOperators)
if (rollbackRisk.ok || rollbackRisk.event.type !== 'operator_count_regression') {
  throw new Error('operator risk should reject a B to A owned-count rollback')
}
const blockedRollback = await licenseUtils.recordSoftBlockedRiskEvent(
  rollbackRecord,
  rollbackRisk.event,
  licenseUtils.formatOperatorRiskBlockMessage(rollbackRisk.event.reason),
  rollbackRisk.fingerprint,
)
rollbackRecord = blockedRollback.record

const latestSelected = await licenseUtils.setOperatorBaselineByAdmin(rollbackRecord, {
  source: 'latest',
  reason: 'verified rollback snapshot',
  unfreeze: true,
})
if (
  !latestSelected
  || latestSelected.baseline_operator_fingerprint?.hash !== rollbackRisk.fingerprint.hash
  || latestSelected.latest_operator_fingerprint?.hash !== rollbackRisk.fingerprint.hash
) {
  throw new Error('latest selection should replace both operator fingerprints')
}

const workspaceFingerprint = licenseUtils.buildOperatorFingerprint(moreOperators)
const workspaceSelected = await licenseUtils.setOperatorBaselineByAdmin(latestSelected, {
  source: 'workspace',
  reason: 'verified workspace snapshot',
  fingerprint: workspaceFingerprint,
  unfreeze: true,
})
if (
  !workspaceSelected
  || workspaceSelected.baseline_operator_fingerprint?.hash !== workspaceFingerprint.hash
  || workspaceSelected.latest_operator_fingerprint?.hash !== workspaceFingerprint.hash
) {
  throw new Error('workspace selection should replace both operator fingerprints')
}

const reset = await licenseUtils.setOperatorBaselineByAdmin(workspaceSelected, {
  source: 'next_import',
  reason: 'binding cleared',
  unfreeze: false,
  eventType: 'admin_operator_baseline_reset',
  reviewed: false,
})
if (!reset || reset.baseline_operator_fingerprint || reset.latest_operator_fingerprint) {
  throw new Error('next-import selection should remove both operator fingerprints')
}
if (reset.risk_events?.at(-1)?.type !== 'admin_operator_baseline_reset') {
  throw new Error('baseline reset should append its audit event')
}
const afterReset = licenseUtils.evaluateOperatorRisk(reset, fewerOperators)
if (!afterReset.ok) throw new Error('reset baseline should accept the next valid A snapshot')
const rebuilt = await licenseUtils.recordOperatorFingerprint(reset, afterReset.fingerprint)
if (
  rebuilt.baseline_operator_fingerprint?.hash !== afterReset.fingerprint.hash
  || rebuilt.latest_operator_fingerprint?.hash !== afterReset.fingerprint.hash
) {
  throw new Error('next valid snapshot should rebuild baseline and latest together')
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

function createMemoryCdkRecordStore() {
  const records = new Map()
  return {
    get: async (key) => records.get(key) ?? null,
    create: async (key, value) => {
      if (records.has(key)) throw new Error('CDK record already exists')
      records.set(key, value)
    },
    mutate: async (key, mutate, options) => {
      const current = records.get(key) ?? null
      if (!current || current.status === 'revoked' || (options?.allowedStatuses && !options.allowedStatuses.includes(current.status))) return current
      const next = mutate(current)
      if (next) records.set(key, next)
      return records.get(key)
    },
    incrementScheduleGenerateCount: async () => true,
    set: async (key, value) => records.set(key, value),
    delete: async (key) => records.delete(key),
    list: async (prefix) => [...records.entries()].filter(([key]) => key.startsWith(prefix)).map(([, value]) => value),
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
