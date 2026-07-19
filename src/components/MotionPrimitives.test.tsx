// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { MotionConfig } from 'motion/react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AnimatedPresenceRegion,
  AnimatedValue,
  MotionSkeleton,
  RevealItem,
  StaggeredReveal,
} from './MotionPrimitives'

afterEach(cleanup)

describe('motion primitives', () => {
  it('makes an exiting presence region inert while showing the latest content immediately', () => {
    const { rerender } = render(<AnimatedPresenceRegion motionKey="first"><button>旧操作</button></AnimatedPresenceRegion>)

    rerender(<AnimatedPresenceRegion motionKey="second"><button>新操作</button></AnimatedPresenceRegion>)

    expect(screen.getByRole('button', { name: '新操作' })).toBeInTheDocument()
    const oldAction = screen.queryByText('旧操作')
    if (oldAction) {
      expect(oldAction.parentElement).toHaveAttribute('aria-hidden', 'true')
      expect(oldAction.parentElement).toHaveAttribute('inert')
    }
  })

  it('exposes only the final animated value to assistive technology', () => {
    const { rerender } = render(<AnimatedValue value="12.50%" />)
    rerender(<AnimatedValue value="18.75%" />)

    expect(screen.getByLabelText('18.75%')).toBeInTheDocument()
    expect(screen.queryByLabelText('12.50%')).not.toBeInTheDocument()
  })

  it('keeps reduced-motion reveals static and provides a labelled skeleton state', () => {
    const { container } = render(
      <MotionConfig reducedMotion="always">
        <StaggeredReveal><RevealItem>静态内容</RevealItem></StaggeredReveal>
        <MotionSkeleton label="正在载入测试内容" rows={4} />
      </MotionConfig>,
    )

    expect(screen.getByRole('status', { name: '正在载入测试内容' })).toBeInTheDocument()
    expect(container.querySelectorAll('.motion-skeleton-block')).toHaveLength(4)
    expect(screen.getByText('静态内容').parentElement).not.toHaveStyle({ transform: 'translateY(8px)' })
  })
})
