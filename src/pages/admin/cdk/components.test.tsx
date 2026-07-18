// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminCdkDetail } from '../contracts'
import { CdkDetailDialog } from './components'

const detail: AdminCdkDetail = {
  code_hash: 'hash-1',
  cdk_id: 'CDK-DETAIL-001',
  permission: 'recommended',
  status: 'used',
  created_at: '2026-07-15T00:00:00.000Z',
  used_at: '2026-07-15T01:00:00.000Z',
  revoked_at: null,
  order_note: '测试订单',
  license_order_hash: 'order-1',
  operator_count: 12,
  config_desc: '测试配置',
  risk_events: [],
}

beforeEach(() => {
  document.body.style.overflow = ''
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    return window.setTimeout(() => callback(0), 0)
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((handle) => window.clearTimeout(handle))
})

afterEach(() => {
  cleanup()
  document.body.style.overflow = ''
  vi.restoreAllMocks()
})

describe('CdkDetailDialog', () => {
  it('opens in the current viewport with its own scroll area and restores focus after Escape', async () => {
    const user = userEvent.setup()
    render(<DialogHarness />)

    const trigger = screen.getByRole('button', { name: '打开 CDK 详情' })
    await user.click(trigger)

    const dialog = screen.getByRole('dialog', { name: detail.cdk_id })
    expect(dialog.parentElement).toHaveClass('fixed', 'inset-0')
    expect(dialog).toHaveClass('overflow-y-auto')
    expect(dialog.className).toContain('100dvh')
    expect(document.body).toHaveStyle({ overflow: 'hidden' })
    await waitFor(() => expect(screen.getByRole('button', { name: '关闭' })).toHaveFocus())

    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(document.body.style.overflow).toBe('')
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('closes when the backdrop is clicked', async () => {
    const user = userEvent.setup()
    render(<DialogHarness />)
    await user.click(screen.getByRole('button', { name: '打开 CDK 详情' }))

    const backdrop = screen.getByRole('dialog', { name: detail.cdk_id }).parentElement
    if (!backdrop) throw new Error('Expected dialog backdrop.')
    fireEvent.mouseDown(backdrop)

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

function DialogHarness() {
  const [open, setOpen] = useState(false)
  const noop = async () => undefined
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>打开 CDK 详情</button>
      {open && (
        <CdkDetailDialog
          detail={detail}
          busyAction={null}
          onClose={() => setOpen(false)}
          onPatch={noop}
          onUpdateNote={noop}
          onSetPermission={noop}
        />
      )}
    </>
  )
}
