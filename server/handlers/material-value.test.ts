import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const originalCachePath = process.env.MAA_MATERIAL_VALUE_CACHE_PATH
const originalMaximumStaleAge = process.env.MAA_MATERIAL_VALUE_MAX_STALE_MS
let temporaryDirectory: string | null = null

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.resetModules()
  restoreEnvironment('MAA_MATERIAL_VALUE_CACHE_PATH', originalCachePath)
  restoreEnvironment('MAA_MATERIAL_VALUE_MAX_STALE_MS', originalMaximumStaleAge)
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true })
  temporaryDirectory = null
})

describe('material value pricing provider', () => {
  it('shares a cold-start refresh and atomically persists one valid snapshot', async () => {
    const cachePath = await useFreshCachePath()
    const fetchMock = vi.fn(async () => jsonResponse({
      data: [
        { itemId: '30011', itemValueAp: 2 },
        { itemId: '31013', itemValueAp: 4 },
      ],
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { getYituliuPricing } = await import('./material-value')

    const [first, second, third] = await Promise.all([
      getYituliuPricing(),
      getYituliuPricing(),
      getYituliuPricing(),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(first.status).toBe('fresh')
    expect(first.prices.get('30011')).toBe(2)
    expect(second.snapshot_id).toBe(first.snapshot_id)
    expect(third.snapshot_id).toBe(first.snapshot_id)
    const persisted = JSON.parse(await readFile(cachePath, 'utf8')) as Record<string, unknown>
    expect(persisted).toMatchObject({ version: 2, snapshot_id: first.snapshot_id })
    expect(await readdir(temporaryDirectory!)).toEqual(['pricing-cache.json'])
  })

  it.each([
    {
      label: 'non-JSON content type',
      response: () => new Response('{"data":[]}', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }),
    },
    {
      label: 'empty price map',
      response: () => jsonResponse({ data: [] }),
    },
    {
      label: 'oversized response',
      response: () => new Response('{}', {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(2 * 1024 * 1024 + 1),
        },
      }),
    },
    {
      label: 'over-budget JSON tree',
      response: () => jsonResponse({
        data: [{ itemId: '30011', itemValueAp: 2 }],
        padding: Array.from({ length: 100_001 }, () => null),
      }),
    },
  ])('marks $label as invalid without creating a cache snapshot', async ({ response }) => {
    const cachePath = await useFreshCachePath()
    vi.stubGlobal('fetch', vi.fn(async () => response()))
    const { getYituliuPricing } = await import('./material-value')

    const pricing = await getYituliuPricing()

    expect(pricing).toMatchObject({
      status: 'invalid',
      fetched_at: null,
      snapshot_id: null,
    })
    expect(pricing.prices.size).toBe(0)
    await expect(readFile(cachePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

async function useFreshCachePath(): Promise<string> {
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'maa-material-value-'))
  const cachePath = join(temporaryDirectory, 'pricing-cache.json')
  process.env.MAA_MATERIAL_VALUE_CACHE_PATH = cachePath
  delete process.env.MAA_MATERIAL_VALUE_MAX_STALE_MS
  return cachePath
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
