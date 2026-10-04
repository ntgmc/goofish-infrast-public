import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { prtsSnapshotPath } from '../server/cultivation/catalog.ts'
import { cliOptions, homeworkRow, loadPlanningAssets, readJson, withSnapshotLock, writeSnapshot } from './prts-planning-lib.mjs'

export async function importPrtsPlanning(options) {
  if (!options.database || !options.costs) throw new Error('Usage: node scripts/import-prts-planning.mjs --database <sqlite backup> --costs <prts_costs_evidence-v3.json> [--output <path>] [--assets <offline assets.json>]')
  const output = resolve(options.output ?? prtsSnapshotPath())
  if ([options.database, options.costs, options.assets].filter(Boolean).some((path) => resolve(path) === output)) throw new Error('Output must differ from input files')
  return withSnapshotLock(output, async () => {
    const costs = await readJson(options.costs)
    const database = new DatabaseSync(resolve(options.database), { readOnly: true })
    const homeworks = []
    let cursor = 0
    let missing = 0
    try {
      database.exec('BEGIN')
      const active = database.prepare("SELECT value FROM meta WHERE key = 'active_snapshot_id'").get()?.value
      if (!active) throw new Error('qqbot database has no completed active snapshot')
      const rows = database.prepare('SELECT h.homework_id, h.payload_json, d.summary_hash, d.content_json FROM homeworks h LEFT JOIN detail_cache d ON d.homework_id = h.homework_id WHERE h.snapshot_id = ? ORDER BY h.homework_id').all(Number(active))
      for (const row of rows) {
        cursor = Math.max(cursor, row.homework_id)
        const score = JSON.parse(row.payload_json)
        if (!row.content_json || row.summary_hash !== score.summary_hash) { missing++; continue }
        const homework = homeworkRow(row.homework_id, JSON.parse(row.content_json), row.summary_hash)
        if (homework) homeworks.push(homework)
      }
      if (missing > 0) throw new Error(`${missing} active homework details are missing or outdated; finish qqbot full refresh before export`)
      if (!homeworks.length) throw new Error('No usable homework details; finish qqbot full refresh before export')
    } finally { database.close() }
    const assets = options.assets ? await readJson(options.assets) : await loadPlanningAssets(costs.game_sha)
    const snapshot = { version: 1, updatedAt: new Date().toISOString(), cursor, reconcilePage: 1, homeworks, costs, ...assets, warnings: [] }
    await writeSnapshot(output, snapshot)
    return { output, count: homeworks.length, cursor }
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await importPrtsPlanning(cliOptions(process.argv.slice(2), ['database', 'costs', 'output', 'assets']))
  console.log(`Imported ${result.count} PRTS homeworks; cursor=${result.cursor}; output=${result.output}`)
}
