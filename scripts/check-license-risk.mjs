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

let operatorRiskRecord = createRecord('operator-risk')
operatorRiskRecord.baseline_operator_fingerprint = licenseUtils.buildOperatorFingerprint(baselineOperators)
operatorRiskRecord.latest_operator_fingerprint = operatorRiskRecord.baseline_operator_fingerprint
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

let userAgentRiskRecord = createRecord('user-agent-risk')
for (const userAgent of ['agent-a', 'agent-b', 'agent-c']) {
  const result = await licenseUtils.recordAdvancedOperatorUpdate(
    userAgentRiskRecord,
    baselineOperators,
    requestWithUserAgent(userAgent),
    'activation-token-user-agent-risk',
  )
  userAgentRiskRecord = result.record
}
if (userAgentRiskRecord.status !== 'frozen') {
  throw new Error('user-agent churn risk should still freeze cdk record')
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
