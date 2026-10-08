// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { cancelAdminOperation, requestAdminOperationEdit } from './admin-operation-reason'

afterEach(() => { cancelAdminOperation(); document.body.replaceChildren() })

it('keeps edits after a conflict, blocks duplicate submissions, and retries with the same input', async () => {
  const user = userEvent.setup()
  let finish!: (message: string | null) => void
  const submit = vi.fn<(_values: Record<string, string>, _reason: string) => Promise<string | null>>()
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    .mockResolvedValueOnce(null)
  const refresh = vi.fn().mockResolvedValue(undefined)
  const pending = requestAdminOperationEdit({ title: '修改档案资料', description: '测试档案', confirmLabel: '保存资料',
    fields: [{ name: 'display_name', label: '档案名称', value: '旧名称', required: true, maxLength: 40 }], onSubmit: submit, onRefresh: refresh })
  const name = screen.getByLabelText('档案名称')
  await user.clear(name)
  await user.type(name, '新名称')
  await user.type(screen.getByRole('textbox', { name: '操作原因或工单号' }), '工单 OPS-103')
  const form = screen.getByRole('button', { name: '保存资料' }).closest('form')!
  fireEvent.submit(form)
  fireEvent.submit(form)
  expect(submit).toHaveBeenCalledTimes(1)
  expect(name).toBeDisabled()
  finish('档案已被其他请求修改，请刷新后重试。')
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('请刷新后重试'))
  expect(name).toHaveValue('新名称')
  expect(name).toBeEnabled()
  await user.click(screen.getByRole('button', { name: '刷新目标数据' }))
  expect(refresh).toHaveBeenCalledTimes(1)
  expect(name).toHaveValue('新名称')
  expect(screen.getByRole('textbox', { name: '操作原因或工单号' })).toHaveValue('工单 OPS-103')
  fireEvent.submit(form)
  await pending
  expect(submit).toHaveBeenLastCalledWith({ display_name: '新名称' }, '工单 OPS-103')
  expect(document.querySelector('dialog')).toBeNull()
})

it('cancels an unsubmitted edit when navigation leaves its section', async () => {
  const submit = vi.fn()
  const pending = requestAdminOperationEdit({ title: '修改状态', description: '测试档案', fields: [], onSubmit: submit })
  cancelAdminOperation()
  await pending
  expect(submit).not.toHaveBeenCalled()
  expect(document.querySelector('dialog')).toBeNull()
})
