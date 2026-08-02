// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminUserDetail } from '../contracts'
import { buildUserWorkspaceExportFilename } from '../shared/helpers'
import { UserDetailDialog, personalUseActionLabel, type UserDetailPanelProps } from './components'

afterEach(() => {
  cleanup()
})

describe('personal-use admin action labels', () => {
  it('labels every protected action explicitly', () => {
    expect(personalUseActionLabel('free_preview_claim')).toBe('领取免费权益')
    expect(personalUseActionLabel('metered_personal_create')).toBe('创建/转换个人按次档案')
    expect(personalUseActionLabel('generated_result_export')).toBe('导出生成结果')
    expect(personalUseActionLabel('optimization_generate')).toBe('生成排班结果')
    expect(personalUseActionLabel('reorder_check')).toBe('调序检查')
  })
})

describe('admin user workspace export controls', () => {
  it('renders one user-level export button and invokes its callback', () => {
    const props = userDetailProps()
    const { rerender } = render(createElement(UserDetailDialog, props))

    fireEvent.click(screen.getByRole('button', { name: '导出工作区' }))
    expect(props.onDownloadWorkspaces).toHaveBeenCalledOnce()

    rerender(createElement(UserDetailDialog, {
      ...props,
      busyAction: `user-workspaces-export:${props.detail.user.id}`,
    }))
    expect(screen.getByRole('button', { name: '处理中' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '冻结用户' })).toBeEnabled()
  })

  it('builds a safe timestamped filename from the user id prefix', () => {
    expect(buildUserWorkspaceExportFilename('user-123456789', new Date('2026-08-03T04:05:06')))
      .toBe('maa-user-workspaces-user-123-20260803-040506.json')
  })
})

describe('admin user detail disclosure sections', () => {
  it('keeps balance and declarations collapsed by default and toggles them independently', () => {
    render(createElement(UserDetailDialog, userDetailProps()))

    const balanceDetails = screen.getByRole('heading', { name: '积分余额' }).closest('details') as HTMLDetailsElement
    const declarationsDetails = screen.getByRole('heading', { name: '个人使用声明确认' }).closest('details') as HTMLDetailsElement

    expect(balanceDetails.open).toBe(false)
    expect(declarationsDetails.open).toBe(false)

    fireEvent.click(balanceDetails.querySelector('summary')!)
    expect(balanceDetails.open).toBe(true)
    expect(declarationsDetails.open).toBe(false)

    fireEvent.click(declarationsDetails.querySelector('summary')!)
    expect(balanceDetails.open).toBe(true)
    expect(declarationsDetails.open).toBe(true)

    fireEvent.click(balanceDetails.querySelector('summary')!)
    expect(balanceDetails.open).toBe(false)
    expect(declarationsDetails.open).toBe(true)
  })
})

function userDetailProps(): UserDetailPanelProps {
  const user: AdminUserDetail['user'] = {
    id: 'user-123456789',
    email: 'user@example.test',
    email_verified_at: '2026-01-01T00:00:00.000Z',
    permission: 'advanced',
    status: 'active',
    cdk_order_hash: null,
    profile_count: 0,
    profile_access: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
  }
  const profileAction = vi.fn(async () => undefined)
  return {
    detail: { user, profiles: [], personal_use_declarations: [] },
    busyAction: null,
    operatorDataByProfileId: {},
    expandedOperatorProfileId: null,
    balance: null,
    balanceLoading: false,
    onClose: vi.fn(),
    onUpdateProfile: profileAction,
    onSetProfileStatus: profileAction,
    onSetProfilePermission: profileAction,
    onUpgradePreviewProfile: profileAction,
    onClearSklandBinding: profileAction,
    onClearWorkspace: profileAction,
    onViewOperators: profileAction,
    onDownloadOperators: profileAction,
    onDownloadWorkspaces: vi.fn(async () => undefined),
    onAdjustBalance: vi.fn(async () => true),
    onLoadMoreBalance: vi.fn(async () => undefined),
    onFreezeUser: vi.fn(async () => undefined),
    onUnfreezeUser: vi.fn(async () => undefined),
    onDeleteUser: vi.fn(async () => undefined),
  }
}
