// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { MotionPreferenceProvider } from '../../lib/motion-preference'
import { V2PageTransition } from './V2Transition'

afterEach(() => {
  cleanup()
  window.localStorage.removeItem('maatool-reduce-motion')
})

function content(section: string) {
  return <>
    <input aria-label="Schedule draft" hidden={section !== 'overview'} defaultValue="original" />
    <h1>{section}</h1>
  </>
}

it('finishes rapid navigation at the latest page while preserving mounted drafts', async () => {
  const { rerender, container } = render(<V2PageTransition motionKey="overview">{content}</V2PageTransition>)
  const draft = screen.getByRole('textbox', { name: 'Schedule draft' })
  fireEvent.change(draft, { target: { value: 'edited' } })
  rerender(<V2PageTransition motionKey="tools">{content}</V2PageTransition>)
  expect(container.firstChild).toHaveAttribute('inert')
  expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  rerender(<V2PageTransition motionKey="settings">{content}</V2PageTransition>)
  expect(await screen.findByRole('heading', { name: 'settings' })).toBeInTheDocument()
  expect(screen.queryByText('tools')).not.toBeInTheDocument()
  expect(container.firstChild).not.toHaveAttribute('inert')

  rerender(<V2PageTransition motionKey="overview">{content}</V2PageTransition>)
  expect(await screen.findByRole('textbox', { name: 'Schedule draft' })).toBe(draft)
  expect(draft).toHaveValue('edited')
  await waitFor(() => expect(container.firstChild).toHaveStyle({ opacity: '1' }))

  rerender(<V2PageTransition motionKey="tools">{content}</V2PageTransition>)
  rerender(<V2PageTransition motionKey="overview">{content}</V2PageTransition>)
  await waitFor(() => expect(container.firstChild).toHaveStyle({ opacity: '1' }))
  expect(screen.getByRole('heading', { name: 'overview' })).toBeInTheDocument()
  expect(draft).toHaveValue('edited')
})

it('switches immediately when the user reduces animations', () => {
  window.localStorage.setItem('maatool-reduce-motion', 'true')
  function Page({ section }: { section: string }) {
    return <MotionPreferenceProvider><V2PageTransition motionKey={section}>{content}</V2PageTransition></MotionPreferenceProvider>
  }
  const { rerender, container } = render(<Page section="overview" />)
  rerender(<Page section="settings" />)
  expect(screen.getByRole('heading', { name: 'settings' })).toBeInTheDocument()
  expect(container.firstChild).not.toHaveAttribute('inert')
  expect(container.firstChild).toHaveStyle({ opacity: '1' })
})
