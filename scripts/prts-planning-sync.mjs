import { resolve } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { prtsSnapshotPath, prtsSnapshotSchema } from '../server/cultivation/catalog.ts'
import { fetchJson, hashContent, homeworkRow, loadPlanningAssets, readJson, withSnapshotLock, writeSnapshot } from './prts-planning-lib.mjs'

const API = 'https://prts.maa.plus'
const unwrap = (payload) => {
  if (payload?.status_code !== 200) throw new Error('Invalid PRTS API status')
  return payload.data
}

export async function syncPrtsPlanning(options = {}, request = (url) => fetchJson(url, { signal: options.signal }), pause = () => setTimeout(500, undefined, { signal: options.signal })) {
  const output = resolve(options.output ?? prtsSnapshotPath())
  const reconcile = Number(options.reconcile ?? 200)
  if (!Number.isInteger(reconcile) || reconcile < 0 || reconcile > 2000) throw new Error('--reconcile must be 0..2000')
  return withSnapshotLock(output, async () => {
    const snapshot = prtsSnapshotSchema.parse(await readJson(output))
    const byId = new Map(snapshot.homeworks.map((row) => [row.id, row]))
    let cursor = snapshot.cursor
    let changed = 0
    let previousPageLastId = Infinity
    for (let page = 1; ; page++) {
      if (page > 1000) throw new Error('Incremental backlog exceeds 50,000 rows; cursor was not advanced')
      const data = unwrap(await request(`${API}/copilot/query?page=${page}&limit=50&desc=true&order_by=id&type=PRTS&status=PUBLIC`))
      if (!Array.isArray(data?.data)) throw new Error('Invalid PRTS page')
      let boundary = false
      let previous = previousPageLastId
      for (const row of data.data) {
        if (!Number.isSafeInteger(row.id) || row.id >= previous) throw new Error('PRTS page is not in descending ID order')
        previous = row.id
        cursor = Math.max(cursor, row.id)
        if (row.id <= snapshot.cursor) { boundary = true; continue }
        if (row.available !== true || row.status !== 'PUBLIC' || row.type !== 'PRTS') continue
        await pause()
        const detail = unwrap(await request(`${API}/copilot/get/${row.id}`))
        if (detail.available === false || (detail.status && detail.status !== 'PUBLIC')) continue
        const content = JSON.parse(detail.content)
        const homework = homeworkRow(row.id, content, hashContent(row.content))
        if (homework) { byId.set(row.id, homework); changed++ }
      }
      if (boundary || !data.has_next) break
      if (!data.data.length) throw new Error('PRTS pagination did not advance')
      previousPageLastId = previous
      await pause()
    }
    // Revisit a bounded slice of old details to pick up edits and removed/private jobs without a full crawl.
    const old = snapshot.homeworks.map((row) => row.id).sort((a, b) => a - b)
    const offset = Math.min(snapshot.reconcilePage - 1, Math.max(0, old.length - 1))
    const ids = old.slice(offset, offset + reconcile)
    for (const id of ids) {
      await pause()
      let payload
      try { payload = await request(`${API}/copilot/get/${id}`) }
      catch (error) { if (error.status === 404) { byId.delete(id); changed++; continue } throw error }
      if (payload?.status_code === 404) { byId.delete(id); changed++; continue }
      const detail = unwrap(payload)
      if (detail.available === false || (detail.status && detail.status !== 'PUBLIC')) { byId.delete(id); changed++; continue }
      const content = JSON.parse(detail.content)
      const homework = homeworkRow(id, content, hashContent(detail.content))
      if (!homework) byId.delete(id)
      else if (JSON.stringify(homework.content) !== JSON.stringify(byId.get(id)?.content)) { byId.set(id, homework); changed++ }
    }
    let assets = {}
    if (options['refresh-assets'] === 'true') {
      const costs = options.costs ? await readJson(options.costs) : null
      if (!costs?.game_sha) throw new Error('--refresh-assets true requires --costs from a refreshed qqbot cost bundle')
      assets = { ...await loadPlanningAssets(costs.game_sha, options.signal), costs }
    }
    options.signal?.throwIfAborted()
    await writeSnapshot(output, { ...snapshot, ...assets, homeworks: [...byId.values()], cursor, reconcilePage: offset + ids.length >= old.length ? 1 : offset + ids.length + 1, updatedAt: new Date().toISOString() })
    return { changed, cursor, reconciled: ids.length }
  })
}
