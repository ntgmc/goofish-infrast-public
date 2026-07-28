// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Announcement, AuthSuccessResponse, AuthUser, UserGameAccount } from '../../lib/types'
import AccountDashboard from './AccountDashboard'
import WorkspaceSetupPage from './WorkspaceSetupPage'
import { tourStorageKey } from '../../components/GuidedTour'

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
  it('renders announcement banners in the main content flow', () => {
    renderWorkspace({
      announcement: {
        id: 'banner-1',
        kind: 'banner',
        title: '维护公告',
        body: '今晚进行例行维护。',
        active: true,
        created_at: '2026-07-21T00:00:00.000Z',
        updated_at: '2026-07-21T00:00:00.000Z',
      },
    })

    const banner = screen.getByRole('region', { name: '站内横幅' })
    expect(banner.closest('header')).toBeNull()
    expect(banner.parentElement).toHaveClass('mx-auto', 'max-w-7xl', 'space-y-4')
  })

  it('moves the setup guide to configuration without saving workspace data', async () => {
    window.localStorage.removeItem(tourStorageKey('workspace-setup', 1))
    const user = userEvent.setup()
    renderWorkspace()

    expect(await screen.findByRole('heading', { name: '完成排班准备' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '下一步' }))
    expect(await screen.findByRole('heading', { name: '先选择基建配置' })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /基建配置/, hidden: true }).some((button) => button.getAttribute('aria-current') === 'page')).toBe(true)
    })

    await user.click(screen.getByRole('button', { name: '下一步' }))
    await user.click(screen.getByRole('button', { name: '下一步' }))
    await user.click(screen.getByRole('button', { name: '完成' }))

    expect(apiJsonMock).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(tourStorageKey('workspace-setup', 1))).toBe('done')
    expect(screen.getAllByRole('button', { name: /基建配置/ }).some((button) => button.getAttribute('aria-current') === 'page')).toBe(true)
  })

  it('keeps manual operator import disabled for free profiles during the advanced trial', () => {
    const { container } = renderWorkspace()

    expect(container.querySelector<HTMLInputElement>('input[type="file"]')).toBeDisabled()
  })

  it('checks an uploaded operator file immediately and preserves trusted data when blocked', async () => {
    const user = userEvent.setup()
    const onSynced = vi.fn()
    apiJsonMock.mockRejectedValue(new Error('本次操作已拦截：高星干员从绑定账号中消失。'))
    const { container } = renderWorkspace({
      profile: createAdvancedProfile(),
      workspace: createAdvancedWorkspace(),
      onSynced,
    })
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).not.toBeDisabled()

    await user.upload(input!, new File([JSON.stringify([
      { id: 'char_002_amiya', name: '阿米娅', own: true, elite: 2, rarity: 4 },
    ])], 'operators.json', { type: 'application/json' }))

    await waitFor(() => expect(apiJsonMock).toHaveBeenCalledWith('/api/user/workspace', {
      method: 'PATCH',
      json: {
        profile_id: 'advanced-profile',
        operators: [{ id: 'char_002_amiya', name: '阿米娅', own: true, elite: 2, rarity: 4 }],
      },
      fallbackMessage: '导入干员数据失败，请稍后重试',
    }))
    expect(await screen.findByRole('alert')).toHaveTextContent('本次操作已拦截')
    expect(screen.getByText('陈')).toBeInTheDocument()
    expect(screen.queryByText('阿米娅')).not.toBeInTheDocument()
    expect(onSynced).not.toHaveBeenCalled()
  })

  it('separates the desktop account actions in one bottom navigation group', () => {
    renderWorkspace()

    const accountActions = screen.getByRole('navigation', { name: '账号操作' })
    expect(accountActions).toHaveClass('grid-cols-2', 'gap-2')
    expect(within(accountActions).getByRole('button', { name: '返回账号列表' })).toBeInTheDocument()
    expect(within(accountActions).getByRole('button', { name: '退出登录' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '返回账号列表' })).toHaveLength(1)
  })

  it('switches sections and preserves account actions in the compact menu', async () => {
    window.localStorage.setItem(tourStorageKey('workspace-setup', 1), 'done')
    const user = userEvent.setup()
    const onBack = vi.fn()
    const onLogout = vi.fn()
    renderWorkspace({ onBack, onLogout })

    const openMenu = () => user.click(screen.getByRole('button', { name: '打开栏目菜单' }))
    await openMenu()
    await user.click(screen.getByRole('menuitem', { name: /基建配置/ }))
    expect(screen.getByRole('button', { name: '打开栏目菜单' })).toHaveTextContent('基建配置')

    await openMenu()
    await user.click(screen.getByRole('menuitem', { name: '返回账号列表' }))
    expect(onBack).toHaveBeenCalledOnce()

    await openMenu()
    await user.click(screen.getByRole('menuitem', { name: '退出登录' }))
    expect(onLogout).toHaveBeenCalledOnce()
  })

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
        announcement={null}
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
  announcement?: Announcement | null
  profile?: UserGameAccount
  workspace?: AuthSuccessResponse['workspace']
  onSynced?: (payload: AuthSuccessResponse) => void
  onRedeemNewProfile?: () => void
  onBack?: () => void
  onLogout?: () => void
} = {}) {
  return render(
    <MemoryRouter>
      <WorkspaceSetupHarness overrides={overrides} />
    </MemoryRouter>,
  )
}

function WorkspaceSetupHarness({ overrides }: {
  overrides: {
    announcement?: Announcement | null
    profile?: UserGameAccount
    workspace?: AuthSuccessResponse['workspace']
    onSynced?: (payload: AuthSuccessResponse) => void
    onRedeemNewProfile?: () => void
    onBack?: () => void
    onLogout?: () => void
  }
}) {
  const [activeSection, setActiveSection] = useState<'operators' | 'config' | 'cdk'>('operators')

  return (
    <WorkspaceSetupPage
      user={{ id: 'user-1', email: 'test@example.com' } as AuthUser}
      profile={overrides.profile ?? createPreviewProfile()}
      workspace={overrides.workspace ?? null}
      announcement={overrides.announcement ?? null}
      activeSection={activeSection}
      onSectionChange={setActiveSection}
      onSaved={vi.fn()}
      onSynced={overrides.onSynced ?? vi.fn()}
      onBack={overrides.onBack ?? vi.fn()}
      onRedeemNewProfile={overrides.onRedeemNewProfile ?? vi.fn()}
      onLogout={overrides.onLogout ?? vi.fn()}
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

function createAdvancedProfile(): UserGameAccount {
  return {
    ...createPreviewProfile(),
    id: 'advanced-profile',
    kind: 'cdk',
    permission: 'advanced',
    display_name: '高级档案',
  }
}

function createAdvancedWorkspace(): NonNullable<AuthSuccessResponse['workspace']> {
  return {
    profile_id: 'advanced-profile',
    operators: [{ id: 'char_010_chen', name: '陈', own: true, elite: 2, rarity: 5 }],
    config: null,
    elite_overrides: {},
    last_result: null,
    saved_configs: [],
    result_history: [],
    archived_results: [],
    free_schedule_entitlement: null,
    updated_at: '2026-07-25T00:00:00.000Z',
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
