// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { installStaleChunkReloadHandler, isStaleChunkError } from './chunk-reload'

afterEach(() => {
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
  vi.restoreAllMocks()
})

describe('chunk load recovery', () => {
  it.each(['storage', 'query'])('preserves the Vite error when automatic reload is throttled by %s', (throttle) => {
    if (throttle === 'storage') sessionStorage.setItem('goofish:stale-chunk-reload-at', String(Date.now()))
    else window.history.replaceState(null, '', `/?app_reload=${Date.now()}`)
    const listeners = vi.spyOn(window, 'addEventListener')
    installStaleChunkReloadHandler()
    try {
      const error = new TypeError('Failed to fetch dynamically imported module: /assets/History.js')
      const event = Object.assign(new Event('vite:preloadError', { cancelable: true }), { payload: error })
      window.dispatchEvent(event)
      // Vite must reject with the original error instead of resolving an undefined module.
      expect(event.defaultPrevented).toBe(false)
      expect(event.payload).toBe(error)
    } finally {
      for (const [type, listener, options] of listeners.mock.calls) window.removeEventListener(type, listener, options)
    }
  })

  it.each([
    new TypeError('Failed to fetch dynamically imported module: /assets/History.js'),
    new TypeError('error loading dynamically imported module'),
    new TypeError('Importing a module script failed.'),
    new Error('Loading chunk 42 failed.'),
    new Error('Unable to preload CSS for /assets/History.css'),
  ])('recognizes a module or stylesheet load failure: %s', (error) => {
    expect(isStaleChunkError(error)).toBe(true)
  })

  it.each([new TypeError("Cannot read properties of null (reading 'map')"), new Error('Failed to fetch'), null])('does not classify a result or API failure as a chunk failure: %s', (error) => {
    expect(isStaleChunkError(error)).toBe(false)
  })
})
