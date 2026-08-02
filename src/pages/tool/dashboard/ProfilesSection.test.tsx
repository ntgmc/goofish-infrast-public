// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UserGameAccount } from '../../../lib/types'
import ProfilesSection from './ProfilesSection'

afterEach(() => cleanup())

const baseProfile: UserGameAccount = {
  id: 'preview-1',
  user_id: 'user-1',
  kind: 'free_preview',
  permission: 'growth',
  status: 'active',
  cdk_order_hash: null,
  display_name: '主账号',
  note: '',
  operator_count: 120,
  updated_at: '2026-08-01T00:00:00.000Z',
  created_at: '2026-07-20T00:00:00.000Z',
}

describe('ProfilesSection limited profile trial', () => {
  it('shows the active trial deadline without replacing a user note', () => {
    renderProfiles({
      ...baseProfile,
      note: '用于主账号排班',
      trial: {
        id: 'free-preview-limited-cdk-2026',
        starts_at: '2026-08-01T00:00:00.000Z',
        ends_at: '2026-08-19T16:00:00.000Z',
        active: true,
        effective_permission: 'advanced',
      },
    })

    expect(screen.getByText('高级版限时体验')).toBeInTheDocument()
    expect(screen.getByText('用于主账号排班')).toBeInTheDocument()
    expect(screen.getByText(/高级版功能已临时解锁，有效至 2026\/08\/20 00:00；到期后恢复免费预览权限/)).toBeInTheDocument()
    expect(screen.queryByText('免费个人排班可查看完整游戏内轮换，但不提供导出和高级分析。')).not.toBeInTheDocument()
  })

  it('keeps the ordinary free-preview description when no trial is active', () => {
    renderProfiles(baseProfile)

    expect(screen.getByText('免费预览')).toBeInTheDocument()
    expect(screen.getByText('免费个人排班可查看完整游戏内轮换，但不提供导出和高级分析。')).toBeInTheDocument()
    expect(screen.queryByText(/高级版功能已临时解锁/)).not.toBeInTheDocument()
  })
})

function renderProfiles(profile: UserGameAccount) {
  return render(
    <ProfilesSection
      profiles={[profile]}
      openingProfileId={null}
      onOpen={vi.fn()}
      onEdit={vi.fn()}
    />,
  )
}
