import { apiVoid } from './api-client'

export async function reportToolVisit(): Promise<void> {
  try {
    await apiVoid('/api/usage-stats', {
      method: 'POST',
      keepalive: true,
      json: {
        event: 'tool_visit',
      },
    })
  } catch {
    // Usage tracking must never interrupt access to the workbench.
  }
}
