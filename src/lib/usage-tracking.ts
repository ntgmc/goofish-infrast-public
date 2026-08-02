import { apiVoid } from './api-client'

export const TOOL_VISITOR_ID_STORAGE_KEY = 'maa-tool-visitor-id'

const VISITOR_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/
let ephemeralVisitorId: string | null = null

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
  const stored = readStoredVisitorId()
  if (stored.value && VISITOR_ID_PATTERN.test(stored.value)) return stored.value
  if (stored.unavailable && ephemeralVisitorId) return ephemeralVisitorId

  const visitorId = createVisitorId()
  try {
    window.localStorage.setItem(TOOL_VISITOR_ID_STORAGE_KEY, visitorId)
  } catch {
    ephemeralVisitorId = visitorId
  }
  if (stored.unavailable) ephemeralVisitorId = visitorId
  return visitorId
}

function readStoredVisitorId(): { value: string | null; unavailable: boolean } {
  try {
    return { value: window.localStorage.getItem(TOOL_VISITOR_ID_STORAGE_KEY), unavailable: false }
  } catch {
    return { value: null, unavailable: true }
  }
}

function createVisitorId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `visitor_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
}
