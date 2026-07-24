// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type { Announcement } from '../../../lib/types'
import AnnouncementSettingsSection from './AnnouncementSettingsSection'

vi.mock('../../../components/AnnouncementBodyEditor', () => ({
  default: ({ id, value }: { id: string; value: string }) => <div data-testid={id}>{value}</div>,
}))

const banner = createAnnouncement('banner', 'banner', '横幅标题', '横幅正文')
const announcements = [
  createAnnouncement('one', 'popup', '第一条公告', '第一条正文'),
  createAnnouncement('two', 'popup', '第二条公告', '第二条正文'),
]

describe('AnnouncementSettingsSection', () => {
  afterEach(() => cleanup())

  it('selects one announcement for editing and keeps the other details collapsed', async () => {
    const user = userEvent.setup()
    renderSection()

    const list = screen.getByRole('list', { name: '弹出式公告列表' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByTestId('announcement-one')).toHaveTextContent('第一条正文')
    expect(screen.queryByTestId('announcement-two')).not.toBeInTheDocument()

    await user.click(within(list).getByRole('button', { name: /第二条公告/, pressed: false }))
    expect(screen.queryByTestId('announcement-one')).not.toBeInTheDocument()
    expect(screen.getByTestId('announcement-two')).toHaveTextContent('第二条正文')
  })

  it('edits, reorders, deletes, adds, and submits through the supplied callbacks', async () => {
    const user = userEvent.setup()
    const callbacks = renderSection()
    const list = screen.getByRole('list', { name: '弹出式公告列表' })

    await user.click(within(list).getByRole('button', { name: /第二条公告/, pressed: false }))
    await user.clear(screen.getByLabelText('标题'))
    expect(callbacks.onUpdate).toHaveBeenLastCalledWith('two', { title: '' })

    await user.click(screen.getByRole('button', { name: '上移' }))
    expect(callbacks.onReorder).toHaveBeenCalledWith(1, 0)
    await user.click(screen.getByRole('button', { name: '删除' }))
    expect(callbacks.onDelete).toHaveBeenCalledWith('two')
    await user.click(screen.getByRole('button', { name: '新增弹出式公告' }))
    expect(callbacks.onAdd).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '发布横幅和公告' }))
    expect(callbacks.onSubmit).toHaveBeenCalled()
  })

  it('announces restored conflicts and exposes draft recovery actions', async () => {
    const user = userEvent.setup()
    const callbacks = renderSection({
      draftStatus: 'saved',
      draftSavedAt: '2026-07-24T13:00:00.000Z',
      draftRestored: true,
      draftConflict: true,
      draftDirty: true,
    })

    expect(screen.getByText(/已恢复本机草稿/)).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByText(/线上版本已变化/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '发布并覆盖线上版本' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '丢弃草稿并载入线上版本' }))
    expect(callbacks.onDiscardDraft).toHaveBeenCalledOnce()
  })

  it('announces local storage failures as alerts', () => {
    renderSection({ draftStatus: 'error', draftError: '草稿空间不足', draftDirty: true })
    expect(screen.getByRole('alert')).toHaveTextContent('草稿空间不足')
  })
})

function renderSection(overrides: Partial<ComponentProps<typeof AnnouncementSettingsSection>> = {}) {
  const callbacks = {
    onSubmit: vi.fn((event) => event.preventDefault()),
    onUpdateBanner: vi.fn(),
    onAdd: vi.fn(() => 'three'),
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
    onReorder: vi.fn(),
    onDiscardDraft: vi.fn(),
  }
  render(
    <AnnouncementSettingsSection
      banner={banner}
      announcements={announcements}
      stats={{}}
      saving={false}
      discarding={false}
      draftStatus="clean"
      draftSavedAt={null}
      draftRestored={false}
      draftConflict={false}
      draftError={null}
      draftDirty={false}
      {...callbacks}
      {...overrides}
    />,
  )
  return callbacks
}

function createAnnouncement(id: string, kind: 'banner' | 'popup', title: string, body: string): Announcement {
  return {
    id,
    kind,
    active: true,
    title,
    body,
    created_at: '2026-07-22T00:00:00.000Z',
    updated_at: '2026-07-22T00:00:00.000Z',
  }
}
