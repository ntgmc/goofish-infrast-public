import { createServer, type Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApiProcess, resolveApiPort, type ApiProcessHooks } from './api-process'
import {
  getServiceLifecycleState,
  setServiceLifecycleStateForTesting,
} from './lifecycle'

const servers: Server[] = []
const originalExitCode = process.exitCode

beforeEach(() => {
  setServiceLifecycleStateForTesting('starting')
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer))
  setServiceLifecycleStateForTesting('ready')
  process.exitCode = originalExitCode
  vi.restoreAllMocks()
})

describe('API process lifecycle', () => {
  it('fails fast in production when account deletion cannot hash depot identities', () => {
    const previousNodeEnv = process.env.NODE_ENV
    const previousPublicAppUrl = process.env.PUBLIC_APP_URL
    const previousDepotSecret = process.env.DEPOT_SAMPLE_HASH_SECRET
    const previousTrustedProxies = process.env.TRUSTED_PROXY_ADDRESSES
    process.env.NODE_ENV = 'production'
    process.env.PUBLIC_APP_URL = 'https://example.test'
    process.env.TRUSTED_PROXY_ADDRESSES = '127.0.0.1,::1'
    delete process.env.DEPOT_SAMPLE_HASH_SECRET

    try {
      expect(() => createApiProcess(createHooks(), createDependencies().values))
        .toThrow('DEPOT_SAMPLE_HASH_SECRET is required in production')
    } finally {
      restoreEnvironment('NODE_ENV', previousNodeEnv)
      restoreEnvironment('PUBLIC_APP_URL', previousPublicAppUrl)
      restoreEnvironment('DEPOT_SAMPLE_HASH_SECRET', previousDepotSecret)
      restoreEnvironment('TRUSTED_PROXY_ADDRESSES', previousTrustedProxies)
    }
  })

  it('fails fast in production when Skland secrets are missing or unstable', () => {
    const names = [
      'NODE_ENV',
      'PUBLIC_APP_URL',
      'DEPOT_SAMPLE_HASH_SECRET',
      'SKLAND_CREDENTIAL_SECRET',
      'FREE_PREVIEW_UID_HASH_SECRET',
      'TRUSTED_PROXY_ADDRESSES',
    ] as const
    const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]))
    process.env.NODE_ENV = 'production'
    process.env.PUBLIC_APP_URL = 'https://example.test'
    process.env.DEPOT_SAMPLE_HASH_SECRET = 'stable-depot-hash-secret'
    process.env.FREE_PREVIEW_UID_HASH_SECRET = 'stable-free-preview-hmac-secret-at-least-32'
    process.env.TRUSTED_PROXY_ADDRESSES = '127.0.0.1,::1'
    delete process.env.SKLAND_CREDENTIAL_SECRET

    try {
      expect(() => createApiProcess(createHooks(), createDependencies().values))
        .toThrow('森空岛服务配置无效，请联系管理员。')

      process.env.SKLAND_CREDENTIAL_SECRET = 'stable-skland-credential-secret'
      process.env.FREE_PREVIEW_UID_HASH_SECRET = 'too-short'
      expect(() => createApiProcess(createHooks(), createDependencies().values))
        .toThrow('森空岛服务配置无效，请联系管理员。')
    } finally {
      for (const name of names) restoreEnvironment(name, previous[name])
    }
  })

  it('runs initialization before listening and drains shared resources in order', async () => {
    const hooks = createHooks()
    const dependencies = createDependencies()
    const controller = createApiProcess(hooks, dependencies.values)

    await controller.start()

    expect(getServiceLifecycleState()).toBe('ready')
    expect(controller.server.listening).toBe(true)
    expect(hooks.initialize).toHaveBeenCalledOnce()
    expect(dependencies.ensureDatabase).toHaveBeenCalledOnce()
    expect(dependencies.startAccountDeletion).toHaveBeenCalledOnce()
    expect(dependencies.ensureDatabase.mock.invocationCallOrder[0])
      .toBeLessThan(hooks.initialize.mock.invocationCallOrder[0]!)
    expect(hooks.initialize.mock.invocationCallOrder[0])
      .toBeLessThan(dependencies.startAccountDeletion.mock.invocationCallOrder[0]!)

    await controller.startShutdown('SIGTERM')

    expect(hooks.drain).toHaveBeenCalledOnce()
    expect(hooks.forceDrain).not.toHaveBeenCalled()
    expect(dependencies.stopAccountDeletion).toHaveBeenCalledOnce()
    expect(dependencies.waitForAccountDeletion).toHaveBeenCalledOnce()
    expect(dependencies.closeDatabase).toHaveBeenCalledOnce()
    expect(getServiceLifecycleState()).toBe('stopped')
  })

  it('uses forceDrain when a second signal arrives during graceful shutdown', async () => {
    let finishDrain: (() => void) | null = null
    const hooks = createHooks()
    hooks.drain.mockImplementation(() => new Promise<void>((resolveDrain) => {
      finishDrain = resolveDrain
    }))
    const dependencies = createDependencies()
    const controller = createApiProcess(hooks, dependencies.values)
    await controller.start()

    const gracefulShutdown = controller.startShutdown('SIGTERM')
    await vi.waitFor(() => expect(hooks.drain).toHaveBeenCalledOnce())
    const forcedShutdown = controller.startShutdown('SIGINT')

    expect(forcedShutdown).toBe(gracefulShutdown)
    expect(hooks.forceDrain).toHaveBeenCalledOnce()
    expect(process.exitCode).toBe(1)

    finishDrain?.()
    await gracefulShutdown
  })

  it('force-drains hooks and closes shared resources after startup failure', async () => {
    const startupError = new Error('startup failed')
    const hooks = createHooks()
    hooks.initialize.mockRejectedValue(startupError)
    const dependencies = createDependencies()
    const controller = createApiProcess(hooks, dependencies.values)

    await expect(controller.start()).rejects.toBe(startupError)
    await controller.handleStartupFailure(startupError)

    expect(hooks.forceDrain).toHaveBeenCalledOnce()
    expect(dependencies.closeDatabase).toHaveBeenCalledOnce()
    expect(getServiceLifecycleState()).toBe('stopped')
    expect(process.exitCode).toBe(1)
  })

  it('does not initialize hooks or listen when schema validation fails', async () => {
    const schemaError = new Error('schema incompatible')
    const hooks = createHooks()
    const dependencies = createDependencies()
    dependencies.ensureDatabase.mockRejectedValue(schemaError)
    const controller = createApiProcess(hooks, dependencies.values)

    await expect(controller.start()).rejects.toBe(schemaError)

    expect(hooks.initialize).not.toHaveBeenCalled()
    expect(dependencies.startAccountDeletion).not.toHaveBeenCalled()
    expect(controller.server.listening).toBe(false)
  })

  it.each(['0', '-1', '65536', '1.5', 'NaN', 'Infinity'])(
    'rejects an invalid API port: %s',
    (port) => expect(() => resolveApiPort({ PORT: port }))
      .toThrow('PORT must be an integer between 1 and 65535'),
  )

  it('accepts API port boundary values', () => {
    expect(resolveApiPort({ PORT: '1' })).toBe(1)
    expect(resolveApiPort({ PORT: '65535' })).toBe(65_535)
    expect(resolveApiPort({})).toBe(3_000)
  })
})

function createHooks() {
  return {
    initialize: vi.fn<ApiProcessHooks['initialize']>(async () => undefined),
    drain: vi.fn<ApiProcessHooks['drain']>(async () => undefined),
    forceDrain: vi.fn<ApiProcessHooks['forceDrain']>(() => undefined),
  }
}

function createDependencies() {
  const server = createServer((_request, response) => response.end())
  servers.push(server)
  const stopAccountDeletion = vi.fn()
  const waitForAccountDeletion = vi.fn(async () => undefined)
  const startAccountDeletion = vi.fn(() => ({
    stop: stopAccountDeletion,
    waitForIdle: waitForAccountDeletion,
  }))
  const closeDatabase = vi.fn(async () => undefined)
  const ensureDatabase = vi.fn(async () => undefined)
  return {
    values: {
      createServer: () => server,
      startAccountDeletion,
      closeDatabase,
      ensureDatabase,
      host: '127.0.0.1',
      port: 0,
    },
    startAccountDeletion,
    stopAccountDeletion,
    waitForAccountDeletion,
    closeDatabase,
    ensureDatabase,
  }
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve()
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose())
  })
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
