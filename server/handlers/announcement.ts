import { randomUUID } from 'node:crypto'
import type { Announcement, AnnouncementKind } from '../../src/lib/types'
import { authenticateAdminRequest } from './admin-auth'
import { jsonResponse } from './license-utils'
import {
  AnnouncementConflictError,
  createPostgresAnnouncementStore,
  type AnnouncementStore,
} from '../storage/announcement-store'
import { getAnnouncementReadCounts } from '../storage/user-store'
import { getAnnouncementEventCounts } from '../storage/usage-store'
import type { AnnouncementStats } from '../../src/lib/types'
import { requestSchemas } from '../security/request-policy'
import { getValidatedJson } from '../security/request-validation'

const ANNOUNCEMENT_KEY = 'current.json'
const MAX_TITLE_LENGTH = 80
export const MAX_BODY_LENGTH = 5000
const VALID_KINDS = new Set<AnnouncementKind>(['banner', 'popup'])

interface AnnouncementData {
  banner: Announcement | null;
  announcements: Announcement[];
}

interface LegacyAnnouncement {
  enabled?: unknown;
  title?: unknown;
  body?: unknown;
  updated_at?: unknown;
}

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return jsonResponse(null, 204)
  }

  const url = new URL(req.url)
  const isAdminRoute = url.searchParams.get('admin') === '1' || url.pathname.includes('/api/admin/announcement')

  try {
    if (req.method === 'GET') {
      return isAdminRoute ? handleAdminGet(req) : handlePublicGet(req)
    }
    if (req.method === 'PUT' && isAdminRoute) {
      return handleAdminPut(req)
    }
    return jsonResponse({ error: 'Method not allowed' }, 405)
  } catch (error) {
    console.error('announcement error:', error)
    return jsonResponse({ error: 'Internal server error' }, 500)
  }
}

async function handlePublicGet(req: Request): Promise<Response> {
  const { data, revision } = await readAnnouncementDocument()
  const banner = data.banner?.active ? data.banner : null
  const announcements = data.announcements
    .filter((item) => item.active)
  const etag = `"announcements-${revision}"`
  const headers = {
    'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
    ETag: etag,
  }
  if (req.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers })

  return jsonResponse({
    banner,
    popups: announcements,
    announcements,
  }, 200, headers)
}

async function handleAdminGet(req: Request): Promise<Response> {
  const authentication = await authenticateAdminRequest(req, 'admin_manage')
  if (!authentication.ok) return authentication.response

  const { data, revision } = await readAnnouncementDocument()
  return jsonResponse({
    ...data,
    revision,
    stats: await buildAnnouncementStats(data.announcements),
  })
}

async function handleAdminPut(req: Request): Promise<Response> {
  const authentication = await authenticateAdminRequest(req, 'admin_manage')
  if (!authentication.ok) return authentication.response

  const body = await getValidatedJson(req, requestSchemas.announcement)
  const currentDocument = await readAnnouncementDocument()
  const current = currentDocument.data
  const bannerValidation = validateAnnouncementBanner(body.banner, current.banner)
  if (!bannerValidation.ok) {
    return jsonResponse({ error: bannerValidation.message }, 400)
  }
  const announcementValidation = validateAnnouncementList(body.announcements, current.announcements)
  if (!announcementValidation.ok) {
    return jsonResponse({ error: announcementValidation.message }, 400)
  }

  const data: AnnouncementData = {
    banner: bannerValidation.banner,
    announcements: announcementValidation.announcements,
  }
  const store = await getAnnouncementStore()
  const retainedIds = data.announcements.map((announcement) => announcement.id)
  let revision: number
  try {
    revision = await store.set(data, body.expected_revision, retainedIds)
  } catch (error) {
    if (!(error instanceof AnnouncementConflictError)) throw error
    const latest = await readAnnouncementDocument()
    return jsonResponse({
      error: '线上公告已更新，请重新载入后合并本机草稿。',
      code: 'announcement_revision_conflict',
      ...latest.data,
      revision: latest.revision,
    }, 409)
  }

  return jsonResponse({
    ...data,
    revision,
  })
}

async function buildAnnouncementStats(announcements: Announcement[]): Promise<Record<string, AnnouncementStats>> {
  const [events, serverReadCounts] = await Promise.all([
    getAnnouncementEventCounts(announcements),
    getAnnouncementReadCounts(announcements),
  ])

  return Object.fromEntries(announcements.map((announcement) => {
    const eventStats = events[announcement.id]
    const serverReads = serverReadCounts[announcement.id] ?? 0
    const visitorReads = eventStats?.visitor_reads ?? 0
    const reads = visitorReads
    const impressions = eventStats?.impressions ?? 0
    return [announcement.id, {
      impressions,
      reads,
      server_reads: serverReads,
      visitor_reads: visitorReads,
      unread: Math.max(0, impressions - reads),
      read_rate: rate(reads, impressions),
    }]
  }))
}

export function validateAnnouncementBanner(
  value: unknown,
  current: Announcement | null,
): { ok: true; banner: Announcement | null } | { ok: false; message: string } {
  if (value === null) return { ok: true, banner: null }
  if (!isRecord(value)) return { ok: false, message: '横幅格式不正确。' }
  if (value.kind !== 'banner') return { ok: false, message: '横幅类型不正确。' }

  const title = typeof value.title === 'string' ? value.title.trim() : ''
  const body = typeof value.body === 'string' ? value.body : ''
  const active = value.active === true
  if (title.length > MAX_TITLE_LENGTH) {
    return { ok: false, message: `横幅标题不能超过 ${MAX_TITLE_LENGTH} 字。` }
  }
  if (body.length > MAX_BODY_LENGTH) {
    return { ok: false, message: `横幅正文不能超过 ${MAX_BODY_LENGTH} 字。` }
  }
  if (active && (!title || !body.trim())) {
    return { ok: false, message: '横幅启用时必须填写标题和正文。' }
  }

  const now = new Date().toISOString()
  const id = typeof value.id === 'string' && value.id.trim() ? value.id.trim() : current?.id ?? createAnnouncementId()
  const createdAt = normalizeIsoString(value.created_at) ?? current?.created_at ?? now
  const updatedAt = hasAnnouncementChanged(current ?? undefined, { kind: 'banner', active, title, body })
    ? now
    : normalizeIsoString(value.updated_at) ?? current?.updated_at ?? now

  return {
    ok: true,
    banner: {
      id,
      kind: 'banner',
      active,
      title,
      body,
      created_at: createdAt,
      updated_at: updatedAt,
    },
  }
}

export function validateAnnouncementList(
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
    if (kind !== 'popup') {
      return { ok: false, message: `第 ${index + 1} 条公告类型不正确。` }
    }

    const title = typeof item.title === 'string' ? item.title.trim() : ''
    const body = typeof item.body === 'string' ? item.body : ''
    const active = item.active === true

    if (title.length > MAX_TITLE_LENGTH) {
      return { ok: false, message: `第 ${index + 1} 条公告标题不能超过 ${MAX_TITLE_LENGTH} 字。` }
    }
    if (body.length > MAX_BODY_LENGTH) {
      return { ok: false, message: `第 ${index + 1} 条公告正文不能超过 ${MAX_BODY_LENGTH} 字。` }
    }
    if (active && (!title || !body.trim())) {
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

async function readAnnouncementDocument(): Promise<{ data: AnnouncementData; revision: number }> {
  const store = await getAnnouncementStore()
  const document = await store.get()
  return { data: normalizeAnnouncementData(document.data), revision: document.revision }
}

async function getAnnouncementStore(): Promise<AnnouncementStore> {
  return createPostgresAnnouncementStore(ANNOUNCEMENT_KEY)
}

export function normalizeAnnouncementData(value: unknown): AnnouncementData {
  if (isRecord(value) && Array.isArray(value.announcements)) {
    const items = value.announcements
      .map(normalizeAnnouncementItem)
      .filter((item): item is Announcement => Boolean(item))
    const hasExplicitBanner = Object.prototype.hasOwnProperty.call(value, 'banner')
    const banner = hasExplicitBanner
      ? normalizeBannerItem(value.banner)
      : items.filter((item) => item.kind === 'banner').sort(compareNewestFirst)[0] ?? null

    return {
      banner,
      announcements: items.filter((item) => item.kind === 'popup'),
    }
  }

  return {
    banner: normalizeLegacyAnnouncement(value),
    announcements: [],
  }
}

function normalizeAnnouncementItem(value: unknown): Announcement | null {
  if (!isRecord(value)) return null
  const id = typeof value.id === 'string' && value.id.trim() ? value.id.trim() : createAnnouncementId()
  const kind = normalizeKind(value.kind)
  if (!kind) return null
  const title = typeof value.title === 'string' ? value.title.trim() : ''
  const body = typeof value.body === 'string' ? value.body : ''
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

function normalizeBannerItem(value: unknown): Announcement | null {
  const item = normalizeAnnouncementItem(value)
  return item?.kind === 'banner' ? item : null
}

function normalizeLegacyAnnouncement(value: unknown): Announcement | null {
  if (!isRecord(value)) return null
  const legacy = value as LegacyAnnouncement
  const title = typeof legacy.title === 'string' ? legacy.title.trim() : ''
  const body = typeof legacy.body === 'string' ? legacy.body : ''
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
  return date.toISOString()
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
