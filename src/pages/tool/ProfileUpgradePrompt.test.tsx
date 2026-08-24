// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import type { InventoryResponse, InventoryStack } from '../../lib/inventory-contracts'
import type { UserGameAccount } from '../../lib/types'
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog'
import ProfileUpgradePrompt, { profileUpgradePromptStorageKey, type ProfileUpgradePromptProps } from './ProfileUpgradePrompt'

const { apiJson } = vi.hoisted(() => ({ apiJson: vi.fn() }))

vi.mock('../../lib/api-client', () => ({ apiJson }))

const binding = {
  uid: 'skland-uid-1',
  nickname: '测试用户',
  channel_name: '官服',
  bound_at: '2026-07-01T00:00:00.000Z',
  last_imported_at: null,
  credential_status: 'available' as const,
  credential_invalid_at: null,
  credential_invalid_reason: null,
}

afterEach(() => cleanup())

beforeEach(() => {
  apiJson.mockReset().mockResolvedValue(emptyInventory())
  window.localStorage.clear()
})

describe('ProfileUpgradePrompt', () => {
  it('shows the limited voucher prompt', async () => {
    apiJson.mockResolvedValue(inventoryWith('limited_profile_voucher', 'use'))

    renderPrompt()

    expect(await screen.findByRole('dialog')).toHaveTextContent('限时 CDK')
    expect(screen.getByRole('button', { name: '前往背包查看' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '不再提示' })).toBeInTheDocument()
  })

  it('shows lifetime and combined voucher copy', async () => {
    apiJson.mockResolvedValue(inventoryWith('lifetime_profile_voucher', 'bind'))
    renderPrompt({ userId: 'lifetime-user' })
    expect(await screen.findByRole('dialog')).toHaveTextContent('终身版兑换 CDK')
    cleanup()

    apiJson.mockResolvedValue(inventoryWith(
      'limited_profile_voucher', 'use',
      'lifetime_profile_voucher', 'bind',
    ))
    renderPrompt({ userId: 'combined-user' })
    expect(await screen.findByRole('dialog')).toHaveTextContent('背包中有多种档案升级道具，请前往背包查看用途和有效期。')
  })

  it.each([
    ['正式档案', { kind: 'cdk' as const }],
    ['冻结档案', { status: 'frozen' as const }],
    ['未绑定档案', { skland_binding: null }],
  ])('does not request or show for %s', async (_label, profileOverrides) => {
    renderPrompt({ profile: createProfile(profileOverrides), userId: `ineligible-${_label}` })
    await Promise.resolve()
    expect(apiJson).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does not request when inventory is disabled or the current page is inventory', async () => {
    renderPrompt({ inventoryEnabled: false, userId: 'disabled-user' })
    await Promise.resolve()
    expect(apiJson).not.toHaveBeenCalled()
    cleanup()

    renderPrompt({ currentPath: '/tool/inventory', userId: 'inventory-user' })
    await Promise.resolve()
    expect(apiJson).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('ignores empty and zero-quantity voucher stacks', async () => {
    apiJson.mockResolvedValue({
      ...emptyInventory(),
      stacks: [voucherStack('limited_profile_voucher', 0, ['use'])],
    })
    renderPrompt()
    await waitFor(() => expect(apiJson).toHaveBeenCalledOnce())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does not offer another limited voucher during an active trial, but still offers lifetime upgrade', async () => {
    apiJson.mockResolvedValue(inventoryWith('limited_profile_voucher', 'use'))
    renderPrompt({ profile: createProfile({ trial: activeTrial() }) })
    await waitFor(() => expect(apiJson).toHaveBeenCalledOnce())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    cleanup()

    apiJson.mockResolvedValue(inventoryWith('limited_profile_voucher', 'use', 'lifetime_profile_voucher', 'bind'))
    renderPrompt({ userId: 'trial-lifetime-user', profile: createProfile({ trial: activeTrial() }) })
    expect(await screen.findByRole('dialog')).toHaveTextContent('终身版兑换 CDK')
  })

  it('navigates to inventory and dismisses the current session', async () => {
    apiJson.mockResolvedValue(inventoryWith('lifetime_profile_voucher', 'bind'))
    const onOpenInventory = vi.fn()
    renderPrompt({ onOpenInventory, userId: 'navigate-user' })

    await userEvent.setup().click(await screen.findByRole('button', { name: '前往背包查看' }))
    expect(onOpenInventory).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('stores account-scoped permanent suppression and keeps users isolated', async () => {
    apiJson.mockResolvedValue(inventoryWith('limited_profile_voucher', 'use'))
    const user = userEvent.setup()
    renderPrompt({ userId: 'suppressed-user' })
    await user.click(await screen.findByRole('button', { name: '不再提示' }))
    expect(window.localStorage.getItem(profileUpgradePromptStorageKey('suppressed-user'))).toBe('done')
    cleanup()

    renderPrompt({ userId: 'suppressed-user' })
    await waitFor(() => expect(apiJson).toHaveBeenCalledOnce())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    cleanup()

    renderPrompt({ userId: 'other-user' })
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('suppresses only the current session when dismissed normally', async () => {
    apiJson.mockResolvedValue(inventoryWith('limited_profile_voucher', 'use'))
    const user = userEvent.setup()
    renderPrompt({ userId: 'session-user' })
    await user.click(await screen.findByRole('button', { name: '本次关闭提示' }))
    expect(window.localStorage.getItem(profileUpgradePromptStorageKey('session-user'))).toBeNull()
    cleanup()

    renderPrompt({ userId: 'session-user' })
    await Promise.resolve()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    cleanup()

    renderPrompt({ userId: 'session-user-2' })
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('remains usable when localStorage throws', async () => {
    apiJson.mockResolvedValue(inventoryWith('lifetime_profile_voucher', 'bind'))
    const getItem = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    const user = userEvent.setup()
    renderPrompt({ userId: 'storage-error-user' })
    await user.click(await screen.findByRole('button', { name: '不再提示' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    getItem.mockRestore()
    setItem.mockRestore()
  })

  it('waits for another modal to close before opening', async () => {
    apiJson.mockResolvedValue(inventoryWith('limited_profile_voucher', 'use'))
    function Harness() {
      const [blocked, setBlocked] = React.useState(true)
      return (
        <>
          <button type="button" onClick={() => setBlocked(false)}>关闭公告</button>
          <Dialog open={blocked} onOpenChange={setBlocked}>
            <DialogContent showCloseButton closeLabel="关闭公告">
              <DialogTitle>公告</DialogTitle>
            </DialogContent>
          </Dialog>
          <ProfileUpgradePrompt {...promptProps()} />
        </>
      )
    }

    const user = userEvent.setup()
    render(<Harness />)
    await waitFor(() => expect(screen.getByRole('dialog', { name: '公告' })).toBeInTheDocument())
    expect(screen.queryByText('背包中有档案升级道具')).not.toBeInTheDocument()
    await user.click(within(screen.getByRole('dialog', { name: '公告' })).getByRole('button', { name: '关闭公告' }))
    expect(await screen.findByRole('dialog', { name: '背包中有档案升级道具' })).toBeInTheDocument()
  })

  it('discards inventory results from a previous profile', async () => {
    let resolveFirst!: (value: InventoryResponse) => void
    const firstRequest = new Promise<InventoryResponse>((resolve) => { resolveFirst = resolve })
    apiJson.mockReturnValueOnce(firstRequest).mockResolvedValueOnce(inventoryWith('lifetime_profile_voucher', 'bind'))
    const firstProfile = createProfile({ id: 'profile-a' })
    const secondProfile = createProfile({ id: 'profile-b' })
    const view = render(<ProfileUpgradePrompt {...promptProps({ profile: firstProfile, userId: 'race-user' })} />)
    view.rerender(<ProfileUpgradePrompt {...promptProps({ profile: secondProfile, userId: 'race-user' })} />)
    resolveFirst(inventoryWith('limited_profile_voucher', 'use'))
    await waitFor(() => expect(apiJson).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('dialog')).toHaveTextContent('终身版兑换 CDK')
    expect(screen.queryByText('限时 CDK，立即开启')).not.toBeInTheDocument()
  })

  it('silently ignores inventory failures', async () => {
    apiJson.mockRejectedValue(new Error('network down'))
    renderPrompt({ userId: 'failure-user' })
    await waitFor(() => expect(apiJson).toHaveBeenCalledOnce())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

function renderPrompt(overrides: Partial<ProfileUpgradePromptProps> = {}) {
  return render(<ProfileUpgradePrompt {...promptProps(overrides)} />)
}

function promptProps(overrides: Partial<ProfileUpgradePromptProps> = {}): ProfileUpgradePromptProps {
  return {
    userId: 'prompt-user',
    profile: createProfile(),
    inventoryEnabled: true,
    currentPath: '/tool/profiles',
    onOpenInventory: vi.fn(),
    ...overrides,
  }
}

function createProfile(overrides: Partial<UserGameAccount> = {}): UserGameAccount {
  return {
    id: 'profile-1',
    user_id: 'prompt-user',
    kind: 'free_preview',
    permission: 'recommended',
    trial: null,
    status: 'active',
    cdk_order_hash: null,
    display_name: '免费预览档案',
    note: '',
    skland_binding: binding,
    operator_count: 0,
    updated_at: null,
    created_at: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

function activeTrial() {
  return {
    id: 'trial-1',
    starts_at: '2026-08-01T00:00:00.000Z',
    ends_at: '2026-08-19T16:00:00.000Z',
    active: true,
    effective_permission: 'advanced' as const,
  }
}

function emptyInventory(): InventoryResponse {
  return { stacks: [], capacities: [], reorder_quotas: [], recent_events: [] }
}

function inventoryWith(...values: Array<'limited_profile_voucher' | 'lifetime_profile_voucher' | 'use' | 'bind'>): InventoryResponse {
  const stacks: InventoryStack[] = []
  for (let index = 0; index < values.length; index += 2) {
    const code = values[index]
    const action = values[index + 1]
    if ((code === 'limited_profile_voucher' || code === 'lifetime_profile_voucher') && (action === 'use' || action === 'bind')) {
      stacks.push(voucherStack(code, 1, [action]))
    }
  }
  return { ...emptyInventory(), stacks }
}

function voucherStack(
  code: 'limited_profile_voucher' | 'lifetime_profile_voucher',
  quantity: number,
  actions: InventoryStack['actions'],
): InventoryStack {
  return {
    stack_id: `${code}-stack`,
    item: {
      code,
      kind: 'license_voucher',
      effect_code: code === 'limited_profile_voucher' ? 'activate_limited_profile' : 'bind_lifetime_profile',
      name: code === 'limited_profile_voucher' ? '限时 CDK' : '终身版兑换 CDK',
      description: '',
      icon_key: code,
      system_owned: true,
      issuance_enabled: true,
      created_at: null,
      updated_at: null,
    },
    gift_pack_version_id: null,
    quantity,
    permanent: code === 'lifetime_profile_voucher' ? quantity : 0,
    next_expiry_at: code === 'limited_profile_voucher' ? '2026-08-19T16:00:00.000Z' : null,
    expiry_buckets: [{ quantity, expires_at: code === 'limited_profile_voucher' ? '2026-08-19T16:00:00.000Z' : null }],
    actions,
  }
}
