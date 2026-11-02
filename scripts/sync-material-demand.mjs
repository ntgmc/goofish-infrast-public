import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileIfChanged } from './atomic-write.mjs'
import { buildMaterialDemand } from './material-demand-lib.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const names = ['character_table', 'char_patch_table', 'item_table', 'building_data', 'uniequip_table']
const options = {}
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index]
  assert(['--input-dir', '--game-sha', '--as-of'].includes(key) && process.argv[index + 1] && !options[key], `Invalid option: ${key}`)
  options[key] = process.argv[index + 1]
}

async function fetchBytes(url, maximumBytes) {
  const headers = { 'User-Agent': 'MaaTool-material-demand' }
  if (url.startsWith('https://api.github.com/') && process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(45000) })
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Upstream HTTP ${response.status}: ${url}`) }
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maximumBytes) { await reader.cancel(); throw new Error(`Upstream response too large: ${url}`) }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

let gameSha = options['--game-sha']
if (!gameSha) {
  assert(!options['--input-dir'], 'Offline sync requires --game-sha')
  const ref = JSON.parse(await fetchBytes('https://api.github.com/repos/Kengxxiao/ArknightsGameData/git/ref/heads/master', 100_000))
  gameSha = ref.object?.sha
}
assert(typeof gameSha === 'string' && /^[a-f0-9]{40}$/.test(gameSha), 'Invalid game data SHA')
const base = `https://cdn.jsdelivr.net/gh/Kengxxiao/ArknightsGameData@${gameSha}/zh_CN/gamedata/excel`
const read = (name, url, maximumBytes) => options['--input-dir'] ? readFile(resolve(options['--input-dir'], name)) : fetchBytes(url, maximumBytes)
const [tableEntries, releaseBytes] = await Promise.all([
  Promise.all(names.map(async (name) => [name, JSON.parse(await read(`${name}.json`, `${base}/${name}.json`, 32_000_000))])),
  read('operator_release_dates.html', 'https://prts.wiki/w/干员上线时间一览', 2_000_000),
])
const asOf = options['--as-of'] ?? new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
const snapshot = buildMaterialDemand(Object.fromEntries(tableEntries), releaseBytes.toString('utf8'), {
  gameSha, asOf, releaseDatesSha256: createHash('sha256').update(releaseBytes).digest('hex'),
})
assert(snapshot.operators.length >= 400 && snapshot.modules.length >= 400 && snapshot.materials.length >= 21, 'Incomplete material demand snapshot')
await writeFileIfChanged(resolve(root, 'src/data/material-demand.json'), `${JSON.stringify(snapshot)}\n`, { mode: 0o644 })
console.log(`Material demand synced: ${snapshot.operators.length} operator/form events, ${snapshot.modules.length} modules, ${snapshot.materials.length} materials (${gameSha}, ${asOf}).`)
