// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import VerifyEmailPage from './VerifyEmailPage'
import { FIRST_SCHEDULE_INTENT_KEY } from '../lib/first-schedule'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.localStorage.removeItem(FIRST_SCHEDULE_INTENT_KEY)
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

  it('resumes the first schedule after registration is verified in another tab', async () => {
    window.localStorage.setItem(FIRST_SCHEDULE_INTENT_KEY, 'true')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(successResponse()))
    render(<MemoryRouter initialEntries={['/verify-email?token=first-schedule-token']}><Routes>
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/v2" element={<div>继续生成第一份排班</div>} />
    </Routes></MemoryRouter>)
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
