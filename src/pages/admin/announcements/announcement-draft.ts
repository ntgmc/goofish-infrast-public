import type { Announcement } from '../../../lib/types'

const ANNOUNCEMENT_DRAFT_VERSION = 1
export const ANNOUNCEMENT_DRAFT_AUTOSAVE_DELAY_MS = 500

export type AnnouncementDraftStatus = 'clean' | 'saving' | 'saved' | 'error'

const ANNOUNCEMENT_DRAFT_STORAGE_PREFIX = 'goofish:admin-announcement-draft:v1:'

export interface AnnouncementSnapshot {
  banner: Announcement
  announcements: Announcement[]
}

interface AnnouncementDraftV1 extends AnnouncementSnapshot {
  version: typeof ANNOUNCEMENT_DRAFT_VERSION
  owner: string
  saved_at: string
  base_revision: string
}

export interface AnnouncementDraftReadResult {
  draft: AnnouncementDraftV1 | null
  error: string | null
}

export interface AnnouncementDraftWriteResult {
  savedAt: string | null
  error: string | null
}

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function announcementDraftStorageKey(owner: string): string {
  return `${ANNOUNCEMENT_DRAFT_STORAGE_PREFIX}${encodeURIComponent(owner)}`
}

export function buildAnnouncementRevision(
  banner: Announcement | null,
  announcements: Announcement[],
): string {
  return JSON.stringify({
    banner: banner ? [banner.id, banner.updated_at] : null,
    announcements: announcements.map((item) => [item.id, item.updated_at]),
  })
}

export function announcementSnapshotsEqual(
  left: AnnouncementSnapshot,
  right: AnnouncementSnapshot,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function readAnnouncementDraft(
  owner: string,
  storage: DraftStorage | null = getBrowserStorage(),
): AnnouncementDraftReadResult {
  if (!storage) return { draft: null, error: '当前浏览器不支持本地草稿存储。' }

  const key = announcementDraftStorageKey(owner)
  let raw: string | null
  try {
    raw = storage.getItem(key)
  } catch {
    return { draft: null, error: '读取本机公告草稿失败。' }
  }
  if (!raw) return { draft: null, error: null }

  try {
    const value: unknown = JSON.parse(raw)
    if (isAnnouncementDraft(value, owner)) return { draft: value, error: null }
  } catch {
    // Invalid drafts are removed below so they cannot repeatedly break recovery.
  }

  try {
    storage.removeItem(key)
    return { draft: null, error: null }
  } catch {
    return { draft: null, error: '清理损坏的本机公告草稿失败。' }
  }
}

export function writeAnnouncementDraft(
  owner: string,
  baseRevision: string,
  snapshot: AnnouncementSnapshot,
  storage: DraftStorage | null = getBrowserStorage(),
  savedAt = new Date().toISOString(),
): AnnouncementDraftWriteResult {
  if (!storage) return { savedAt: null, error: '当前浏览器不支持本地草稿存储。' }

  const draft: AnnouncementDraftV1 = {
    version: ANNOUNCEMENT_DRAFT_VERSION,
    owner,
    saved_at: savedAt,
    base_revision: baseRevision,
    banner: snapshot.banner,
    announcements: snapshot.announcements,
  }

  try {
    storage.setItem(announcementDraftStorageKey(owner), JSON.stringify(draft))
    return { savedAt, error: null }
  } catch {
    return { savedAt: null, error: '本机公告草稿保存失败，请立即备份当前内容。' }
  }
}

export function clearAnnouncementDraft(
  owner: string,
  storage: DraftStorage | null = getBrowserStorage(),
): string | null {
  if (!storage) return '当前浏览器不支持本地草稿存储。'
  try {
    storage.removeItem(announcementDraftStorageKey(owner))
    return null
  } catch {
    return '清除本机公告草稿失败。'
  }
}

function getBrowserStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function isAnnouncementDraft(value: unknown, owner: string): value is AnnouncementDraftV1 {
  if (!isRecord(value)) return false
  if (value.version !== ANNOUNCEMENT_DRAFT_VERSION || value.owner !== owner) return false
  if (!isIsoString(value.saved_at) || typeof value.base_revision !== 'string') return false
  if (!isAnnouncement(value.banner, 'banner') || !Array.isArray(value.announcements)) return false
  return value.announcements.every((item) => isAnnouncement(item, 'popup'))
}

function isAnnouncement(value: unknown, kind: Announcement['kind']): value is Announcement {
  if (!isRecord(value)) return false
  return value.kind === kind
    && typeof value.id === 'string'
    && value.id.length > 0
    && typeof value.active === 'boolean'
    && typeof value.title === 'string'
    && typeof value.body === 'string'
    && isIsoString(value.created_at)
    && isIsoString(value.updated_at)
}

function isIsoString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
