// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MotionPreferenceProvider, useMotionPreference } from '../../lib/motion-preference'
import { V2PageTransition } from './V2Transition'

afterEach(() => {
  cleanup()
  window.localStorage.removeItem('maatool-reduce-motion')
  Reflect.deleteProperty(document, 'startViewTransition')
  vi.restoreAllMocks()
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
  expect(container.firstChild).not.toHaveAttribute('inert')
  expect(screen.getByRole('heading', { name: 'tools' })).toBeInTheDocument()
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

function mockViewTransitions() {
  const pending: { update: () => void; finish: () => void; skipTransition: ReturnType<typeof vi.fn> }[] = []
  const start = vi.fn((update: () => void) => {
    let finish!: () => void
    const finished = new Promise<void>((resolve) => { finish = resolve })
    const skipTransition = vi.fn()
    pending.push({ update, finish, skipTransition })
    return { ready: Promise.resolve(), finished, skipTransition }
  })
  Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start })
  return { start, pending }
}

it('crossfades page snapshots without replacing mounted drafts or animating the first page', async () => {
  const { start, pending } = mockViewTransitions()
  const { rerender, container } = render(<V2PageTransition motionKey="overview">{content}</V2PageTransition>)
  expect(start).not.toHaveBeenCalled()
  const draft = screen.getByRole('textbox', { name: 'Schedule draft' })
  fireEvent.change(draft, { target: { value: 'edited' } })
  rerender(<V2PageTransition motionKey="tools">{content}</V2PageTransition>)
  expect(container.firstChild).toHaveAttribute('data-page-entering', 'native')
  act(() => pending[0].update())
  expect(screen.getByRole('heading', { name: 'tools' })).toBeInTheDocument()
  expect(container.firstChild).not.toHaveAttribute('inert')
  await act(async () => pending[0].finish())
  expect(container.firstChild).not.toHaveAttribute('data-page-entering')

  rerender(<V2PageTransition motionKey="overview">{content}</V2PageTransition>)
  act(() => pending[1].update())
  expect(screen.getByRole('textbox', { name: 'Schedule draft' })).toBe(draft)
  expect(draft).toHaveValue('edited')
  await act(async () => pending[1].finish())
})

it('keeps loading indicators live instead of holding their snapshots', async () => {
  const { pending } = mockViewTransitions()
  const renderPage = (section: string) => <section className="v2-page-section"><div className="v2-section-body">
    {section === 'tools' ? <div className="v2-section-loading-region" role="status">Loading tools</div> : <h1>overview</h1>}
  </div></section>
  const { rerender, container } = render(<V2PageTransition motionKey="overview">{renderPage}</V2PageTransition>)
  rerender(<V2PageTransition motionKey="tools">{renderPage}</V2PageTransition>)
  await act(async () => pending[0].update())
  expect(screen.getByRole('status')).toHaveTextContent('Loading tools')
  expect(pending[0].skipTransition).toHaveBeenCalledOnce()
  expect(container.firstChild).not.toHaveAttribute('data-route-pending')
  await act(async () => pending[0].finish())
})

it('ignores superseded snapshot callbacks and keeps the latest transition active', async () => {
  const { pending } = mockViewTransitions()
  const { rerender, container } = render(<V2PageTransition motionKey="overview">{content}</V2PageTransition>)
  rerender(<V2PageTransition motionKey="tools">{content}</V2PageTransition>)
  rerender(<V2PageTransition motionKey="settings">{content}</V2PageTransition>)
  expect(pending[0].skipTransition).toHaveBeenCalledOnce()
  act(() => { pending[1].update(); pending[0].update() })
  expect(screen.getByRole('heading', { name: 'settings' })).toBeInTheDocument()
  await act(async () => pending[0].finish())
  expect(container.firstChild).toHaveAttribute('data-page-entering', 'native')
  await act(async () => pending[1].finish())
  expect(container.firstChild).not.toHaveAttribute('data-page-entering')
})

it('cancels a pending snapshot when reduced motion is enabled', async () => {
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(0)
  const { pending } = mockViewTransitions()
  function ReduceAnimations() {
    const preference = useMotionPreference()
    return <button onClick={() => preference?.setReduceAnimations(true)}>Reduce animations</button>
  }
  function Page({ section }: { section: string }) {
    return <MotionPreferenceProvider><V2PageTransition motionKey={section}>{content}</V2PageTransition><ReduceAnimations /></MotionPreferenceProvider>
  }
  const { rerender, container } = render(<Page section="overview" />)
  rerender(<Page section="tools" />)
  fireEvent.click(screen.getByRole('button', { name: 'Reduce animations' }))
  rerender(<Page section="settings" />)
  act(() => pending[0].update())
  await act(async () => pending[0].finish())
  expect(pending[0].skipTransition).toHaveBeenCalledOnce()
  expect(screen.getByRole('heading', { name: 'settings' })).toBeInTheDocument()
  expect(container.firstChild).not.toHaveAttribute('data-page-entering')
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
