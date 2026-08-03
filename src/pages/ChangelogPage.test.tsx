// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'
import App from '../App'
import { copy } from '../copy/index'

afterEach(() => cleanup())

describe('ChangelogPage', () => {
  it('describes the baseline release as the first public changelog version', () => {
    expect(copy.public.pages_ChangelogPage_019).toBe('这是首个公开更新日志版本；后续版本将记录自上一正式发布以来面向用户的改动。')
  })

  it('renders the static release details from the public route', async () => {
    render(<MemoryRouter initialEntries={['/changelog']}><App /></MemoryRouter>)

    expect(await screen.findByRole('heading', { name: '更新日志' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '前端 v2.0.435 · 后端 v2.0.435' })).toBeInTheDocument()
    expect(screen.getByText('发布日期：2026-07-23')).toBeInTheDocument()

    for (const sectionTitle of ['排班准确性与稳定性', '账号与个人使用', '工作区体验']) {
      expect(screen.getByRole('heading', { name: sectionTitle })).toBeInTheDocument()
    }
    expect(screen.queryByText('管理端现可下载死信任务载荷 JSON，便于定位和处理异常任务。')).not.toBeInTheDocument()

    expect(screen.getByRole('link', { name: '返回首页' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: '返回首页' })).toHaveClass('hidden', 'sm:inline-flex')
    expect(screen.getByRole('link', { name: '更新日志' })).toHaveAttribute('href', '/changelog')
  })
})
