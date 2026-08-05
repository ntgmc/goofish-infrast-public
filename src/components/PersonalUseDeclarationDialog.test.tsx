// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PersonalUseDeclarationDialog from './PersonalUseDeclarationDialog'
import { PERSONAL_USE_DECLARATION } from '../lib/personal-use-declaration'

const declaration = {
  ...PERSONAL_USE_DECLARATION,
  contentHash: 'a'.repeat(64),
}

afterEach(() => {
  cleanup()
})

describe('PersonalUseDeclarationDialog', () => {
  it('requires the explicit checkbox before it continues', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    render(<PersonalUseDeclarationDialog open={true} submitting={false} declaration={declaration} onClose={onClose} onConfirm={onConfirm} />)

    const dialog = screen.getByRole('dialog', { name: '个人使用确认' })
    expect(dialog).toHaveAttribute('data-slot', 'dialog-content')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeInTheDocument()
    const continueButton = screen.getByRole('button', { name: '确认并继续' })
    expect(continueButton).toBeDisabled()
    await waitFor(() => expect(screen.getByRole('checkbox')).toHaveFocus())

    await user.click(screen.getByRole('checkbox'))
    expect(continueButton).toBeEnabled()
    await user.click(continueButton)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('cancels without confirming', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    render(<PersonalUseDeclarationDialog open={true} submitting={false} declaration={declaration} onClose={onClose} onConfirm={onConfirm} />)

    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('shows the server document inline without navigating away', async () => {
    const user = userEvent.setup()
    render(
      <PersonalUseDeclarationDialog
        open={true}
        submitting={false}
        declaration={{ ...declaration, title: '服务端当前声明', version: 'V9.9' }}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    )

    expect(screen.getByText(/服务端当前声明 · V9\.9/)).toBeInTheDocument()
    await user.click(screen.getByText('查看完整《个人使用声明》'))
    expect(screen.getByRole('heading', { name: '1. 使用范围' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '查看完整《个人使用声明》' })).not.toBeInTheDocument()
  })

  it('preserves confirmation and focus lifecycle across a failed submission', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onConfirm = vi.fn()
    const view = render(
      <PersonalUseDeclarationDialog open={true} submitting={false} declaration={declaration} onClose={onClose} onConfirm={onConfirm} />,
    )
    const checkbox = screen.getByRole('checkbox')
    await user.click(checkbox)

    view.rerender(
      <PersonalUseDeclarationDialog open={true} submitting={true} declaration={declaration} onClose={onClose} onConfirm={onConfirm} />,
    )
    view.rerender(
      <PersonalUseDeclarationDialog open={true} submitting={false} declaration={declaration} onClose={onClose} onConfirm={onConfirm} />,
    )

    expect(checkbox).toBeChecked()
    expect(screen.getByRole('button', { name: '确认并继续' })).toBeEnabled()
  })

  it('closes with Escape and restores focus to the opening action', async () => {
    const user = userEvent.setup()
    render(<LifecycleHarness />)
    const trigger = screen.getByRole('button', { name: '打开个人声明' })
    await user.click(trigger)
    await screen.findByRole('dialog', { name: '个人使用确认' })

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('cannot be dismissed with Escape or the overlay while submitting', async () => {
    const user = userEvent.setup()
    render(<LifecycleHarness submitting />)
    await user.click(screen.getByRole('button', { name: '打开个人声明' }))
    await screen.findByRole('dialog', { name: '个人使用确认' })

    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: '个人使用确认' })).toBeInTheDocument()

    const overlay = document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')
    if (!overlay) throw new Error('Expected dialog overlay.')
    await user.click(overlay)
    expect(screen.getByRole('dialog', { name: '个人使用确认' })).toBeInTheDocument()
  })
})

function LifecycleHarness({ submitting = false }: { submitting?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>打开个人声明</button>
      <PersonalUseDeclarationDialog
        open={open}
        submitting={submitting}
        declaration={declaration}
        onClose={() => setOpen(false)}
        onConfirm={vi.fn()}
      />
    </>
  )
}
