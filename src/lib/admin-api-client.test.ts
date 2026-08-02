// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ADMIN_SESSION_EXPIRED_EVENT, adminApiBlob } from './admin-api-client'

describe('adminApiBlob', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the successful response body as a blob', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('workspace export', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const blob = await adminApiBlob('/api/admin/users?include=workspaces')

    expect(await blob.text()).toBe('workspace export')
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/users?include=workspaces', expect.objectContaining({
      headers: expect.any(Headers),
    }))
  })

  it('notifies the application when the administrator session has expired', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: '管理员会话已失效。' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }))
    const expired = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    window.addEventListener(ADMIN_SESSION_EXPIRED_EVENT, expired, { once: true })

    await expect(adminApiBlob('/api/admin/users?include=workspaces')).rejects.toMatchObject({ status: 401 })
    expect(expired).toHaveBeenCalledOnce()
  })
})
