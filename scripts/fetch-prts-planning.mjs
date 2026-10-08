import { resolve } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { prtsSnapshotSchema } from '../server/cultivation/catalog.ts'
import { cliOptions, fetchJson, hashContent, homeworkRow, readJson, withSnapshotLock, writeSnapshot } from './prts-planning-lib.mjs'

export async function fetchPrtsPlanning(options, request = (url) => fetchJson(url, { signal: options.signal }), pause = () => setTimeout(500, undefined, { signal: options.signal }), progress = () => {}) {
  if (!options.base || !options.output) throw new Error('Usage: node scripts/fetch-prts-planning.mjs --base <existing snapshot.json> --output <new snapshot.json>')
  const output = resolve(options.output)
  if (resolve(options.base) === output) throw new Error('Output must differ from the base snapshot')
  return withSnapshotLock(output, async () => {
    const snapshot = prtsSnapshotSchema.parse(await readJson(options.base))
    const homeworks = []
    const seen = new Set()
    let cursor = 0
    let oldest = Infinity
    let page = 1
    for (;; page++) {
      await pause()
      const url = `https://prts.maa.plus/copilot/query?page=${page}&limit=200&desc=true&order_by=id&type=PRTS&status=PUBLIC`
      let payload
      for (let attempt = 0; ; attempt++) {
        try { payload = await request(url); break }
        catch (error) {
          if (attempt >= 3 || options.signal?.aborted || (error.status && error.status !== 429 && error.status < 500)) throw error
          await setTimeout(1000 * 2 ** attempt, undefined, { signal: options.signal })
        }
      }
      const data = payload?.data
      if (payload?.status_code !== 200 || !Array.isArray(data?.data) || typeof data.has_next !== 'boolean') throw new Error('Invalid PRTS page')
      let previous = Infinity
      let advanced = false
      for (const row of data.data) {
        if (!Number.isSafeInteger(row?.id) || row.id < 1 || row.id >= previous) throw new Error('PRTS page is not in descending ID order')
        previous = row.id
        // New uploads can shift page boundaries; accept overlap without importing duplicates.
        if (seen.has(row.id)) continue
        if (row.id >= oldest) throw new Error('PRTS pagination is not in descending ID order')
        seen.add(row.id)
        oldest = row.id
        cursor = Math.max(cursor, row.id)
        advanced = true
        if (row.available !== true || row.status !== 'PUBLIC' || row.type !== 'PRTS') continue
        if (typeof row.content !== 'string') throw new Error(`Homework ${row.id} has no content`)
        const homework = homeworkRow(row.id, JSON.parse(row.content), hashContent(row.content), row)
        if (!homework) continue
        if (!homework.uploadedAt) throw new Error(`Homework ${row.id} has no valid publication time`)
        homeworks.push(homework)
      }
      progress({ page, summaries: seen.size, count: homeworks.length, total: data.total })
      if (!data.has_next) break
      if (!advanced) throw new Error('PRTS pagination did not advance')
    }
    if (!homeworks.length) throw new Error('No usable PRTS homeworks')
    options.signal?.throwIfAborted()
    await writeSnapshot(output, { ...snapshot, homeworks, cursor, reconcilePage: 1, updatedAt: new Date().toISOString() })
    return { output, count: homeworks.length, cursor, pages: page }
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await fetchPrtsPlanning(cliOptions(process.argv.slice(2), ['base', 'output']), undefined, undefined, ({ page, summaries, count, total }) => {
    if (page === 1 || page % 10 === 0) console.log(`PRTS page ${page}: ${summaries}/${total} summaries, ${count} usable homeworks`)
  })
  console.log(`Fetched ${result.count} PRTS homeworks with publication times; cursor=${result.cursor}; pages=${result.pages}; output=${result.output}`)
}
