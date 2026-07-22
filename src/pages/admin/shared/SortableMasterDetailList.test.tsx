// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SortableMasterDetailList } from './SortableMasterDetailList'

describe('SortableMasterDetailList', () => {
  afterEach(() => cleanup())

  it('shows a compact master list and only the selected detail', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const list = screen.getByRole('list', { name: '测试列表' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('第一条详情')).toBeInTheDocument()
    expect(screen.queryByText('第二条详情')).not.toBeInTheDocument()

    await user.click(within(list).getByRole('button', { name: /第二条/, pressed: false }))
    expect(screen.queryByText('第一条详情')).not.toBeInTheDocument()
    expect(screen.getByText('第二条详情')).toBeInTheDocument()
  })

  it('exposes keyboard-operable drag handles and selection state', () => {
    render(<Harness />)

    const firstHandle = screen.getByRole('button', { name: /拖动排序.*第一条/ })
    expect(firstHandle).toHaveAttribute('tabindex', '0')
    expect(firstHandle).toHaveAttribute('aria-roledescription', 'sortable')
    expect(screen.getByRole('button', { name: /第一条第一条摘要/, pressed: true })).toBeInTheDocument()
  })
})

function Harness() {
  const [selectedId, setSelectedId] = useState('one')
  return (
    <SortableMasterDetailList
      items={[
        { id: 'one', title: '第一条', description: '第一条摘要' },
        { id: 'two', title: '第二条', description: '第二条摘要' },
      ]}
      selectedId={selectedId}
      onSelect={setSelectedId}
      onReorder={vi.fn()}
      ariaLabel="测试列表"
      detail={<div>{selectedId === 'one' ? '第一条详情' : '第二条详情'}</div>}
    />
  )
}
