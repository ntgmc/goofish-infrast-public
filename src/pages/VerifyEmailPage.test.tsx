// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import VerifyEmailPage from './VerifyEmailPage'
import { rememberAuthReturn } from '../lib/auth-navigation'
import { copy } from '../copy'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.sessionStorage.clear()
})

describe('VerifyEmailPage', () => {
  it('verifies the token and offers an explicit workspace entry', async () => {
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
          <Route path="/v2" element={<div>账号工作台</div>} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText(copy.auth.pages_VerifyEmailPage_003)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/verify-email', expect.objectContaining({ method: 'POST' }))
    expect(screen.queryByText('账号工作台')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: copy.auth.enterWorkspace }))
    expect(await screen.findByText('账号工作台')).toBeInTheDocument()
  })

  it('resumes the first schedule after registration is verified in another tab', async () => {
    rememberAuthReturn('/v2?section=generation')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(successResponse()))
    render(<MemoryRouter initialEntries={['/verify-email?token=first-schedule-token']}><Routes>
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/v2" element={<div>继续生成第一份排班</div>} />
    </Routes></MemoryRouter>)
    expect(await screen.findByRole('link', { name: copy.auth.enterWorkspace })).toHaveAttribute('href', '/v2?section=generation')
    await userEvent.click(screen.getByRole('link', { name: copy.auth.enterWorkspace }))
    expect(await screen.findByText('继续生成第一份排班')).toBeInTheDocument()
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
    expect(await screen.findByText(copy.auth.pages_VerifyEmailPage_003)).toBeInTheDocument()
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
    expect(await screen.findByText(copy.auth.pages_VerifyEmailPage_003)).toBeInTheDocument()
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
