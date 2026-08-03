import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsConflictError } from '../storage/settings-conflict'

const mocks = vi.hoisted(() => ({
  authenticateAdminRequest: vi.fn(),
  requireRootAdminPassword: vi.fn(),
  getRiskControlSettings: vi.fn(),
  saveRiskControlSettings: vi.fn(),
}))

vi.mock('./admin-auth', () => ({
  authenticateAdminRequest: mocks.authenticateAdminRequest,
  requireRootAdminPassword: mocks.requireRootAdminPassword,
}))
vi.mock('./license-utils', () => ({
  getRiskControlSettings: mocks.getRiskControlSettings,
  saveRiskControlSettings: mocks.saveRiskControlSettings,
  jsonResponse: (data: unknown, status = 200, headers?: Record<string, string>) => new Response(
    status === 204 ? null : JSON.stringify(data),
    { status, headers: { 'content-type': 'application/json', ...headers } },
  ),
}))

import adminRiskSettingsHandler from './admin-risk-settings'

const currentSettings = {
  operator_data_risk_enabled: true,
  revision: 4,
  updated_at: '2026-08-03T00:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.authenticateAdminRequest.mockResolvedValue({
    ok: true,
    username: 'security-admin',
    role: 'security_admin',
    capabilities: ['risk_view', 'risk_review', 'risk_config'],
  })
  mocks.requireRootAdminPassword.mockResolvedValue({ ok: true, username: 'root' })
  mocks.getRiskControlSettings.mockResolvedValue(currentSettings)
  mocks.saveRiskControlSettings.mockResolvedValue({ ...currentSettings, operator_data_risk_enabled: false, revision: 5 })
})

describe('admin risk settings HTTP boundary', () => {
  it('authenticates before parsing a protected malformed JSON body', async () => {
    mocks.authenticateAdminRequest.mockResolvedValueOnce({
      ok: false,
      response: new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
    })
    const response = await adminRiskSettingsHandler(new Request('https://example.test/api/admin/risk-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{',
    }))

    expect(response.status).toBe(401)
    expect(mocks.authenticateAdminRequest).toHaveBeenCalledWith(expect.any(Request), 'risk_config')
    expect(mocks.saveRiskControlSettings).not.toHaveBeenCalled()
  })

  it('requires Root step-up and forwards revision, reason, actor, and request ID when disabling risk control', async () => {
    const response = await adminRiskSettingsHandler(new Request('https://example.test/api/admin/risk-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-request-id': 'request-789' },
      body: JSON.stringify({
        operator_data_risk_enabled: false,
        expected_revision: 4,
        reason: '排查持续误报',
        root_password: 'root-secret',
      }),
    }))

    expect(response.status).toBe(200)
    expect(mocks.requireRootAdminPassword).toHaveBeenCalledWith(expect.any(Request), 'root-secret')
    expect(mocks.saveRiskControlSettings).toHaveBeenCalledWith({
      patch: { operator_data_risk_enabled: false },
      expectedRevision: 4,
      adminUsername: 'security-admin',
      reason: '排查持续误报',
      requestId: 'request-789',
    })
  })

  it('returns the latest revision with a 409 conflict', async () => {
    mocks.saveRiskControlSettings.mockRejectedValueOnce(new SettingsConflictError())
    const response = await adminRiskSettingsHandler(new Request('https://example.test/api/admin/risk-settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operator_data_risk_enabled: true,
        expected_revision: 3,
        reason: '恢复检测',
      }),
    }))

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ settings: currentSettings })
  })
})
