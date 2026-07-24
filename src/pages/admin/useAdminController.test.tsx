// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FormEvent } from 'react'
import type { Announcement, AnnouncementAdminResponse } from '../../lib/types'
import {
  announcementDraftStorageKey,
  readAnnouncementDraft,
  writeAnnouncementDraft,
} from './announcements/announcement-draft'
import { useAdminController } from './useAdminController'

const adminApi = vi.hoisted(() => ({
  json: vi.fn(),
  void: vi.fn(),
}))

vi.mock('../../lib/admin-api-client', () => ({
  ADMIN_SESSION_EXPIRED_EVENT: 'goofish:admin-session-expired',
  adminApiJson: adminApi.json,
  adminApiVoid: adminApi.void,
}))

let serverAnnouncements: AnnouncementAdminResponse
let sessionUsername: string
let failAnnouncementGet: boolean
let failAnnouncementPut: boolean

describe('useAdminController announcement drafts', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.stubGlobal('confirm', vi.fn(() => true))
    serverAnnouncements = createServerAnnouncements()
    sessionUsername = 'alice'
    failAnnouncementGet = false
    failAnnouncementPut = false
    adminApi.void.mockReset().mockResolvedValue(undefined)
    adminApi.json.mockReset().mockImplementation(async (url: string, init?: { method?: string; json?: unknown }) => {
      if (url === '/api/admin/session') return { user: { username: sessionUsername } }
      if (url === '/api/admin/announcement') {
        if (init?.method === 'PUT') {
          if (failAnnouncementPut) throw new Error('发布服务不可用')
          const payload = init.json as Pick<AnnouncementAdminResponse, 'banner' | 'announcements'>
          serverAnnouncements = { ...payload, stats: {} }
        }
        if (!init?.method && failAnnouncementGet) throw new Error('线上公告加载失败')
        return serverAnnouncements
      }
      if (url.startsWith('/api/admin/usage-stats')) return {}
      if (url === '/api/admin/risk-settings') return {}
      if (url.startsWith('/api/admin/cdk')) return {}
      if (url.startsWith('/api/admin/users')) return {}
      throw new Error(`Unexpected admin API request: ${url}`)
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('flushes the latest edit before session reset and restores it after login', async () => {
    const { result } = renderHook(() => useAdminController())
    await waitForHydration(result)

    act(() => result.current.updateBanner({ title: '会话过期前的草稿' }))
    act(() => window.dispatchEvent(new Event('goofish:admin-session-expired')))

    expect(result.current.authenticated).toBe(false)
    expect(readAnnouncementDraft('alice', window.localStorage).draft?.banner.title).toBe('会话过期前的草稿')

    act(() => result.current.setLoginPassword('password'))
    await act(async () => result.current.handleLogin(formEvent()))
    await waitFor(() => expect(result.current.authenticated).toBe(true))
    await waitFor(() => expect(result.current.banner.title).toBe('会话过期前的草稿'))
    expect(result.current.announcementDraftRestored).toBe(true)
    expect(result.current.announcementDraftDirty).toBe(true)
  })

  it('autosaves after the debounce and clears the draft after publishing', async () => {
    const { result } = renderHook(() => useAdminController())
    await waitForHydration(result)

    act(() => result.current.updateAnnouncement('popup-one', { body: '自动保存后的正文' }))
    await waitFor(() => expect(result.current.announcementDraftStatus).toBe('saved'), { timeout: 1_500 })
    expect(readAnnouncementDraft('alice', window.localStorage).draft?.announcements[0].body).toBe('自动保存后的正文')

    await act(async () => result.current.handleSaveAnnouncement(formEvent()))
    expect(result.current.notice).toBe('横幅和公告已发布')
    expect(result.current.announcementDraftDirty).toBe(false)
    expect(window.localStorage.getItem(announcementDraftStorageKey('alice'))).toBeNull()
    expect(adminApi.json).toHaveBeenCalledWith('/api/admin/announcement', expect.objectContaining({ method: 'PUT' }))
  })

  it('keeps drafts isolated when another administrator logs in', async () => {
    const { result } = renderHook(() => useAdminController())
    await waitForHydration(result)

    act(() => result.current.updateBanner({ title: 'Alice 的本机草稿' }))
    act(() => window.dispatchEvent(new Event('goofish:admin-session-expired')))
    expect(readAnnouncementDraft('alice', window.localStorage).draft?.banner.title).toBe('Alice 的本机草稿')

    sessionUsername = 'bob'
    act(() => {
      result.current.setLoginUser('bob')
      result.current.setLoginPassword('password')
    })
    await act(async () => result.current.handleLogin(formEvent()))
    await waitFor(() => expect(result.current.adminUsername).toBe('bob'))
    await waitFor(() => expect(result.current.banner.title).toBe('线上横幅'))
    expect(result.current.announcementDraftDirty).toBe(false)
    expect(readAnnouncementDraft('alice', window.localStorage).draft?.banner.title).toBe('Alice 的本机草稿')
    expect(readAnnouncementDraft('bob', window.localStorage).draft).toBeNull()
  })

  it('keeps a local draft when publishing fails and removes it after reverting to the server baseline', async () => {
    const { result } = renderHook(() => useAdminController())
    await waitForHydration(result)

    act(() => result.current.updateBanner({ title: '尚未发布的草稿' }))
    failAnnouncementPut = true
    await act(async () => result.current.handleSaveAnnouncement(formEvent()))
    expect(result.current.error).toBe('发布服务不可用')
    expect(readAnnouncementDraft('alice', window.localStorage).draft?.banner.title).toBe('尚未发布的草稿')

    act(() => result.current.updateBanner({ title: '线上横幅' }))
    await waitFor(() => expect(result.current.announcementDraftStatus).toBe('clean'))
    expect(window.localStorage.getItem(announcementDraftStorageKey('alice'))).toBeNull()
  })

  it('restores a conflicting draft and discards it only after reloading the server version', async () => {
    const draftBanner = { ...serverAnnouncements.banner!, title: '本机冲突草稿' }
    writeAnnouncementDraft('alice', 'older-server-revision', {
      banner: draftBanner,
      announcements: serverAnnouncements.announcements,
    }, window.localStorage, '2026-07-24T13:00:00.000Z')

    const { result } = renderHook(() => useAdminController())
    await waitFor(() => expect(result.current.banner.title).toBe('本机冲突草稿'))
    expect(result.current.announcementDraftConflict).toBe(true)
    expect(result.current.announcementDraftRestored).toBe(true)

    vi.mocked(window.confirm).mockReturnValueOnce(false)
    await act(async () => result.current.handleSaveAnnouncement(formEvent()))
    expect(adminApi.json.mock.calls.some(([url, init]) => url === '/api/admin/announcement' && init?.method === 'PUT')).toBe(false)

    failAnnouncementGet = true
    await act(async () => result.current.handleDiscardAnnouncementDraft())
    expect(result.current.error).toBe('线上公告加载失败')
    expect(result.current.banner.title).toBe('本机冲突草稿')
    expect(window.localStorage.getItem(announcementDraftStorageKey('alice'))).not.toBeNull()

    failAnnouncementGet = false
    await act(async () => result.current.handleDiscardAnnouncementDraft())
    expect(result.current.banner.title).toBe('线上横幅')
    expect(result.current.announcementDraftDirty).toBe(false)
    expect(result.current.notice).toContain('已重新载入线上公告')
    expect(window.localStorage.getItem(announcementDraftStorageKey('alice'))).toBeNull()
  })
})

async function waitForHydration(result: { current: ReturnType<typeof useAdminController> }) {
  await waitFor(() => expect(result.current.authenticated).toBe(true))
  await waitFor(() => expect(result.current.banner.title).toBe('线上横幅'))
}

function formEvent(): FormEvent {
  return { preventDefault: vi.fn() } as unknown as FormEvent
}

function createServerAnnouncements(): AnnouncementAdminResponse {
  const banner = createAnnouncement('banner-one', 'banner', '线上横幅', '线上横幅正文', '2026-07-24T10:00:00.000Z')
  const announcements = [
    createAnnouncement('popup-one', 'popup', '线上公告', '线上公告正文', '2026-07-24T11:00:00.000Z'),
  ]
  return { banner, announcements, stats: {} }
}

function createAnnouncement(
  id: string,
  kind: Announcement['kind'],
  title: string,
  body: string,
  updatedAt: string,
): Announcement {
  return {
    id,
    kind,
    active: true,
    title,
    body,
    created_at: updatedAt,
    updated_at: updatedAt,
  }
}
