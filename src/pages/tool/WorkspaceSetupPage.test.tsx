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
import { cloneDefaultPublicContentSettings } from '../../lib/public-content'
import * as publicContentContext from '../../lib/public-content-context'

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
  vi.spyOn(publicContentContext, 'usePublicContent').mockReturnValue(publicContentValue('https://example.com/xianyu-listing'))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
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

  it('allows commercial profiles to start with JSON instead of a Skland binding', async () => {
    const user = userEvent.setup()
    const onSynced = vi.fn()
    const payload = createPayload()
    apiJsonMock.mockResolvedValue(payload)
    const { container } = renderWorkspace({
      profile: createCommercialProfile(),
      onSynced,
    })
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).not.toBeDisabled()

    await user.upload(input!, new File([JSON.stringify([
      { id: 'char_002_amiya', name: '阿米娅', own: true, elite: 2, rarity: 4 },
    ])], 'commercial.json', { type: 'application/json' }))

    await waitFor(() => expect(apiJsonMock).toHaveBeenCalledWith('/api/user/workspace', {
      method: 'PATCH',
      json: {
        profile_id: 'commercial-profile',
        operators: [{ id: 'char_002_amiya', name: '阿米娅', own: true, elite: 2, rarity: 4 }],
      },
      fallbackMessage: '导入干员数据失败，请稍后重试',
    }))
    expect(onSynced).toHaveBeenCalledWith(payload)
  })

  it('shows all three intermediate materials after a Skland refresh', async () => {
    const user = userEvent.setup()
    const profile: UserGameAccount = {
      ...createAdvancedProfile(),
      skland_binding: {
        uid: '12345678',
        nickname: '材料博士',
        channel_name: '官服',
        bound_at: '2026-08-01T00:00:00.000Z',
        last_imported_at: '2026-08-01T00:00:00.000Z',
        credential_status: 'available',
        credential_invalid_at: null,
        credential_invalid_reason: null,
      },
    }
    apiJsonMock.mockResolvedValue({
      ...createPayload(),
      profiles: [profile],
      active_profile: profile,
      skland_import: {
        status: 'imported',
        uid: '12345678',
        nickname: '材料博士',
        channel_name: '官服',
        operator_count: 2,
        imported_at: '2026-08-01T00:01:00.000Z',
        intermediate_inventory: {
          'Pure Gold': 12,
          'Originium Shard': 3,
          'Orirock Cube': 45,
        },
        inventory_synced: true,
        config_saved: true,
      },
    })

    renderWorkspace({ profile, workspace: createAdvancedWorkspace() })
    await user.click(screen.getByRole('button', { name: '刷新森空岛数据' }))

    const notice = await screen.findByRole('status')
    expect(notice).toHaveTextContent('赤金 12')
    expect(notice).toHaveTextContent('源石碎片 3')
    expect(notice).toHaveTextContent('固源岩 45')
  })

  it('separates the desktop account actions in one bottom navigation group', () => {
    renderWorkspace()

    const accountActions = screen.getByRole('navigation', { name: '账号操作' })
    expect(accountActions).toHaveClass('grid-cols-2', 'gap-2')
    expect(within(accountActions).getByRole('button', { name: '返回账号列表' })).toBeInTheDocument()
    expect(within(accountActions).getByRole('button', { name: '退出登录' })).toHaveClass('tool-danger-action')
    expect(screen.getAllByRole('button', { name: '返回账号列表' })).toHaveLength(1)
  })

  it('renders the business workflow breadcrumb with the active profile context', () => {
    renderWorkspace({ profile: createAdvancedProfile() })

    const breadcrumb = screen.getByRole('navigation', { name: '面包屑' })
    expect(within(breadcrumb).getByRole('link', { name: '首页' })).toHaveAttribute('href', '/')
    expect(within(breadcrumb).getByRole('link', { name: '游戏账号' })).toHaveAttribute('href', '/tool/profiles')
    expect(within(breadcrumb).getByRole('link', { name: '高级档案' })).toHaveAttribute('href', '/tool/profiles?profile_id=advanced-profile')
    expect(within(breadcrumb).getByRole('link', { name: '工作区设置' })).toHaveAttribute('href', '/tool/setup/operators?profile_id=advanced-profile')
    expect(within(breadcrumb).getByText('干员数据')).toHaveAttribute('aria-current', 'page')
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
    apiJsonMock.mockResolvedValue({ redemption_type: 'profile', auth: payload })

    renderWorkspace({ onSynced })
    expect(screen.queryByRole('heading', { name: '档案与 CDK' })).not.toBeInTheDocument()
    await openCdkTab(user)

    await user.type(screen.getByLabelText('升级 CDK'), 'test-cdk')
    await user.click(screen.getByRole('button', { name: '升级当前免费档案' }))

    await waitFor(() => expect(apiJsonMock).toHaveBeenCalledWith('/api/user/cdk/redeem', {
      method: 'POST',
      json: {
        profile_id: 'preview-profile',
        cdk: 'test-cdk',
        idempotency_key: expect.any(String),
      },
      fallbackMessage: '免费档案升级失败，请稍后重试',
    }))
    expect(onSynced).toHaveBeenCalledWith(payload)
  })

  it('reuses the upgrade idempotency key after an unknown result', async () => {
    const user = userEvent.setup()
    const payload = createPayload()
    apiJsonMock
      .mockRejectedValueOnce(new Error('网络响应中断'))
      .mockResolvedValueOnce({ redemption_type: 'profile', auth: payload })

    renderWorkspace()
    await openCdkTab(user)
    await user.type(screen.getByLabelText('升级 CDK'), 'retry-cdk')
    await user.click(screen.getByRole('button', { name: '升级当前免费档案' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('网络响应中断')
    await user.click(screen.getByRole('button', { name: '升级当前免费档案' }))

    await waitFor(() => expect(apiJsonMock).toHaveBeenCalledTimes(2))
    const requests = apiJsonMock.mock.calls.map((call) => call[1]?.json as { idempotency_key?: string })
    expect(requests[0]?.idempotency_key).toBeTruthy()
    expect(requests[1]?.idempotency_key).toBe(requests[0]?.idempotency_key)
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
    expect(purchaseLink).toHaveAttribute('href', 'https://example.com/xianyu-listing')
  })

  it.each([
    { label: 'empty configuration', url: '', isFallback: false },
    { label: 'initial configuration failure', url: 'https://example.com/stale-listing', isFallback: true },
  ])('hides the CDK purchase path for $label', async ({ url, isFallback }) => {
    vi.mocked(publicContentContext.usePublicContent).mockReturnValue(publicContentValue(url, isFallback))
    const user = userEvent.setup()
    renderWorkspace()
    await openCdkTab(user)

    expect(screen.queryByRole('link', { name: '去闲鱼购买 CDK' })).not.toBeInTheDocument()
  })

  it('can open the account dashboard directly on the CDK redemption path', async () => {
    render(
      <MemoryRouter>
        <AccountDashboard
          user={{ id: 'user-1', email: 'test@example.com' } as AuthUser}
          profiles={[createPreviewProfile()]}
          activeProfile={createPreviewProfile()}
          announcement={null}
          announcementUnreadCount={0}
          onAnnouncementUnreadCountChange={vi.fn()}
          openingProfileId={null}
          workspaceLoadError={null}
          section="redeem"
          onSectionChange={vi.fn()}
          onLogout={vi.fn()}
          onPayload={vi.fn()}
          onOpenProfile={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: '添加账号' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: '添加游戏账号' })).toBeInTheDocument()
  })
})

async function openCdkTab(user: ReturnType<typeof userEvent.setup>) {
  const workspaceNavigation = screen.getByRole('navigation', { name: '工作区设置' })
  const cdkTab = within(workspaceNavigation).getByRole('button', { name: '档案与 CDK' })
  await user.click(cdkTab)
  expect(cdkTab).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('heading', { name: '档案与 CDK' })).toBeInTheDocument()
}

function publicContentValue(xianyuUrl: string, isFallback = false): ReturnType<typeof publicContentContext.usePublicContent> {
  const content = cloneDefaultPublicContentSettings()
  content.cdk_purchase.xianyu_url = xianyuUrl
  return { status: 'ready', isFallback, content, refresh: vi.fn() }
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

function createCommercialProfile(): UserGameAccount {
  return {
    ...createAdvancedProfile(),
    id: 'commercial-profile',
    kind: 'metered_commercial',
    permission: 'metered_advanced',
    display_name: '商用账号',
  }
}

function createAdvancedWorkspace(): NonNullable<AuthSuccessResponse['workspace']> {
  return {
    profile_id: 'advanced-profile',
    operators: [{ id: 'char_010_chen', name: '陈', own: true, elite: 2, rarity: 5 }],
    config: null,
    elite_overrides: {},
    latest_result: null,
    saved_configs: [],
    result_history: [],
    archived_results: [],
    result_history_next_cursor: null,
    archived_results_next_cursor: null,
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
