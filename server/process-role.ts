export type AppRole = 'api' | 'worker' | 'all'

export type AppCapability = 'serve-api' | 'run-optimize-worker' | 'maintain-optimize-queue'

const CAPABILITIES: Record<AppRole, ReadonlySet<AppCapability>> = {
  api: new Set(['serve-api', 'maintain-optimize-queue']),
  worker: new Set(['run-optimize-worker', 'maintain-optimize-queue']),
  all: new Set(['serve-api', 'run-optimize-worker', 'maintain-optimize-queue']),
}

export function resolveAppRole(environment: NodeJS.ProcessEnv = process.env): AppRole {
  const configured = environment.APP_ROLE?.trim().toLowerCase()
  if (configured === 'api' || configured === 'worker' || configured === 'all') return configured

  if (environment.NODE_ENV === 'production') {
    throw new Error(configured
      ? 'APP_ROLE must be one of: api, worker, all'
      : 'APP_ROLE is required in production')
  }
  return 'all'
}

export function hasAppCapability(
  capability: AppCapability,
  role: AppRole = resolveAppRole(),
): boolean {
  return CAPABILITIES[role].has(capability)
}

export function canServeApi(role: AppRole = resolveAppRole()): boolean {
  return hasAppCapability('serve-api', role)
}

export function canRunOptimizeWorker(role: AppRole = resolveAppRole()): boolean {
  return hasAppCapability('run-optimize-worker', role)
}

export function canMaintainOptimizeQueue(role: AppRole = resolveAppRole()): boolean {
  return hasAppCapability('maintain-optimize-queue', role)
}
