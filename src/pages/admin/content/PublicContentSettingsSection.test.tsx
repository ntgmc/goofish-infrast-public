// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cloneDefaultPublicContentSettings } from '../../../lib/public-content'

const { adminApiJson, refresh } = vi.hoisted(() => ({ adminApiJson: vi.fn(), refresh: vi.fn() }))
vi.mock('../../../lib/admin-api-client', () => ({ adminApiJson }))
vi.mock('../../../lib/public-content-context', () => ({ usePublicContent: () => ({ refresh }) }))

import PublicContentSettingsSection from './PublicContentSettingsSection'

describe('PublicContentSettingsSection', () => {
  beforeEach(() => {
    adminApiJson.mockReset().mockImplementation(async (_url: string, init?: { method?: string }) => ({
      settings: { ...cloneDefaultPublicContentSettings(), updated_at: init?.method === 'PUT' ? '2026-07-22T00:00:00.000Z' : null },
    }))
    refresh.mockReset().mockResolvedValue(undefined)
  })

  afterEach(() => cleanup())

  it('edits and reorders FAQ items before publishing the complete document', async () => {
    const user = userEvent.setup()
    render(<PublicContentSettingsSection />)
    await screen.findByRole('heading', { name: '公开内容管理' })
    await user.click(screen.getByRole('tab', { name: '常见问题' }))

    const panel = screen.getByRole('tabpanel')
    const firstQuestion = within(panel).getAllByLabelText(/问题/)[0]
    await user.clear(firstQuestion)
    await user.type(firstQuestion, '更新后的第一个问题')
    await user.click(within(panel).getAllByRole('button', { name: '下移' })[0])
    await user.click(screen.getByRole('button', { name: '保存并发布' }))

    await waitFor(() => expect(adminApiJson).toHaveBeenLastCalledWith('/api/admin/public-content', expect.objectContaining({
      method: 'PUT',
      json: expect.objectContaining({
        faq: expect.objectContaining({
          items: expect.arrayContaining([expect.objectContaining({ question: '更新后的第一个问题' })]),
        }),
      }),
    })))
    expect(refresh).toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('公开内容已保存并发布。')
  })

  it('does not expose a save action when loading fails', async () => {
    adminApiJson.mockRejectedValueOnce(new Error('数据库不可用'))
    render(<PublicContentSettingsSection />)
    expect(await screen.findByRole('alert')).toHaveTextContent('数据库不可用')
    expect(screen.queryByRole('button', { name: '保存并发布' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument()
  })
})
