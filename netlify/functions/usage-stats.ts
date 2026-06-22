import type { Context } from '@netlify/functions'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { jsonResponse, requireEnv } from './license-utils'

type UsageEventName = 'tool_visit' | 'schedule_generate' | 'cdk_redeem'

interface UsageEventRecord {
  id: string;
  event: UsageEventName;
  visitor_id: string | null;
  created_at: string;
  date: string;
}

interface UsageEventStore {
  set: (key: string, record: UsageEventRecord) => Promise<void>;
  list: (prefix: string) => Promise<UsageEventRecord[]>;
}

interface UsageDayStats {
  date: string;
  unique_visitors: number;
  visits: number;
  schedule_generates: number;
  cdk_redeems: number;
}

const EVENT_PREFIX = 'events/'
const VALID_VISITOR_ID = /^[A-Za-z0-9_-]{8,128}$/

export default async (req: Request, _context: Context): Promise<Response> => {
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
  const adminPassword = requireEnv('MAA_ADMIN_PASSWORD')
  const providedPassword = req.headers.get('X-Admin-Password')
  if (providedPassword !== adminPassword) {
    return jsonResponse({ error: '管理口令错误。' }, 401)
  }

  const store = await getUsageEventStore()
  const events = await store.list(EVENT_PREFIX)
  return jsonResponse(buildUsageStats(events))
}

function buildUsageStats(events: UsageEventRecord[]) {
  const sortedEvents = events
    .filter(isUsageEventRecord)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
  const totals = createEmptyDayStats('total')
  const totalVisitors = new Set<string>()
  const dayVisitors = new Map<string, Set<string>>()
  const dayStats = new Map<string, UsageDayStats>()
  const lastSevenDays = getLastSevenDates()

  for (const date of lastSevenDays) {
    dayStats.set(date, createEmptyDayStats(date))
    dayVisitors.set(date, new Set())
  }

  for (const event of sortedEvents) {
    if (event.event === 'tool_visit') {
      totals.visits += 1
      if (event.visitor_id) totalVisitors.add(event.visitor_id)
    } else if (event.event === 'schedule_generate') {
      totals.schedule_generates += 1
    } else if (event.event === 'cdk_redeem') {
      totals.cdk_redeems += 1
    }

    const day = dayStats.get(event.date)
    if (!day) continue
    if (event.event === 'tool_visit') {
      day.visits += 1
      if (event.visitor_id) dayVisitors.get(event.date)?.add(event.visitor_id)
    } else if (event.event === 'schedule_generate') {
      day.schedule_generates += 1
    } else if (event.event === 'cdk_redeem') {
      day.cdk_redeems += 1
    }
  }

  totals.unique_visitors = totalVisitors.size
  const days = lastSevenDays.map((date) => {
    const day = dayStats.get(date) ?? createEmptyDayStats(date)
    day.unique_visitors = dayVisitors.get(date)?.size ?? 0
    return day
  })

  return { totals, days }
}

function createEmptyDayStats(date: string): UsageDayStats {
  return {
    date,
    unique_visitors: 0,
    visits: 0,
    schedule_generates: 0,
    cdk_redeems: 0,
  }
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
  if (hasNetlifyBlobsContext()) {
    const { getStore } = await import('@netlify/blobs')
    const store = getStore('maa-usage-events')
    return {
      set: async (key, record) => {
        await store.setJSON(key, record)
      },
      list: async (prefix) => {
        const { blobs } = await store.list({ prefix })
        const records = await Promise.all(
          blobs.map(async ({ key }) => await store.get(key, { type: 'json' }) as UsageEventRecord | null),
        )
        return records.filter((record): record is UsageEventRecord => record !== null)
      },
    }
  }

  return {
    set: async (key, record) => writeLocalUsageEvent(key, record),
    list: async (prefix) => readLocalUsageEvents(prefix),
  }
}

function isUsageEventRecord(value: unknown): value is UsageEventRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<UsageEventRecord>
  return (
    (record.event === 'tool_visit' || record.event === 'schedule_generate' || record.event === 'cdk_redeem') &&
    typeof record.created_at === 'string' &&
    typeof record.date === 'string' &&
    (record.visitor_id === null || typeof record.visitor_id === 'string')
  )
}

function hasNetlifyBlobsContext(): boolean {
  if (process.env.NETLIFY_DEV || process.env.NODE_ENV === 'development') {
    return false
  }

  const globalContext = (globalThis as unknown as { netlifyBlobsContext?: unknown }).netlifyBlobsContext
  if (hasUsableBlobsContext(globalContext)) return true

  const encodedContext = process.env.NETLIFY_BLOBS_CONTEXT
  if (!encodedContext) return false
  try {
    const decoded = JSON.parse(Buffer.from(encodedContext, 'base64').toString('utf8')) as unknown
    return hasUsableBlobsContext(decoded)
  } catch {
    return false
  }
}

function hasUsableBlobsContext(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const context = value as Record<string, unknown>
  return typeof context.siteID === 'string' &&
    context.siteID.length > 0 &&
    typeof context.token === 'string' &&
    context.token.length > 0
}

function localUsagePath(key: string): string {
  const safeParts = key.split('/').filter((part) => part && part !== '.' && part !== '..')
  return join(process.cwd(), '.netlify', 'local-usage-events', ...safeParts)
}

function writeLocalUsageEvent(key: string, record: UsageEventRecord): void {
  const path = localUsagePath(key)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(record, null, 2), 'utf8')
}

function readLocalUsageEvents(prefix: string): UsageEventRecord[] {
  const dir = localUsagePath(prefix)
  if (!existsSync(dir)) return []
  return readJsonFilesRecursively(dir)
}

function readJsonFilesRecursively(dir: string): UsageEventRecord[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return readJsonFilesRecursively(path)
    if (!entry.isFile() || !entry.name.endsWith('.json')) return []
    return JSON.parse(readFileSync(path, 'utf8')) as UsageEventRecord
  })
}
