// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommercialAdminControls } from './components'

const { adminApiJson } = vi.hoisted(() => ({ adminApiJson: vi.fn() }))

vi.mock('../../../lib/admin-api-client', () => ({ adminApiJson }))

describe('commercial admin controls', () => {
  beforeEach(() => adminApiJson.mockReset())

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
      },
    })

    render(<CommercialAdminControls userId="user-2" eligible />)

    await waitFor(() => expect(adminApiJson).toHaveBeenCalledWith('/api/admin/commercial?user_id=user-2'))
    expect(screen.getByText('商用账户控制')).toBeInTheDocument()
    expect(screen.getByText(/档案用量：活跃 2 \/ 100，总量 4 \/ 1000；状态：已暂停/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '恢复商用' })).toBeInTheDocument()
  })
})
