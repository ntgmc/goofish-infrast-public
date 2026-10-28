import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { atomicWriteFile, writeFileIfChanged } from './atomic-write.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const catalogPath = resolve(root, 'src/data/cultivation-item-icons.json')
const sklandCatalogPath = resolve(root, 'src/data/skland-items.json')
const resourceIds = ['3003', '3141', '4002', '4003', '4004', '4005', '4006', '4007', '4008', '4009', '4010', '5001', '6001', '7001', '7002', '7003', '7004', '7006', '3401', '3131', '3132', '3133', '3112', '3113', '3114', 'classic_normal_ticket', 'classic_gacha']
const assetRepo = 'arkntools/arknights-toolbox-data'
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const safeName = /^[A-Za-z0-9_-]{1,128}$/
const specialType = /^(?:VOUCHER_PICK|VOUCHER_(?:LEVELMAX|ELITE_II|SKILL_SPECIALLEVELMAX)_[456])$/

function planIcons(tree, items) {
  assert(!tree.truncated && Array.isArray(tree.tree), 'Incomplete upstream asset tree')
  const icons = new Map()
  const itemIcons = {}
  const add = (kind, name, url) => {
    assert(safeName.test(name), `Unsafe icon name: ${name}`)
    icons.set(`public/${kind}-icons/${name}.png`, url)
  }
  for (const entry of tree.tree) {
    const match = entry.type === 'blob' && entry.path.match(/^assets\/img\/(item|skill)\/([^/]+)\.png$/)
    if (!match) continue
    const [, kind, id] = match
    const name = kind === 'item' ? items[id]?.iconId || id : id
    if (kind === 'item') itemIcons[id] = name
    add(kind, name, `https://cdn.jsdelivr.net/gh/${assetRepo}@${tree.sha}/${entry.path}`)
  }
  for (const id of resourceIds) {
    const item = items[id]
    if (!item?.iconId || itemIcons[id]) continue
    itemIcons[id] = item.iconId
    add('item', item.iconId, `https://torappu.prts.wiki/assets/item_icon/${item.iconId}.png`)
  }
  for (const item of Object.values(items)) {
    if (specialType.test(item.itemType) && item.iconId) {
      add('item', item.iconId, `https://torappu.prts.wiki/assets/item_icon/${item.iconId}.png`)
    }
  }
  const sklandItems = Object.fromEntries(Object.entries(items).map(([id, item]) => {
    const group = resourceIds.includes(id) || ['GOLD', 'CARD_EXP'].includes(item.itemType) ? 'resources'
      : /^(?:MTL_ASC|MTL_SKILL)/.test(item.iconId) || id.startsWith('mod_') ? 'upgrades'
        : item.classifyType === 'MATERIAL' && item.sortId < 200000 ? 'materials' : 'other'
    return [id, { name: item.name, ...(icons.has(`public/item-icons/${item.iconId}.png`) && { icon: item.iconId }), group, sort: item.sortId }]
  }))
  return { icons, itemIcons, sklandItems }
}

async function fetchBytes(url, maximumBytes = 5_000_000) {
  for (let attempt = 1; ; attempt++) {
    try {
      const headers = { 'User-Agent': 'goofish-infrast-icon-sync' }
      if (url.startsWith('https://api.github.com/') && process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) })
      if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}: ${url}`) }
      const reader = response.body?.getReader()
      assert(reader, `Empty response: ${url}`)
      const chunks = []
      let size = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > maximumBytes) { await reader.cancel(); throw new Error(`Response too large: ${url}`) }
        chunks.push(value)
      }
      return Buffer.concat(chunks)
    } catch (error) {
      if (attempt === 3) throw error
    }
  }
}

async function existing(path) {
  try { return await readFile(path) }
  catch (error) { if (error.code !== 'ENOENT') throw error; return null }
}

async function sync() {
  const check = process.argv.includes('--check')
  const [tree, table] = await Promise.all([
    fetchBytes(`https://api.github.com/repos/${assetRepo}/git/trees/main?recursive=1`).then((bytes) => JSON.parse(bytes)),
    fetchBytes('https://cdn.jsdelivr.net/gh/Kengxxiao/ArknightsGameData@master/zh_CN/gamedata/excel/item_table.json').then((bytes) => JSON.parse(bytes)),
  ])
  const { icons, itemIcons, sklandItems } = planIcons(tree, table.items)
  assert(Object.keys(itemIcons).length >= 97 && icons.size > 900, 'Incomplete upstream icon catalog')
  const previous = JSON.parse(await readFile(catalogPath, 'utf8'))
  for (const id of Object.keys(previous)) assert(itemIcons[id], `Missing material icon: ${id}`)
  const downloads = new Map()
  const entries = [...icons]
  let next = 0
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < entries.length) {
      const [path, url] = entries[next++]
      const bytes = await fetchBytes(url, 512 * 1024)
      assert(bytes.length >= 24 && bytes.subarray(0, 8).equals(pngSignature) && bytes.toString('ascii', 12, 16) === 'IHDR'
        && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(16) <= 2048
        && bytes.readUInt32BE(20) > 0 && bytes.readUInt32BE(20) <= 2048, `Invalid PNG: ${path}`)
      downloads.set(path, bytes)
    }
  }))
  const license = await fetchBytes(`https://cdn.jsdelivr.net/gh/${assetRepo}@${tree.sha}/LICENSE`)
  assert(license.toString('utf8').includes('MIT License'), 'Missing upstream asset license')
  downloads.set('public/item-icons/LICENSE.txt', license)
  downloads.set('public/skill-icons/LICENSE.txt', license)
  let changed = 0
  for (const [path, bytes] of downloads) {
    const destination = resolve(root, path)
    if (!bytes.equals(await existing(destination) ?? Buffer.alloc(0))) {
      assert(!check, `Out-of-sync icon: ${path}`)
      await atomicWriteFile(destination, bytes, { mode: 0o644 })
      changed++
    }
  }
  for (const [path, data] of [[catalogPath, itemIcons], [sklandCatalogPath, sklandItems]]) {
    const catalog = `${JSON.stringify(data, null, 2)}\n`
    if (check) assert.equal(await readFile(path, 'utf8'), catalog, `Item catalog is out of sync: ${path}`)
    else await writeFileIfChanged(path, catalog, { mode: 0o644 })
  }
  console.log(`Cultivation icons ${check ? 'verified' : 'synced'}: ${Object.keys(itemIcons).length} materials, ${icons.size} PNGs, ${changed} changed (${assetRepo}@${tree.sha}).`)
}

if (process.argv.includes('--self-test')) {
  const tree = { sha: 'a'.repeat(40), truncated: false, tree: [
    { type: 'blob', path: 'assets/img/item/4001.png' },
    { type: 'blob', path: 'assets/img/skill/shared.png' },
    { type: 'blob', path: 'assets/img/avatar/unused.png' },
  ] }
  const items = { '4001': { name: '龙门币', iconId: 'GOLD', itemType: 'GOLD', sortId: 10400 }, voucher: { iconId: 'voucher', itemType: 'VOUCHER_ELITE_II_6' }, duplicate: { iconId: 'voucher', itemType: 'VOUCHER_PICK' } }
  const plan = planIcons(tree, items)
  assert.deepEqual(plan.itemIcons, { '4001': 'GOLD' })
  assert.deepEqual(plan.sklandItems['4001'], { name: '龙门币', icon: 'GOLD', group: 'resources', sort: 10400 })
  assert.equal(plan.icons.size, 3)
  assert(plan.icons.get('public/skill-icons/shared.png').includes(`@${tree.sha}/`))
  assert.equal(plan.icons.get('public/item-icons/voucher.png'), 'https://torappu.prts.wiki/assets/item_icon/voucher.png')
  assert.throws(() => planIcons({ ...tree, truncated: true }, items), /Incomplete/)
  assert.throws(() => planIcons(tree, { '4001': { iconId: '../bad' } }), /Unsafe/)
  console.log('Cultivation icon sync checks passed.')
} else {
  await sync()
}
