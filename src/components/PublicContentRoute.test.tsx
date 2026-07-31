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
    expect(screen.getByText('正在加载最新站点内容，当前暂时显示内置内容。')).toBeInTheDocument()
    await act(async () => resolveRequest(cloneDefaultPublicContentSettings()))
    expect(screen.queryByText('正在加载最新站点内容，当前暂时显示内置内容。')).not.toBeInTheDocument()
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
    expect(await screen.findByText(/当前显示内置默认内容/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重新加载' }))
    expect(await screen.findByText('pricing')).toBeInTheDocument()
    expect(screen.queryByText(/当前显示内置默认内容/)).not.toBeInTheDocument()
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
    expect(await screen.findByText('刷新失败，当前显示上次成功加载的内容。')).toBeInTheDocument()
    expect(screen.getByText('123456789')).toBeInTheDocument()
  })
})

function RefreshProbe() {
  const { content, refresh } = usePublicContent()
  return <main><span>{content.qq_group.number}</span><button type="button" onClick={() => void refresh()}>refresh content</button></main>
}
