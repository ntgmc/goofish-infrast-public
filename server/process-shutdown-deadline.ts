const DEFAULT_PROCESS_SHUTDOWN_DEADLINE_MS = 65_000
const FORCED_PROCESS_SHUTDOWN_DEADLINE_MS = 1_000

export function resolveProcessShutdownDeadlineMs(
  environment: Pick<NodeJS.ProcessEnv, 'PROCESS_SHUTDOWN_DEADLINE_MS'> = process.env,
): number {
  const rawValue = environment.PROCESS_SHUTDOWN_DEADLINE_MS?.trim()
  if (!rawValue) return DEFAULT_PROCESS_SHUTDOWN_DEADLINE_MS
  const configured = Number(rawValue)
  if (!Number.isSafeInteger(configured) || configured < 5_000 || configured > 300_000) {
    throw new Error('PROCESS_SHUTDOWN_DEADLINE_MS must be an integer between 5000 and 300000')
  }
  return configured
}

export function scheduleProcessHardExit(
  forced: boolean,
  exit: (code: number) => never = process.exit,
): () => void {
  const delayMs = forced ? FORCED_PROCESS_SHUTDOWN_DEADLINE_MS : resolveProcessShutdownDeadlineMs()
  const timer = setTimeout(() => exit(1), delayMs)
  timer.unref?.()
  return () => clearTimeout(timer)
}
