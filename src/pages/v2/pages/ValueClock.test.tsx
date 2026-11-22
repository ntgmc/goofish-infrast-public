// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { zeroValueClockVector, type ValueClockSnapshot } from '../../../lib/value-clock'
import ValueClock from './ValueClock'

const mocks = vi.hoisted(() => ({ reduced: false, query: {} as Record<string, unknown> }))
vi.mock('../../../lib/value-clock-query', () => ({ useValueClockQuery: () => mocks.query }))
vi.mock('../../../lib/motion-preference', () => ({ useAppReducedMotion: () => mocks.reduced }))
let now = 0
let hidden = false
const initial = 28_825_564.5
const rate = 206.4 / 60
const snapshot: ValueClockSnapshot = {
  schema_version: 1, view: 'production', series_id: 'production-v1', metric_version: 'production-sanity-v1', revision: 1,
  server_now: '2026-11-22T00:00:00Z', as_of: '2026-11-22T00:00:00Z', valid_until: '2026-11-22T00:02:00Z',
  day_started_at: '2026-11-21T16:00:00Z', day_ends_at: '2026-11-22T16:00:00Z', tracking_started_at: '2026-11-22T00:00:00Z',
  totals: { ...zeroValueClockVector(), sanity: initial, lmd_net: 3_860_948_640 }, today_totals: zeroValueClockVector(),
  rates_per_second: { ...zeroValueClockVector(), sanity: rate, lmd_net: 460.8 }, active_accounts: 905, status: 'ready',
}
const mount = () => render(<MemoryRouter><ValueClock /></MemoryRouter>)
const label = () => document.querySelector('.value-clock-total')!.getAttribute('aria-label')
const expected = (elapsed: number) => (initial + rate * elapsed / 1000).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const advance = (duration: number) => act(() => { now += duration; vi.advanceTimersByTime(duration) })

beforeEach(() => {
  vi.useFakeTimers()
  now = 0; hidden = false
  mocks.reduced = false
  mocks.query = { data: { snapshot, receivedAt: 0 }, isPending: false, error: null }
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

it('samples the main readings and resources once a second while keeping the real rate', () => {
  mount()
  const initial = label()
  advance(900)
  expect(label()).toBe(initial)
  expect(document.querySelector('.value-clock-resources dd')?.textContent).toBe('3,860,948,640')
  advance(100)
  expect(label()).toContain(expected(1000))
  expect(document.querySelector('.value-clock-resources dd')?.textContent).toBe('3,860,949,101')
  expect(document.querySelector('.value-clock-resources .value-clock-digit')).toBeNull()
})

it('holds paused and hidden readings and resumes from monotonic elapsed time', () => {
  mount()
  advance(1000)
  fireEvent.click(screen.getByRole('button', { name: '暂停' }))
  const paused = label()
  advance(5000)
  expect(label()).toBe(paused)
  fireEvent.click(screen.getByRole('button', { name: '继续' }))
  expect(label()).toContain(expected(6000))
  hidden = true
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  advance(10000)
  expect(label()).toContain(expected(6000))
  hidden = false
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  expect(label()).toContain(expected(16000))
})

it('freezes exactly at expiry even when a scheduled update is late', () => {
  mocks.query.data = { snapshot: { ...snapshot, valid_until: '2026-11-22T00:00:01Z' }, receivedAt: 0 }
  mount()
  advance(1500)
  expect(label()).toContain(expected(1000))
  expect(screen.getByText('数据暂未更新，已暂停增长', { exact: true })).toBeVisible()
  advance(10000)
  act(() => document.dispatchEvent(new Event('visibilitychange')))
  expect(label()).toContain(expected(1000))
})

it('uses static one-second readings with reduced motion and cleans up on unmount', () => {
  mocks.reduced = true
  const page = mount()
  expect(document.querySelector('.value-clock-digit')).toBeNull()
  advance(500)
  expect(label()).toContain(expected(0))
  advance(500)
  expect(label()).toContain(expected(1000))
  page.unmount()
  expect(vi.getTimerCount()).toBe(0)
})
