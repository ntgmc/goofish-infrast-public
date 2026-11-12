// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { completeDeploymentRefresh, hideDeploymentRefresh, reloadDeployment, showDeploymentRefresh } from './deployment-refresh'

const markup = readFileSync('index.html', 'utf8')
const bootstrap = readFileSync('public/deployment-refresh.js', 'utf8')
const key = 'maatool:deployment-refresh'
let dialog: HTMLDialogElement
let animations: { finish: () => void; cancel: ReturnType<typeof vi.fn> }[]
let animate: ReturnType<typeof vi.fn>

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  document.documentElement.removeAttribute('data-reduced-motion')
  const parsed = new DOMParser().parseFromString(markup, 'text/html')
  document.body.innerHTML = parsed.getElementById('deployment-refresh')!.outerHTML
  dialog = document.querySelector('dialog')!
  dialog.showModal = vi.fn(() => dialog.setAttribute('open', ''))
  dialog.close = vi.fn(() => dialog.removeAttribute('open'))
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
  animations = []
  animate = vi.fn(() => {
    let finish!: () => void
    const finished = new Promise<void>((resolve) => { finish = resolve })
    const animation = { finish, cancel: vi.fn(), finished }
    animations.push(animation)
    return animation
  })
  Object.defineProperty(dialog, 'animate', { value: animate })
})
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('finishes the outgoing fade before recording the handoff and reloading exactly once', async () => {
  const reload = vi.fn()
  reloadDeployment(reload)
  expect(dialog.open).toBe(true)
  expect(animate).toHaveBeenCalledWith([{ opacity: 0 }, { opacity: 1 }], expect.objectContaining({ duration: 180 }))
  expect(sessionStorage.getItem(key)).toBeNull()
  expect(reload).not.toHaveBeenCalled()
  animations[0].finish()
  await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())
  expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual({ path: location.pathname, startedAt: Number(dialog.dataset.startedAt) })
  expect(animations[0].cancel).toHaveBeenCalledOnce()
})

it('restores the same loading surface before app startup and fades only after its first frame', async () => {
  const startedAt = Date.now() - 200
  sessionStorage.setItem(key, JSON.stringify({ path: location.pathname, startedAt }))
  new Function(bootstrap)()
  expect(dialog.open).toBe(true)
  expect(dialog.dataset.restoring).toBe('true')
  expect(Number.parseInt(dialog.style.getPropertyValue('--deployment-refresh-delay'), 10)).toBeLessThanOrEqual(-200)
  expect(sessionStorage.getItem(key)).toBeNull()
  const cancel = new Event('cancel', { cancelable: true })
  dialog.dispatchEvent(cancel)
  expect(cancel.defaultPrevented).toBe(true)
  const frames: FrameRequestCallback[] = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frames.push(callback); return frames.length })
  completeDeploymentRefresh()
  completeDeploymentRefresh()
  expect(frames).toHaveLength(1)
  expect(animate).not.toHaveBeenCalled()
  frames.shift()!(0)
  expect(animate).not.toHaveBeenCalled()
  frames.shift()!(0)
  expect(animate).toHaveBeenCalledWith([{ opacity: 1 }, { opacity: 0 }], expect.objectContaining({ duration: 240 }))
  animations[0].finish()
  await vi.waitFor(() => expect(dialog.open).toBe(false))
})

it.each([
  '{broken',
  JSON.stringify({ path: '/another-page', startedAt: Date.now() }),
  JSON.stringify({ path: '/', startedAt: Date.now() - 60_000 }),
  JSON.stringify({ path: '/', startedAt: Date.now() + 60_000 }),
])('consumes invalid or unrelated handoffs without showing a blocker: %s', (stored) => {
  sessionStorage.setItem(key, stored)
  new Function(bootstrap)()
  expect(dialog.open).toBe(false)
  expect(sessionStorage.getItem(key)).toBeNull()
})

it('plays a local preview without writing a reload marker and closes once', async () => {
  const show = showDeploymentRefresh()
  animations[0].finish()
  await show
  const hide = hideDeploymentRefresh()
  await hideDeploymentRefresh()
  expect(animations).toHaveLength(2)
  animations[1].finish()
  await hide
  expect(dialog.close).toHaveBeenCalledOnce()
  expect(sessionStorage.getItem(key)).toBeNull()
})

it.each(['system', 'setting'])('switches directly with reduced motion from the %s', async (source) => {
  if (source === 'system') vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
  else document.documentElement.setAttribute('data-reduced-motion', '')
  await showDeploymentRefresh()
  await hideDeploymentRefresh()
  expect(animate).not.toHaveBeenCalled()
  expect(dialog.open).toBe(false)
})

it.each(['true', 'off', 'reduced', 'full'])('restores the saved %s motion mode before app startup', (mode) => {
  localStorage.setItem('maatool-reduce-motion', mode)
  sessionStorage.setItem(key, JSON.stringify({ path: location.pathname, startedAt: Date.now() }))
  new Function(bootstrap)()
  expect(dialog.open).toBe(true)
  expect(dialog.hasAttribute('data-reduced-motion')).toBe(mode !== 'full')
})

it('still reloads when session storage rejects the marker', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
  const reload = vi.fn()
  reloadDeployment(reload)
  animations[0].finish()
  await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())
})

it('restores with system preferences even when local preference storage is blocked', () => {
  sessionStorage.setItem(key, JSON.stringify({ path: location.pathname, startedAt: Date.now() }))
  const get = Storage.prototype.getItem
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, name) {
    if (this === localStorage) throw new Error('blocked')
    return get.call(this, name)
  })
  new Function(bootstrap)()
  expect(dialog.open).toBe(true)
})

it('returns to the update prompt when a browser navigation is cancelled', async () => {
  reloadDeployment(() => Promise.reject(new DOMException('Cancelled', 'AbortError')))
  animations[0].finish()
  await vi.waitFor(() => expect(animations).toHaveLength(2))
  expect(sessionStorage.getItem(key)).toBeNull()
  animations[1].finish()
  await vi.waitFor(() => expect(dialog.open).toBe(false))
})

it('keeps refresh functional when the early loading surface is unavailable', () => {
  document.body.innerHTML = ''
  const reload = vi.fn()
  reloadDeployment(reload)
  expect(reload).toHaveBeenCalledOnce()
})
