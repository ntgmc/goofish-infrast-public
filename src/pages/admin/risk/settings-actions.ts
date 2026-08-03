import type { Dispatch, SetStateAction } from 'react'
import { adminApiJson } from '../../../lib/admin-api-client'
import { ApiError } from '../../../lib/api-client'
import type { RiskControlSettings, RiskControlSettingsPatch } from '../contracts'
import { normalizeRiskSettings } from '../shared/helpers'

export async function saveRiskControlSettings(options: {
  patch: RiskControlSettingsPatch
  reason: string
  rootPassword: string
  currentRevision: number
  setSettings: Dispatch<SetStateAction<RiskControlSettings>>
  setBusyAction: Dispatch<SetStateAction<string | null>>
  setError: Dispatch<SetStateAction<string | null>>
  setNotice: Dispatch<SetStateAction<string | null>>
}): Promise<boolean> {
  options.setBusyAction('risk-settings')
  options.setError(null)
  options.setNotice(null)
  try {
    const data = await adminApiJson<{ settings?: Partial<RiskControlSettings> }>('/api/admin/risk-settings', {
      method: 'PUT',
      json: {
        ...options.patch,
        expected_revision: options.currentRevision,
        reason: options.reason,
        ...(options.rootPassword ? { root_password: options.rootPassword } : {}),
      },
      fallbackMessage: '保存风控设置失败',
    })
    options.setSettings(normalizeRiskSettings(data.settings))
    options.setNotice('风控设置已保存')
    return true
  } catch (caught) {
    if (caught instanceof ApiError && caught.status === 409 && caught.data && typeof caught.data === 'object') {
      const latest = (caught.data as { settings?: Partial<RiskControlSettings> }).settings
      if (latest) options.setSettings(normalizeRiskSettings(latest))
    }
    options.setError((caught as Error).message)
    return false
  } finally {
    options.setBusyAction(null)
  }
}
