import { apiVoid } from './api-client'

export const TOOL_VISITOR_ID_STORAGE_KEY = 'maa-tool-visitor-id'

const VISITOR_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/

export async function reportToolVisit(): Promise<void> {
  try {
    await apiVoid('/api/usage-stats', {
      method: 'POST',
      keepalive: true,
      json: {
        event: 'tool_visit',
        visitor_id: getOrCreateToolVisitorId(),
      },
    })
  } catch {
    // Usage tracking must never interrupt access to the workbench.
  }
}

export function getOrCreateToolVisitorId(): string {
  const storedVisitorId = readStoredVisitorId()
  if (storedVisitorId && VISITOR_ID_PATTERN.test(storedVisitorId)) return storedVisitorId

  const visitorId = createVisitorId()
  try {
    window.localStorage.setItem(TOOL_VISITOR_ID_STORAGE_KEY, visitorId)
  } catch {
    // Storage may be unavailable; retain an ephemeral ID for this visit instead.
  }
  return visitorId
}

function readStoredVisitorId(): string | null {
  try {
    return window.localStorage.getItem(TOOL_VISITOR_ID_STORAGE_KEY)
  } catch {
    return null
  }
}

function createVisitorId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `visitor_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
}
