import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PUBLIC_CONTENT_DRAFT } from '../../src/lib/public-content'

const queryMock = vi.hoisted(() => vi.fn())
const ensureDatabaseSchema = vi.hoisted(() => vi.fn())

vi.mock('./postgres', () => ({ query: queryMock }))
vi.mock('./schema', () => ({ ensureDatabaseSchema }))

import { getPublicContentSettings, savePublicContentSettings } from './public-content-settings-store'

describe('public content settings store', () => {
  beforeEach(() => {
    queryMock.mockReset()
    ensureDatabaseSchema.mockReset().mockResolvedValue(undefined)
  })

  it('returns defaults without writing when no row exists', async () => {
    queryMock.mockResolvedValue({ rows: [] })
    const settings = await getPublicContentSettings()
    expect(settings).toMatchObject({ version: 1, updated_at: null, qq_group: { number: '891655477' } })
    expect(queryMock).toHaveBeenCalledTimes(1)
  })

  it('validates, timestamps, and upserts the complete document', async () => {
    queryMock.mockResolvedValue({ rows: [] })
    const settings = await savePublicContentSettings(structuredClone(DEFAULT_PUBLIC_CONTENT_DRAFT))
    expect(settings.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('insert into public_content_settings'), [
      'global',
      expect.stringContaining('"version":1'),
    ])
  })
})
