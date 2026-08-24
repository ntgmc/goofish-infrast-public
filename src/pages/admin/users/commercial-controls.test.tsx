// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommercialAdminControls } from './components'

const { adminApiJson } = vi.hoisted(() => ({ adminApiJson: vi.fn() }))

vi.mock('../../../lib/admin-api-client', () => ({ adminApiJson }))

describe('commercial admin controls', () => {
  beforeEach(() => adminApiJson.mockReset())
  afterEach(cleanup)

  it('does not render or load limits when commercial access is not effective', () => {
    render(<CommercialAdminControls userId="user-1" eligible={false} />)

    expect(screen.queryByText('商用账户控制')).not.toBeInTheDocument()
    expect(screen.queryByText(/档案用量/)).not.toBeInTheDocument()
    expect(adminApiJson).not.toHaveBeenCalled()
  })

  it('keeps controls available for an eligible suspended account', async () => {
    adminApiJson.mockResolvedValue({
      limits: {
        active: 2,
        total: 4,
        active_limit: 100,
        total_limit: 1000,
        suspended: true,
        suspension_reason: 'manual review',
        revision: 3,
        as_of: '2026-07-31T00:00:00.000Z',
        inflight_jobs: 2,
        inflight_reserved: '1200.00',
      },
    })

    render(<CommercialAdminControls userId="user-2" eligible />)

    await waitFor(() => expect(adminApiJson).toHaveBeenCalledWith('/api/admin/commercial?user_id=user-2'))
    expect(screen.getByText('商用账户控制')).toBeInTheDocument()
    expect(screen.getByText(/档案用量：活跃 2 \/ 100，总量 4 \/ 1000；状态：已暂停/)).toBeInTheDocument()
    expect(screen.getByText(/计算中任务 2 个 · 暂扣 1200.00 积分/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '恢复商用' })).toBeInTheDocument()
  })

  it('does not show trusted defaults or enable mutations when loading fails', async () => {
    adminApiJson.mockRejectedValueOnce(new Error('商用状态不可用'))

    render(<CommercialAdminControls userId="user-3" eligible />)

    expect(await screen.findByRole('alert')).toHaveTextContent('商用状态不可用')
    expect(screen.queryByText(/100 \/ 1000/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存限额' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '暂停商用' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument()
  })
})
