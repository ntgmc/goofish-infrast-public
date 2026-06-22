import type { Context } from '@netlify/functions'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Announcement } from '../../src/lib/types'
import { jsonResponse, requireEnv } from './license-utils'

const ANNOUNCEMENT_KEY = 'current.json'
const DEFAULT_ANNOUNCEMENT: Announcement = {
  enabled: false,
  title: '',
  body: '',
  updated_at: null,
}

interface AnnouncementStore {
  get: () => Promise<Announcement | null>;
  set: (announcement: Announcement) => Promise<void>;
}

export default async (req: Request, _context: Context): Promise<Response> => {
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
  const announcement = await readAnnouncement()
  if (!announcement.enabled) {
    return jsonResponse({ enabled: false })
  }
  return jsonResponse(announcement)
}

async function handleAdminGet(req: Request): Promise<Response> {
  const adminPassword = requireEnv('MAA_ADMIN_PASSWORD')
  const providedPassword = req.headers.get('X-Admin-Password')
  if (providedPassword !== adminPassword) {
    return jsonResponse({ error: '管理口令错误。' }, 401)
  }

  return jsonResponse(await readAnnouncement())
}

async function handleAdminPut(req: Request): Promise<Response> {
  const body = await req.json() as {
    admin_password?: string;
    enabled?: unknown;
    title?: unknown;
    body?: unknown;
  }
  const adminPassword = requireEnv('MAA_ADMIN_PASSWORD')
  if (body.admin_password !== adminPassword) {
    return jsonResponse({ error: '管理口令错误。' }, 401)
  }

  const validation = validateAnnouncementInput(body)
  if (!validation.ok) {
    return jsonResponse({ error: validation.message }, 400)
  }

  const announcement: Announcement = {
    ...validation.announcement,
    updated_at: new Date().toISOString(),
  }
  const store = await getAnnouncementStore()
  await store.set(announcement)

  return jsonResponse(announcement)
}

function validateAnnouncementInput(value: {
  enabled?: unknown;
  title?: unknown;
  body?: unknown;
}): { ok: true; announcement: Omit<Announcement, 'updated_at'> } | { ok: false; message: string } {
  if (typeof value.enabled !== 'boolean') {
    return { ok: false, message: '公告启用状态必须是布尔值。' }
  }

  const title = typeof value.title === 'string' ? value.title.trim() : ''
  const body = typeof value.body === 'string' ? value.body.trim() : ''
  if (title.length > 80) {
    return { ok: false, message: '公告标题不能超过 80 字。' }
  }
  if (body.length > 600) {
    return { ok: false, message: '公告正文不能超过 600 字。' }
  }
  if (value.enabled && (!title || !body)) {
    return { ok: false, message: '启用公告时必须填写标题和正文。' }
  }

  return { ok: true, announcement: { enabled: value.enabled, title, body } }
}

async function readAnnouncement(): Promise<Announcement> {
  const store = await getAnnouncementStore()
  const announcement = await store.get()
  return normalizeAnnouncement(announcement)
}

async function getAnnouncementStore(): Promise<AnnouncementStore> {
  if (hasNetlifyBlobsContext()) {
    const { getStore } = await import('@netlify/blobs')
    const store = getStore('maa-announcements')
    return {
      get: async () => await store.get(ANNOUNCEMENT_KEY, { type: 'json' }) as Announcement | null,
      set: async (announcement) => {
        await store.setJSON(ANNOUNCEMENT_KEY, announcement)
      },
    }
  }

  return {
    get: async () => readLocalAnnouncement(),
    set: async (announcement) => writeLocalAnnouncement(announcement),
  }
}

function normalizeAnnouncement(value: Announcement | null): Announcement {
  if (!value || typeof value !== 'object') return DEFAULT_ANNOUNCEMENT
  return {
    enabled: value.enabled === true,
    title: typeof value.title === 'string' ? value.title : '',
    body: typeof value.body === 'string' ? value.body : '',
    updated_at: typeof value.updated_at === 'string' ? value.updated_at : null,
  }
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

function localAnnouncementPath(): string {
  return join(process.cwd(), '.netlify', 'local-announcements', ANNOUNCEMENT_KEY)
}

function readLocalAnnouncement(): Announcement | null {
  const path = localAnnouncementPath()
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')) as Announcement
}

function writeLocalAnnouncement(announcement: Announcement): void {
  const path = localAnnouncementPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(announcement, null, 2), 'utf8')
}
