import { describe, expect, it, vi } from 'vitest'
import { initializeWorkerLifecycleStages } from './worker-lifecycle-stages'

describe('worker lifecycle stages', () => {
  it('initializes independent responsibilities concurrently', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const first = vi.fn(async () => gate)
    const second = vi.fn(async () => gate)

    const initialization = initializeWorkerLifecycleStages([
      { initialize: first },
      { initialize: second },
    ])

    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()

    release()
    await expect(initialization).resolves.toBeUndefined()
  })
})
