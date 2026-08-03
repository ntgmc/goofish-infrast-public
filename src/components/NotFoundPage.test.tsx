// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'
import NotFoundPage from './NotFoundPage'

afterEach(cleanup)

describe('NotFoundPage', () => {
  it('preserves the missing path and provides accessible recovery links', () => {
    render(<MemoryRouter initialEntries={['/missing/resource']}><NotFoundPage /></MemoryRouter>)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('这个链接暂时没有对应页面')
    expect(screen.getByText('/missing/resource')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: '页面导航' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '返回首页' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: '进入工作台' })).toHaveAttribute('href', '/tool/profiles')
  })
})
