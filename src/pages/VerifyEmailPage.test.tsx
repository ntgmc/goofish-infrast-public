// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
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
})
