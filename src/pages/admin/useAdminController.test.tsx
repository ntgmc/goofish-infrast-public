// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FormEvent } from 'react'
import type { Announcement, AnnouncementAdminResponse } from '../../lib/types'
import type { AdminProfileSummary, AdminUserDetail } from './contracts'
import {
  announcementDraftStorageKey,
  readAnnouncementDraft,
  writeAnnouncementDraft,
} from './announcements/announcement-draft'
import { useAdminController } from './useAdminController'

const adminApi = vi.hoisted(() => ({
  blob: vi.fn(),
  json: vi.fn(),
  void: vi.fn(),
}))
const requestAdminOperationReason = vi.hoisted(() => vi.fn())

vi.mock('../../lib/admin-api-client', () => ({
  ADMIN_SESSION_EXPIRED_EVENT: 'goofish:admin-session-expired',
  adminApiBlob: adminApi.blob,
  adminApiJson: adminApi.json,
  adminApiVoid: adminApi.void,
}))
vi.mock('../../lib/admin-operation-reason', () => ({ requestAdminOperationReason }))

let serverAnnouncements: AnnouncementAdminResponse
let sessionUsername: string
let failAnnouncementGet: boolean
let failAnnouncementPut: boolean
let failCdkPageGet: boolean
let usageVisits: number
let deferredUsageResponses: Array<ReturnType<typeof deferred<unknown>>>

describe('useAdminController announcement drafts', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.stubGlobal('prompt', vi.fn(() => '工单 OPS-103 管理员操作'))
    requestAdminOperationReason.mockReset().mockResolvedValue('工单 OPS-103 管理员操作')
    serverAnnouncements = createServerAnnouncements()
    sessionUsername = 'alice'
    failAnnouncementGet = false
    failAnnouncementPut = false
    failCdkPageGet = false
    usageVisits = 0
    deferredUsageResponses = []
    adminApi.blob.mockReset().mockResolvedValue(new Blob(['workspace export'], { type: 'application/json' }))
    adminApi.void.mockReset().mockResolvedValue(undefined)
    adminApi.json.mockReset().mockImplementation(async (url: string, init?: { method?: string; json?: unknown }) => {
      if (url === '/api/admin/session') return {
        user: {
          username: sessionUsername,
          role: 'security_admin',
          capabilities: [
            'risk_view',
            'risk_review',
            'risk_config',
            'usage_view',
            'user_view',
            'sensitive_data_view',
            'user_manage',
            'user_delete',
            'optimization_view',
            'optimization_manage',
            'admin_manage',
          ],
          authenticated_at: '2026-08-03T00:00:00.000Z',
        },
      }
      if (url === '/api/admin/announcement') {
        if (init?.method === 'PUT') {
          if (failAnnouncementPut) throw new Error('发布服务不可用')
          const payload = init.json as Pick<AnnouncementAdminResponse, 'banner' | 'announcements'> & { expected_revision: number }
          if (payload.expected_revision !== serverAnnouncements.revision) throw new Error('公告版本冲突')
          serverAnnouncements = {
            banner: payload.banner,
            announcements: payload.announcements,
            revision: serverAnnouncements.revision + 1,
            stats: {},
          }
        }
        if (!init?.method && failAnnouncementGet) throw new Error('线上公告加载失败')
        return serverAnnouncements
      }
      if (url.startsWith('/api/admin/usage-stats')) {
        const pending = deferredUsageResponses.shift()
        if (pending) return pending.promise
        return { totals: { visits: usageVisits } }
      }
      if (url === '/api/admin/risk-settings') return {}
      if (url.startsWith('/api/admin/cdk')) {
        if (failCdkPageGet && url.includes('page=')) throw new Error('CDK 列表刷新失败')
        return {}
      }
      if (url.startsWith('/api/admin/users')) return {}
      throw new Error(`Unexpected admin API request: ${url}`)
    })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('defaults profile CDK generation to advanced permission', () => {
    const { result } = renderHook(() => useAdminController())

    expect(result.current.cdkType).toBe('profile')
    expect(result.current.permission).toBe('advanced')
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

  it('warns that clearing a Skland binding also resets the operator baseline', async () => {
    const { result } = renderHook(() => useAdminController())
    await waitForHydration(result)
    const profile = { id: 'profile-1', display_name: 'B 账号' } as AdminProfileSummary
    act(() => result.current.setSelectedUserDetail({ user: { id: 'user-1' } } as AdminUserDetail))

    await act(async () => result.current.handleClearProfileSklandBinding(profile))

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('旧干员基线也会重置'))
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('下一次有效导入将自动成为新基线'))
    expect(adminApi.json).toHaveBeenCalledWith('/api/admin/users', expect.objectContaining({
      method: 'PATCH',
      json: expect.objectContaining({
        action: 'clear_profile_skland_binding',
        profile_id: 'profile-1',
        reason: '工单 OPS-103 管理员操作',
      }),
    }))
  })

  it('downloads the selected user workspace export with isolated busy and notice state', async () => {
    const createObjectURL = vi.fn(() => 'blob:workspace-export')
    const revokeObjectURL = vi.fn()
    let downloadedFilename = ''
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloadedFilename = this.download
    })
    let resolveBlob!: (blob: Blob) => void
    adminApi.blob.mockReturnValueOnce(new Promise<Blob>((resolve) => {
      resolveBlob = resolve
    }))
    const { result } = renderHook(() => useAdminController())
    await waitForHydration(result)
    act(() => result.current.setSelectedUserDetail({ user: { id: 'user-123456789' } } as AdminUserDetail))

    let download!: Promise<void>
    act(() => {
      download = result.current.handleDownloadUserWorkspaces()
    })
    expect(result.current.busyAction).toBe('user-workspaces-export:user-123456789')
    expect(adminApi.blob).toHaveBeenCalledWith(
      '/api/admin/users?user_id=user-123456789&include=workspaces',
      { fallbackMessage: '导出完整工作区数据失败' },
    )

    await act(async () => {
      resolveBlob(new Blob(['workspace export'], { type: 'application/json' }))
      await download
    })

    expect(downloadedFilename).toMatch(/^maa-user-workspaces-user-123-\d{8}-\d{6}\.json$/)
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:workspace-export')
    expect(result.current.busyAction).toBeNull()
    expect(result.current.error).toBeNull()
    expect(result.current.notice).toBe('已开始下载完整工作区数据')
  })

  it('shows an export error without generating a download', async () => {
    adminApi.blob.mockRejectedValueOnce(new Error('导出服务不可用'))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const { result } = renderHook(() => useAdminController())
    await waitForHydration(result)
    act(() => result.current.setSelectedUserDetail({ user: { id: 'user-1' } } as AdminUserDetail))

    await act(async () => result.current.handleDownloadUserWorkspaces())

    expect(click).not.toHaveBeenCalled()
    expect(result.current.busyAction).toBeNull()
    expect(result.current.notice).toBeNull()
    expect(result.current.error).toBe('导出服务不可用')
  })

  it('revokes selected CDKs with one batch request', async () => {
    const firstHash = 'a'.repeat(64)
    const secondHash = 'b'.repeat(64)
    const records = [adminCdkRecord(firstHash), adminCdkRecord(secondHash)]
    const originalImplementation = adminApi.json.getMockImplementation()!
    adminApi.json.mockImplementation(async (url: string, init?: { method?: string; json?: unknown }) => {
      if (url === '/api/admin/cdk' && init?.method === 'PATCH') {
        return {
          succeeded: 2,
          failed: 0,
          results: records.map((record) => ({ code_hash: record.code_hash, ok: true })),
        }
      }
      if (url.startsWith('/api/admin/cdk?') && !url.includes('view=summary') && !url.includes('view=risk')) {
        return { cdks: records, pagination: { page: 1, page_size: 25, total: 2, total_pages: 1 } }
      }
      return originalImplementation(url, init)
    })
    const { result } = renderHook(() => useAdminController())
    await waitForHydration(result)
    await waitFor(() => expect(result.current.visibleRecords).toHaveLength(2))
    act(() => result.current.setSelectedCdkHashes([firstHash, secondHash]))

    await act(async () => result.current.handleBulkRevoke())

    const batchCalls = adminApi.json.mock.calls.filter(([url, init]) => url === '/api/admin/cdk' && init?.method === 'PATCH')
    expect(batchCalls).toHaveLength(1)
    expect(batchCalls[0]?.[1]).toMatchObject({
      json: { action: 'revoke', code_hashes: [firstHash, secondHash] },
    })
  })

  it('keeps successful overview blocks when another block fails', async () => {
    const { result } = renderHook(() => useAdminController())
    await waitForHydration(result)
    usageVisits = 42
    failAnnouncementGet = true

    await act(async () => result.current.loadDashboard())

    expect(result.current.usageStats?.totals.visits).toBe(42)
    expect(result.current.banner.title).toBe('线上横幅')
    expect(result.current.overviewPartialFailure).toBe(true)
    expect(result.current.lastSuccessfulSyncAt).not.toBeNull()
    expect(result.current.error).toContain('部分概览数据刷新失败')
    expect(result.current.error).toContain('线上公告加载失败')
  })

  it('does not let an older overview response overwrite a newer range response', async () => {
    const { result } = renderHook(() => useAdminController())
    await waitForHydration(result)
    const older = deferred<unknown>()
    const newer = deferred<unknown>()
    deferredUsageResponses.push(older, newer)

    let olderLoad!: Promise<void>
    let newerLoad!: Promise<void>
    act(() => {
      olderLoad = result.current.loadDashboard()
      newerLoad = result.current.loadDashboard()
    })
    await act(async () => {
      newer.resolve({ totals: { visits: 22 } })
      await newerLoad
    })
    await act(async () => {
      older.resolve({ totals: { visits: 11 } })
      await olderLoad
    })

    expect(result.current.usageStats?.totals.visits).toBe(22)
  })

  it('reports a successful user mutation separately from a failed background refresh', async () => {
    const { result } = renderHook(() => useAdminController())
    await waitForHydration(result)
    failCdkPageGet = true
    const target = {
      id: 'user-1',
      email: 'user@example.test',
      status: 'active',
    } as Parameters<typeof result.current.handleFreezeAppUser>[0]

    await act(async () => result.current.handleFreezeAppUser(target))

    expect(adminApi.json).toHaveBeenCalledWith('/api/admin/users', expect.objectContaining({
      method: 'PATCH',
      json: expect.objectContaining({
        action: 'freeze_account',
        reason: '工单 OPS-103 管理员操作',
      }),
    }))
    expect(result.current.notice).toContain('已冻结账号：user@example.test')
    expect(result.current.notice).toContain('操作已成功，但部分数据刷新失败')
    expect(result.current.error).toContain('CDK 列表刷新失败')
  })
})

async function waitForHydration(result: { current: ReturnType<typeof useAdminController> }) {
  await waitFor(() => expect(result.current.authenticated).toBe(true))
  await waitFor(() => expect(result.current.banner.title).toBe('线上横幅'))
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function formEvent(): FormEvent {
  return { preventDefault: vi.fn() } as unknown as FormEvent
}

function createServerAnnouncements(): AnnouncementAdminResponse {
  const banner = createAnnouncement('banner-one', 'banner', '线上横幅', '线上横幅正文', '2026-07-24T10:00:00.000Z')
  const announcements = [
    createAnnouncement('popup-one', 'popup', '线上公告', '线上公告正文', '2026-07-24T11:00:00.000Z'),
  ]
  return { banner, announcements, revision: 1, stats: {} }
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

function adminCdkRecord(codeHash: string) {
  return {
    code_hash: codeHash,
    cdk_id: codeHash.slice(0, 12),
    cdk_type: 'profile' as const,
    permission: 'growth' as const,
    amount: null,
    status: 'used' as const,
    created_at: '2026-01-01T00:00:00.000Z',
    used_at: '2026-01-02T00:00:00.000Z',
    revoked_at: null,
    order_note: null,
    license_order_hash: null,
    operator_count: null,
    config_desc: null,
  }
}
