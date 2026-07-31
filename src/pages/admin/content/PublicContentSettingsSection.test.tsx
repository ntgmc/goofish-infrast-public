// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../lib/api-client'
import { PUBLIC_CONTENT_LIMITS, cloneDefaultPublicContentSettings } from '../../../lib/public-content'

const { adminApiJson } = vi.hoisted(() => ({ adminApiJson: vi.fn() }))
vi.mock('../../../lib/admin-api-client', () => ({ adminApiJson }))

import PublicContentSettingsSection from './PublicContentSettingsSection'

describe('PublicContentSettingsSection', () => {
  beforeEach(() => {
    adminApiJson.mockReset().mockImplementation(async (_url: string, init?: { method?: string }) => ({
      settings: { ...cloneDefaultPublicContentSettings(), revision: init?.method === 'PUT' ? 4 : 3, updated_at: init?.method === 'PUT' ? '2026-07-22T00:00:00.000Z' : null },
    }))
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

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
        expected_revision: 3,
        faq: expect.objectContaining({
          items: expect.arrayContaining([expect.objectContaining({ question: '更新后的第二个问题' })]),
        }),
      }),
    })))
    const savedDocument = adminApiJson.mock.calls[adminApiJson.mock.calls.length - 1]?.[1]?.json
    expect(savedDocument.faq.items[0].question).toBe('更新后的第二个问题')
    expect(savedDocument.faq.items[1].question).not.toBe(originalQuestion)
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

    expect(within(panel).getByLabelText('说明')).not.toBeRequired()
    const avatarInput = within(panel).getByLabelText(/头像地址/)
    await user.clear(avatarInput)
    await user.type(avatarInput, 'https://github.com/ntgmc.png')
    await user.click(screen.getByRole('button', { name: '保存并发布' }))

    await waitFor(() => expect(adminApiJson).toHaveBeenLastCalledWith('/api/admin/public-content', expect.objectContaining({
      method: 'PUT',
      json: expect.objectContaining({
        expected_revision: 3,
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

  it('maps validation errors to fields and focuses the first invalid input', async () => {
    const user = userEvent.setup()
    render(<PublicContentSettingsSection />)
    const name = await screen.findByLabelText(/群名称/)
    await user.clear(name)
    await user.click(screen.getByRole('button', { name: '保存并发布' }))
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(name).toHaveFocus()
    expect(adminApiJson).toHaveBeenCalledTimes(1)
    await user.type(name, '恢复后的群名称')
    expect(name).toHaveAttribute('aria-invalid', 'false')
    expect(name).not.toHaveAttribute('aria-describedby')
  })

  it('marks a non-HTTPS QQ join URL invalid and focuses it', async () => {
    const user = userEvent.setup()
    render(<PublicContentSettingsSection />)
    const joinUrl = await screen.findByLabelText(/HTTPS 入群链接/)
    await user.clear(joinUrl)
    await user.type(joinUrl, 'http://example.com/join')
    await user.click(screen.getByRole('button', { name: '保存并发布' }))
    expect(joinUrl).toHaveAttribute('aria-invalid', 'true')
    expect(joinUrl).toHaveFocus()
    expect(adminApiJson).toHaveBeenCalledTimes(1)
  })

  it('keeps the draft and exposes online reload after a revision conflict', async () => {
    const user = userEvent.setup()
    render(<PublicContentSettingsSection />)
    const name = await screen.findByLabelText(/群名称/)
    await user.clear(name)
    await user.type(name, '本地客服群')
    adminApiJson.mockRejectedValueOnce(new ApiError('conflict', 409, { code: 'settings_conflict' }, '/api/admin/public-content'))
    await user.click(screen.getByRole('button', { name: '保存并发布' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('线上公开内容已被其他管理员更新')
    expect(name).toHaveValue('本地客服群')
    const reload = screen.getByRole('button', { name: '重新加载线上配置' })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await user.click(reload)
    expect(confirm).toHaveBeenCalledOnce()
    expect(adminApiJson).toHaveBeenCalledTimes(2)
    expect(name).toHaveValue('本地客服群')

    confirm.mockReturnValue(true)
    await user.click(reload)
    await waitFor(() => expect(adminApiJson).toHaveBeenCalledTimes(3))
  })

  it('switches to a hidden nested field and focuses an invalid URL', async () => {
    const settings = { ...cloneDefaultPublicContentSettings(), revision: 3 }
    settings.thanks.sections[0].entries[2].avatar_url = 'http://example.com/avatar.png'
    adminApiJson.mockReset().mockResolvedValue({ settings })
    const user = userEvent.setup()
    render(<PublicContentSettingsSection />)
    await screen.findByRole('heading', { name: '公开内容管理' })
    await user.click(screen.getByRole('button', { name: '保存并发布' }))
    await waitFor(() => expect(screen.getByRole('tab', { name: '致谢' })).toHaveAttribute('aria-selected', 'true'))
    const invalidAvatar = await screen.findByDisplayValue('http://example.com/avatar.png')
    await waitFor(() => expect(invalidAvatar).toHaveFocus())
    expect(invalidAvatar).toHaveAttribute('data-validation-path', 'thanks.sections.0.entries.2.avatar_url')
    expect(invalidAvatar).toHaveAttribute('aria-invalid', 'true')
  })

  it('disables adding FAQ items at the shared schema limit', async () => {
    const settings = { ...cloneDefaultPublicContentSettings(), revision: 3 }
    const template = settings.faq.items[0]
    settings.faq.items = Array.from({ length: PUBLIC_CONTENT_LIMITS.faqItems }, (_value, index) => ({
      ...template,
      id: `faq-${index}`,
      question: `问题 ${index}`,
    }))
    adminApiJson.mockReset().mockResolvedValue({ settings })
    const user = userEvent.setup()
    render(<PublicContentSettingsSection />)
    await screen.findByRole('heading', { name: '公开内容管理' })
    await user.click(screen.getByRole('tab', { name: '常见问题' }))
    expect(screen.getByRole('button', { name: '新增 FAQ' })).toBeDisabled()
    expect(screen.getByText(`已达到最多 ${PUBLIC_CONTENT_LIMITS.faqItems} 项的上限。`)).toBeInTheDocument()
  })

  it.each([
    { label: 'pricing disclosures', tab: '价格与权益', button: '新增说明', collection: 'pricingDisclosures', limit: PUBLIC_CONTENT_LIMITS.pricingDisclosures },
    { label: 'pricing comparison rows', tab: '价格与权益', button: '新增对比行', collection: 'pricingComparisonRows', limit: PUBLIC_CONTENT_LIMITS.pricingComparisonRows },
    { label: 'thanks sections', tab: '致谢', button: '新增分组', collection: 'thanksSections', limit: PUBLIC_CONTENT_LIMITS.thanksSections },
    { label: 'thanks entries', tab: '致谢', button: '新增条目', collection: 'thanksEntries', limit: PUBLIC_CONTENT_LIMITS.thanksEntries },
  ] as const)('disables adding $label at the shared schema limit', async ({ tab, button, collection, limit }) => {
    const settings = { ...cloneDefaultPublicContentSettings(), revision: 3 }
    if (collection === 'pricingDisclosures') {
      settings.pricing.disclosures = Array.from({ length: limit }, (_value, index) => `说明 ${index}`)
    } else if (collection === 'pricingComparisonRows') {
      const template = settings.pricing.comparison_rows[0]
      settings.pricing.comparison_rows = Array.from({ length: limit }, (_value, index) => ({
        ...template,
        id: `comparison-${index}`,
        feature: `能力 ${index}`,
      }))
    } else if (collection === 'thanksSections') {
      const template = settings.thanks.sections[0]
      settings.thanks.sections = Array.from({ length: limit }, (_value, index) => ({
        ...template,
        id: `section-${index}`,
        heading: `分组 ${index}`,
      }))
    } else {
      const section = settings.thanks.sections[0]
      const template = section.entries[0] ?? { id: 'entry-template', name: '贡献者', description: '', url: '', avatar_url: '' }
      section.entries = Array.from({ length: limit }, (_value, index) => ({
        ...template,
        id: `entry-${index}`,
        name: `贡献者 ${index}`,
      }))
    }
    adminApiJson.mockReset().mockResolvedValue({ settings })
    const user = userEvent.setup()
    render(<PublicContentSettingsSection />)
    await screen.findByRole('heading', { name: '公开内容管理' })
    await user.click(screen.getByRole('tab', { name: tab }))
    expect(screen.getByRole('button', { name: button })).toBeDisabled()
    expect(screen.getByText(`已达到最多 ${limit} 项的上限。`)).toBeInTheDocument()
  })

  it('maps duplicate business identifiers to the collection error', async () => {
    const settings = { ...cloneDefaultPublicContentSettings(), revision: 3 }
    settings.faq.items = [settings.faq.items[0], {
      ...settings.faq.items[1],
      id: settings.faq.items[0].id,
      question: '重复项问题',
    }]
    adminApiJson.mockReset().mockResolvedValue({ settings })
    const user = userEvent.setup()
    render(<PublicContentSettingsSection />)
    await screen.findByRole('heading', { name: '公开内容管理' })
    await user.click(screen.getByRole('tab', { name: '常见问题' }))
    await user.click(screen.getByRole('button', { name: '保存并发布' }))
    expect(await screen.findByText('条目标识重复，请删除重复条目后重新添加。')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByDisplayValue('重复项问题')).toHaveAttribute('data-validation-path', 'faq.items.1.question'))
  })
})
