import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { atomicWriteFile, writeFileIfChanged } from './atomic-write.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const catalogPath = resolve(root, 'src/data/building-skills.json')
const rooms = { CONTROL: 'control', TRADING: 'trading', MANUFACTURE: 'manufacture', POWER: 'power', DORMITORY: 'dormitory', MEETING: 'meeting', HIRE: 'hire', WORKSHOP: 'processing', TRAINING: 'training' }
const gameRepo = 'Kengxxiao/ArknightsGameData'
const assetRepo = 'arkntools/arknights-toolbox-data'
const professionRepo = 'ZOOT-Plus/zoot-plus-frontend'
const professionRef = '130a0ce499da611fd49f4c2a03a2fe0b61684a8f'
const professions = ['', 'WARRIOR', 'SNIPER', 'TANK', 'MEDIC', 'SUPPORT', 'CASTER', 'SPECIAL', 'PIONEER']

function compile(building, names, characters, source) {
  const skills = {}
  const operators = {}
  for (const [shortId, name] of Object.entries(names)) {
    const id = `char_${shortId}`
    const character = building.chars[id]
    assert(character && typeof name === 'string', `Missing operator: ${id}`)
    const profession = professions[characters[shortId]?.profession]
    assert(profession, `Unknown profession: ${id}`)
    operators[id] = {
      name,
      skills: character.buffChar.flatMap((group, slot) => group.buffData.map((entry) => {
        const buff = building.buffs[entry.buffId]
        assert(buff && rooms[buff.roomType], `Unknown skill or facility: ${entry.buffId}`)
        assert(/^[A-Za-z0-9_&]+$/.test(buff.skillIcon), `Unsafe icon: ${buff.skillIcon}`)
        assert(typeof buff.description === 'string' && typeof buff.buffName === 'string', `Invalid skill: ${entry.buffId}`)
        skills[entry.buffId] = {
          name: buff.buffName, room: rooms[buff.roomType], icon: buff.skillIcon,
          description: buff.description.replace(/<[^>]*>/g, ''),
        }
        const elite = Number(String(entry.cond.phase).replace('PHASE_', ''))
        const level = entry.cond.level
        assert(Number.isInteger(elite) && elite >= 0 && elite <= 2 && Number.isInteger(level) && level >= 1, `Invalid unlock: ${entry.buffId}`)
        return { id: entry.buffId, slot, elite, level }
      })),
      profession,
    }
  }
  return { source, skills, operators }
}

async function fetchBytes(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000), headers: { 'User-Agent': 'goofish-infrast-asset-sync' } })
  if (!response.ok) throw new Error(`${response.status}: ${url}`)
  return Buffer.from(await response.arrayBuffer())
}
async function fetchJson(url) { return JSON.parse((await fetchBytes(url)).toString('utf8')) }
const raw = (repo, ref, path) => `https://raw.githubusercontent.com/${repo}/${ref}/${path}`

async function sync() {
  const check = process.argv.includes('--check')
  const old = await readFile(catalogPath, 'utf8').catch((error) => {
    if (error.code !== 'ENOENT') throw error
    return null
  })
  const source = check && old ? JSON.parse(old).source : {
    game: (await fetchJson(`https://api.github.com/repos/${gameRepo}/commits/master`)).sha,
    assets: (await fetchJson(`https://api.github.com/repos/${assetRepo}/commits/main`)).sha,
  }
  assert(/^[a-f0-9]{40}$/.test(source.game) && /^[a-f0-9]{40}$/.test(source.assets), 'Invalid upstream revisions')
  const [building, names, characters] = await Promise.all([
    fetchJson(raw(gameRepo, source.game, 'zh_CN/gamedata/excel/building_data.json')),
    fetchJson(raw(assetRepo, source.assets, 'assets/locales/cn/character.json')),
    fetchJson(raw(assetRepo, source.assets, 'assets/data/character.json')),
  ])
  const catalog = compile(building, names, characters, source)
  assert(Object.keys(catalog.operators).length > 300 && Object.keys(catalog.skills).length > 500, 'Incomplete upstream catalog')
  const icons = [
    ...[...new Set(Object.values(catalog.skills).map((skill) => skill.icon))].map((icon) => ({
      path: `public/building-skills/${icon}.png`,
      url: raw(assetRepo, source.assets, `assets/img/building_skill/${encodeURIComponent(icon)}.png`),
    })),
    ...professions.slice(1).map((profession) => ({
      path: `public/operator-professions/${profession}.png`,
      url: raw(professionRepo, professionRef, `public/assets/prof-icons/${profession}.png`),
    })),
  ]
  const downloads = new Map()
  let next = 0
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < icons.length) {
      const icon = icons[next++]
      const bytes = await fetchBytes(icon.url)
      assert(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `Invalid PNG: ${icon.path}`)
      downloads.set(icon.path, bytes)
    }
  }))
  const text = `${JSON.stringify(catalog)}\n`
  if (check) {
    assert.equal(old, text, 'Building skill catalog is out of sync')
    for (const [icon, bytes] of downloads) {
      assert(bytes.equals(await readFile(resolve(root, icon))), `Out-of-sync icon: ${icon}`)
    }
  } else {
    for (const [icon, bytes] of downloads) {
      const path = resolve(root, icon)
      const existing = await readFile(path).catch((error) => { if (error.code !== 'ENOENT') throw error; return null })
      if (!existing?.equals(bytes)) await atomicWriteFile(path, bytes)
    }
    await writeFileIfChanged(catalogPath, text)
  }
  console.log(`Building skills ${check ? 'verified' : 'synced'}: ${Object.keys(catalog.operators).length} operators, ${Object.keys(catalog.skills).length} skills, ${icons.length} icons.`)
}

if (process.argv.includes('--self-test')) {
  const fixture = {
    chars: { char_test: { buffChar: [{ buffData: [{ buffId: 'base', cond: { phase: 'PHASE_0', level: 1 } }, { buffId: 'upgrade', cond: { phase: 'PHASE_2', level: 1 } }] }] } },
    buffs: Object.fromEntries(['base', 'upgrade'].map((id) => [id, { buffName: id, roomType: 'TRADING', skillIcon: 'bskill_test', description: 'Production <@cc.vup>+30%</>' }])),
  }
  const characters = { test: { profession: 8 } }
  const catalog = compile(fixture, { test: 'Test' }, characters, {})
  assert.deepEqual(catalog.operators.char_test.skills, [{ id: 'base', slot: 0, elite: 0, level: 1 }, { id: 'upgrade', slot: 0, elite: 2, level: 1 }])
  assert.equal(catalog.skills.base.description, 'Production +30%')
  assert.equal(catalog.operators.char_test.profession, 'PIONEER')
  assert.throws(() => compile(fixture, { test: 'Test' }, {}, {}), /Unknown profession/)
  fixture.buffs.base.skillIcon = '../invalid'
  assert.throws(() => compile(fixture, { test: 'Test' }, characters, {}), /Unsafe icon/)
  console.log('Building skill compiler checks passed.')
} else {
  await sync()
}
