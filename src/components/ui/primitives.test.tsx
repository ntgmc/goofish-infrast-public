// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Button, buttonVariants } from './button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from './dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './dropdown-menu'
import { Input } from './input'
import { Label } from './label'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from './popover'
import { Textarea } from './textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip'

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})

afterAll(() => vi.unstubAllGlobals())
afterEach(cleanup)

describe('project UI primitives', () => {
  it('exports the complete first-stage primitive surface', () => {
    const exports = [
      Button,
      buttonVariants,
      Dialog,
      DialogClose,
      DialogContent,
      DialogDescription,
      DialogFooter,
      DialogHeader,
      DialogOverlay,
      DialogPortal,
      DialogTitle,
      DialogTrigger,
      DropdownMenu,
      DropdownMenuCheckboxItem,
      DropdownMenuContent,
      DropdownMenuGroup,
      DropdownMenuItem,
      DropdownMenuLabel,
      DropdownMenuPortal,
      DropdownMenuRadioGroup,
      DropdownMenuRadioItem,
      DropdownMenuSeparator,
      DropdownMenuShortcut,
      DropdownMenuSub,
      DropdownMenuSubContent,
      DropdownMenuSubTrigger,
      DropdownMenuTrigger,
      Input,
      Label,
      Popover,
      PopoverAnchor,
      PopoverContent,
      PopoverDescription,
      PopoverHeader,
      PopoverTitle,
      PopoverTrigger,
      Textarea,
      Tooltip,
      TooltipContent,
      TooltipProvider,
      TooltipTrigger,
    ]

    expect(exports.every((component) => typeof component === 'function')).toBe(true)
  })

  it('keeps actions and fields accessible while allowing class overrides', () => {
    render(
      <div>
        <Label htmlFor="primitive-email">邮箱</Label>
        <Input id="primitive-email" aria-invalid="true" className="h-12" />
        <Textarea aria-label="备注" />
        <Button>保存</Button>
        <Button variant="secondary" size="sm">次要操作</Button>
        <Button variant="destructive" size="icon" aria-label="删除" />
      </div>,
    )

    const input = screen.getByLabelText('邮箱')
    expect(input).toHaveAttribute('data-slot', 'input')
    expect(input).toHaveClass('h-12', 'aria-invalid:border-destructive/70')
    expect(input).not.toHaveClass('h-11')

    expect(screen.getByRole('textbox', { name: '备注' })).toHaveClass('min-h-28')

    const primary = screen.getByRole('button', { name: '保存' })
    expect(primary).toHaveAttribute('type', 'button')
    expect(primary).toHaveClass('h-11', 'rounded-[var(--radius-input)]')
    expect(screen.getByRole('button', { name: '次要操作' })).toHaveClass('h-11')
    expect(screen.getByRole('button', { name: '删除' })).toHaveClass('size-11')
  })

  it('provides modal semantics, Escape dismissal, and focus restoration', async () => {
    const user = userEvent.setup()
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline">打开基础对话框</Button>
        </DialogTrigger>
        <DialogContent showCloseButton closeLabel="关闭基础对话框">
          <DialogHeader>
            <DialogTitle>基础对话框</DialogTitle>
            <DialogDescription>用于验证通用对话框契约。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    )

    const trigger = screen.getByRole('button', { name: '打开基础对话框' })
    trigger.focus()
    await user.click(trigger)

    const dialog = screen.getByRole('dialog', { name: '基础对话框' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveTextContent('用于验证通用对话框契约。')
    expect(screen.getByRole('button', { name: '关闭基础对话框' })).toHaveClass('size-11')

    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('keeps dropdown items touch-sized and keyboard operable', async () => {
    const user = userEvent.setup()
    const onAction = vi.fn()
    render(
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">打开基础菜单</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>菜单操作</DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={onAction}>
              执行操作
              <DropdownMenuShortcut>Enter</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuCheckboxItem checked>显示详情</DropdownMenuCheckboxItem>
            <DropdownMenuRadioGroup value="compact">
              <DropdownMenuRadioItem value="compact">紧凑模式</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>更多操作</DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent>
                <DropdownMenuItem>子操作</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    )

    const trigger = screen.getByRole('button', { name: '打开基础菜单' })
    trigger.focus()
    await user.keyboard('{Enter}')

    const action = await screen.findByRole('menuitem', { name: /执行操作/ })
    expect(action).toHaveClass('min-h-11')
    expect(screen.getByRole('menu')).toHaveClass('max-w-[calc(100vw-2rem)]')

    await user.keyboard('{Enter}')
    expect(onAction).toHaveBeenCalledOnce()
    await waitFor(() => expect(trigger).toHaveFocus())

    await user.keyboard('{Enter}')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('renders project-themed popover and tooltip content through portals', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <Popover>
          <PopoverAnchor asChild>
            <span data-testid="popover-anchor" />
          </PopoverAnchor>
          <PopoverTrigger asChild>
            <Button variant="outline">打开浮层</Button>
          </PopoverTrigger>
          <PopoverContent>
            <PopoverHeader>
              <PopoverTitle>浮层标题</PopoverTitle>
              <PopoverDescription>浮层说明</PopoverDescription>
            </PopoverHeader>
          </PopoverContent>
        </Popover>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost">查看提示</Button>
            </TooltipTrigger>
            <TooltipContent>提示内容</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>,
    )

    await user.click(screen.getByRole('button', { name: '打开浮层' }))
    const popover = await screen.findByText('浮层说明')
    expect(popover.closest('[data-slot="popover-content"]')).toHaveClass(
      'border-surface-3',
      'bg-surface-1',
    )

    await user.hover(screen.getByRole('button', { name: '查看提示' }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('提示内容')
  })
})
