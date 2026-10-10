import { Worker } from 'node:worker_threads'
import type { CultivationQuery } from '../../src/lib/cultivation-contract'

export type CultivationTask = { type: 'plan'; credential: string; uid: string; query: CultivationQuery } | { type: 'refresh' }
export type CultivationWorkerReply = { ok: true; result: ArrayBuffer | null } | { ok: false; status: number; code: string; message: string }

export class CultivationReadError extends Error {
  constructor(message: string, readonly status = 503, readonly code = 'cultivation_unavailable') { super(message) }
}

let worker: Worker | null = null
let stopping: Promise<unknown> | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null
let active: { task: CultivationTask; promise: Promise<ArrayBuffer | null>; finish: (error: Error | null, result?: ArrayBuffer | null) => void } | null = null

function stopWorker() {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = null
  const current = worker
  worker = null
  if (current) stopping = current.terminate().catch(() => undefined).finally(() => { stopping = null })
  return stopping ?? Promise.resolve()
}

function getWorker() {
  if (worker) return worker
  const current = new Worker(new URL('./cultivation-worker.js', import.meta.url), {
    execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 512 },
  })
  worker = current
  current.on('message', (reply: CultivationWorkerReply) => {
    if (worker !== current) return
    if (reply.ok) active?.finish(null, reply.result)
    else active?.finish(new CultivationReadError(reply.message, reply.status, reply.code))
  })
  const failed = () => {
    if (worker !== current) return
    active?.finish(new CultivationReadError('养成数据读取暂不可用，请稍后重试。'))
    void stopWorker()
  }
  current.on('error', failed)
  current.on('exit', failed)
  return current
}

function execute(task: CultivationTask, signal?: AbortSignal): Promise<ArrayBuffer | null> {
  if (signal?.aborted) return Promise.reject(signal.reason)
  if (active || stopping) return Promise.reject(new CultivationReadError(
    active?.task.type === 'refresh' ? '养成数据正在更新，请稍后重试。' : '养成数据正在读取，请稍后重试。', 503, 'cultivation_busy',
  ))
  let current: Worker
  try { current = getWorker() }
  catch { return Promise.reject(new CultivationReadError('养成数据读取暂不可用，请稍后重试。')) }
  let finish!: (error: Error | null, result?: ArrayBuffer | null) => void
  const promise = new Promise<ArrayBuffer | null>((resolve, reject) => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = null
    current.ref()
    const cancel = () => {
      if (task.type === 'refresh') current.postMessage({ type: 'cancel' })
      else {
        finish(new CultivationReadError('养成数据读取已取消。', 499, 'request_aborted'))
        void stopWorker()
      }
    }
    const timeout = task.type === 'plan' ? setTimeout(() => {
      finish(new CultivationReadError('养成数据读取超时，请稍后重试。', 504, 'cultivation_timeout'))
      void stopWorker()
    }, 90_000) : null
    finish = (error, result = null) => {
      if (active?.finish !== finish) return
      active = null
      if (timeout) clearTimeout(timeout)
      signal?.removeEventListener('abort', cancel)
      current.unref()
      idleTimer = setTimeout(() => { void stopWorker() }, 60_000)
      idleTimer.unref()
      if (error) reject(error)
      else resolve(result)
    }
    signal?.addEventListener('abort', cancel, { once: true })
  })
  active = { task, promise, finish }
  try { worker!.postMessage(task) }
  catch {
    finish(new CultivationReadError('养成数据读取暂不可用，请稍后重试。'))
    void stopWorker()
  }
  return promise
}

export async function readCultivationPlan(input: Omit<Extract<CultivationTask, { type: 'plan' }>, 'type'>, signal?: AbortSignal): Promise<ArrayBuffer> {
  return (await execute({ type: 'plan', ...input }, signal))!
}

export async function refreshCultivationSnapshot(signal: AbortSignal): Promise<void> {
  await execute({ type: 'refresh' }, signal)
}

export async function shutdownCultivationWorker(): Promise<void> {
  if (active?.task.type === 'refresh') {
    worker?.postMessage({ type: 'cancel' })
    await active.promise.catch(() => undefined)
  } else active?.finish(new CultivationReadError('服务正在重启，请稍后重试。'))
  await stopWorker()
}
