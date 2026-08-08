// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import ToolBreadcrumbs from './ToolBreadcrumbs'

afterEach(() => cleanup())

describe('ToolBreadcrumbs', () => {
  it('renders linked ancestors and an accessible current page', () => {
    render(
      <MemoryRouter>
        <ToolBreadcrumbs
          items={[
            { id: 'home', label: '首页', to: '/' },
            { id: 'profiles', label: '游戏账号', to: '/tool/profiles' },
            { id: 'profile', label: '高级账号', to: '/tool/profiles?profile_id=profile-1' },
            { id: 'current', label: '干员数据' },
          ]}
        />
      </MemoryRouter>,
    )

    const breadcrumb = screen.getByRole('navigation', { name: '面包屑' })
    expect(within(breadcrumb).getByRole('link', { name: '首页' })).toHaveAttribute('href', '/')
    expect(within(breadcrumb).getByRole('link', { name: '游戏账号' })).toHaveAttribute('href', '/tool/profiles')
    expect(within(breadcrumb).getByRole('link', { name: '高级账号' })).toHaveAttribute('href', '/tool/profiles?profile_id=profile-1')
    expect(within(breadcrumb).getByText('干员数据')).toHaveAttribute('aria-current', 'page')
    expect(within(breadcrumb).queryByRole('link', { name: '干员数据' })).not.toBeInTheDocument()
    expect(breadcrumb.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3)
  })

  it('keeps long labels inspectable when the visual label is truncated', () => {
    const longLabel = '这是一个非常长的游戏账号档案名称'
    render(
      <MemoryRouter>
        <ToolBreadcrumbs items={[{ id: 'profile', label: longLabel }]} />
      </MemoryRouter>,
    )

    const current = screen.getByText(longLabel)
    expect(current).toHaveAttribute('title', longLabel)
    expect(current).toHaveClass('truncate', 'max-w-[16rem]')
  })
})
