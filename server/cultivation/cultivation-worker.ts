import { parentPort } from 'node:worker_threads'
import { syncPrtsPlanning } from '../../scripts/prts-planning-sync.mjs'
import { getYituliuPricing } from '../handlers/material-value'
import { invalidatePrtsSnapshot, readPrtsSnapshot, releasePrtsSnapshot } from './catalog'
import { cultivationDayStart } from './cache-policy'
import { buildCultivationData } from './data'
import { buildCultivationProjects } from './projects'
import { readProjectCatalog } from './project-catalog'
import { getCultivationStatistics } from './references'
import { getSpecialItemCatalog } from './special-items'
import { CultivationReadError, type CultivationTask, type CultivationWorkerReply } from './worker-client'

let controller: AbortController | null = null

parentPort!.on('message', (task: CultivationTask | { type: 'cancel' | 'invalidate' }) => {
  if (task.type === 'cancel') { controller?.abort(); return }
  if (task.type === 'invalidate') { invalidatePrtsSnapshot(); return }
  controller = new AbortController()
  const signal = controller.signal
  void execute(task, signal).then(
    (result) => parentPort!.postMessage({ ok: true, result } satisfies CultivationWorkerReply, result ? [result] : []),
    (error: unknown) => {
      const reply: CultivationWorkerReply = error instanceof CultivationReadError
        ? { ok: false, status: error.status, code: error.code, message: error.message }
        : { ok: false, status: 502, code: 'cultivation_failed', message: '读取养成数据失败，请稍后重试。' }
      parentPort!.postMessage(reply)
    },
  ).finally(() => { controller = null })
})

async function execute(task: CultivationTask, signal: AbortSignal): Promise<ArrayBuffer | null> {
  if (task.type === 'plan' && task.projects !== undefined) {
    let snapshot
    try { snapshot = await readProjectCatalog(signal) }
    catch {
      signal.throwIfAborted()
      throw new CultivationReadError('养成资料暂不可用，请稍后重试。', 503, 'cultivation_data_unavailable')
    }
    const pricing = await getYituliuPricing()
    signal.throwIfAborted()
    const data = buildCultivationProjects(snapshot, task.game, task.inventory, pricing, task.projects)
    return encodePlan(data, task)
  }
  let snapshot
  try { snapshot = await readPrtsSnapshot() }
  catch { throw new CultivationReadError('作业数据暂不可用，请等待管理员导入后重试。', 503, 'prts_data_unavailable') }
  signal.throwIfAborted()
  if (task.type === 'refresh') {
    if (Date.parse(snapshot.updatedAt) >= cultivationDayStart()) return null
    snapshot = undefined
    releasePrtsSnapshot()
    await syncPrtsPlanning({ signal })
    return null
  }
  const [pricing, community, specialCatalog] = await Promise.all([
    getYituliuPricing(), getCultivationStatistics(), getSpecialItemCatalog(snapshot.operators),
  ])
  signal.throwIfAborted()
  return encodePlan(buildCultivationData(snapshot, task.game, task.inventory, pricing, community, specialCatalog, task.query), task)
}

function encodePlan(data: import('../../src/lib/cultivation-contract').CultivationData, task: Extract<CultivationTask, { type: 'plan' }>): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify({ ...data, importedAt: task.importedAt, snapshotVersion: task.snapshotVersion,
    warnings: [...data.warnings, ...task.warnings] })).buffer
}
