// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UserGameAccount } from '../lib/types'
import SklandBindingDialog from './SklandBindingDialog'

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
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
