// @vitest-environment jsdom

import { fireEvent, screen } from '@testing-library/dom'
import { afterEach, describe, expect, it } from 'vitest'
import { requestAdminOperationReason } from './admin-operation-reason'

afterEach(() => {
  document.body.replaceChildren()
})

describe('administrator operation reason dialog', () => {
  it('requires a 2-500 character reason and resolves with the trimmed value', async () => {
    const reason = requestAdminOperationReason({
      title: '确认冻结用户',
      description: '目标：user@example.test；active → frozen。',
    })
    const textbox = screen.getByRole('textbox', { name: '操作原因或工单号' })

    fireEvent.change(textbox, { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: '确认并继续' }))
    expect(screen.getByRole('alert')).toHaveTextContent('操作原因必须为 2–500 个字符。')

    fireEvent.change(textbox, { target: { value: '  工单 OPS-200 冻结异常账号  ' } })
    fireEvent.click(screen.getByRole('button', { name: '确认并继续' }))
    await expect(reason).resolves.toBe('工单 OPS-200 冻结异常账号')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('resolves with null when the administrator cancels', async () => {
    const reason = requestAdminOperationReason({
      title: '确认操作',
      description: '操作摘要',
    })

    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    await expect(reason).resolves.toBeNull()
  })
})
