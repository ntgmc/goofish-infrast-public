export type ServiceLifecycleState = 'starting' | 'ready' | 'draining' | 'stopped'

let lifecycleState: ServiceLifecycleState = process.env.NODE_ENV === 'test' ? 'ready' : 'starting'

export function getServiceLifecycleState(): ServiceLifecycleState {
  return lifecycleState
}

export function markServiceReady(): void {
  if (lifecycleState === 'starting') lifecycleState = 'ready'
}

export function beginServiceDrain(): boolean {
  if (lifecycleState === 'draining' || lifecycleState === 'stopped') return false
  lifecycleState = 'draining'
  return true
}

export function markServiceStopped(): void {
  lifecycleState = 'stopped'
}

export function isServiceReady(): boolean {
  return lifecycleState === 'ready'
}

export function setServiceLifecycleStateForTesting(state: ServiceLifecycleState): void {
  lifecycleState = state
}
