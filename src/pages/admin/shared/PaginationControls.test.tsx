// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PaginationControls } from './PaginationControls'

afterEach(cleanup)

describe('PaginationControls', () => {
  it('renders compact page navigation and reports page changes', async () => {
    const onPageChange = vi.fn()
    render(<PaginationControls pagination={{ page: 5, page_size: 25, total: 300, total_pages: 12 }} loading={false} onPageChange={onPageChange} onPageSizeChange={vi.fn()} />)
    expect(screen.getByText('共 300 条 · 第 5/12 页')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '第 5 页' })).toHaveAttribute('aria-current', 'page')
    await userEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(onPageChange).toHaveBeenCalledWith(6)
  })

  it('disables navigation for an empty result', () => {
    render(<PaginationControls pagination={{ page: 1, page_size: 25, total: 0, total_pages: 0 }} loading={false} onPageChange={vi.fn()} onPageSizeChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: '首页' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled()
  })
})
