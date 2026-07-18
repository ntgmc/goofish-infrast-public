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
record.baseline_operator_fingerprint = licenseUtils.buildOperatorFingerprint(baselineOperators)
record.latest_operator_fingerprint = record.baseline_operator_fingerprint
await store.create(`cdk/${record.code_hash}.json`, record)

const risk = licenseUtils.evaluateOperatorRisk(record, regressedOperators)
if (risk.ok || risk.event.type !== 'operator_ownership_regression') {
  throw new Error('operator risk should reject a missing owned high-rarity operator')
}

for (let index = 0; index < 3; index += 1) {
  const blocked = await licenseUtils.recordSoftBlockedRiskEvent(record, risk.event, licenseUtils.formatOperatorRiskBlockMessage(risk.event.reason))
  if (index < 2 && blocked.frozen) throw new Error('operator risk should soft-block before the threshold')
  if (index === 2 && !blocked.frozen) throw new Error('operator risk should escalate at the threshold')
  record = blocked.record
}

record.status = 'frozen'
record.latest_operator_fingerprint = licenseUtils.buildOperatorFingerprint(regressedOperators)
await store.set(`cdk/${record.code_hash}.json`, record)
const recovered = await licenseUtils.acceptLatestOperatorBaselineAndUnfreeze(record, 'verified operator snapshot')
if (!recovered || recovered.status !== 'used' || recovered.baseline_operator_fingerprint?.hash !== recovered.latest_operator_fingerprint?.hash) {
  throw new Error('reviewed recovery should accept the latest operator snapshot and unfreeze the record')
}
if (recovered.risk_events?.at(-1)?.type !== 'admin_operator_baseline_accepted') {
  throw new Error('reviewed recovery should append an audit event')
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
