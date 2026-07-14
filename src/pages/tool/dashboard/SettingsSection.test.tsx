// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SettingsSection from './SettingsSection'

afterEach(() => cleanup())

describe('SettingsSection privacy controls', () => {
  it('shows export, retention, and destructive account controls', () => {
    render(<SettingsSection profiles={[{
      id: 'profile-1', user_id: 'user-1', kind: 'depot_value', permission: 'growth', status: 'active', cdk_order_hash: null,
      display_name: '仓库分析', note: '', skland_binding: null, operator_count: 0, created_at: '2026-01-01T00:00:00.000Z', updated_at: null,
    }]} onLogout={vi.fn()} />)
    expect(screen.getByRole('heading', { name: '数据与隐私' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导出个人数据' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '撤回仓库样本' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '发起注销请求' })).toBeDisabled()
  })
})
