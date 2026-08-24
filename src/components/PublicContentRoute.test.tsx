// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import { cloneDefaultPublicContentSettings } from '../lib/public-content'

const apiJson = vi.hoisted(() => vi.fn())
vi.mock('../lib/api-client', () => ({ apiJson }))

import PublicContentRoute from './PublicContentRoute'
import { usePublicContent } from '../lib/public-content-context'

describe('PublicContentRoute', () => {
  beforeEach(() => apiJson.mockReset())
  afterEach(() => cleanup())

  it('shows bundled-content loading feedback until the first request succeeds', async () => {
    let resolveRequest!: (value: ReturnType<typeof cloneDefaultPublicContentSettings>) => void
    apiJson.mockReturnValue(new Promise((resolve) => { resolveRequest = resolve }))
    render(
      <MemoryRouter initialEntries={['/pricing']}>
        <Routes>
          <Route element={<PublicContentRoute />}>
            <Route path="/pricing" element={<main>pricing</main>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('最新页面内容正在加载，部分信息可能稍后更新。')).toBeInTheDocument()
    await act(async () => resolveRequest(cloneDefaultPublicContentSettings()))
    expect(screen.queryByText('最新页面内容正在加载，部分信息可能稍后更新。')).not.toBeInTheDocument()
  })

  it('shows bundled-content fallback feedback and retries', async () => {
    const user = userEvent.setup()
    apiJson.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(cloneDefaultPublicContentSettings())
    render(
      <MemoryRouter initialEntries={['/pricing']}>
        <Routes>
          <Route element={<PublicContentRoute />}>
            <Route path="/pricing" element={<main>pricing</main>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText(/最新页面内容暂时无法加载/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重新加载' }))
    expect(await screen.findByText('pricing')).toBeInTheDocument()
    expect(screen.queryByText(/最新页面内容暂时无法加载/)).not.toBeInTheDocument()
  })

  it('shows cached-content feedback and retains remote content when refresh fails', async () => {
    const user = userEvent.setup()
    const remote = cloneDefaultPublicContentSettings()
    remote.qq_group.number = '123456789'
    apiJson.mockResolvedValueOnce(remote).mockRejectedValueOnce(new Error('offline'))
    render(
      <MemoryRouter initialEntries={['/pricing']}>
        <Routes>
          <Route element={<PublicContentRoute />}>
            <Route path="/pricing" element={<RefreshProbe />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('123456789')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'refresh content' }))
    expect(await screen.findByText('页面内容暂时无法更新，当前信息可继续查看。')).toBeInTheDocument()
    expect(screen.getByText('123456789')).toBeInTheDocument()
  })
})

function RefreshProbe() {
  const { content, refresh } = usePublicContent()
  return <main><span>{content.qq_group.number}</span><button type="button" onClick={() => void refresh()}>refresh content</button></main>
}
