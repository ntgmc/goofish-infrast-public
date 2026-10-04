import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { cliOptions } from './prts-planning-lib.mjs'
import { syncPrtsPlanning } from './prts-planning-sync.mjs'
export { syncPrtsPlanning } from './prts-planning-sync.mjs'

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await syncPrtsPlanning(cliOptions(process.argv.slice(2), ['output', 'reconcile', 'refresh-assets', 'costs']))
  console.log(`PRTS sync: ${result.changed} changed, ${result.reconciled} rechecked; cursor=${result.cursor}`)
}
