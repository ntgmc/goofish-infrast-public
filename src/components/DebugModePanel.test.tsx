// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import DebugModePanel from './DebugModePanel'

const STORAGE_KEY = 'maa:debug-diagnostics:v1'

beforeEach(() => {
  window.localStorage.removeItem(STORAGE_KEY)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.removeItem(STORAGE_KEY)
})

describe('DebugModePanel', () => {
  it('enables, exports, clears, and disables the local capture', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:debug-data') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<DebugModePanel />)

    await user.click(screen.getByRole('button', { name: '开启调试模式' }))
    expect(screen.getByText('调试模式已开启。请复现问题后导出调试数据。')).toBeInTheDocument()
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull()

    await user.click(screen.getByRole('button', { name: '导出调试数据' }))
    expect(await screen.findByRole('status')).toHaveTextContent('调试数据已导出')
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull()

    await user.click(screen.getByRole('button', { name: '清空已记录数据' }))
    expect(window.confirm).toHaveBeenCalledOnce()
    expect(await screen.findByRole('status')).toHaveTextContent('已清空调试数据')
    expect(screen.getByText('当前已记录 0 条事件。')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '关闭并清空' }))
    expect(await screen.findByRole('status')).toHaveTextContent('调试模式已关闭')
    expect(screen.getByRole('button', { name: '开启调试模式' })).toBeInTheDocument()
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('reports blocked local storage without enabling the mode', async () => {
    const user = userEvent.setup()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage blocked', 'SecurityError')
    })
    render(<DebugModePanel />)

    await user.click(screen.getByRole('button', { name: '开启调试模式' }))

    expect(screen.getByRole('alert')).toHaveTextContent('当前浏览器无法使用本地存储')
    expect(screen.getByRole('button', { name: '开启调试模式' })).toBeInTheDocument()
  })
})
