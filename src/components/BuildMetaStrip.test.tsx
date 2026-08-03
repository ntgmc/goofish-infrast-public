// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BuildMetaStrip from './BuildMetaStrip'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('BuildMetaStrip', () => {
  it('shows the actual API version and detects deployment drift', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      build_meta: {
        frontend_version: '2.0.8',
        backend_version: '2.0.8',
        data_version: 'data.api',
        generated_at: '2026-08-03T01:00:00.000Z',
        source_summary: 'api',
        git_sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    render(<BuildMetaStrip meta={{
      frontend_version: '2.0.7',
      backend_version: '2.0.7',
      expected_backend_version: '2.0.7',
      data_version: 'data.web',
      generated_at: '2026-08-03T00:00:00.000Z',
      source_summary: 'web',
      git_sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    }} />)

    await waitFor(() => expect(screen.getByText(/2\.0\.8 · 版本漂移/)).toBeInTheDocument())
  })
})
