import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PUBLIC_CONTENT_DRAFT, cloneDefaultPublicContentSettings } from '../../src/lib/public-content'

const queryMock = vi.hoisted(() => vi.fn())
const ensureDatabaseSchema = vi.hoisted(() => vi.fn())

vi.mock('./postgres', () => ({ query: queryMock }))
vi.mock('./schema', () => ({ ensureDatabaseSchema }))

import { getPublicContentSettings, savePublicContentSettings } from './public-content-settings-store'
import { SettingsConflictError } from './settings-conflict'

describe('public content settings store', () => {
  beforeEach(() => {
    queryMock.mockReset()
    ensureDatabaseSchema.mockReset().mockResolvedValue(undefined)
  })

  it('returns defaults without writing when no row exists', async () => {
    queryMock.mockResolvedValue({ rows: [] })
    const settings = await getPublicContentSettings()
    expect(settings).toMatchObject({
      version: 1,
      defaults_revision: 5,
      revision: 0,
      updated_at: null,
      cdk_purchase: { xianyu_url: DEFAULT_PUBLIC_CONTENT_DRAFT.cdk_purchase.xianyu_url },
      qq_group: { number: '891655477' },
    })
    expect(queryMock).toHaveBeenCalledTimes(1)
  })

  it('validates, timestamps, and upserts the complete document', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ revision: 1 }] })
      .mockResolvedValueOnce({ rows: [{ revision: 2 }] })
    const settings = await savePublicContentSettings(structuredClone(DEFAULT_PUBLIC_CONTENT_DRAFT), 0)
    expect(settings.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(settings.revision).toBe(1)
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('revision = revision + 1'), [
      'global',
      expect.stringContaining('"version":1'),
      expect.any(String),
      0,
    ])
    expect(queryMock.mock.calls[0]?.[1]?.[1]).toContain('"cdk_purchase"')

    const updated = await savePublicContentSettings(structuredClone(DEFAULT_PUBLIC_CONTENT_DRAFT), 1)
    expect(updated.revision).toBe(2)
    expect(queryMock).toHaveBeenLastCalledWith(expect.stringContaining('revision = revision + 1'), [
      'global',
      expect.stringContaining('"version":1'),
      expect.any(String),
      1,
    ])
  })

  it('rejects a stale revision without overwriting the document', async () => {
    queryMock.mockResolvedValue({ rows: [] })
    await expect(savePublicContentSettings(structuredClone(DEFAULT_PUBLIC_CONTENT_DRAFT), 4)).rejects.toBeInstanceOf(SettingsConflictError)
  })

  it('returns upgraded built-in credits and the purchase URL to the management API for an older stored default', async () => {
    const stored = cloneDefaultPublicContentSettings()
    delete (stored as unknown as { defaults_revision?: number }).defaults_revision
    delete (stored as unknown as { cdk_purchase?: unknown }).cdk_purchase
    stored.qq_group.name = '管理员自定义群名'
    stored.thanks.sections[1].entries[0].avatar_url = 'https://avatars.githubusercontent.com/u/74061867?v=4'
    stored.thanks.sections[2].entries[0] = {
      id: 'all-helpers',
      name: '所有参与开发、测试、反馈与验证的协助者',
      description: '每一次复现、建议、测试和反馈都让 MaaTool 更可靠。',
      url: '',
      avatar_url: '',
    }
    queryMock.mockResolvedValue({ rows: [{ record_json: stored, revision: 7 }] })

    const settings = await getPublicContentSettings()

    expect(settings.defaults_revision).toBe(5)
    expect(settings.revision).toBe(7)
    expect(settings.cdk_purchase.xianyu_url).toBe(DEFAULT_PUBLIC_CONTENT_DRAFT.cdk_purchase.xianyu_url)
    expect(settings.qq_group.name).toBe('管理员自定义群名')
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
