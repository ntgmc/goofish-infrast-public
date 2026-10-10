import { parentPort } from 'node:worker_threads'
import { syncPrtsPlanning } from '../../scripts/prts-planning-sync.mjs'
import { getYituliuPricing } from '../handlers/material-value'
import { SklandClient, SklandClientError } from '../handlers/skland-client'
import { readPrtsSnapshot, releasePrtsSnapshot } from './catalog'
import { buildCultivationData } from './data'
import { getCultivationStatistics } from './references'
import { getSpecialItemCatalog } from './special-items'
import { CultivationReadError, type CultivationTask, type CultivationWorkerReply } from './worker-client'

let controller: AbortController | null = null

parentPort!.on('message', (task: CultivationTask | { type: 'cancel' }) => {
  if (task.type === 'cancel') { controller?.abort(); return }
  controller = new AbortController()
  const signal = controller.signal
  void execute(task, signal).then(
    (result) => parentPort!.postMessage({ ok: true, result } satisfies CultivationWorkerReply, result ? [result] : []),
    (error: unknown) => {
      const reply: CultivationWorkerReply = error instanceof CultivationReadError
        ? { ok: false, status: error.status, code: error.code, message: error.message }
        : error instanceof SklandClientError
          ? { ok: false, status: 502, code: error.code, message: error.message }
          : { ok: false, status: 502, code: 'cultivation_failed', message: '读取养成数据失败，请稍后重试。' }
      parentPort!.postMessage(reply)
    },
  ).finally(() => { controller = null })
})

async function execute(task: CultivationTask, signal: AbortSignal): Promise<ArrayBuffer | null> {
  let snapshot
  try { snapshot = await readPrtsSnapshot() }
  catch { throw new CultivationReadError('作业数据暂不可用，请等待管理员导入后重试。', 503, 'prts_data_unavailable') }
  signal.throwIfAborted()
  if (task.type === 'refresh') {
    if (Date.now() - Date.parse(snapshot.updatedAt) < 24 * 3600000) return null
    snapshot = undefined
    releasePrtsSnapshot()
    await syncPrtsPlanning({ signal })
    return null
  }
  const client = new SklandClient(task.credential)
  const [game, inventory, pricing, community, specialCatalog] = await Promise.all([
    client.getGamePlayerInfo(task.uid), client.getCultivatePlayer(task.uid), getYituliuPricing(), getCultivationStatistics(), getSpecialItemCatalog(snapshot.operators),
  ])
  signal.throwIfAborted()
  return new TextEncoder().encode(JSON.stringify(buildCultivationData(snapshot, game, inventory, pricing, community, specialCatalog, task.query))).buffer
}
