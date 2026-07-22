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
    const list = within(panel).getByRole('list', { name: 'FAQ 条目' })
    const itemButtons = within(list).getAllByRole('button', { pressed: false })
    expect(itemButtons.length).toBeGreaterThan(1)
    expect(within(panel).getAllByLabelText(/问题/)).toHaveLength(1)

    await user.click(itemButtons[0])
    const selectedQuestion = within(panel).getByLabelText(/问题/)
    const originalQuestion = (selectedQuestion as HTMLInputElement).value
    await user.clear(selectedQuestion)
    await user.type(selectedQuestion, '更新后的第二个问题')
    await user.click(within(panel).getByRole('button', { name: '上移' }))
    await user.click(screen.getByRole('button', { name: '保存并发布' }))

    await waitFor(() => expect(adminApiJson).toHaveBeenLastCalledWith('/api/admin/public-content', expect.objectContaining({
      method: 'PUT',
      json: expect.objectContaining({
        faq: expect.objectContaining({
          items: expect.arrayContaining([expect.objectContaining({ question: '更新后的第二个问题' })]),
        }),
      }),
    })))
    const savedDocument = adminApiJson.mock.calls[adminApiJson.mock.calls.length - 1]?.[1]?.json
    expect(savedDocument.faq.items[0].question).toBe('更新后的第二个问题')
    expect(savedDocument.faq.items[1].question).not.toBe(originalQuestion)
    expect(refresh).toHaveBeenCalled()
    expect(screen.getByText('公开内容已保存并发布。')).toBeInTheDocument()
  })

  it('does not expose a save action when loading fails', async () => {
    adminApiJson.mockRejectedValueOnce(new Error('数据库不可用'))
    render(<PublicContentSettingsSection />)
    expect(await screen.findByRole('alert')).toHaveTextContent('数据库不可用')
    expect(screen.queryByRole('button', { name: '保存并发布' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument()
  })

  it('edits the selected developer GitHub avatar before publishing', async () => {
    const user = userEvent.setup()
    render(<PublicContentSettingsSection />)
    await screen.findByRole('heading', { name: '公开内容管理' })
    await user.click(screen.getByRole('tab', { name: '致谢' }))

    const panel = screen.getByRole('tabpanel')
    const sections = within(panel).getByRole('list', { name: '致谢分组' })
    await user.click(within(sections).getByRole('button', { name: /开发者/, pressed: false }))

    const avatarInput = within(panel).getByLabelText(/可选 HTTPS 头像地址/)
    await user.clear(avatarInput)
    await user.type(avatarInput, 'https://github.com/ntgmc.png')
    await user.click(screen.getByRole('button', { name: '保存并发布' }))

    await waitFor(() => expect(adminApiJson).toHaveBeenLastCalledWith('/api/admin/public-content', expect.objectContaining({
      method: 'PUT',
      json: expect.objectContaining({
        thanks: expect.objectContaining({
          sections: expect.arrayContaining([
            expect.objectContaining({
              id: 'developers',
              entries: expect.arrayContaining([
                expect.objectContaining({ id: 'ntgmc', avatar_url: 'https://github.com/ntgmc.png' }),
              ]),
            }),
          ]),
        }),
      }),
    })))
  })
})
