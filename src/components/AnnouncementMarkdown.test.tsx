// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AnnouncementBodyEditor, { MAX_ANNOUNCEMENT_BODY_LENGTH } from './AnnouncementBodyEditor'
import AnnouncementMarkdown from './AnnouncementMarkdown'

afterEach(cleanup)

describe('AnnouncementMarkdown', () => {
  it('renders common Markdown and GFM content', () => {
    render(<MemoryRouter><AnnouncementMarkdown>{'# 标题\n\n**重点**和[链接](https://example.com)\n\n- 第一项\n- 第二项\n\n| 名称 | 状态 |\n| --- | --- |\n| 公告 | 已发布 |\n\n`代码`'}</AnnouncementMarkdown></MemoryRouter>)

    expect(screen.getByRole('heading', { name: '标题' })).toBeInTheDocument()
    expect(screen.getByText('重点').tagName).toBe('STRONG')
    expect(screen.getByRole('link', { name: '链接' })).toHaveAttribute('href', 'https://example.com')
    expect(screen.getByRole('link', { name: '链接' })).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link', { name: '链接' })).toHaveAttribute('rel', 'noreferrer')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText('代码').tagName).toBe('CODE')
  })

  it('does not render raw HTML', () => {
    render(<MemoryRouter><AnnouncementMarkdown>{'<img src="/unsafe.png" onerror="alert(1)" />'}</AnnouncementMarkdown></MemoryRouter>)

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('uses client-side navigation for app routes and preserves search and hash', async () => {
    const onInternalNavigate = vi.fn()
    const router = createMemoryRouter([{
      path: '*',
      element: <AnnouncementMarkdown onInternalNavigate={onInternalNavigate}>{'[打开背包](/tool/inventory?source=announcement#items)'}</AnnouncementMarkdown>,
    }], { initialEntries: ['/announcements'] })
    render(<RouterProvider router={router} />)

    const link = screen.getByRole('link', { name: '打开背包' })
    expect(link).not.toHaveAttribute('target')
    fireEvent.click(link)

    await waitFor(() => expect(router.state.location.pathname).toBe('/tool/inventory'))
    expect(router.state.location.search).toBe('?source=announcement')
    expect(router.state.location.hash).toBe('#items')
    expect(onInternalNavigate).toHaveBeenCalledOnce()
  })

  it('keeps non-page root paths and protocol-relative URLs as external navigation', () => {
    render(
      <MemoryRouter>
        <AnnouncementMarkdown>{'[下载](/downloads/guide.pdf)\n\n[镜像](//example.com/tool/inventory)'}</AnnouncementMarkdown>
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: '下载' })).toHaveAttribute('target', '_blank')
    expect(screen.getByRole('link', { name: '镜像' })).toHaveAttribute('target', '_blank')
  })
})

describe('AnnouncementBodyEditor', () => {
  it('switches between the mobile-safe editor and Markdown preview', async () => {
    const value = '# 公告\n\n正文内容'
    render(<AnnouncementBodyEditor id="announcement-one" value={value} onChange={() => undefined} />)

    const textarea = screen.getByRole('textbox')
    expect(textarea).toHaveAttribute('maxLength', String(MAX_ANNOUNCEMENT_BODY_LENGTH))
    expect(textarea).toHaveClass('max-h-[50dvh]', 'overflow-y-auto', 'resize-y')
    expect(screen.getByText('10 / 5,000 字符')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '预览' }))

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '公告' })).toBeInTheDocument()
  })
})
