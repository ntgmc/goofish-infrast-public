import * as esbuild from 'esbuild'
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

const operators = skland.convertSklandCharactersToOperators({
  data: {
    chars: [
      { charId: 'char_002_amiya', evolvePhase: 2, level: 80, potentialRank: 5 },
      { charId: 'char_1001_amiya2', evolvePhase: 1, level: 70, potentialRank: 3 },
      { charId: 'char_1037_amiya3', evolvePhase: 0, level: 50, potentialRank: 1 },
      { charId: 'token_10002_kalts_mon3tr', name: 'Mon3tr', evolvePhase: 0, rarity: 5 },
      { charId: 'char_010_chen', name: '陈', evolvePhase: '1', level: '70', potentialRank: '2', rarity: '5' },
    ],
    charInfoMap: {
      char_002_amiya: { name: '阿米娅', rarity: 4 },
      char_1001_amiya2: { name: '阿米娅', rarity: 4 },
      char_1037_amiya3: { name: '阿米娅', rarity: 4 },
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
      data: { chars: [{ charId: 'char_002_amiya', name: '阿米娅', evolvePhase: 2, level: 80, potentialRank: 5, rarity: 4 }] },
    })
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
const imported = await skland.importSklandOperatorsByCred(cred)
if (imported.binding.uid !== '12345678' || imported.operators.length !== 1) {
  throw new Error('skland import flow failed')
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
