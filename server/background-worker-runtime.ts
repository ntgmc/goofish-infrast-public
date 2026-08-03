import { describeServerError, type SafeServerErrorDetails } from './security/error-reporting'

export type BackgroundWorkerHealth = {
  name: string
  initialized: boolean
  healthy: boolean
  running: boolean
  started_at: string | null
  last_started_at: string | null
  last_success_at: string | null
  last_error_at: string | null
  last_error: SafeServerErrorDetails | null
  next_run_at: string | null
  consecutive_failures: number
  skipped_overlaps: number
}

export type BackgroundWorkerController = {
  initialize: () => Promise<void>
  stop: () => void
  waitForIdle: () => Promise<void>
  getHealth: () => BackgroundWorkerHealth
}

type BackgroundWorkerOptions = {
  name: string
  intervalMs: number
  idleIntervalMs?: number
  run: () => Promise<number | boolean | void>
  maximumBackoffMs?: number
  jitterRatio?: number
  random?: () => number
  now?: () => number
  logError?: (message: string, error: SafeServerErrorDetails) => void
}

const registeredWorkers = new Map<string, BackgroundWorkerController>()

export function createBackgroundWorker(options: BackgroundWorkerOptions): BackgroundWorkerController {
  const now = options.now ?? Date.now
  const random = options.random ?? Math.random
  const longestBaseIntervalMs = Math.max(options.intervalMs, options.idleIntervalMs ?? options.intervalMs)
  const maximumBackoffMs = Math.max(
    longestBaseIntervalMs,
    options.maximumBackoffMs ?? longestBaseIntervalMs * 8,
  )
  const jitterRatio = Math.max(0, Math.min(0.5, options.jitterRatio ?? 0.1))
  const logError = options.logError ?? ((message, error) => console.warn(message, error))
  let initialized = false
  let stopped = true
  let timer: ReturnType<typeof setTimeout> | null = null
  let running: Promise<void> | null = null
  let initializing: Promise<void> | null = null
  let startedAt: string | null = null
  let lastStartedAt: string | null = null
  let lastSuccessAt: string | null = null
  let lastErrorAt: string | null = null
  let lastError: SafeServerErrorDetails | null = null
  let nextRunAt: string | null = null
  let consecutiveFailures = 0
  let skippedOverlaps = 0
  let lastRunHadActivity = true

  const runOnce = (): Promise<void> => {
    if (running) {
      skippedOverlaps += 1
      return running
    }
    lastStartedAt = new Date(now()).toISOString()
    running = options.run()
      .then((activity) => {
        lastRunHadActivity = typeof activity === 'number' ? activity > 0 : activity !== false
        lastSuccessAt = new Date(now()).toISOString()
        consecutiveFailures = 0
      })
      .catch((error) => {
        lastErrorAt = new Date(now()).toISOString()
        lastError = describeServerError(error)
        consecutiveFailures += 1
        throw error
      })
      .finally(() => {
        running = null
      })
    return running
  }

  const schedule = () => {
    if (stopped) return
    const baseIntervalMs = lastRunHadActivity
      ? options.intervalMs
      : Math.max(options.intervalMs, options.idleIntervalMs ?? options.intervalMs)
    const backoff = Math.min(maximumBackoffMs, baseIntervalMs * 2 ** consecutiveFailures)
    const jitter = Math.floor(backoff * jitterRatio * random())
    const delayMs = backoff + jitter
    nextRunAt = new Date(now() + delayMs).toISOString()
    timer = setTimeout(() => {
      timer = null
      nextRunAt = null
      void runOnce()
        .catch((error) => logError(`[${options.name}] scheduled run failed`, describeServerError(error)))
        .finally(schedule)
    }, delayMs)
    timer.unref?.()
  }

  const controller: BackgroundWorkerController = {
    initialize: () => {
      if (initialized) return Promise.resolve()
      if (initializing) return initializing
      stopped = false
      startedAt = new Date(now()).toISOString()
      initializing = runOnce()
        .then(() => {
          if (stopped) return
          initialized = true
          schedule()
        })
        .catch((error) => {
          stopped = true
          throw error
        })
        .finally(() => {
          initializing = null
        })
      return initializing
    },
    stop: () => {
      stopped = true
      initialized = false
      nextRunAt = null
      if (timer) clearTimeout(timer)
      timer = null
    },
    waitForIdle: async () => {
      await running?.catch(() => undefined)
    },
    getHealth: () => ({
      name: options.name,
      initialized,
      healthy: initialized && consecutiveFailures === 0,
      running: running !== null,
      started_at: startedAt,
      last_started_at: lastStartedAt,
      last_success_at: lastSuccessAt,
      last_error_at: lastErrorAt,
      last_error: lastError,
      next_run_at: nextRunAt,
      consecutive_failures: consecutiveFailures,
      skipped_overlaps: skippedOverlaps,
    }),
  }
  registeredWorkers.set(options.name, controller)
  return controller
}

export function getBackgroundWorkerHealth(names: readonly string[]): BackgroundWorkerHealth[] {
  return names.map((name) => registeredWorkers.get(name)?.getHealth() ?? missingWorkerHealth(name))
}

function missingWorkerHealth(name: string): BackgroundWorkerHealth {
  return {
    name,
    initialized: false,
    healthy: false,
    running: false,
    started_at: null,
    last_started_at: null,
    last_success_at: null,
    last_error_at: null,
    last_error: null,
    next_run_at: null,
    consecutive_failures: 0,
    skipped_overlaps: 0,
  }
}
