// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { copy } from '../copy'
import { DEFAULT_SITE_FEATURES } from '../lib/site-features'
import V1Route from './V1Route'

vi.mock('../lib/site-feature-context', () => ({
  useSiteFeatures: () => ({ status: 'ready', features: DEFAULT_SITE_FEATURES }),
}))

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

function mount() {
  return render(<MemoryRouter initialEntries={['/v1']}><Routes>
    <Route element={<V1Route />}><Route path="/v1" element={<p>V1 content</p>} /></Route>
  </Routes></MemoryRouter>)
}

it('counts down in Beijing time, reaches the deadline without redirecting, and clears its timer on unmount', () => {
  vi.setSystemTime(new Date('2026-11-14T23:58:59+08:00'))
  const page = mount()
  expect(screen.getByText('距离关闭还剩 0 天 0 小时 2 分钟')).toBeInTheDocument()
  act(() => vi.advanceTimersByTime(60_000))
  expect(screen.getByText('距离关闭还剩 0 天 0 小时 1 分钟')).toBeInTheDocument()
  act(() => vi.advanceTimersByTime(60_000))
  expect(screen.getByText(copy.features.v1_migration.deadline_reached)).toBeInTheDocument()
  expect(screen.getByText('V1 content')).toBeInTheDocument()
  page.unmount()
  expect(vi.getTimerCount()).toBe(0)
})

it('shows complete days and hours remaining', () => {
  vi.setSystemTime(new Date('2026-11-13T21:57:00+08:00'))
  mount()
  expect(screen.getByText('距离关闭还剩 1 天 2 小时 3 分钟')).toBeInTheDocument()
})
