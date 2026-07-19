// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AnnouncementBodyEditor from './AnnouncementBodyEditor'

afterEach(cleanup)

describe('AnnouncementBodyEditor tabs', () => {
  it('keeps the selected tab and controlled panel in sync during rapid changes', async () => {
    const user = userEvent.setup()
    render(<AnnouncementBodyEditor id="announcement" value="公告正文" onChange={vi.fn()} />)
    const [editTab, previewTab] = screen.getAllByRole('tab')

    expect(editTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'announcement-editor')

    await user.click(previewTab)
    await user.click(editTab)
    await user.click(previewTab)

    expect(previewTab).toHaveAttribute('aria-selected', 'true')
    expect(editTab).toHaveAttribute('aria-selected', 'false')
    expect(previewTab).toHaveAttribute('aria-controls', 'announcement-preview')
    const panel = screen.getByRole('tabpanel')
    expect(panel).toHaveAttribute('id', 'announcement-preview')
    expect(within(panel).getByText('公告正文')).toBeInTheDocument()
  })
})
