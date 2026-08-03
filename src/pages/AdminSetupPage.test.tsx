// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copy } from '../copy/index'

const adminApi = vi.hoisted(() => ({ json: vi.fn(), void: vi.fn() }))
vi.mock('../lib/admin-api-client', () => ({
  adminApiJson: adminApi.json,
  adminApiVoid: adminApi.void,
}))
vi.mock('../components/ThemeSwitcher', () => ({ default: () => null }))

import AdminSetupPage from './AdminSetupPage'

const existingAdmin = {
  username: 'existing-admin',
  role: 'risk_reviewer',
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
} as const

beforeEach(() => {
  adminApi.json.mockReset().mockResolvedValue({ users: [existingAdmin] })
  adminApi.void.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('confirm', vi.fn(() => true))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AdminSetupPage', () => {
  it('uses first-time setup guidance without migration-era instructions', async () => {
    adminApi.json.mockResolvedValueOnce({ users: [] })
    renderPage()

    expect(screen.getByText('首次使用管理后台时，请使用 Root 口令创建第一个管理账号；已有账号时，可在这里继续维护。')).toBeInTheDocument()
    expect(screen.queryByText(/日常管理账号|减少 root 口令暴露次数/)).not.toBeInTheDocument()
    expect(await screen.findByText('尚未创建管理账号，请使用左侧表单创建第一个账号。')).toBeInTheDocument()
  })

  it('distinguishes a loading failure from an empty list and retries explicitly', async () => {
    adminApi.json
      .mockRejectedValueOnce(new Error('管理员列表网络失败'))
      .mockResolvedValueOnce({ users: [existingAdmin] })
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('管理员列表网络失败')
    expect(screen.queryByText(copy.common.pages_AdminSetupPage_021)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '重试' }))

    expect(await screen.findByText(existingAdmin.username)).toBeInTheDocument()
    expect(adminApi.json).toHaveBeenCalledTimes(2)
  })

  it('requires confirmation and sends an explicit audited replacement request for a duplicate username', async () => {
    adminApi.json
      .mockResolvedValueOnce({ users: [existingAdmin] })
      .mockResolvedValueOnce({ user: { ...existingAdmin, role: 'security_admin' }, replaced: true })
    renderPage()
    await screen.findByText(existingAdmin.username)

    await fillCredentials({
      rootPassword: 'root-password',
      username: existingAdmin.username,
      password: 'ReplacementPassword!2026',
      reason: '工单 OPS-300 替换管理员角色',
    })
    await userEvent.selectOptions(screen.getByLabelText('风控角色'), 'security_admin')
    await userEvent.click(screen.getByRole('button', { name: copy.common.pages_AdminSetupPage_018 }))

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('撤销全部现有会话'))
    expect(adminApi.json).toHaveBeenLastCalledWith('/api/admin/users', expect.objectContaining({
      method: 'POST',
      json: {
        root_password: 'root-password',
        username: existingAdmin.username,
        password: 'ReplacementPassword!2026',
        role: 'security_admin',
        reason: '工单 OPS-300 替换管理员角色',
        replace_existing: true,
      },
    }))
    expect(await screen.findByRole('status')).toHaveTextContent(`已替换管理员 ${existingAdmin.username}`)
  })

  it('sends the root step-up secret and operation reason when deleting an administrator', async () => {
    renderPage()
    await screen.findByText(existingAdmin.username)
    await fillCredentials({
      rootPassword: 'root-password',
      reason: '工单 OPS-301 删除离职管理员',
    })

    await userEvent.click(screen.getByRole('button', { name: copy.common.pages_AdminSetupPage_024 }))

    expect(adminApi.void).toHaveBeenCalledWith('/api/admin/users', expect.objectContaining({
      method: 'DELETE',
      json: {
        root_password: 'root-password',
        username: existingAdmin.username,
        reason: '工单 OPS-301 删除离职管理员',
      },
    }))
    await waitFor(() => expect(screen.queryByText(existingAdmin.username)).not.toBeInTheDocument())
  })
})

function renderPage() {
  return render(<MemoryRouter><AdminSetupPage /></MemoryRouter>)
}

async function fillCredentials(values: {
  rootPassword: string
  username?: string
  password?: string
  reason: string
}) {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText(copy.common.pages_AdminSetupPage_013), values.rootPassword)
  if (values.username) await user.type(screen.getByLabelText(copy.common.pages_AdminSetupPage_014), values.username)
  if (values.password) await user.type(screen.getByLabelText(copy.common.pages_AdminSetupPage_016), values.password)
  await user.type(screen.getByLabelText('操作原因 / 工单号'), values.reason)
}
