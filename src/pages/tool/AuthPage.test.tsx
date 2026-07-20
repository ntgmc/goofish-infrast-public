// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import type { Announcement } from '../../lib/types'
import AuthPage from './AuthPage'

const announcement: Announcement = {
  id: 'banner-1',
  kind: 'banner',
  title: '维护公告',
  body: '今晚进行例行维护。',
  active: true,
  created_at: '2026-07-21T00:00:00.000Z',
  updated_at: '2026-07-21T00:00:00.000Z',
}

it('keeps the announcement above the centered authentication layout', () => {
  render(
    <MemoryRouter>
      <AuthPage announcement={announcement} onAuthenticated={vi.fn()} />
    </MemoryRouter>,
  )

  const banner = screen.getByRole('region', { name: '站内横幅' })
  const pageLayout = banner.parentElement
  const authLayout = banner.nextElementSibling
  const authPanel = screen.getByRole('region', { name: '账号登录与注册' })

  expect(pageLayout).toHaveClass('flex', 'flex-col', 'max-w-6xl')
  expect(banner).toHaveClass('mb-6', 'shrink-0')
  expect(authLayout).toHaveClass('grid', 'flex-1', 'lg:items-center')
  expect(authLayout).toContainElement(authPanel)
  expect(banner.closest('section.max-w-xl')).toBeNull()
})
