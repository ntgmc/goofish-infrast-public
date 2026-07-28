// @vitest-environment jsdom

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminToast } from './AdminToast'

describe('AdminToast', () => {
  afterEach(() => vi.useRealTimers())

  it('shows an accessible fixed notification and supports manual dismissal', () => {
    const onDismiss = vi.fn()
    render(<AdminToast message="横幅和公告已发布" onDismiss={onDismiss} />)

    const toast = screen.getByRole('status')
    expect(toast).toHaveTextContent('横幅和公告已发布')
    expect(toast).toHaveClass('fixed')

    fireEvent.click(screen.getByRole('button', { name: '关闭通知' }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })

  it('dismisses automatically after the configured duration', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    render(<AdminToast message="设置已保存" onDismiss={onDismiss} duration={3000} />)

    act(() => vi.advanceTimersByTime(2999))
    expect(onDismiss).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(1))
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
