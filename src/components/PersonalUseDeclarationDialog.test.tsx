// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PersonalUseDeclarationDialog from './PersonalUseDeclarationDialog'

afterEach(() => {
  cleanup()
})

describe('PersonalUseDeclarationDialog', () => {
  it('requires the explicit checkbox before it continues', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    render(<PersonalUseDeclarationDialog open={true} submitting={false} onClose={onClose} onConfirm={onConfirm} />)

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
    render(<PersonalUseDeclarationDialog open={true} submitting={false} onClose={onClose} onConfirm={onConfirm} />)

    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
