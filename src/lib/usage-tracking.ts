import { apiVoid } from './api-client'
import type { OperationsPage } from './operations-tools'

export async function reportPageVisit(page: OperationsPage): Promise<void> {
  try {
    await apiVoid('/api/usage-stats', { method: 'POST', keepalive: true, json: { event: 'page_view', page } })
  } catch {
    // Usage tracking must never interrupt access to the page.
  }
}

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
