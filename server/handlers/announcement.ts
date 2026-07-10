import { randomUUID } from 'node:crypto'
import type { Announcement, AnnouncementKind } from '../../src/lib/types'
import { authenticateAdminRequest } from './admin-auth'
import { jsonResponse } from './license-utils'
import { createPostgresAnnouncementStore } from '../storage/announcement-store'
import { getAnnouncementReadCounts } from '../storage/user-store'
import { listUsageEvents, recordUsageEvent } from './usage-stats'
import type { AnnouncementStats } from '../../src/lib/types'

const ANNOUNCEMENT_KEY = 'current.json'
const MAX_TITLE_LENGTH = 80
const MAX_BODY_LENGTH = 600
const VALID_KINDS = new Set<AnnouncementKind>(['banner', 'popup'])

interface AnnouncementData {
  announcements: Announcement[];
}

interface LegacyAnnouncement {
  enabled?: unknown;
  title?: unknown;
  body?: unknown;
  updated_at?: unknown;
}

interface AnnouncementStore {
  get: () => Promise<unknown>;
  set: (data: AnnouncementData) => Promise<void>;
}

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return jsonResponse(null, 204)
  }

  const url = new URL(req.url)
  const isAdminRoute = url.searchParams.get('admin') === '1' || url.pathname.includes('/api/admin/announcement')

  try {
    if (req.method === 'GET') {
      return isAdminRoute ? handleAdminGet(req) : handlePublicGet()
    }
    if (req.method === 'PUT' && isAdminRoute) {
      return handleAdminPut(req)
    }
    return jsonResponse({ error: 'Method not allowed' }, 405)
  } catch (error) {
    console.error('announcement error:', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return jsonResponse({ error: message }, 500)
  }
}

async function handlePublicGet(): Promise<Response> {
  const announcements = (await readAnnouncementData()).announcements
  const activeAnnouncements = announcements
    .filter((item) => item.active)
    .sort(compareNewestFirst)
  const banner = activeAnnouncements.find((item) => item.kind === 'banner') ?? null
  const popups = activeAnnouncements.filter((item) => item.kind === 'popup')
  if (activeAnnouncements.length > 0) {
    await Promise.all(activeAnnouncements.map((item) => recordAnnouncementEvent('announcement_impression', 'public_get', item)))
  }

  return jsonResponse({
    banner,
    popups,
    announcements: activeAnnouncements,
  })
}

async function recordAnnouncementEvent(
  event: 'announcement_impression' | 'announcement_read',
  source: string,
  announcement: Pick<Announcement, 'id' | 'kind'>,
): Promise<void> {
  try {
    await recordUsageEvent(event, {
      status: 'success',
      reason_code: 'ok',
      source,
      announcement_id: announcement.id,
      announcement_kind: announcement.kind,
    })
  } catch (error) {
    console.warn('usage stats announcement skipped:', error)
  }
}

async function handleAdminGet(req: Request): Promise<Response> {
  const authentication = await authenticateAdminRequest(req)
  if (!authentication.ok) return authentication.response

  const data = await readAnnouncementData()
  return jsonResponse({
    ...data,
    stats: await buildAnnouncementStats(data.announcements),
  })
}

async function handleAdminPut(req: Request): Promise<Response> {
  const authentication = await authenticateAdminRequest(req)
  if (!authentication.ok) return authentication.response

  const body = await req.json() as { announcements?: unknown }
  const current = await readAnnouncementData()
  const validation = validateAnnouncementList(body.announcements, current.announcements)
  if (!validation.ok) {
    return jsonResponse({ error: validation.message }, 400)
  }

  const data: AnnouncementData = {
    announcements: validation.announcements,
  }
  const store = await getAnnouncementStore()
  await store.set(data)

  return jsonResponse({
    ...data,
    stats: await buildAnnouncementStats(data.announcements),
  })
}

async function buildAnnouncementStats(announcements: Announcement[]): Promise<Record<string, AnnouncementStats>> {
  const [events, serverReadCounts] = await Promise.all([
    listUsageEvents(),
    getAnnouncementReadCounts(),
  ])
  const stats = new Map<string, { impressions: number; local_reads: number }>()
  const activeIds = new Set(announcements.map((announcement) => announcement.id))

  for (const event of events) {
    if (!event.announcement_id || !activeIds.has(event.announcement_id) || event.status === 'failure') continue
    const current = stats.get(event.announcement_id) ?? { impressions: 0, local_reads: 0 }
    if (event.event === 'announcement_impression') current.impressions += 1
    if (event.event === 'announcement_read' && event.source !== 'user_announcements') current.local_reads += 1
    stats.set(event.announcement_id, current)
  }

  return Object.fromEntries(announcements.map((announcement) => {
    const eventStats = stats.get(announcement.id)
    const serverReads = serverReadCounts[announcement.id] ?? 0
    const localReads = eventStats?.local_reads ?? 0
    const reads = serverReads + localReads
    const impressions = Math.max(eventStats?.impressions ?? 0, reads)
    return [announcement.id, {
      impressions,
      reads,
      server_reads: serverReads,
      local_reads: localReads,
      unread: Math.max(0, impressions - reads),
      read_rate: rate(reads, impressions),
    }]
  }))
}

function validateAnnouncementList(
  value: unknown,
  current: Announcement[],
): { ok: true; announcements: Announcement[] } | { ok: false; message: string } {
  if (!Array.isArray(value)) {
    return { ok: false, message: '公告列表格式不正确。' }
  }

  const now = new Date().toISOString()
  const currentById = new Map(current.map((item) => [item.id, item]))
  const usedIds = new Set<string>()
  const announcements: Announcement[] = []

  for (const [index, raw] of value.entries()) {
    if (!raw || typeof raw !== 'object') {
      return { ok: false, message: `第 ${index + 1} 条公告格式不正确。` }
    }

    const item = raw as Record<string, unknown>
    const kind = item.kind
    if (kind !== 'banner' && kind !== 'popup') {
      return { ok: false, message: `第 ${index + 1} 条公告类型不正确。` }
    }

    const title = typeof item.title === 'string' ? item.title.trim() : ''
    const body = typeof item.body === 'string' ? item.body.trim() : ''
    const active = item.active === true

    if (title.length > MAX_TITLE_LENGTH) {
      return { ok: false, message: `第 ${index + 1} 条公告标题不能超过 ${MAX_TITLE_LENGTH} 字。` }
    }
    if (body.length > MAX_BODY_LENGTH) {
      return { ok: false, message: `第 ${index + 1} 条公告正文不能超过 ${MAX_BODY_LENGTH} 字。` }
    }
    if (active && (!title || !body)) {
      return { ok: false, message: `第 ${index + 1} 条公告启用时必须填写标题和正文。` }
    }

    let id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : createAnnouncementId()
    while (usedIds.has(id)) id = createAnnouncementId()
    usedIds.add(id)

    const previous = currentById.get(id)
    const createdAt = normalizeIsoString(item.created_at) ?? previous?.created_at ?? now
    const updatedAt = hasAnnouncementChanged(previous, { kind, active, title, body })
      ? now
      : normalizeIsoString(item.updated_at) ?? previous?.updated_at ?? now

    announcements.push({
      id,
      kind,
      active,
      title,
      body,
      created_at: createdAt,
      updated_at: updatedAt,
    })
  }

  return { ok: true, announcements }
}

function hasAnnouncementChanged(
  previous: Announcement | undefined,
  next: Pick<Announcement, 'kind' | 'active' | 'title' | 'body'>,
): boolean {
  if (!previous) return true
  return previous.kind !== next.kind
    || previous.active !== next.active
    || previous.title !== next.title
    || previous.body !== next.body
}

async function readAnnouncementData(): Promise<AnnouncementData> {
  const store = await getAnnouncementStore()
  return normalizeAnnouncementData(await store.get())
}

async function getAnnouncementStore(): Promise<AnnouncementStore> {
  return createPostgresAnnouncementStore(ANNOUNCEMENT_KEY)
}

function normalizeAnnouncementData(value: unknown): AnnouncementData {
  if (isRecord(value) && Array.isArray(value.announcements)) {
    return {
      announcements: value.announcements
        .map(normalizeAnnouncementItem)
        .filter((item): item is Announcement => Boolean(item)),
    }
  }

  const legacy = normalizeLegacyAnnouncement(value)
  return { announcements: legacy ? [legacy] : [] }
}

function normalizeAnnouncementItem(value: unknown): Announcement | null {
  if (!isRecord(value)) return null
  const id = typeof value.id === 'string' && value.id.trim() ? value.id.trim() : createAnnouncementId()
  const kind = normalizeKind(value.kind)
  if (!kind) return null
  const title = typeof value.title === 'string' ? value.title.trim() : ''
  const body = typeof value.body === 'string' ? value.body.trim() : ''
  const now = new Date().toISOString()

  return {
    id,
    kind,
    active: value.active === true,
    title,
    body,
    created_at: normalizeIsoString(value.created_at) ?? normalizeIsoString(value.updated_at) ?? now,
    updated_at: normalizeIsoString(value.updated_at) ?? now,
  }
}

function normalizeLegacyAnnouncement(value: unknown): Announcement | null {
  if (!isRecord(value)) return null
  const legacy = value as LegacyAnnouncement
  const title = typeof legacy.title === 'string' ? legacy.title.trim() : ''
  const body = typeof legacy.body === 'string' ? legacy.body.trim() : ''
  const updatedAt = normalizeIsoString(legacy.updated_at) ?? new Date().toISOString()

  if (!title && !body && legacy.enabled !== true) return null

  return {
    id: 'legacy-banner',
    kind: 'banner',
    active: legacy.enabled === true,
    title,
    body,
    created_at: updatedAt,
    updated_at: updatedAt,
  }
}

function normalizeKind(value: unknown): AnnouncementKind | null {
  return typeof value === 'string' && VALID_KINDS.has(value as AnnouncementKind)
    ? value as AnnouncementKind
    : null
}

function normalizeIsoString(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return value
}

function compareNewestFirst(a: Announcement, b: Announcement): number {
  return Date.parse(b.updated_at) - Date.parse(a.updated_at)
}

function rate(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 1000) / 10 : 0
}

function createAnnouncementId(): string {
  if (typeof randomUUID === 'function') return `ann_${randomUUID()}`
  return `ann_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
