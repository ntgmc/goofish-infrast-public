// @vitest-environment jsdom
import { useEffect } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { AnimatedPresenceRegion } from './MotionPrimitives'

afterEach(() => cleanup())

it('releases the previous section and its pending request as soon as navigation commits', () => {
  const requests = new Map<string, AbortController>()
  function Section({ name }: { name: string }) {
    useEffect(() => {
      const controller = new AbortController()
      requests.set(name, controller)
      return () => controller.abort()
    }, [name])
    return <form aria-label={name}><input id="section-input" /></form>
  }

  const { rerender } = render(<AnimatedPresenceRegion motionKey="first"><Section name="first" /></AnimatedPresenceRegion>)
  rerender(<AnimatedPresenceRegion motionKey="second"><Section name="second" /></AnimatedPresenceRegion>)

  expect(requests.get('first')?.signal.aborted).toBe(true)
  expect(requests.get('second')?.signal.aborted).toBe(false)
  expect(screen.queryByRole('form', { name: 'first', hidden: true })).not.toBeInTheDocument()
  expect(screen.getByRole('form', { name: 'second' })).toBeInTheDocument()
  expect(document.querySelectorAll('#section-input')).toHaveLength(1)
})
