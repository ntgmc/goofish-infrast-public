// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ThemeSwitcher from '../components/ThemeSwitcher'
import {
  THEME_STORAGE_KEY,
  ThemeProvider,
  readThemePreference,
  resolveTheme,
  useTheme,
  type ResolvedTheme,
} from './theme'

function createMatchMedia(initialMatches = false) {
  let matches = initialMatches
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const mediaQuery = {
    media: '(prefers-color-scheme: dark)',
    get matches() { return matches },
    onchange: null,
    addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener)),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as unknown as MediaQueryList

  return {
    mediaQuery,
    setMatches(nextMatches: boolean) {
      matches = nextMatches
      listeners.forEach((listener) => listener({ matches: nextMatches } as MediaQueryListEvent))
    },
  }
}

function ThemeState() {
  const { preference, resolvedTheme } = useTheme()
  return <output>{preference}:{resolvedTheme}</output>
}

function renderTheme(matchMedia: ReturnType<typeof createMatchMedia>) {
  vi.stubGlobal('matchMedia', vi.fn(() => matchMedia.mediaQuery))
  return render(
    <ThemeProvider>
      <ThemeState />
      <ThemeSwitcher />
    </ThemeProvider>,
  )
}

describe('theme preferences', () => {
  beforeEach(() => {
    window.localStorage.clear()
    document.documentElement.classList.remove('light', 'dark')
    document.documentElement.style.colorScheme = ''
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('validates stored preferences and resolves system mode', () => {
    expect(readThemePreference({ getItem: () => null })).toBe('system')
    expect(readThemePreference({ getItem: () => 'unexpected' })).toBe('system')
    expect(readThemePreference({ getItem: () => 'light' })).toBe('light')
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('falls back safely when reading storage fails', () => {
    expect(readThemePreference({ getItem: () => { throw new Error('blocked') } })).toBe('system')
  })

  it('defaults to the system theme and reacts to system changes', () => {
    const matchMedia = createMatchMedia(true)
    renderTheme(matchMedia)
    expect(screen.getByText('system:dark')).toBeInTheDocument()
    expect(document.documentElement).toHaveClass('dark')

    act(() => matchMedia.setMatches(false))
    expect(screen.getByText('system:light')).toBeInTheDocument()
    expect(document.documentElement).toHaveClass('light')
  })

  it.each<[string, ResolvedTheme]>([['浅色', 'light'], ['深色', 'dark']])('persists explicit %s mode', async (label, theme) => {
    const user = userEvent.setup()
    const matchMedia = createMatchMedia(theme !== 'dark')
    renderTheme(matchMedia)

    await user.click(screen.getByRole('button', { name: /选择主题/ }))
    await user.click(screen.getByRole('menuitemradio', { name: label }))
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(theme)
    expect(screen.getByText(`${theme}:${theme}`)).toBeInTheDocument()

    act(() => matchMedia.setMatches(theme === 'light'))
    expect(screen.getByText(`${theme}:${theme}`)).toBeInTheDocument()
  })

  it('returns to live system mode and supports keyboard menu navigation', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    const user = userEvent.setup()
    const matchMedia = createMatchMedia(false)
    renderTheme(matchMedia)

    await user.click(screen.getByRole('button', { name: /选择主题/ }))
    await user.keyboard('{Home}{Enter}')
    expect(screen.getByText('system:light')).toBeInTheDocument()
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('system')

    act(() => matchMedia.setMatches(true))
    expect(screen.getByText('system:dark')).toBeInTheDocument()
  })

  it('closes the menu with Escape and restores trigger focus', async () => {
    const user = userEvent.setup()
    renderTheme(createMatchMedia())
    const trigger = screen.getByRole('button', { name: /选择主题/ })
    await user.click(trigger)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
