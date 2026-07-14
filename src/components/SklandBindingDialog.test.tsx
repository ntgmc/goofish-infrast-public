// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UserGameAccount } from '../lib/types'
import { apiJson } from '../lib/api-client'
import SklandBindingDialog from './SklandBindingDialog'

vi.mock('../lib/api-client', () => ({ apiJson: vi.fn() }))

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  vi.clearAllMocks()
})

describe('SklandBindingDialog accessibility', () => {
  it('uses modal semantics, focuses its close action, and returns focus after Escape', async () => {
    const user = userEvent.setup()
    const root = document.createElement('div')
    const opener = document.createElement('button')
    opener.textContent = '打开森空岛导入'
    const container = document.createElement('div')
    root.append(opener, container)
    document.body.append(root)
    opener.focus()

    render(<DialogHarness />, { container })

    const dialog = screen.getByRole('dialog', { name: '森空岛导入' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-describedby', 'skland-binding-description')
    await waitFor(() => expect(screen.getByRole('button', { name: '关闭森空岛导入' })).toHaveFocus())

    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(opener).toHaveFocus()
  })

  it('requires an explicit account choice and previews the selected uid', async () => {
    const user = userEvent.setup()
    const mockedApiJson = vi.mocked(apiJson)
    mockedApiJson
      .mockResolvedValueOnce({
        status: 'account_selection_required',
        selection_id: 'selection-1',
        skland_accounts: [
          { uid: '12345678', nickname: '默认博士', channel_name: '官服', is_default: true },
          { uid: '87654321', nickname: '另一个博士', channel_name: 'B服', is_default: false },
        ],
        warning: '检测到多个明日方舟账号，请选择要导入的账号。',
      })
      .mockResolvedValueOnce({
        status: 'confirm_required',
        confirmation_id: 'confirmation-1',
        skland_preview: {
          uid: '87654321',
          nickname: '另一个博士',
          channel_name: 'B服',
          operator_count: 88,
        },
      })

    render(
      <SklandBindingDialog
        open
        profile={createProfile()}
        onOpenChange={vi.fn()}
        onPayload={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: '粘贴凭据' }))
    await user.type(screen.getByPlaceholderText('粘贴森空岛凭据'), 'credential-value')
    await user.click(screen.getByRole('button', { name: '读取账号预览' }))

    const defaultAccount = await screen.findByRole('radio', { name: /默认博士/ })
    const otherAccount = screen.getByRole('radio', { name: /另一个博士/ })
    const continueButton = screen.getByRole('button', { name: '读取所选账号' })
    expect(defaultAccount).not.toBeChecked()
    expect(otherAccount).not.toBeChecked()
    expect(continueButton).toBeDisabled()
    await waitFor(() => expect(defaultAccount).toHaveFocus())

    await user.click(otherAccount)
    expect(otherAccount).toBeChecked()
    expect(continueButton).toBeEnabled()
    await user.click(continueButton)

    await waitFor(() => expect(mockedApiJson).toHaveBeenNthCalledWith(2, '/api/user/skland/account/select', expect.objectContaining({
      method: 'POST',
      json: {
        profile_id: 'profile-1',
        selection_id: 'selection-1',
        uid: '87654321',
      },
    })))
    expect(await screen.findByText('88 名')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认保存并导入' })).toBeEnabled()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })
})

function DialogHarness() {
  const [open, setOpen] = useState(true)
  return (
    <SklandBindingDialog
      open={open}
      profile={createProfile()}
      onOpenChange={setOpen}
      onPayload={vi.fn()}
    />
  )
}

function createProfile(): UserGameAccount {
  return {
    id: 'profile-1',
    user_id: 'user-1',
    kind: 'cdk',
    permission: 'advanced',
    status: 'active',
    cdk_order_hash: 'order-hash',
    display_name: '测试档案',
    note: '',
    skland_binding: null,
    operator_count: 0,
    updated_at: null,
    created_at: '2026-07-15T00:00:00.000Z',
  }
}
