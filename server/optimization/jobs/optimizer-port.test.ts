import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getRegisteredOptimizerPort,
  OPTIMIZER_PORT_VERSION,
  OptimizerPortConfigurationError,
  OptimizerPortNotRegisteredError,
  registerOptimizerPort,
  requireRegisteredOptimizerPort,
  type OptimizerPort,
} from './optimizer-port'

let unregister: (() => void) | null = null

afterEach(() => {
  unregister?.()
  unregister = null
})

describe('OptimizerPort registry', () => {
  it('registers, reads, and idempotently unregisters a compatible implementation', () => {
    const port = fakePort()
    unregister = registerOptimizerPort(port)

    expect(getRegisteredOptimizerPort()).toBe(port)
    expect(requireRegisteredOptimizerPort()).toBe(port)

    unregister()
    unregister()
    unregister = null
    expect(getRegisteredOptimizerPort()).toBeNull()
  })

  it('rejects missing, incompatible, incomplete, and duplicate implementations', () => {
    expect(() => requireRegisteredOptimizerPort()).toThrow(OptimizerPortNotRegisteredError)
    expect(() => registerOptimizerPort({ version: 2 } as never)).toThrow(OptimizerPortConfigurationError)
    expect(() => registerOptimizerPort({ version: OPTIMIZER_PORT_VERSION } as never))
      .toThrow('OptimizerPort.executeSchedule must be a function.')

    const port = fakePort()
    unregister = registerOptimizerPort(port)
    expect(() => registerOptimizerPort(fakePort())).toThrow('already registered')
  })

  it('does not let an old disposer clear a later registration', () => {
    const firstDisposer = registerOptimizerPort(fakePort())
    firstDisposer()
    const second = fakePort()
    unregister = registerOptimizerPort(second)

    firstDisposer()

    expect(getRegisteredOptimizerPort()).toBe(second)
  })
})

function fakePort(): OptimizerPort {
  return {
    version: OPTIMIZER_PORT_VERSION,
    executeSchedule: vi.fn(async () => ({} as never)),
    executeScenarioComparison: vi.fn(async () => ({} as never)),
  }
}
