// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import AnnouncementBodyEditor, { MAX_ANNOUNCEMENT_BODY_LENGTH } from './AnnouncementBodyEditor'
import AnnouncementMarkdown from './AnnouncementMarkdown'

afterEach(cleanup)

describe('AnnouncementMarkdown', () => {
  it('renders common Markdown and GFM content', () => {
    render(<AnnouncementMarkdown>{'# 标题\n\n**重点**和[链接](https://example.com)\n\n- 第一项\n- 第二项\n\n| 名称 | 状态 |\n| --- | --- |\n| 公告 | 已发布 |\n\n`代码`'}</AnnouncementMarkdown>)

    expect(screen.getByRole('heading', { name: '标题' })).toBeInTheDocument()
    expect(screen.getByText('重点').tagName).toBe('STRONG')
    expect(screen.getByRole('link', { name: '链接' })).toHaveAttribute('href', 'https://example.com')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText('代码').tagName).toBe('CODE')
  })

  it('does not render raw HTML', () => {
    render(<AnnouncementMarkdown>{'<img src="/unsafe.png" onerror="alert(1)" />'}</AnnouncementMarkdown>)

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
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
