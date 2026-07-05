import { randomUUID } from 'node:crypto'
import { authenticateAdminRequest } from './admin-auth'
import { jsonResponse } from './license-utils'
import {
  createPostgresUsageEventStore,
  type UsageEventName,
  type UsageEventRecord,
  type UsageEventStore,
} from '../storage/usage-store'

const EVENT_PREFIX = 'events/'
const VALID_VISITOR_ID = /^[A-Za-z0-9_-]{8,128}$/

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return jsonResponse(null, 204)
  }

  const url = new URL(req.url)
  const isAdminRoute = url.searchParams.get('admin') === '1' || url.pathname.includes('/api/admin/usage-stats')

  try {
    if (req.method === 'POST' && !isAdminRoute) {
      return handlePublicPost(req)
    }
    if (req.method === 'GET' && isAdminRoute) {
      return handleAdminGet(req)
    }
    return jsonResponse({ error: 'Method not allowed' }, 405)
  } catch (error) {
    console.error('usage stats error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return jsonResponse({ error: message }, 500)
  }
}

export async function recordUsageEvent(event: UsageEventName, visitorId: string | null = null): Promise<void> {
  const createdAt = new Date().toISOString()
  const date = createdAt.slice(0, 10)
  const id = randomUUID()
  const key = `${EVENT_PREFIX}${date}/${createdAt.replace(/[:.]/g, '-')}-${id}.json`
  const record: UsageEventRecord = {
    id,
    event,
    visitor_id: visitorId,
    created_at: createdAt,
    date,
  }
  const store = await getUsageEventStore()
  await store.set(key, record)
}

async function handlePublicPost(req: Request): Promise<Response> {
  const body = await req.json() as {
    event?: unknown;
    visitor_id?: unknown;
  }
  if (body.event !== 'tool_visit') {
    return jsonResponse({ error: 'Unsupported usage event.' }, 400)
  }
  if (typeof body.visitor_id !== 'string' || !VALID_VISITOR_ID.test(body.visitor_id)) {
    return jsonResponse({ error: 'Invalid visitor id.' }, 400)
  }

  await recordUsageEvent('tool_visit', body.visitor_id)
  return jsonResponse({ ok: true })
}

async function handleAdminGet(req: Request): Promise<Response> {
  if (!(await authenticateAdminRequest(req))) {
    return jsonResponse({ error: '管理账号或密码错误。' }, 401)
  }

  const store = await getUsageEventStore()
  return jsonResponse(await store.getStats(getLastSevenDates()))
}

function getLastSevenDates(): string[] {
  const dates: string[] = []
  const now = new Date()
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset))
    dates.push(date.toISOString().slice(0, 10))
  }
  return dates
}

async function getUsageEventStore(): Promise<UsageEventStore> {
  const testingStore = getTestingUsageEventStore()
  if (testingStore) return testingStore
  return createPostgresUsageEventStore()
}

export function setUsageEventStoreForTesting(store: UsageEventStore | null): void {
  ;(globalThis as unknown as { __maaUsageEventStoreForTesting?: UsageEventStore }).__maaUsageEventStoreForTesting =
    store ?? undefined
}

function getTestingUsageEventStore(): UsageEventStore | null {
  if (process.env.NODE_ENV === 'production') return null
  return (
    (globalThis as unknown as { __maaUsageEventStoreForTesting?: UsageEventStore })
      .__maaUsageEventStoreForTesting ?? null
  )
}
