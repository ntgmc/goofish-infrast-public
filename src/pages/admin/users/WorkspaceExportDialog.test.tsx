// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminProfileSummary, AdminUserDetail } from '../contracts'
import { UserDetailDialog } from './components'
import { WorkspaceExportDialog } from './WorkspaceExportDialog'

afterEach(cleanup)

function detailForPage(page: number): AdminUserDetail {
  const timestamp = '2026-10-02T00:00:00.000Z'
  return {
    user: {
      id: 'user-1', email: 'test@example.com', email_verified_at: timestamp,
      status: 'active', profile_access: [], profile_count: 4,
      created_at: timestamp, updated_at: timestamp,
    },
    profiles: [1, 2].map((offset): AdminProfileSummary => ({
      id: `profile-${(page - 1) * 2 + offset}`,
      user_id: 'user-1',
      display_name: `账号 ${(page - 1) * 2 + offset}`,
      note: '',
      kind: 'cdk',
      permission: 'recommended',
      status: 'active',
      skland_binding: null,
      skland_pending_binding: null,
      skland_risk: null,
      workspace: {
        exists: false, operator_count: 0, has_operators: false, has_config: false,
        config_desc: null, layout: null, schedule_mode: '', dormitory_rule: null,
        trading_stations_count: null, manufacturing_stations_count: null,
        has_last_result: false, last_result_title: null, updated_at: null,
      },
      operator_count: 0,
      cdk: null,
      created_at: timestamp,
      updated_at: timestamp,
    })),
    profile_pagination: { page, page_size: 2, returned: 2, total: 4, total_pages: 2, truncated: true },
    personal_use_declarations: [],
  }
}

describe('workspace export dialog', () => {
  it('opens inside user details and returns focus without closing the parent dialog', async () => {
    const action = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    const props = {
      detail: detailForPage(1),
      busyAction: null,
      operatorDataByProfileId: {},
      expandedOperatorProfileId: null,
      balance: null,
      balanceLoading: false,
      onClose,
      onUpdateProfile: action,
      onSetProfileStatus: action,
      onSetProfilePermission: action,
      onUpgradePreviewProfile: action,
      onClearSklandBinding: action,
      onClearWorkspace: action,
      onViewOperators: action,
      onDownloadOperators: action,
      onDownloadWorkspaces: vi.fn().mockResolvedValue(true),
      onLoadProfilePage: action,
      onAdjustBalance: vi.fn().mockResolvedValue(false),
      onLoadMoreBalance: action,
      onFreezeUser: action,
      onUnfreezeUser: action,
      onDeleteUser: action,
    }
    const { rerender } = render(<UserDetailDialog {...props} />)
    const trigger = screen.getByRole('button', { name: '导出工作区' })
    expect(screen.queryByText(/导出的最近结果选用优化器排班/)).not.toBeInTheDocument()
    trigger.focus()
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: '导出工作区' })).toBeInTheDocument()
    expect(screen.getByText(/导出的最近结果选用优化器排班/)).toBeInTheDocument()

    rerender(<UserDetailDialog {...props} busyAction="user-detail:user-1" />)
    expect(screen.getByRole('checkbox', { name: /账号 1/ })).toBeDisabled()
    fireEvent.keyDown(screen.getByRole('dialog', { name: '导出工作区' }), { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: '导出工作区' })).toBeInTheDocument()

    rerender(<UserDetailDialog {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '导出工作区' })).not.toBeInTheDocument())
    expect(screen.getByRole('dialog', { name: 'test@example.com' })).toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(onClose).not.toHaveBeenCalled()
  })

  it('exports one selected account and keeps the selection available after failure', async () => {
    const onDownload = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const onClose = vi.fn()
    render(<WorkspaceExportDialog detail={detailForPage(1)} busy={false} pageLoading={false} onClose={onClose} onDownload={onDownload} onLoadProfilePage={vi.fn()} />)

    expect(screen.getByRole('button', { name: '导出所选账号（0）' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: /账号 2/ }))
    fireEvent.click(screen.getByRole('button', { name: '导出所选账号（1）' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('导出失败，请重试。')
    expect(onDownload).toHaveBeenLastCalledWith(['profile-2'])
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox', { name: /账号 2/ })).toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: '导出所选账号（1）' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(onDownload).toHaveBeenLastCalledWith(['profile-2'])
  })

  it('retains multiple selections across pages and blocks changes during export', async () => {
    const onDownload = vi.fn().mockResolvedValue(false)
    const onClose = vi.fn()
    const onLoadProfilePage = vi.fn()
    const props = { busy: false, pageLoading: false, onClose, onDownload, onLoadProfilePage }
    const { rerender } = render(<WorkspaceExportDialog {...props} detail={detailForPage(1)} />)

    fireEvent.click(screen.getByRole('checkbox', { name: /账号 1/ }))
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(onLoadProfilePage).toHaveBeenCalledWith(2)
    rerender(<WorkspaceExportDialog {...props} detail={detailForPage(2)} />)
    fireEvent.click(screen.getByRole('button', { name: '全选当前页' }))
    fireEvent.click(screen.getByRole('button', { name: '全选当前页' }))
    fireEvent.click(screen.getByRole('button', { name: '导出所选账号（3）' }))
    await screen.findByRole('alert')
    expect(onDownload).toHaveBeenCalledWith(['profile-1', 'profile-3', 'profile-4'])

    rerender(<WorkspaceExportDialog {...props} detail={detailForPage(1)} busy />)
    expect(screen.getByRole('checkbox', { name: /账号 1/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /账号 2/ })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /账号 1/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()

    rerender(<WorkspaceExportDialog {...props} detail={detailForPage(1)} />)
    fireEvent.click(screen.getByRole('button', { name: '清空选择' }))
    expect(screen.getByRole('button', { name: '导出所选账号（0）' })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: /账号 1/ })).not.toBeChecked()
  })
})
