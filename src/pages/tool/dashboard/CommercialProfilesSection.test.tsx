// @vitest-environment jsdom
import { useQueryClient } from '@tanstack/react-query'
import { act, cleanup, render, renderHook, screen, waitFor } from '../../../test/query-render'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserGameAccount } from '../../../lib/types'

const mocks = vi.hoisted(() => ({ apiJson: vi.fn() }))

vi.mock('../../../lib/api-client', () => ({
  apiJson: mocks.apiJson,
  getApiErrorMessage: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback,
}))

import CommercialProfilesSection, { useCommercialProfiles } from './CommercialProfilesSection'
import { Commercial } from '../../v2/pages/Billing'

const limits = {
  active: 2,
  total: 2,
  active_limit: 100,
  total_limit: 1000,
  suspended: false,
  suspension_reason: null,
  revision: 1,
  as_of: '2026-08-02T00:00:00.000Z',
  inflight_jobs: 0,
  inflight_reserved: '0.00',
}

const profiles = [profile('commercial-1', '甲账号', '甲备注'), profile('commercial-2', '乙账号', '乙备注')]

beforeEach(() => {
  mocks.apiJson.mockReset()
  vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'batch-operation-1') })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('CommercialProfilesSection request boundaries', () => {
  it.each(['v1', 'v2'])('does not search while typing and requests only after form submission in %s', async (version) => {
    mocks.apiJson.mockResolvedValue(page(profiles))
    const user = userEvent.setup()
    render(version === 'v1'
      ? <CommercialProfilesSection userId="user-1" activeProfileId="profile-1" onOpen={vi.fn()} />
      : <Commercial userId="user-1" activeProfileId="profile-1" onOpen={vi.fn()} />)

    await screen.findByText('甲账号')
    await user.type(screen.getByRole('textbox'), '  乙账号  ')
    expect(mocks.apiJson).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: '搜索' }))
    await waitFor(() => expect(mocks.apiJson).toHaveBeenCalledTimes(2))
    expect(mocks.apiJson.mock.calls[1]?.[0]).toBe('/api/user/commercial/profiles?state=active&limit=20&q=%E4%B9%99%E8%B4%A6%E5%8F%B7')
  })

  it('discards a slow stale search response that arrives after the latest result', async () => {
    const slow = deferred<ReturnType<typeof page>>()
    const latest = deferred<ReturnType<typeof page>>()
    mocks.apiJson.mockImplementation((url: string) => {
      if (url.includes('q=%E6%97%A7')) return slow.promise
      if (url.includes('q=%E6%96%B0')) return latest.promise
      return Promise.resolve(page(profiles))
    })
    const user = userEvent.setup()
    render(<CommercialProfilesSection userId="user-1" activeProfileId="profile-1" onOpen={vi.fn()} />)
    await screen.findByText('甲账号')

    const search = screen.getByPlaceholderText('搜索名称或备注')
    await user.type(search, '旧')
    await user.click(screen.getByRole('button', { name: '搜索' }))
    await waitFor(() => expect(mocks.apiJson.mock.calls.some(([url]) => String(url).includes('q=%E6%97%A7'))).toBe(true))
    await user.clear(search)
    await user.type(search, '新')
    await user.click(screen.getByRole('button', { name: '搜索' }))
    await waitFor(() => expect(mocks.apiJson.mock.calls.some(([url]) => String(url).includes('q=%E6%96%B0'))).toBe(true))

    latest.resolve(page([profile('latest', '新结果', '')]))
    expect(await screen.findByText('新结果')).toBeInTheDocument()
    slow.resolve(page([profile('stale', '旧结果', '')]))
    await waitFor(() => expect(screen.queryByText('旧结果')).not.toBeInTheDocument())
    expect(screen.getByText('新结果')).toBeInTheDocument()
  })

  it('archives the selected profiles in one PATCH and reuses the operation id after an unknown result', async () => {
    mocks.apiJson
      .mockResolvedValueOnce(page(profiles))
      .mockRejectedValueOnce(new Error('网络结果未知'))
      .mockResolvedValueOnce({
        results: profiles.map((item) => ({ profile_id: item.id, status: 'archived' as const })),
        replayed: true,
      })
      .mockResolvedValueOnce(page([]))
    const user = userEvent.setup()
    render(<CommercialProfilesSection userId="user-1" activeProfileId="profile-1" onOpen={vi.fn()} />)
    await screen.findByText('甲账号')

    await user.click(screen.getByText('全选当前已加载档案'))
    await user.click(screen.getByRole('button', { name: '批量归档（2）' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('网络结果未知')
    await user.click(screen.getByRole('button', { name: '批量归档（2）' }))
    expect(await screen.findByText('已归档 2 个商用档案。')).toBeInTheDocument()

    const patchCalls = mocks.apiJson.mock.calls.filter(([url, init]) =>
      url === '/api/user/commercial/profiles' && init?.method === 'PATCH')
    expect(patchCalls).toHaveLength(2)
    expect(patchCalls[0]?.[1]?.json).toEqual({
      action: 'batch_archive',
      profile_ids: ['commercial-1', 'commercial-2'],
      operation_id: 'batch-operation-1',
    })
    expect(patchCalls[1]?.[1]?.json).toEqual(patchCalls[0]?.[1]?.json)
  })

  it('refreshes loaded pages using new cursors, deduplicates profiles and retains the last successful limits on failure', async () => {
    let refreshed = false
    mocks.apiJson.mockImplementation(async (url: string) => {
      if (url.includes('cursor=old')) return page([profiles[0]!, profiles[1]!])
      if (url.includes('cursor=new')) return { ...page([profile('third', '第三个账号', '')]), limits: { ...limits, revision: 2 } }
      return { ...page([refreshed ? profiles[1]! : profiles[0]!]), next_cursor: refreshed ? 'new' : 'old' }
    })
    const { result } = renderHook(() => useCommercialProfiles('user-1', 'profile-1'))
    await waitFor(() => expect(result.current.page?.next_cursor).toBe('old'))
    await act(async () => result.current.loadMore())
    expect(result.current.page?.profiles.map((item) => item.id)).toEqual(['commercial-1', 'commercial-2'])
    refreshed = true
    await act(async () => result.current.load())
    expect(result.current.page?.profiles.map((item) => item.id)).toEqual(['commercial-2', 'third'])
    expect(result.current.page?.limits.revision).toBe(2)
    expect(mocks.apiJson.mock.calls.map(([url]) => url)).toEqual([
      '/api/user/commercial/profiles?state=active&limit=20',
      '/api/user/commercial/profiles?state=active&limit=20&cursor=old',
      '/api/user/commercial/profiles?state=active&limit=20',
      '/api/user/commercial/profiles?state=active&limit=20&cursor=new',
    ])
    mocks.apiJson.mockRejectedValue(new Error('列表刷新失败'))
    await act(async () => result.current.load())
    await waitFor(() => expect(result.current.error).toBe('列表刷新失败'))
    expect(result.current.page?.profiles.map((item) => item.id)).toEqual(['commercial-2', 'third'])
    expect(result.current.page?.limits.revision).toBe(2)
    expect(mocks.apiJson).toHaveBeenCalledTimes(5)
  })

  it('cancels old identities, discards late responses and disables reads without a confirmed user', async () => {
    const requests: Array<{ signal: AbortSignal; finish: (value: ReturnType<typeof page>) => void }> = []
    mocks.apiJson.mockImplementation((_url, init) => new Promise((finish) => requests.push({ signal: init.signal, finish })))
    const { result, rerender, unmount } = renderHook(({ userId, profileId }) => useCommercialProfiles(userId, profileId), {
      initialProps: { userId: 'user-1', profileId: 'profile-1' },
    })
    rerender({ userId: 'user-1', profileId: 'profile-2' })
    expect(requests[0].signal.aborted).toBe(true)
    expect(result.current.page).toBeNull()
    rerender({ userId: 'user-2', profileId: 'profile-2' })
    expect(requests[1].signal.aborted).toBe(true)
    await act(async () => {
      requests[0].finish(page([profiles[0]!]))
      requests[1].finish(page([profiles[1]!]))
      requests[2].finish(page([profile('current', '当前账号', '')]))
    })
    await waitFor(() => expect(result.current.page?.profiles[0]?.id).toBe('current'))
    act(() => {
      result.current.setSelectedIds(new Set(['current']))
      result.current.setEditDraft({ profileId: 'current', displayName: '草稿', note: '' })
    })
    rerender({ userId: '', profileId: 'profile-2' })
    expect(result.current.page).toBeNull()
    expect(result.current.selectedIds.size).toBe(0)
    expect(result.current.editDraft).toBeNull()
    await act(async () => { await result.current.load(); await result.current.loadMore() })
    expect(mocks.apiJson).toHaveBeenCalledTimes(3)
    rerender({ userId: 'user-3', profileId: 'profile-3' })
    unmount()
    expect(requests[3].signal.aborted).toBe(true)
  })

  it('keeps active and archived caches separate, reuses fresh results and clears hidden selections', async () => {
    const pending = deferred<ReturnType<typeof page>>()
    mocks.apiJson.mockResolvedValueOnce(page(profiles)).mockReturnValueOnce(pending.promise)
    const { result } = renderHook(() => useCommercialProfiles('user-1', null))
    await waitFor(() => expect(result.current.page?.profiles).toHaveLength(2))
    act(() => result.current.setSelectedIds(new Set(['commercial-1'])))
    act(() => result.current.setState('archived'))
    expect(result.current.page).toBeNull()
    expect(result.current.selectedIds.size).toBe(0)
    await act(async () => pending.resolve(page([profile('archived', '已归档账号', '')])))
    await waitFor(() => expect(result.current.page?.profiles[0]?.id).toBe('archived'))
    act(() => result.current.setState('active'))
    expect(result.current.page?.profiles).toEqual(profiles)
    expect(mocks.apiJson).toHaveBeenCalledTimes(2)
  })

  it('invalidates other profile and search caches after editing while keeping other accounts isolated', async () => {
    const old = page(profiles)
    const updated = page([profile('commercial-1', '新名称', '新备注')])
    mocks.apiJson.mockResolvedValueOnce(old).mockResolvedValue(updated)
    const { result, rerender } = renderHook(({ profileId }) => ({
      model: useCommercialProfiles('user-1', profileId), client: useQueryClient(),
    }), { initialProps: { profileId: 'profile-1' } })
    await waitFor(() => expect(result.current.model.page?.profiles).toHaveLength(2))
    const otherProfile = ['user', 'user-1', 'profile-2', 'commercial-profiles', 'active', '']
    const archivedSearch = ['user', 'user-1', 'profile-1', 'commercial-profiles', 'archived', 'name']
    const otherUser = ['user', 'user-2', 'profile-1', 'commercial-profiles', 'active', '']
    for (const key of [otherProfile, archivedSearch, otherUser]) {
      result.current.client.setQueryData(key, { pages: [old], pageParams: [undefined] })
    }
    act(() => result.current.model.setEditDraft({ profileId: 'commercial-1', displayName: '新名称', note: '新备注' }))
    await act(async () => result.current.model.saveEdit())
    expect(result.current.client.getQueryState(otherProfile)?.isInvalidated).toBe(true)
    expect(result.current.client.getQueryState(archivedSearch)?.isInvalidated).toBe(true)
    expect(result.current.client.getQueryState(otherUser)?.isInvalidated).toBe(false)
    rerender({ profileId: 'profile-2' })
    await waitFor(() => expect(result.current.model.page?.profiles[0]?.display_name).toBe('新名称'))
  })

  it('keeps a successful batch notice after a failed read and retries only the list', async () => {
    let failReads = false
    mocks.apiJson.mockImplementation(async (_url, init) => {
      if (init?.method === 'PATCH') return { results: [{ profile_id: 'commercial-1', status: 'archived' }], replayed: false }
      if (failReads) throw new Error('读取暂时失败')
      return page(profiles)
    })
    const { result } = renderHook(() => useCommercialProfiles('user-1', 'profile-1'))
    await waitFor(() => expect(result.current.page?.profiles).toHaveLength(2))
    act(() => result.current.setSelectedIds(new Set(['commercial-1'])))
    failReads = true
    await act(async () => result.current.batchArchive())
    await waitFor(() => expect(result.current.error).toBe('读取暂时失败'))
    expect(result.current.notice).toBe('已归档 1 个商用档案。')
    expect(result.current.page?.profiles).toHaveLength(2)
    expect(result.current.selectedIds.size).toBe(0)
    failReads = false
    await act(async () => result.current.load())
    await waitFor(() => expect(result.current.error).toBeNull())
    expect(result.current.notice).toBe('已归档 1 个商用档案。')
    expect(mocks.apiJson.mock.calls.filter(([, init]) => init?.method === 'PATCH')).toHaveLength(1)
    expect(window.confirm).toHaveBeenCalledOnce()
  })

  it('saves inline name and note edits through action=update', async () => {
    mocks.apiJson
      .mockResolvedValueOnce(page([profiles[0]!]))
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(page([profile('commercial-1', '新名称', '新备注')]))
    const user = userEvent.setup()
    render(<CommercialProfilesSection userId="user-1" activeProfileId="profile-1" onOpen={vi.fn()} />)
    await screen.findByText('甲账号')

    await user.click(screen.getByRole('button', { name: '编辑' }))
    const name = screen.getByLabelText('档案名称')
    const note = screen.getByLabelText('备注')
    await user.clear(name)
    await user.type(name, ' 新名称 ')
    await user.clear(note)
    await user.type(note, ' 新备注 ')
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(mocks.apiJson).toHaveBeenCalledWith('/api/user/commercial/profiles', expect.objectContaining({
      method: 'PATCH',
      json: {
        profile_id: 'commercial-1',
        action: 'update',
        display_name: '新名称',
        note: '新备注',
      },
    })))
    expect(await screen.findByText('商用档案已更新。')).toBeInTheDocument()
  })
})

function profile(id: string, displayName: string, note: string): UserGameAccount {
  return {
    id,
    user_id: 'user-1',
    kind: 'metered_commercial',
    permission: 'metered_advanced',
    status: 'active',
    archived_at: null,
    cdk_order_hash: null,
    display_name: displayName,
    note,
    operator_count: 0,
    updated_at: '2026-08-02T00:00:00.000Z',
    created_at: '2026-08-01T00:00:00.000Z',
  }
}

function page(items: UserGameAccount[]) {
  return { profiles: items, next_cursor: null, limits: { ...limits, active: items.length, total: items.length } }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}
