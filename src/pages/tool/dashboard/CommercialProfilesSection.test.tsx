// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserGameAccount } from '../../../lib/types'

const mocks = vi.hoisted(() => ({ apiJson: vi.fn() }))

vi.mock('../../../lib/api-client', () => ({
  apiJson: mocks.apiJson,
  getApiErrorMessage: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback,
}))

import CommercialProfilesSection from './CommercialProfilesSection'

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
  it('does not search while typing and requests only after form submission', async () => {
    mocks.apiJson.mockResolvedValue(page(profiles))
    const user = userEvent.setup()
    render(<CommercialProfilesSection onOpen={vi.fn()} />)

    await screen.findByText('甲账号')
    await user.type(screen.getByPlaceholderText('搜索名称或备注'), '  乙账号  ')
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
    render(<CommercialProfilesSection onOpen={vi.fn()} />)
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
    render(<CommercialProfilesSection onOpen={vi.fn()} />)
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

  it('saves inline name and note edits through action=update', async () => {
    mocks.apiJson
      .mockResolvedValueOnce(page([profiles[0]!]))
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(page([profile('commercial-1', '新名称', '新备注')]))
    const user = userEvent.setup()
    render(<CommercialProfilesSection onOpen={vi.fn()} />)
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
