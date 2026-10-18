import { fork, type ChildProcess } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { defaultCultivationQuery } from '../../src/lib/cultivation-contract'
import { prtsSnapshotPath } from './catalog'
import type { CultivationQuery } from '../../src/lib/cultivation-contract'
import type { CultivationProject } from '../../src/lib/cultivation-projects'
import { hasStoredRecommendation } from './public-store'

export type CultivationTask = { type: 'plan'; game: unknown; inventory: unknown; importedAt: string; snapshotVersion: string;
  warnings: string[]; query: CultivationQuery; projects?: CultivationProject[] } | { type: 'refresh' } | { type: 'prepare'; query: CultivationQuery }
export type CultivationWorkerReply = { ok: true; result: ArrayBuffer | null } | { ok: false; status: number; code: string; message: string }

export class CultivationReadError extends Error {
  constructor(message: string, readonly status = 503, readonly code = 'cultivation_unavailable') { super(message) }
}

type WorkerState = { worker: ChildProcess | null; stopping: Promise<unknown> | null; idle: ReturnType<typeof setTimeout> | null;
  active: { promise: Promise<ArrayBuffer | null>; finish: (error: Error | null, result?: ArrayBuffer | null) => void } | null }
const reader: WorkerState = { worker: null, stopping: null, active: null, idle: null }
const updater: WorkerState = { worker: null, stopping: null, active: null, idle: null }
let reading = false
let generation = 0

function stopWorker(state: WorkerState) {
  if (state.idle) clearTimeout(state.idle)
  state.idle = null
  const current = state.worker
  state.worker = null
  if (current) {
    current.ref()
    const stopped = new Promise<void>((resolve) => {
      if (!current.pid || current.exitCode != null || current.signalCode != null) { resolve(); return }
      current.once('exit', () => resolve())
      current.kill()
    })
    state.stopping = stopped.catch(() => undefined).finally(() => { state.stopping = null })
  }
  return state.stopping ?? Promise.resolve()
}

function getWorker(state: WorkerState) {
  if (state.worker) return state.worker
  const entry = new URL('./cultivation-worker.js', import.meta.url)
  const current = fork(entry, [], { execArgv: ['--max-old-space-size=512'],
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'], serialization: 'advanced' })
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
    state === updater ? '养成数据正在更新，请稍后重试。' : '养成数据正在读取，请稍后重试。', 503, 'cultivation_busy',
  ))
  let current: ChildProcess
  try { current = getWorker(state) }
  catch { return Promise.reject(new CultivationReadError('养成数据读取暂不可用，请稍后重试。')) }
  let finish!: (error: Error | null, result?: ArrayBuffer | null) => void
  const promise = new Promise<ArrayBuffer | null>((resolve, reject) => {
    if (state.idle) clearTimeout(state.idle)
    state.idle = null
    current.ref()
    current.channel?.ref()
    const cancel = () => {
      if (state === updater) current.send({ type: 'cancel' })
      else {
        finish(new CultivationReadError('养成数据读取已取消。', 499, 'request_aborted'))
        void stopWorker(state)
      }
    }
    let timedOut = false
    const timeout = task.type !== 'refresh' ? setTimeout(() => {
      timedOut = true
      if (state === updater) current.send({ type: 'cancel' })
      else {
        finish(new CultivationReadError('养成数据读取超时，请稍后重试。', 504, 'cultivation_timeout'))
        void stopWorker(state)
      }
    }, 90_000) : null
    finish = (error, result = null) => {
      if (state.active?.finish !== finish) return
      state.active = null
      if (timeout) clearTimeout(timeout)
      signal?.removeEventListener('abort', cancel)
      if (state !== updater) { current.unref(); current.channel?.unref() }
      if (state === updater) void stopWorker(state)
      else {
        state.idle = setTimeout(() => { void stopWorker(state) }, 60_000)
        state.idle.unref()
      }
      if (timedOut) reject(new CultivationReadError('养成数据读取超时，请稍后重试。', 504, 'cultivation_timeout'))
      else if (signal?.aborted) reject(new CultivationReadError('养成数据读取已取消。', 499, 'request_aborted'))
      else if (error) reject(error)
      else resolve(result)
    }
    signal?.addEventListener('abort', cancel, { once: true })
  })
  state.active = { promise, finish }
  try { current.send(task) }
  catch {
    finish(new CultivationReadError('养成数据读取暂不可用，请稍后重试。'))
    void stopWorker(state)
  }
  return promise
}

async function executeBuild(task: Extract<CultivationTask, { type: 'prepare' | 'refresh' }>, signal?: AbortSignal) {
  if (updater.stopping) await updater.stopping
  try { await execute(updater, task, signal) }
  finally { if (updater.stopping) await updater.stopping }
}

export async function readCultivationPlan(input: Omit<Extract<CultivationTask, { type: 'plan' }>, 'type'>, signal?: AbortSignal): Promise<ArrayBuffer> {
  if (reading) throw new CultivationReadError('养成数据正在读取，请稍后重试。', 503, 'cultivation_busy')
  reading = true
  const started = generation
  try {
    if (input.projects !== undefined && !hasStoredRecommendation(defaultCultivationQuery, true)) {
      const sourceExists = await stat(prtsSnapshotPath()).then(() => true, () => false)
      if (sourceExists) {
        try { await executeBuild({ type: 'prepare', query: defaultCultivationQuery }, signal) }
        catch (error) { if (signal?.aborted) throw error }
      }
    }
    if (input.projects === undefined && !hasStoredRecommendation(input.query)) {
      try { await executeBuild({ type: 'prepare', query: input.query }, signal) }
      catch (error) {
        if (signal?.aborted || !hasStoredRecommendation(input.query, true)) throw error
      }
    }
    if (started !== generation) throw new CultivationReadError('服务正在重启，请稍后重试。')
    try { return (await execute(reader, { type: 'plan', ...input }, signal))! }
    catch (error) {
      if (!(error instanceof CultivationReadError) || error.code !== 'public_evidence_invalid') throw error
      await executeBuild({ type: 'prepare', query: input.query }, signal)
      if (started !== generation) throw new CultivationReadError('服务正在重启，请稍后重试。')
      return (await execute(reader, { type: 'plan', ...input }, signal))!
    }
  } finally { reading = false }
}

export async function refreshCultivationSnapshot(signal: AbortSignal): Promise<void> {
  await executeBuild({ type: 'refresh' }, signal)
}

export async function shutdownCultivationWorker(): Promise<void> {
  generation++
  if (updater.active) {
    updater.worker?.send({ type: 'cancel' })
    await updater.active.promise.catch(() => undefined)
  }
  reader.active?.finish(new CultivationReadError('服务正在重启，请稍后重试。'))
  await Promise.all([stopWorker(reader), stopWorker(updater)])
}
