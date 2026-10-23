// @vitest-environment jsdom
import { useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from './dialog'

afterEach(cleanup)

function Example({ customFocus = false, children, onPointerDownOutside, preventOutsideDismiss }: {
  customFocus?: boolean
  children?: ReactNode
  onPointerDownOutside?: ComponentProps<typeof DialogContent>['onPointerDownOutside']
  preventOutsideDismiss?: boolean
}) {
  const [open, setOpen] = useState(false)
  const alternative = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  return <>
    <button onClick={() => setOpen(true)}>打开弹窗</button>
    <button ref={alternative}>下一步</button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        preventOutsideDismiss={preventOutsideDismiss}
        onPointerDownOutside={onPointerDownOutside}
        onOpenAutoFocus={customFocus ? (event) => { event.preventDefault(); input.current?.focus() } : undefined}
        onCloseAutoFocus={customFocus ? (event) => { event.preventDefault(); alternative.current?.focus() } : undefined}>
        <DialogTitle>编辑</DialogTitle><DialogDescription>填写后关闭</DialogDescription>
        <button>第一个操作</button>{children ?? <input ref={input} aria-label="输入" />}
        <DialogClose>完成</DialogClose>
      </DialogContent>
    </Dialog>
  </>
}

it.each(['Escape', 'button'])('restores focus to a controlled dialog opener after closing with %s', async (method) => {
  const user = userEvent.setup()
  render(<Example />)
  const opener = screen.getByRole('button', { name: '打开弹窗' })
  await user.click(opener)
  await waitFor(() => expect(screen.getByRole('button', { name: '第一个操作' })).toHaveFocus())
  if (method === 'Escape') await user.keyboard('{Escape}')
  else await user.click(screen.getByRole('button', { name: '完成' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  await waitFor(() => expect(opener).toHaveFocus())
})

it.each([
  ['input', <input aria-label="草稿" />],
  ['textarea', <textarea aria-label="草稿" />],
  ['select', <select aria-label="草稿"><option>初始值</option><option>修改值</option></select>],
  ['disabled field', <fieldset disabled><input aria-label="草稿" defaultValue="正在提交的内容" /></fieldset>],
  ['contenteditable', <div contentEditable suppressContentEditableWarning aria-label="草稿" role="textbox" />],
])('preserves a protected draft with %s after clicking its overlay', async (_name, field) => {
  const user = userEvent.setup()
  const outside = vi.fn()
  render(<Example preventOutsideDismiss onPointerDownOutside={outside}>{field}</Example>)
  await user.click(screen.getByRole('button', { name: '打开弹窗' }))
  const control = screen.getByLabelText('草稿')
  if (control instanceof HTMLSelectElement) await user.selectOptions(control, '修改值')
  else if (!control.matches(':disabled')) await user.type(control, '未提交的内容')
  const value = control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement
    ? control.value : control.textContent
  await user.click(document.querySelector('[data-slot="dialog-overlay"]')!)
  expect(outside).toHaveBeenCalledOnce()
  expect(screen.getByRole('dialog')).toBeVisible()
  expect(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement
    ? control.value : control.textContent).toBe(value)
  await user.click(screen.getByRole('button', { name: '完成' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it.each([
  ['search', <input type="search" aria-label="搜索" />],
  ['file picker', <input type="file" aria-label="导入" />],
  ['toggle', <input type="checkbox" role="switch" aria-label="设置" />],
  ['select', <select aria-label="筛选"><option>全部</option></select>],
])('allows overlay dismissal by default with a %s control', async (_name, control) => {
  const user = userEvent.setup()
  render(<Example>{control}</Example>)
  await user.click(screen.getByRole('button', { name: '打开弹窗' }))
  await user.click(document.querySelector('[data-slot="dialog-overlay"]')!)
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it.each([false, true])('honors the caller outside event handler (%s)', async (prevent) => {
  const user = userEvent.setup()
  render(<Example onPointerDownOutside={prevent ? (event) => event.preventDefault() : undefined} />)
  await user.click(screen.getByRole('button', { name: '打开弹窗' }))
  await user.type(screen.getByRole('textbox', { name: '输入' }), '搜索条件')
  await user.click(document.querySelector('[data-slot="dialog-overlay"]')!)
  await waitFor(() => expect(Boolean(screen.queryByRole('dialog'))).toBe(prevent))
})

it('keeps a nested form protected inside a dismissible drawer', async () => {
  const user = userEvent.setup()
  render(<Example>
    <input aria-label="搜索" />
    <Dialog defaultOpen>
      <DialogContent preventOutsideDismiss>
        <DialogTitle>填写反馈</DialogTitle><DialogDescription>提交问题</DialogDescription>
        <textarea aria-label="反馈内容" />
        <DialogClose>关闭反馈</DialogClose>
      </DialogContent>
    </Dialog>
  </Example>)
  await user.click(screen.getByRole('button', { name: '打开弹窗' }))
  await user.type(screen.getByLabelText('反馈内容'), '未提交的反馈')
  await user.click(document.querySelectorAll('[data-slot="dialog-overlay"]')[1]!)
  expect(screen.getByRole('dialog', { name: '填写反馈' })).toBeVisible()
  expect(screen.getByLabelText('反馈内容')).toHaveValue('未提交的反馈')
  await user.click(screen.getByRole('button', { name: '关闭反馈' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '填写反馈' })).not.toBeInTheDocument())
  await user.click(document.querySelector('[data-slot="dialog-overlay"]')!)
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('allows overlay dismissal after saving while the editable field remains', async () => {
  const user = userEvent.setup()
  const view = render(<Example preventOutsideDismiss />)
  await user.click(screen.getByRole('button', { name: '打开弹窗' }))
  await user.type(screen.getByLabelText('输入'), '待保存的内容')
  await user.click(document.querySelector('[data-slot="dialog-overlay"]')!)
  expect(screen.getByRole('dialog')).toBeVisible()
  view.rerender(<Example preventOutsideDismiss={false} />)
  expect(screen.getByLabelText('输入')).toHaveValue('待保存的内容')
  await user.click(document.querySelector('[data-slot="dialog-overlay"]')!)
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
})

it('protects pending work even when there are no editable fields', async () => {
  const user = userEvent.setup()
  render(<Example preventOutsideDismiss><p>正在处理已选内容</p></Example>)
  await user.click(screen.getByRole('button', { name: '打开弹窗' }))
  await user.click(document.querySelector('[data-slot="dialog-overlay"]')!)
  expect(screen.getByRole('dialog')).toBeVisible()
})

it('dismisses a nested preview without closing or clearing the parent form', async () => {
  const user = userEvent.setup()
  render(<Example preventOutsideDismiss>
    <textarea aria-label="草稿" defaultValue="未提交的内容" />
    <Dialog defaultOpen>
      <DialogContent>
        <DialogTitle>图片预览</DialogTitle><DialogDescription>查看附件</DialogDescription>
        <DialogClose>关闭预览</DialogClose>
      </DialogContent>
    </Dialog>
  </Example>)
  await user.click(screen.getByRole('button', { name: '打开弹窗' }))
  expect(screen.getAllByRole('dialog', { hidden: true })).toHaveLength(2)
  await user.click(document.querySelectorAll('[data-slot="dialog-overlay"]')[1]!)
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '图片预览' })).not.toBeInTheDocument())
  expect(screen.getByRole('dialog', { name: '编辑' })).toBeVisible()
  expect(screen.getByLabelText('草稿')).toHaveValue('未提交的内容')
  await user.click(document.querySelector('[data-slot="dialog-overlay"]')!)
  expect(screen.getByRole('dialog', { name: '编辑' })).toBeVisible()
})

it('honors a caller that prevents outside dismissal for a read-only dialog', async () => {
  const user = userEvent.setup()
  render(<Example onPointerDownOutside={(event) => event.preventDefault()}><p>只读详情</p></Example>)
  await user.click(screen.getByRole('button', { name: '打开弹窗' }))
  await user.click(document.querySelector('[data-slot="dialog-overlay"]')!)
  expect(screen.getByRole('dialog')).toBeVisible()
})

it('preserves custom initial focus and close focus destinations', async () => {
  const user = userEvent.setup()
  render(<Example customFocus />)
  await user.click(screen.getByRole('button', { name: '打开弹窗' }))
  await waitFor(() => expect(screen.getByRole('textbox', { name: '输入' })).toHaveFocus())
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.getByRole('button', { name: '下一步' })).toHaveFocus())
})
