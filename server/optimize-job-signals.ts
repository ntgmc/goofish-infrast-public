export type OptimizeJobSignalHandlers = {
  onProcessingRequested: () => void
  onCancellationRequested: (jobId: string) => void
}

let registeredHandlers: OptimizeJobSignalHandlers | null = null

export function registerOptimizeJobSignalHandlers(handlers: OptimizeJobSignalHandlers): () => void {
  registeredHandlers = handlers
  return () => {
    if (registeredHandlers === handlers) registeredHandlers = null
  }
}

export function requestOptimizeJobProcessing(): void {
  registeredHandlers?.onProcessingRequested()
}

export function requestOptimizeJobCancellation(jobId: string): void {
  registeredHandlers?.onCancellationRequested(jobId)
}
