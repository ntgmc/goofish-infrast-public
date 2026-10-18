import { Worker } from 'node:worker_threads'
import type { CultivationQuery } from '../../src/lib/cultivation-contract'
import type { CultivationProject } from '../../src/lib/cultivation-projects'

export type CultivationTask = { type: 'plan'; game: unknown; inventory: unknown; importedAt: string; snapshotVersion: string;
  warnings: string[]; query: CultivationQuery; projects?: CultivationProject[] } | { type: 'refresh' }
export type CultivationWorkerReply = { ok: true; result: ArrayBuffer | null } | { ok: false; status: number; code: string; message: string }

export class CultivationReadError extends Error {
  constructor(message: string, readonly status = 503, readonly code = 'cultivation_unavailable') { super(message) }
}

type WorkerState = { worker: Worker | null; stopping: Promise<unknown> | null;
  active: { promise: Promise<ArrayBuffer | null>; finish: (error: Error | null, result?: ArrayBuffer | null) => void } | null }
const reader: WorkerState = { worker: null, stopping: null, active: null }
const updater: WorkerState = { worker: null, stopping: null, active: null }

function stopWorker(state: WorkerState) {
  const current = state.worker
  state.worker = null
  if (current) state.stopping = current.terminate().catch(() => undefined).finally(() => { state.stopping = null })
  return state.stopping ?? Promise.resolve()
}

function getWorker(state: WorkerState) {
  if (state.worker) return state.worker
  const current = new Worker(new URL('./cultivation-worker.js', import.meta.url), {
    execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 512 },
  })
  state.worker = current
  current.on('message', (reply: CultivationWorkerReply) => {
    if (state.worker !== current) return
    if (reply.ok) state.active?.finish(null, reply.result)
    else state.active?.finish(new CultivationReadError(reply.message, reply.status, reply.code))
  })
  const failed = () => {
    if (state.worker !== current) return
    state.active?.finish(new CultivationReadError('养成数据读取暂不可用，请稍后重试。'))
    void stopWorker(state)
  }
  current.on('error', failed)
  current.on('exit', failed)
  return current
}

function execute(state: WorkerState, task: CultivationTask, signal?: AbortSignal): Promise<ArrayBuffer | null> {
  if (signal?.aborted) return Promise.reject(signal.reason)
  if (state.active || state.stopping) return Promise.reject(new CultivationReadError(
    task.type === 'refresh' ? '养成数据正在更新，请稍后重试。' : '养成数据正在读取，请稍后重试。', 503, 'cultivation_busy',
  ))
  let current: Worker
  try { current = getWorker(state) }
  catch { return Promise.reject(new CultivationReadError('养成数据读取暂不可用，请稍后重试。')) }
  let finish!: (error: Error | null, result?: ArrayBuffer | null) => void
  const promise = new Promise<ArrayBuffer | null>((resolve, reject) => {
    current.ref()
    const cancel = () => {
      if (task.type === 'refresh') current.postMessage({ type: 'cancel' })
      else {
        finish(new CultivationReadError('养成数据读取已取消。', 499, 'request_aborted'))
        void stopWorker(state)
      }
    }
    const timeout = task.type === 'plan' ? setTimeout(() => {
      finish(new CultivationReadError('养成数据读取超时，请稍后重试。', 504, 'cultivation_timeout'))
      void stopWorker(state)
    }, 90_000) : null
    finish = (error, result = null) => {
      if (state.active?.finish !== finish) return
      state.active = null
      if (timeout) clearTimeout(timeout)
      signal?.removeEventListener('abort', cancel)
      current.unref()
      if (task.type === 'refresh') void stopWorker(state)
      if (error) reject(error)
      else resolve(result)
    }
    signal?.addEventListener('abort', cancel, { once: true })
  })
  state.active = { promise, finish }
  try { current.postMessage(task) }
  catch {
    finish(new CultivationReadError('养成数据读取暂不可用，请稍后重试。'))
    void stopWorker(state)
  }
  return promise
}

export async function readCultivationPlan(input: Omit<Extract<CultivationTask, { type: 'plan' }>, 'type'>, signal?: AbortSignal): Promise<ArrayBuffer> {
  return (await execute(reader, { type: 'plan', ...input }, signal))!
}

export async function refreshCultivationSnapshot(signal: AbortSignal): Promise<void> {
  await execute(updater, { type: 'refresh' }, signal)
  reader.worker?.postMessage({ type: 'invalidate' })
}

export async function shutdownCultivationWorker(): Promise<void> {
  if (updater.active) {
    updater.worker?.postMessage({ type: 'cancel' })
    await updater.active.promise.catch(() => undefined)
  }
  reader.active?.finish(new CultivationReadError('服务正在重启，请稍后重试。'))
  await Promise.all([stopWorker(reader), stopWorker(updater)])
}
