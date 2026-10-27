import { getYituliuPricing } from '../handlers/material-value'
import { describeServerError } from '../security/error-reporting'
import { defaultCultivationQuery } from '../../src/lib/cultivation-contract'
import { buildPublicEvidence, readStoredRecommendations } from './public-store'
import { asRecord, asRows } from './catalog'
import { buildCultivationData } from './data'
import { buildCultivationProjects } from './projects'
import { buildTrainingAccountData } from './training-ratio'
import { readProjectCatalog } from './project-catalog'
import { getCultivationStatistics } from './references'
import { getSpecialItemCatalog } from './special-items'
import { CultivationReadError, type CultivationTask, type CultivationWorkerReply } from './worker-client'

let controller: AbortController | null = null

function reply(message: CultivationWorkerReply) {
  if (process.connected) process.send!(message)
}

process.once('disconnect', () => { controller?.abort() })
// Let an interrupted incremental update release its snapshot lock before exiting.
const stop = () => {
  controller?.abort()
  if (process.connected) process.disconnect()
}
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
process.on('message', (task: CultivationTask | { type: 'cancel' }) => {
  if (task.type === 'cancel') { controller?.abort(); return }
  controller = new AbortController()
  const signal = controller.signal
  void execute(task, signal).then(
    (result) => reply({ ok: true, result }),
    (error: unknown) => {
      if (!signal.aborted && !(error instanceof CultivationReadError)) {
        console.error('cultivation task failed:', { task: task.type, ...describeServerError(error) })
      }
      const failure: CultivationWorkerReply = error instanceof CultivationReadError
        ? { ok: false, status: error.status, code: error.code, message: error.message }
        : { ok: false, status: 502, code: 'cultivation_failed', message: '读取养成数据失败，请稍后重试。' }
      reply(failure)
    },
  ).finally(() => { controller = null })
})

async function execute(task: CultivationTask, signal: AbortSignal): Promise<ArrayBuffer | null> {
  if (task.type === 'prepare' || task.type === 'refresh') {
    try { await buildPublicEvidence(task.type === 'prepare' ? task.query : defaultCultivationQuery, signal, task.type === 'refresh') }
    catch (error) {
      signal.throwIfAborted()
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
        throw new CultivationReadError('作业数据暂不可用，请等待管理员导入后重试。', 503, 'prts_data_unavailable')
      if (error instanceof Error && /database is locked/.test(error.message))
        throw new CultivationReadError('养成数据正在更新，请稍后重试。', 503, 'cultivation_busy')
      throw error
    }
    return null
  }
  if (task.type === 'plan' && (task.projects !== undefined || task.training)) {
    let snapshot
    try {
      const ownedIds = asRows(asRecord(asRecord(task.game).data ?? task.game).chars).map((row) => String(row.charId ?? row.id ?? ''))
      snapshot = await readProjectCatalog(signal, ownedIds)
    }
    catch {
      signal.throwIfAborted()
      throw new CultivationReadError('养成资料暂不可用，请稍后重试。', 503, 'cultivation_data_unavailable')
    }
    if (task.training) {
      const community = await getCultivationStatistics()
      signal.throwIfAborted()
      return encodePlan(buildTrainingAccountData(snapshot, task.game, task.inventory, community), task)
    }
    const pricing = await getYituliuPricing()
    signal.throwIfAborted()
    const data = buildCultivationProjects(snapshot, task.game, task.inventory, pricing, task.projects!)
    return encodePlan(data, task)
  }
  let saved: ReturnType<typeof readStoredRecommendations>
  try { saved = readStoredRecommendations(task.query) }
  catch { throw new CultivationReadError('作业数据暂不可用，请稍后重试。', 503, 'public_evidence_invalid') }
  const { snapshot, recommendation } = saved
  signal.throwIfAborted()
  const [pricing, community, specialCatalog] = await Promise.all([
    getYituliuPricing(), getCultivationStatistics(), getSpecialItemCatalog(snapshot.operators),
  ])
  signal.throwIfAborted()
  return encodePlan(buildCultivationData(snapshot, task.game, task.inventory, pricing, community, specialCatalog, task.query, recommendation, task.thanksRecruitmentEnabled !== false), task)
}

function encodePlan(data: { warnings: string[] }, task: Extract<CultivationTask, { type: 'plan' }>): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify({ ...data, importedAt: task.importedAt, snapshotVersion: task.snapshotVersion,
    warnings: [...data.warnings, ...task.warnings] })).buffer
}
