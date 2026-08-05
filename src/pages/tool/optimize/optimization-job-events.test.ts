// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('optimization job events browser compatibility', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('loads when crypto.randomUUID is unavailable', async () => {
    vi.stubGlobal('crypto', {})

    await expect(import('./optimization-job-events')).resolves.toMatchObject({
      withOptimizationSubmissionLock: expect.any(Function),
    })
  })
})
