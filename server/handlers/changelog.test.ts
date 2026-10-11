import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChangelogRelease } from '../../src/lib/changelog-contract'

const mocks = vi.hoisted(() => ({ releases: [] as ChangelogRelease[] }))
vi.mock('../../src/lib/changelog', () => ({ get CHANGELOG_RELEASES() { return mocks.releases } }))

import handler from './changelog'

beforeEach(() => {
  mocks.releases = Array.from({ length: 23 }, (_, index) => ({
    id: `v2.0.${1028 - index}`, version: `2.0.${1028 - index}`, displayVersion: `v2.0.${1028 - index}`,
    releasedAt: '2026-10-11', kind: 'release', sections: [],
  }))
})

describe('public changelog pagination', () => {
  it('returns only the requested page and clamps past the end', async () => {
    const first = await handler(request())
    expect(first.headers.get('Cache-Control')).toBe('no-store')
    await expect(first.json()).resolves.toEqual({ releases: mocks.releases.slice(0, 10), page: 1, pageSize: 10, total: 23 })
    await expect((await handler(request('?page=2'))).json()).resolves.toEqual({ releases: mocks.releases.slice(10, 20), page: 2, pageSize: 10, total: 23 })
    await expect((await handler(request('?page=999'))).json()).resolves.toMatchObject({ releases: mocks.releases.slice(20), page: 3 })
  })

  it('opens the page containing an anchored version without returning earlier pages', async () => {
    await expect((await handler(request('?release=v2.0.1016'))).json()).resolves.toEqual({
      releases: mocks.releases.slice(10, 20), page: 2, pageSize: 10, total: 23,
    })
  })

  it.each(['0', '-1', '1.5', 'Infinity', '9007199254740992', 'abc', ''])('rejects invalid page %s', async (page) => {
    expect((await handler(request(`?page=${page}`))).status).toBe(400)
  })

  it('handles unknown versions and an empty history', async () => {
    await expect((await handler(request('?page=2&release=missing'))).json()).resolves.toMatchObject({ page: 2, releases: mocks.releases.slice(10, 20) })
    mocks.releases = []
    await expect((await handler(request())).json()).resolves.toEqual({ releases: [], page: 1, pageSize: 10, total: 0 })
  })

  it('rejects unsupported methods and oversized release identifiers', async () => {
    expect((await handler(new Request('https://example.test/api/changelog', { method: 'POST' }))).status).toBe(405)
    expect((await handler(request(`?release=${'a'.repeat(161)}`))).status).toBe(400)
  })
})

function request(query = '') { return new Request(`https://example.test/api/changelog${query}`) }
