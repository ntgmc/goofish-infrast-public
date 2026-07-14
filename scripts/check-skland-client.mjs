import * as esbuild from 'esbuild'
import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const bundleDir = resolve('.cache/check-skland-client')
await mkdir(bundleDir, { recursive: true })
process.env.SKLAND_CREDENTIAL_SECRET = 'check-skland-credential-secret'

const modulePath = await bundleModule('server/handlers/skland-client.ts')
const skland = await import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`)

const sign = skland.generateSklandSign('token', '/api/v1/game/player/info', 'uid=123', '1700000000')
if (sign !== skland.generateSklandSign('token', '/api/v1/game/player/info', 'uid=123', '1700000000')) {
  throw new Error('skland sign must be stable')
}
if (!/^[a-f0-9]{32}$/.test(sign)) {
  throw new Error('skland sign must be md5 hex')
}

const encrypted = skland.encryptSklandCredential('cred-secret')
if (encrypted.includes('cred-secret')) {
  throw new Error('encrypted credential leaked plaintext')
}
if (skland.decryptSklandCredential(encrypted) !== 'cred-secret') {
  throw new Error('credential decrypt roundtrip failed')
}
const legacyCredential = encryptLegacyCredential('legacy-cred', 'check-skland-credential-secret')
process.env.SKLAND_CREDENTIAL_SECRET = 'check-skland-credential-rotated-secret'
process.env.SKLAND_CREDENTIAL_SECRET_PREVIOUS = 'check-skland-credential-secret'
process.env.SKLAND_CREDENTIAL_KEY_ID = '2026q3'
process.env.SKLAND_CREDENTIAL_KEY_ID_PREVIOUS = '2026q2'
if (skland.decryptSklandCredential(legacyCredential) !== 'legacy-cred') {
  throw new Error('legacy credential should decrypt with the previous rotation key')
}
const rotatedCredential = skland.encryptSklandCredential('rotated-cred')
if (!rotatedCredential.startsWith('SKLAND-V2:2026q3:') || !skland.isSklandCredentialCurrent(rotatedCredential)) {
  throw new Error('rotated credential should use the active V2 key id')
}

const operators = skland.convertSklandCharactersToOperators({
  data: {
    chars: [
      { charId: 'char_002_amiya', evolvePhase: 2, level: 80, potentialRank: 5 },
      { charId: 'char_1001_amiya2', evolvePhase: 1, level: 70, potentialRank: 3 },
      { charId: 'char_1037_amiya3', evolvePhase: 0, level: 50, potentialRank: 1 },
      { charId: 'token_10002_kalts_mon3tr', name: 'Mon3tr', evolvePhase: 0, rarity: 5 },
      { charId: 'char_010_chen', name: '陈', evolvePhase: '1', level: '70', potentialRank: '2', rarity: 0 },
      { charId: 'char_rawonly', name: '仅原始稀有度', evolvePhase: 0, level: 1, potentialRank: 0, rarity: 5 },
    ],
    charInfoMap: {
      char_002_amiya: { name: '阿米娅', rarity: 4 },
      char_1001_amiya2: { name: '阿米娅', rarity: 4 },
      char_1037_amiya3: { name: '阿米娅', rarity: 4 },
      char_010_chen: { name: '陈', rarity: 5 },
    },
  },
})
if (operators.length !== 2) {
  throw new Error(`expected 2 converted operators, got ${operators.length}`)
}
if (!operators.every((operator) => operator.id.startsWith('char_') && operator.own === true)) {
  throw new Error('converted operators have invalid ids or ownership')
}
if (operators.filter((operator) => operator.name === '阿米娅').length !== 1) {
  throw new Error('converted operators should dedupe Amiya variants')
}
const chen = operators.find((operator) => operator.id === 'char_010_chen')
if (chen?.rarity !== 5) {
  throw new Error(`converted operators should use charInfoMap rarity, got ${chen?.rarity}`)
}
if (operators.some((operator) => operator.id === 'char_rawonly')) {
  throw new Error('converted operators should require charInfoMap rarity')
}

const calls = []
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init })
  if (String(url).endsWith('/general/v1/gen_scan/login')) {
    return jsonResponse({ status: 0, msg: 'OK', data: { scanId: 'scan-1' } })
  }
  if (String(url).includes('/general/v1/scan_status')) {
    return jsonResponse({ status: 0, data: { scanCode: 'scan-code-1' } })
  }
  if (String(url).endsWith('/user/auth/v1/token_by_scan_code')) {
    return jsonResponse({ status: 0, msg: 'OK', data: { token: 'account-token' } })
  }
  if (String(url).endsWith('/user/oauth2/v2/grant')) {
    return jsonResponse({ msg: 'OK', data: { code: 'oauth-code' } })
  }
  if (String(url).endsWith('/web/v1/user/auth/generate_cred_by_code')) {
    return jsonResponse({ message: 'OK', data: { cred: 'skland-cred' } })
  }
  if (String(url).endsWith('/api/v1/auth/refresh')) {
    return jsonResponse({ code: 0, message: 'OK', data: { token: 'skland-token' }, timestamp: 1700000000 })
  }
  if (String(url).endsWith('/api/v1/game/player/binding')) {
    if (init?.headers?.cred === 'multi-account-cred') {
      return jsonResponse({
        code: 0,
        message: 'OK',
        data: {
          list: [{
            appCode: 'arknights',
            defaultUid: '22222222',
            bindingList: [
              { uid: '11111111', nickName: '账号一', channelName: '官服' },
              { uid: '22222222', nickName: '账号二', channelName: 'B服' },
              { uid: '11111111', nickName: '重复账号', channelName: '官服' },
              { uid: '', nickName: '无效账号', channelName: '官服' },
            ],
          }, {
            appCode: 'endfield',
            bindingList: [{ uid: '33333333', nickName: '终末地账号', channelName: '官服' }],
          }],
        },
      })
    }
    if (init?.headers?.cred === 'blank-default-uid-cred') {
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
          defaultUid: '12345678',
          bindingList: [{ nickName: '博士', channelName: '官服' }],
        }],
      },
    })
  }
  if (String(url).includes('/api/v1/game/player/info')) {
    return jsonResponse({
      code: 0,
      message: 'OK',
      data: {
        chars: [{ charId: 'char_002_amiya', name: '阿米娅', evolvePhase: 2, level: 80, potentialRank: 5, rarity: 0 }],
        charInfoMap: { char_002_amiya: { name: '阿米娅', rarity: 4 } },
      },
    })
  }
  if (String(url).endsWith('/api/v1/game/cultivate/info')) {
    return jsonResponse({
      code: 0,
      message: 'OK',
      data: {
        characters: [],
        items: {
          3003: { name: '赤金' },
          shard_item: { id: 'shard_item', name: '源石碎片' },
        },
      },
    })
  }
  if (String(url).includes('/api/v1/game/cultivate/player')) {
    return jsonResponse({
      code: 0,
      message: 'OK',
      data: {
        items: [
          { id: '3003', count: 123 },
          { id: 'shard_item', count: '45' },
        ],
        characters: [],
      },
    })
  }
  if (String(url).includes('/api/v1/game/cultivate/character')) {
    return jsonResponse({ code: 0, message: 'OK', data: { evolvePhaseCost: [] } })
  }
  throw new Error(`unexpected fetch ${url}`)
}

const scan = await skland.createHypergryphScan()
if (scan.scanId !== 'scan-1' || !scan.scanUrl.includes('hypergryph://scan_login')) {
  throw new Error('scan creation returned invalid payload')
}
if (await skland.getScanCode('scan-1') !== 'scan-code-1') {
  throw new Error('scan status did not return scan code')
}
const accountToken = await skland.getHypergryphTokenByScanCode('scan-code-1')
const cred = await skland.getCredByHypergryphToken(accountToken)
if (cred !== 'skland-cred') throw new Error('cred exchange failed')
const cultivateCallsBeforeDefaultImport = calls.filter((call) => String(call.url).includes('/api/v1/game/cultivate/')).length
const imported = await skland.importSklandOperatorsByCred(cred, { uid: '12345678' })
if (imported.binding.uid !== '12345678' || imported.operators.length !== 1) {
  throw new Error('skland import flow failed')
}
const cultivateCallsAfterDefaultImport = calls.filter((call) => String(call.url).includes('/api/v1/game/cultivate/')).length
if (cultivateCallsAfterDefaultImport !== cultivateCallsBeforeDefaultImport) {
  throw new Error('default skland import should not read cultivate inventory')
}
const importedWithInventory = await skland.importSklandOperatorsByCred(cred, { uid: '12345678', includeInventory: true })
if (
  importedWithInventory.intermediateInventory?.['Pure Gold'] !== 123 ||
  importedWithInventory.intermediateInventory?.['Originium Shard'] !== 45
) {
  throw new Error(`skland import should read intermediate inventory, got ${JSON.stringify(importedWithInventory.intermediateInventory)}`)
}
const blankDefaultUidImported = await skland.importSklandOperatorsByCred('blank-default-uid-cred', { uid: '130761348' })
if (
  blankDefaultUidImported.binding.uid !== '130761348'
  || blankDefaultUidImported.binding.nickname !== 'Blank Default Doctor'
  || blankDefaultUidImported.binding.channel_name !== '官服'
  || blankDefaultUidImported.operators.length !== 1
) {
  throw new Error(`blank defaultUid import flow failed: ${JSON.stringify(blankDefaultUidImported.binding)}`)
}
if (!calls.some((call) => String(call.url).endsWith('/api/v1/game/player/info?uid=130761348'))) {
  throw new Error('blank defaultUid import should read Arknights player info by bindingList uid')
}
if (calls.some((call) => String(call.url).endsWith('/api/v1/game/player/info?uid=434207645'))) {
  throw new Error('blank defaultUid import should ignore Endfield uid')
}
const multiAccounts = await skland.listSklandArknightsBindingsByCred('multi-account-cred')
if (
  multiAccounts.length !== 2
  || multiAccounts[0].uid !== '22222222'
  || !multiAccounts[0].is_default
  || multiAccounts[1].uid !== '11111111'
  || multiAccounts[1].is_default
) {
  throw new Error(`multi-account binding parsing failed: ${JSON.stringify(multiAccounts)}`)
}
const selectedImport = await skland.importSklandOperatorsByCred('multi-account-cred', { uid: '11111111', includeInventory: true })
if (selectedImport.binding.uid !== '11111111') {
  throw new Error(`explicit account selection imported the wrong uid: ${selectedImport.binding.uid}`)
}
if (!calls.some((call) => String(call.url).endsWith('/api/v1/game/player/info?uid=11111111'))) {
  throw new Error('explicit account selection should read player info for the selected uid')
}
if (!calls.some((call) => String(call.url).endsWith('/api/v1/game/cultivate/player?uid=11111111'))) {
  throw new Error('explicit account selection should read inventory for the selected uid')
}
let rejectedUnknownUid = false
try {
  await skland.importSklandOperatorsByCred('multi-account-cred', { uid: '99999999' })
} catch (error) {
  rejectedUnknownUid = String(error?.message ?? error).includes('不在森空岛绑定列表')
}
if (!rejectedUnknownUid) throw new Error('unknown selected uid should be rejected')
const refreshCallsBeforeCultivate = calls.filter((call) => String(call.url).endsWith('/api/v1/auth/refresh')).length
const cultivateClient = new skland.SklandClient('cultivate-cred')
await cultivateClient.getCultivateInfo()
await cultivateClient.getCultivatePlayer('12345678')
await cultivateClient.getCultivateCharacter('char_002_amiya')
const refreshCallsAfterCultivate = calls.filter((call) => String(call.url).endsWith('/api/v1/auth/refresh')).length
if (refreshCallsAfterCultivate !== refreshCallsBeforeCultivate + 1) {
  throw new Error('cultivate requests should reuse one refreshed Skland token')
}
for (const path of ['/api/v1/game/cultivate/info', '/api/v1/game/cultivate/player?uid=12345678', '/api/v1/game/cultivate/character?characterId=char_002_amiya']) {
  if (!calls.some((call) => String(call.url).endsWith(path))) {
    throw new Error(`missing cultivate request ${path}`)
  }
}
if (calls.some((call) => JSON.stringify(call).includes('cred-secret'))) {
  throw new Error('mock calls should not include credential plaintext from encryption test')
}

console.log('skland client smoke check ok')

async function bundleModule(entryPoint) {
  const outputPath = resolve(bundleDir, `${entryPoint.replace(/[\\/.:]/g, '-')}.mjs`)
  const result = await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    external: ['qrcode'],
  })
  await writeFile(outputPath, result.outputFiles[0].text, 'utf8')
  return outputPath
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function encryptLegacyCredential(credential, secret) {
  const iv = randomBytes(12)
  const key = createHash('sha256').update(secret).digest()
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(credential, 'utf8'), cipher.final()])
  return 'SKLAND-V1:' + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64')
}
