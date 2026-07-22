import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PUBLIC_CONTENT_DRAFT, cloneDefaultPublicContentSettings } from '../../src/lib/public-content'

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
    expect(settings).toMatchObject({ version: 1, defaults_revision: 2, updated_at: null, qq_group: { number: '891655477' } })
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

  it('returns upgraded built-in credits to the management API for an older stored default', async () => {
    const stored = cloneDefaultPublicContentSettings()
    delete (stored as unknown as { defaults_revision?: number }).defaults_revision
    stored.thanks.sections[1].entries[0].avatar_url = 'https://avatars.githubusercontent.com/u/74061867?v=4'
    stored.thanks.sections[2].entries[0] = {
      id: 'all-helpers',
      name: '所有参与开发、测试、反馈与验证的协助者',
      description: '每一次复现、建议、测试和反馈都让 MaaTool 更可靠。',
      url: '',
      avatar_url: '',
    }
    queryMock.mockResolvedValue({ rows: [{ record_json: stored }] })

    const settings = await getPublicContentSettings()

    expect(settings.defaults_revision).toBe(2)
    expect(settings.thanks.sections[1].entries[0]).toMatchObject({
      id: 'ntgmc',
      name: 'ntgmc',
      avatar_url: '/assets/credits/ntgmc.jpg',
    })
    expect(settings.thanks.sections[2].entries[0]).toEqual({
      id: 'dake',
      name: 'DaKe.',
      description: '',
      url: '',
      avatar_url: '',
    })
  })
})
