// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import VerifyEmailPage from './VerifyEmailPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('VerifyEmailPage', () => {
  it('verifies the token and automatically enters the workspace', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      user: { id: 'user-1', email: 'verified@example.com' },
      profiles: [],
      active_profile: null,
      workspace: null,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <MemoryRouter initialEntries={['/verify-email?token=valid-token']}>
        <Routes>
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/tool/profiles" element={<div>账号工作台</div>} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('邮箱验证成功，正在进入工作台。')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/verify-email', expect.objectContaining({ method: 'POST' }))
    expect(await screen.findByText('账号工作台')).toBeInTheDocument()
  })

  it('shares one in-flight POST across StrictMode effect replay', async () => {
    let resolveRequest!: (response: Response) => void
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((resolve) => { resolveRequest = resolve }))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/verify-email?token=strict-token']}>
          <VerifyEmailPage />
        </MemoryRouter>
      </StrictMode>,
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    resolveRequest(successResponse())
    expect(await screen.findByText('邮箱验证成功，正在进入工作台。')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('starts a new request after a failed verification is retried manually', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: '验证链接暂时失败。' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(successResponse())
    vi.stubGlobal('fetch', fetchMock)
    const user = userEvent.setup()

    render(
      <MemoryRouter initialEntries={['/verify-email?token=retry-token']}>
        <VerifyEmailPage />
      </MemoryRouter>,
    )

    await user.click(await screen.findByRole('button', { name: '重试验证' }))
    expect(await screen.findByText('邮箱验证成功，正在进入工作台。')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

function successResponse(): Response {
  return new Response(JSON.stringify({
    user: { id: 'user-1', email: 'verified@example.com' },
    profiles: [],
    active_profile: null,
    workspace: null,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
