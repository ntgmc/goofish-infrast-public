// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthSuccessResponse, AuthUser, UserGameAccount } from '../../lib/types'
import AccountDashboard from './AccountDashboard'
import WorkspaceSetupPage from './WorkspaceSetupPage'

const { apiJsonMock } = vi.hoisted(() => ({
  apiJsonMock: vi.fn(),
}))

vi.mock('../../lib/api-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../lib/api-client')>()
  return {
    ...original,
    apiJson: apiJsonMock,
  }
})

beforeEach(() => {
  apiJsonMock.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('WorkspaceSetupPage CDK paths', () => {
  it('upgrades the current free profile in place and preserves the profile id', async () => {
    const user = userEvent.setup()
    const onSynced = vi.fn()
    const payload = createPayload()
    apiJsonMock.mockResolvedValue(payload)

    renderWorkspace({ onSynced })
    expect(screen.queryByRole('heading', { name: '档案与 CDK' })).not.toBeInTheDocument()
    await openCdkTab(user)

    await user.type(screen.getByLabelText('升级 CDK'), 'test-cdk')
    await user.click(screen.getByRole('button', { name: '升级当前免费档案' }))

    await waitFor(() => expect(apiJsonMock).toHaveBeenCalledWith('/api/user/profiles/redeem', {
      method: 'POST',
      json: { profile_id: 'preview-profile', cdk: 'test-cdk' },
      fallbackMessage: '免费档案升级失败，请稍后重试',
    }))
    expect(onSynced).toHaveBeenCalledWith(payload)
  })

  it('offers paths to redeem a new profile and purchase a CDK', async () => {
    const user = userEvent.setup()
    const onRedeemNewProfile = vi.fn()

    renderWorkspace({ onRedeemNewProfile })
    await openCdkTab(user)

    await user.click(screen.getByRole('button', { name: '前往兑换新档案' }))
    expect(onRedeemNewProfile).toHaveBeenCalledOnce()

    const purchaseLink = screen.getByRole('link', { name: '去闲鱼购买 CDK' })
    expect(purchaseLink).toHaveAttribute('target', '_blank')
    expect(purchaseLink).toHaveAttribute('rel', 'noopener noreferrer')
    expect(purchaseLink).toHaveAttribute('href', expect.stringContaining('m.tb.cn'))
  })

  it('can open the account dashboard directly on the CDK redemption path', async () => {
    render(
      <AccountDashboard
        user={{ id: 'user-1', email: 'test@example.com' } as AuthUser}
        profiles={[createPreviewProfile()]}
        activeProfile={createPreviewProfile()}
        announcementUnreadCount={0}
        openingProfileId={null}
        workspaceLoadError={null}
        section="redeem"
        onSectionChange={vi.fn()}
        onLogout={vi.fn()}
        onPayload={vi.fn()}
        onOpenProfile={vi.fn()}
      />,
    )

    expect(screen.getByRole('heading', { name: '添加账号' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: '新增账号档案' })).toBeInTheDocument()
  })
})

async function openCdkTab(user: ReturnType<typeof userEvent.setup>) {
  const workspaceNavigation = screen.getByRole('navigation', { name: '工作区设置' })
  const cdkTab = within(workspaceNavigation).getByRole('button', { name: '档案与 CDK' })
  await user.click(cdkTab)
  expect(cdkTab).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('heading', { name: '档案与 CDK' })).toBeInTheDocument()
}

function renderWorkspace(overrides: {
  onSynced?: (payload: AuthSuccessResponse) => void
  onRedeemNewProfile?: () => void
} = {}) {
  return render(<WorkspaceSetupHarness overrides={overrides} />)
}

function WorkspaceSetupHarness({ overrides }: {
  overrides: {
    onSynced?: (payload: AuthSuccessResponse) => void
    onRedeemNewProfile?: () => void
  }
}) {
  const [activeSection, setActiveSection] = useState<'operators' | 'config' | 'cdk'>('operators')

  return (
    <WorkspaceSetupPage
      user={{ id: 'user-1', email: 'test@example.com' } as AuthUser}
      profile={createPreviewProfile()}
      workspace={null}
      announcement={null}
      activeSection={activeSection}
      onSectionChange={setActiveSection}
      onSaved={vi.fn()}
      onSynced={overrides.onSynced ?? vi.fn()}
      onBack={vi.fn()}
      onRedeemNewProfile={overrides.onRedeemNewProfile ?? vi.fn()}
      onLogout={vi.fn()}
    />
  )
}

function createPreviewProfile(): UserGameAccount {
  return {
    id: 'preview-profile',
    user_id: 'user-1',
    kind: 'free_preview',
    permission: 'recommended',
    status: 'active',
    cdk_order_hash: null,
    display_name: '免费档案',
    note: '',
    skland_binding: null,
    operator_count: 0,
    updated_at: null,
    created_at: '2026-07-11T00:00:00.000Z',
  }
}

function createPayload(): AuthSuccessResponse {
  const upgradedProfile = {
    ...createPreviewProfile(),
    kind: 'cdk' as const,
    permission: 'advanced' as const,
    cdk_order_hash: 'order-hash',
  }
  return {
    user: { id: 'user-1', email: 'test@example.com' } as AuthUser,
    profiles: [upgradedProfile],
    active_profile: upgradedProfile,
    workspace: null,
  }
}
