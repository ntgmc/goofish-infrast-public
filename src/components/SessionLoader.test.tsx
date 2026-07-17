// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import SessionLoader from './SessionLoader'

afterEach(cleanup)

describe('SessionLoader', () => {
  it('announces the current loading state and hides the decorative animation', () => {
    const { container } = render(<SessionLoader label="正在确认登录信息..." />)

    expect(screen.getByRole('main')).toHaveAttribute('data-route-focus')
    expect(screen.getByRole('status')).toHaveTextContent('正在确认登录信息...')
    expect(container.querySelector('.session-loader')).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelectorAll('.session-loader span')).toHaveLength(5)
  })
})
