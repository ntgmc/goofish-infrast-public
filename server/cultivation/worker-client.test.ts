import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultCultivationQuery } from '../../src/lib/cultivation-contract'
import { CultivationReadError, readCultivationPlan, refreshCultivationSnapshot, shutdownCultivationWorker } from './worker-client'

const mocks = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('node:worker_threads', () => ({ Worker: class { constructor(...args: unknown[]) { return mocks.create(...args) } } }))
const input = { game: {}, inventory: {}, importedAt: '2026-10-17T00:00:00Z', snapshotVersion: '1', warnings: [], query: defaultCultivationQuery }
const payload = new TextEncoder().encode('{"candidates":[]}').buffer
let worker: EventEmitter & { postMessage: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn>; ref: ReturnType<typeof vi.fn>; unref: ReturnType<typeof vi.fn> }

beforeEach(() => {
  vi.useFakeTimers()
  worker = Object.assign(new EventEmitter(), { postMessage: vi.fn(), terminate: vi.fn(async () => 0), ref: vi.fn(), unref: vi.fn() })
  mocks.create.mockReset().mockReturnValue(worker)
})
afterEach(async () => { await shutdownCultivationWorker(); vi.useRealTimers() })

describe('isolated cultivation reader lifecycle', () => {
  it('bounds reads and keeps public caches across idle periods and calendar days', async () => {
    const first = readCultivationPlan(input)
    expect(mocks.create).toHaveBeenCalledWith(expect.any(URL), { execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 512 } })
    await expect(readCultivationPlan(input)).rejects.toMatchObject({ code: 'cultivation_busy', status: 503 })
    worker.emit('message', { ok: true, result: payload })
    await expect(first).resolves.toBe(payload)
    await vi.advanceTimersByTimeAsync(2 * 86400000)
    expect(worker.terminate).not.toHaveBeenCalled()
    const second = readCultivationPlan(input)
    worker.emit('message', { ok: true, result: payload })
    await second
    expect(mocks.create).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    await shutdownCultivationWorker()
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('terminates a timed-out computation and allows a fresh reader on retry', async () => {
    const pending = readCultivationPlan(input)
    const failure = expect(pending).rejects.toMatchObject({ code: 'cultivation_timeout', status: 504 })
    await vi.advanceTimersByTimeAsync(90_000)
    await failure
    expect(worker.terminate).toHaveBeenCalledOnce()
    const retry = readCultivationPlan(input)
    worker.emit('message', { ok: true, result: payload })
    await retry
    expect(mocks.create).toHaveBeenCalledTimes(2)
  })

  it.each(['error', 'exit'])('contains worker %s failures and releases the pending request', async (event) => {
    const pending = readCultivationPlan(input)
    const failure = expect(pending).rejects.toBeInstanceOf(CultivationReadError)
    worker.emit(event, event === 'error' ? new Error('heap limit') : 1)
    await failure
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels an abandoned request and removes its abort listener', async () => {
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const pending = readCultivationPlan(input, controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'request_aborted' })
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not start another large snapshot while a previous thread is still terminating', async () => {
    let stopped!: (code: number) => void
    worker.terminate.mockImplementationOnce(() => new Promise<number>((resolve) => { stopped = resolve }))
    const controller = new AbortController()
    const pending = readCultivationPlan(input, controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'request_aborted' })
    await expect(readCultivationPlan(input)).rejects.toMatchObject({ code: 'cultivation_busy' })
    expect(mocks.create).toHaveBeenCalledOnce()
    stopped(0)
    await Promise.resolve()
    await Promise.resolve()
  })

  it('does not start a thread for an already cancelled request or keep a failed thread startup', async () => {
    await expect(readCultivationPlan(input, AbortSignal.abort())).rejects.toBeDefined()
    expect(mocks.create).not.toHaveBeenCalled()
    mocks.create.mockImplementationOnce(() => { throw new Error('cannot start') })
    await expect(readCultivationPlan(input)).rejects.toMatchObject({ code: 'cultivation_unavailable' })
    const retry = readCultivationPlan(input)
    worker.emit('message', { ok: true, result: payload })
    await retry
  })

  it('allows cached reads during a refresh and invalidates the reader only after success', async () => {
    const updateWorker = Object.assign(new EventEmitter(), { postMessage: vi.fn(), terminate: vi.fn(async () => 0), ref: vi.fn(), unref: vi.fn() })
    const first = readCultivationPlan(input)
    worker.emit('message', { ok: true, result: payload })
    await first
    mocks.create.mockReturnValueOnce(updateWorker)
    const refresh = refreshCultivationSnapshot(new AbortController().signal)
    const read = readCultivationPlan(input)
    worker.emit('message', { ok: true, result: payload })
    await expect(read).resolves.toBe(payload)
    expect(worker.postMessage).not.toHaveBeenCalledWith({ type: 'invalidate' })
    updateWorker.emit('message', { ok: true, result: null })
    await refresh
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'invalidate' })
    expect(updateWorker.terminate).toHaveBeenCalledOnce()
    expect(worker.terminate).not.toHaveBeenCalled()
  })

  it('preserves the reader and its cache when a background refresh fails', async () => {
    const updateWorker = Object.assign(new EventEmitter(), { postMessage: vi.fn(), terminate: vi.fn(async () => 0), ref: vi.fn(), unref: vi.fn() })
    const first = readCultivationPlan(input)
    worker.emit('message', { ok: true, result: payload })
    await first
    mocks.create.mockReturnValueOnce(updateWorker)
    const refresh = refreshCultivationSnapshot(new AbortController().signal)
    updateWorker.emit('error', new Error('upstream unavailable'))
    await expect(refresh).rejects.toBeInstanceOf(CultivationReadError)
    expect(worker.postMessage).not.toHaveBeenCalledWith({ type: 'invalidate' })
    expect(worker.terminate).not.toHaveBeenCalled()
    const retry = readCultivationPlan(input)
    worker.emit('message', { ok: true, result: payload })
    await expect(retry).resolves.toBe(payload)
    expect(mocks.create).toHaveBeenCalledTimes(2)
  })

  it('lets a cancelled refresh finish atomic file cleanup before terminating the thread', async () => {
    const controller = new AbortController()
    const refresh = refreshCultivationSnapshot(controller.signal)
    await expect(refreshCultivationSnapshot(controller.signal)).rejects.toMatchObject({ code: 'cultivation_busy' })
    controller.abort()
    const shutdown = shutdownCultivationWorker()
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'cancel' })
    expect(worker.terminate).not.toHaveBeenCalled()
    worker.emit('message', { ok: false, code: 'cultivation_failed', status: 502, message: 'cancelled' })
    await expect(refresh).rejects.toMatchObject({ code: 'cultivation_failed' })
    await shutdown
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})
