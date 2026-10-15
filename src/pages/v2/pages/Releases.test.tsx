// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation, useNavigate } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { copy } from '../../../copy'
import type { ChangelogPageData, ChangelogRelease } from '../../../lib/changelog-contract'
import Releases from './Releases'

const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('../../../lib/api-client', () => ({ apiJson: mocks.api, getApiErrorMessage: (_error: unknown, fallback: string) => fallback }))

const releases: ChangelogRelease[] = Array.from({ length: 23 }, (_, index) => ({
  id: `v2.0.${1028 - index}`, version: `2.0.${1028 - index}`, displayVersion: `v2.0.${1028 - index}`,
  releasedAt: '2026-10-11', kind: 'release', sections: [{ id: 'fix', kind: 'fix', items: [`Change ${index}`] }],
}))

function pageData(page: number): ChangelogPageData {
  return { releases: releases.slice((page - 1) * 10, page * 10), page, pageSize: 10, total: releases.length }
}

beforeEach(() => {
  mocks.api.mockImplementation(async (url: string) => {
    const params = new URL(url, 'https://example.test').searchParams
    const index = releases.findIndex((release) => release.id === params.get('release'))
    return pageData(index >= 0 ? Math.floor(index / 10) + 1 : Number(params.get('page')))
  })
})
afterEach(() => { cleanup(); vi.resetAllMocks() })

function RouteControls() {
  const location = useLocation()
  const navigate = useNavigate()
  return <><output data-testid="location">{location.pathname}{location.search}{location.hash}</output><button onClick={() => navigate(-1)}>Back</button><button onClick={() => navigate(1)}>Forward</button><button onClick={() => navigate('/v2?section=updates&page=2')}>Jump</button></>
}

function mount(path = '/v2?section=updates&profile_id=doctor') {
  render(<MemoryRouter initialEntries={[path]}><Releases /><RouteControls /></MemoryRouter>)
}

it('loads ten versions at a time, selects locally, and restores selection through history', async () => {
  const user = userEvent.setup()
  mount()
  await screen.findByRole('heading', { name: 'v2.0.1028' })
  const index = screen.getByRole('navigation', { name: copy.public.pages_ChangelogPage_002 })
  expect(within(index).getAllByRole('button')).toHaveLength(10)
  expect(screen.queryByText('v2.0.1018')).not.toBeInTheDocument()
  await user.click(within(index).getByRole('button', { name: /v2.0.1025/ }))
  expect(screen.getByRole('heading', { name: 'v2.0.1025' })).toBeInTheDocument()
  expect(screen.getByTestId('location')).toHaveTextContent('profile_id=doctor&page=1#release-v2.0.1025')
  expect(mocks.api).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole('button', { name: copy.v2.nextPage }))
  await screen.findByRole('heading', { name: 'v2.0.1018' })
  expect(screen.queryByText('v2.0.1028')).not.toBeInTheDocument()
  expect(within(index).getAllByRole('button')).toHaveLength(10)
  await user.click(screen.getByRole('button', { name: 'Back' }))
  await screen.findByRole('heading', { name: 'v2.0.1025' })
  await user.click(screen.getByRole('button', { name: 'Forward' }))
  await screen.findByRole('heading', { name: 'v2.0.1018' })
})

it('opens an old release directly and keeps its anchor when normalizing the page', async () => {
  mount('/v2?section=updates#release-v2.0.1016')
  await screen.findByRole('heading', { name: 'v2.0.1016' })
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/v2?section=updates&page=2#release-v2.0.1016'))
  expect(screen.queryByText('v2.0.1028')).not.toBeInTheDocument()
  expect(mocks.api).toHaveBeenCalledExactlyOnceWith('/api/changelog?page=1&release=v2.0.1016', expect.anything())
})

it('ignores an earlier response after navigation changes the requested page', async () => {
  let finishFirst!: (data: ChangelogPageData) => void
  mocks.api.mockImplementationOnce(() => new Promise<ChangelogPageData>((resolve) => { finishFirst = resolve }))
  const user = userEvent.setup()
  mount()
  await user.click(screen.getByRole('button', { name: 'Jump' }))
  await screen.findByRole('heading', { name: 'v2.0.1018' })
  expect(mocks.api.mock.calls[0][1].signal.aborted).toBe(true)
  await act(async () => { finishFirst(pageData(1)) })
  expect(screen.getByRole('heading', { name: 'v2.0.1018' })).toBeInTheDocument()
  expect(screen.queryByText('v2.0.1028')).not.toBeInTheDocument()
})

it('keeps the current content through a failed page load and supports retry', async () => {
  const user = userEvent.setup()
  mount()
  await screen.findByRole('heading', { name: 'v2.0.1028' })
  mocks.api.mockRejectedValueOnce(new Error('Network request failed'))
  await user.click(screen.getByRole('button', { name: copy.v2.nextPage }))
  expect(await screen.findByRole('alert')).toHaveTextContent(copy.v2.updatesLoadFailed)
  expect(screen.getByRole('heading', { name: 'v2.0.1028' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: copy.v2.retry }))
  await screen.findByRole('heading', { name: 'v2.0.1018' })
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('shows an unknown anchored version explicitly', async () => {
  mount('/v2?section=updates#release-missing')
  await screen.findByRole('heading', { name: copy.v2.updatesNotFound })
  expect(screen.queryByRole('heading', { name: 'v2.0.1028' })).not.toBeInTheDocument()
})

it('handles an empty history without offering more pages', async () => {
  mocks.api.mockResolvedValueOnce({ releases: [], page: 1, pageSize: 10, total: 0 })
  mount()
  await screen.findByRole('heading', { name: copy.v2.noMatches })
  await waitFor(() => expect(screen.getByRole('button', { name: copy.v2.nextPage })).toBeDisabled())
  expect(screen.getByRole('button', { name: copy.v2.previousPage })).toBeDisabled()
})
