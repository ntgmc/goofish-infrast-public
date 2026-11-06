// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { createOperationsOverview } from '../../../test/operations-overview-fixture'
import DeletionStatistics from './DeletionStatistics'

afterEach(cleanup)

describe('deletion statistics', () => {
  it('separates completed and pending counts and opens plain-text feedback', async () => {
    const data = createOperationsOverview()
    data.current.deleted_users = 4
    data.previous.deleted_users = 2
    data.deletions = {
      total_deleted: 10, pending: 3, failed: 1,
      reasons: [
        { reason: 'privacy', deleted: 2, pending: 1 },
        { reason: 'results_unsatisfactory', deleted: 1, pending: 2 },
        { reason: 'unrecorded', deleted: 1, pending: 0 },
      ],
      recent_feedback: [{ at: '2026-11-06T00:00:00Z', status: 'pending', reason: 'privacy', detail: '<img src=x onerror=alert(1)>' }],
    }
    const { container } = render(<DeletionStatistics data={data} />)
    expect(screen.getByText('所选时段已注销').parentElement).toHaveTextContent('4 人上期 2 人')
    expect(screen.getByText('当前待注销').parentElement).toHaveTextContent('3 人')
    expect(screen.getByText('累计已注销').parentElement).toHaveTextContent('10 人')
    expect(screen.getByText('当前处理失败').parentElement).toHaveTextContent('1 人包含在待注销人数中')
    const table = screen.getByRole('table', { name: '注销原因人数' })
    expect(within(within(table).getByRole('row', { name: /隐私/ })).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['2', '1'])
    expect(within(within(table).getByRole('row', { name: /未记录或已到期/ })).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['1', '0'])
    const user = userEvent.setup()
    const summary = screen.getByText('补充说明（最近 1 条）')
    await user.click(summary)
    expect(summary.parentElement).toHaveAttribute('open')
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeVisible()
    expect(screen.getByText(/申请于/)).toHaveTextContent('8:00:00')
    expect(container.querySelector('img')).toBeNull()
  })

  it('keeps statistics available when the server withholds feedback', () => {
    const data = createOperationsOverview()
    data.deletions.recent_feedback = null
    render(<DeletionStatistics data={data} />)
    expect(screen.getByRole('heading', { name: '账号注销' })).toBeVisible()
    expect(screen.queryByText(/补充说明/)).not.toBeInTheDocument()
    expect(screen.getByText('所选时段已注销').parentElement).toHaveTextContent('0 人')
  })

  it('shows empty counts and an empty feedback state', async () => {
    render(<DeletionStatistics data={createOperationsOverview()} />)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByText(/当前也没有待注销账号/)).toBeVisible()
    await userEvent.setup().click(screen.getByText('补充说明（最近 0 条）'))
    expect(screen.getByText('暂无补充说明。')).toBeVisible()
  })
})
