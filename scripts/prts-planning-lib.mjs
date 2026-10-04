import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { prtsSnapshotSchema } from '../server/cultivation/catalog.ts'

export const hashContent = (content) => createHash('sha256').update(typeof content === 'string' ? content : JSON.stringify(content)).digest('hex')

export function homeworkRow(id, content, hash = hashContent(content)) {
  if (!Number.isSafeInteger(id) || id < 1 || !content || typeof content !== 'object' || Array.isArray(content)) throw new Error('Invalid PRTS homework')
  if (content.type === 'SSS' || typeof content.stage_name !== 'string' || !content.stage_name) return null
  const mode = [1, 2, 3].includes(content.difficulty) ? content.difficulty : content.stage_name.includes('#f#') ? 2 : 1
  return { id, content, hash, mode, stageId: content.stage_name.split('#f#')[0] }
}

export async function readJson(path) { return JSON.parse(await readFile(path, 'utf8')) }

export async function writeSnapshot(path, snapshot) {
  const data = prtsSnapshotSchema.parse(snapshot)
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const file = await open(temporary, 'wx', 0o600)
    try { await file.writeFile(JSON.stringify(data)); await file.sync() } finally { await file.close() }
    await rename(temporary, path)
  } finally { await unlink(temporary).catch(() => undefined) }
}

export async function withSnapshotLock(path, operation) {
  await mkdir(dirname(path), { recursive: true })
  const lockPath = `${path}.lock`
  const lock = await open(lockPath, 'wx', 0o600).catch((error) => {
    if (error.code === 'EEXIST') throw new Error('PRTS import/sync is already locked; check the running process before removing a stale .lock file')
    throw error
  })
  try { await lock.writeFile(String(process.pid)); return await operation() }
  finally { await lock.close(); await unlink(lockPath) }
}

export async function fetchJson(url, options = {}) {
  const timeout = AbortSignal.timeout(30000)
  const response = await fetch(url, { ...options, signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout })
  if (!response.ok) {
    await response.body?.cancel()
    const error = new Error(`Upstream HTTP ${response.status}`)
    error.status = response.status
    throw error
  }
  const reader = response.body.getReader()
  const chunks = []
  let bytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > 64 * 1024 * 1024) { await reader.cancel(); throw new Error('Upstream response too large') }
    chunks.push(value)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

export async function loadPlanningAssets(gameSha, signal) {
  if (!/^[0-9a-f]{40}$/.test(gameSha)) throw new Error('Import requires the pinned game_sha in qqbot prts_costs_evidence-v3.json')
  const base = `https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/${gameSha}/zh_CN/gamedata/excel`
  const [characters, building, items, zones, stages, drops] = await Promise.all([
    ...['character_table', 'building_data', 'item_table', 'zone_table', 'stage_table'].map((file) => fetchJson(`${base}/${file}.json`, { signal })),
    fetchJson('https://penguin-stats.io/PenguinStats/api/v2/result/matrix?server=CN', { signal }),
  ])
  const operators = Object.fromEntries(Object.entries(characters).filter(([id]) => id.startsWith('char_')).map(([id, row]) => [id, {
    name: row.name, rarity: typeof row.rarity === 'number' ? row.rarity + 1 : Number(String(row.rarity).replace('TIER_', '')), skills: (row.skills ?? []).map((skill) => skill.skillId),
  }]))
  const recipes = {}
  for (const formula of [...Object.values(building.workshopFormulas), ...Object.values(building.manufactFormulas)]) {
    if (!['F_EVOLVE', 'F_SKILL', 'F_ASC'].includes(formula.formulaType)) continue
    const cost = Object.fromEntries((formula.costs ?? []).map((row) => [row.id, row.count]))
    if (formula.goldCost) cost['4001'] = (cost['4001'] ?? 0) + formula.goldCost
    recipes[formula.itemId] = { count: formula.count, items: cost }
  }
  const farms = {}
  const stageExp = new Map()
  const expValues = { '2001': 200, '2002': 400, '2003': 1000, '2004': 2000 }
  for (const row of drops.matrix ?? []) {
    const stage = stages.stages[row.stageId]
    if (!stage || !['MAIN', 'SUB', 'DAILY'].includes(stage.stageType) || stage.difficulty !== 'NORMAL' || stage.apCost <= 0 || row.times < 300 || row.quantity <= 0 || row.endTime) continue
    const days = zones.weeklyAdditionInfo[stage.zoneId]?.daysOfWeek ?? [1, 2, 3, 4, 5, 6, 7]
    const farm = { stage: stage.code, sanity: stage.apCost, quantity: row.quantity / row.times, days }
    if (!Number.isFinite(farm.quantity)) continue
    if (expValues[row.itemId]) {
      const prior = stageExp.get(row.stageId) ?? { ...farm, quantity: 0 }
      prior.quantity += farm.quantity * expValues[row.itemId]
      stageExp.set(row.stageId, prior)
    } else (farms[row.itemId] ??= []).push(farm)
  }
  farms.exp = [...stageExp.values()]
  // Fixed supply rewards are absent from Penguin's random-drop matrix.
  const lmdRewards = { 'CE-1': 1700, 'CE-2': 2800, 'CE-3': 4100, 'CE-4': 5700, 'CE-5': 7500, 'CE-6': 10000 }
  farms['4001'] = Object.values(stages.stages).filter((stage) => lmdRewards[stage.code] && stage.difficulty === 'NORMAL').map((stage) => ({ stage: stage.code, sanity: stage.apCost, quantity: lmdRewards[stage.code], days: zones.weeklyAdditionInfo[stage.zoneId]?.daysOfWeek ?? [2, 4, 6, 7] }))
  const potionValues = {}
  const itemNames = { exp: '作战经验' }
  for (const [id, item] of Object.entries(items.items)) {
    itemNames[id] = item.name
    if (item.itemType === 'AP_SUPPLY') {
      const amount = id.match(/^ap_supply_(?:lt_)?(\d+)(?:_|$)/)?.[1]
      if (amount && Number(amount) > 0) potionValues[id] = Number(amount)
    }
  }
  for (const [id, options] of Object.entries(farms)) farms[id] = options.sort((a, b) => a.sanity / a.quantity - b.sanity / b.quantity).slice(0, 12)
  return { operators, recipes, farms, itemNames, potionValues }
}

export function cliOptions(argv, allowed) {
  const options = {}
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index].replace(/^--/, '')
    if (!argv[index].startsWith('--') || !allowed.includes(key) || !argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error(`Expected --${allowed.join(', --')} with values`)
    if (options[key] !== undefined) throw new Error(`Duplicate --${key}`)
    options[key] = argv[index + 1]
  }
  return options
}
