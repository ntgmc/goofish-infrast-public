// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { UserStatusPill } from './helpers'

afterEach(cleanup)

describe('UserStatusPill', () => {
  it('marks an active account with no verified timestamp as unverified', () => {
    render(<UserStatusPill status="active" emailVerifiedAt={null} />)

    expect(screen.getByText('未验证')).toHaveClass('tool-status--warning')
  })

  it('keeps a verified active account marked as normal', () => {
    render(<UserStatusPill status="active" emailVerifiedAt="2026-07-27T12:00:00.000Z" />)

    expect(screen.getByText('正常')).toHaveClass('tool-status--success')
  })

  it('keeps an inactive account status ahead of its verification status', () => {
    render(<UserStatusPill status="revoked" emailVerifiedAt={null} />)

    expect(screen.getByText('已撤销')).toHaveClass('tool-status--error')
  })
})
