import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../lib/api-client'

const { adminApiJson } = vi.hoisted(() => ({ adminApiJson: vi.fn() }))
vi.mock('../../../lib/admin-api-client', () => ({ adminApiJson }))

import { saveRiskControlSettings } from './settings-actions'

const setters = {
  setSettings: vi.fn(),
  setBusyAction: vi.fn(),
  setError: vi.fn(),
  setNotice: vi.fn(),
}

beforeEach(() => {
  adminApiJson.mockReset()
  Object.values(setters).forEach((setter) => setter.mockReset())
})

describe('risk settings save action', () => {
  it('sends the expected revision, audit reason, and Root step-up secret', async () => {
    adminApiJson.mockResolvedValue({
      settings: {
        operator_data_risk_enabled: false,
        revision: 8,
        can_configure: true,
        updated_at: '2026-08-03T00:00:00.000Z',
      },
    })

    await expect(saveRiskControlSettings({
      patch: { operator_data_risk_enabled: false },
      reason: '完成风险复核后关闭规则',
      rootPassword: 'root-secret',
      currentRevision: 7,
      ...setters,
    })).resolves.toBe(true)

    expect(adminApiJson).toHaveBeenCalledWith('/api/admin/risk-settings', expect.objectContaining({
      method: 'PUT',
      json: {
        operator_data_risk_enabled: false,
        expected_revision: 7,
        reason: '完成风险复核后关闭规则',
        root_password: 'root-secret',
      },
    }))
    expect(setters.setSettings).toHaveBeenCalledWith(expect.objectContaining({ revision: 8 }))
    expect(setters.setNotice).toHaveBeenLastCalledWith('风控设置已保存')
    expect(setters.setBusyAction).toHaveBeenNthCalledWith(1, 'risk-settings')
    expect(setters.setBusyAction).toHaveBeenLastCalledWith(null)
  })

  it('reconciles the latest settings after a revision conflict', async () => {
    adminApiJson.mockRejectedValue(new ApiError('设置已被其他管理员更新', 409, {
      settings: {
        operator_data_risk_enabled: true,
        revision: 9,
        can_configure: true,
        updated_at: '2026-08-03T00:01:00.000Z',
      },
    }, '/api/admin/risk-settings'))

    await expect(saveRiskControlSettings({
      patch: { operator_data_risk_enabled: false },
      reason: '尝试关闭规则',
      rootPassword: '',
      currentRevision: 7,
      ...setters,
    })).resolves.toBe(false)

    expect(setters.setSettings).toHaveBeenCalledWith(expect.objectContaining({ revision: 9 }))
    expect(setters.setError).toHaveBeenLastCalledWith('设置已被其他管理员更新')
    expect(setters.setBusyAction).toHaveBeenLastCalledWith(null)
  })
})
