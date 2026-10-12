// @vitest-environment jsdom
import { useRef, useState } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it } from 'vitest'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from './dialog'

afterEach(cleanup)

function Example({ customFocus = false }: { customFocus?: boolean }) {
  const [open, setOpen] = useState(false)
  const alternative = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  return <>
    <button onClick={() => setOpen(true)}>打开弹窗</button>
    <button ref={alternative}>下一步</button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        onOpenAutoFocus={customFocus ? (event) => { event.preventDefault(); input.current?.focus() } : undefined}
        onCloseAutoFocus={customFocus ? (event) => { event.preventDefault(); alternative.current?.focus() } : undefined}>
        <DialogTitle>编辑</DialogTitle><DialogDescription>填写后关闭</DialogDescription>
        <button>第一个操作</button><input ref={input} aria-label="输入" />
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

it('preserves custom initial focus and close focus destinations', async () => {
  const user = userEvent.setup()
  render(<Example customFocus />)
  await user.click(screen.getByRole('button', { name: '打开弹窗' }))
  await waitFor(() => expect(screen.getByRole('textbox', { name: '输入' })).toHaveFocus())
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.getByRole('button', { name: '下一步' })).toHaveFocus())
})
