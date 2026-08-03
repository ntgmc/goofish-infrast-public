// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const adminApi = vi.hoisted(() => ({ json: vi.fn(), void: vi.fn() }))
vi.mock('../../lib/admin-api-client', () => ({
  ADMIN_SESSION_EXPIRED_EVENT: 'goofish:admin-session-expired',
  adminApiJson: adminApi.json,
  adminApiVoid: adminApi.void,
}))
vi.mock('../../components/ThemeSwitcher', () => ({ default: () => null }))

import AdminDashboardView from './AdminDashboardView'

describe('AdminDashboardView', () => {
  beforeEach(() => {
    adminApi.json.mockReset().mockResolvedValue({})
    adminApi.void.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => cleanup())

  it('does not expose administrator setup guidance or a setup link before login', async () => {
    const { container } = render(<MemoryRouter initialEntries={['/admin/overview']}><AdminDashboardView /></MemoryRouter>)

    expect(await screen.findByRole('button', { name: '进入后台' })).toBeInTheDocument()
    expect(screen.queryByText(/Root 口令只用于创建和维护管理账号/)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '添加管理账号' })).not.toBeInTheDocument()
    expect(container.querySelector('a[href="/admin/setup"]')).not.toBeInTheDocument()
  })
})
