// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BehaviorRiskPanel from './BehaviorRiskPanel'

const { apiJsonMock } = vi.hoisted(() => ({
  apiJsonMock: vi.fn(),
}))

vi.mock('../../../lib/api-client', () => ({
  apiJson: apiJsonMock,
}))

beforeEach(() => {
  apiJsonMock.mockReset()
  apiJsonMock.mockResolvedValue({
    cases: [{
      id: 'risk-case-1',
      status: 'pending',
      score: 70,
      categories: ['operator_data'],
      rules: [{
        code: 'operator_data_anomaly',
        category: 'operator_data',
        score: 70,
        explanation: '干员数据异常',
        evidence: { anomaly_count: 3 },
      }],
      model_version: 'behavior-risk-v1.1.0',
      first_seen_at: '2026-07-25T00:00:00.000Z',
      last_seen_at: '2026-07-25T01:00:00.000Z',
      expires_at: '2026-10-23T00:00:00.000Z',
      reviewed_at: null,
      reviewed_by: null,
      members: [{
        user_id: 'user-1',
        account_label: 'user-1@example.test',
        counts: { operator_data_anomaly: 3 },
        first_seen_at: '2026-07-25T00:00:00.000Z',
        last_seen_at: '2026-07-25T01:00:00.000Z',
        browser_prefixes: ['browser12345'],
        network_prefixes: ['network12345'],
        uid_prefixes: ['uid123456789'],
        output_prefixes: [],
        operator_fingerprint_prefixes: ['operator1234'],
        profiles: [{
          profile_id: 'profile-1',
          profile_label: '主档案',
          kind: 'cdk',
          status: 'active',
        }],
      }],
    }],
    pagination: { page: 1, page_size: 25, total: 1, total_pages: 1 },
  })
})

afterEach(() => {
  cleanup()
})

describe('BehaviorRiskPanel review form', () => {
  it('keeps rendering while the reviewer types a note and changes member actions', async () => {
    const user = userEvent.setup()
    render(<BehaviorRiskPanel />)

    const note = await screen.findByRole('textbox', { name: '复核说明（必填，将写入审计）' })
    await user.type(note, '已核对用户提交记录')
    expect(note).toHaveValue('已核对用户提交记录')
    expect(screen.getByText('风险 70')).toBeInTheDocument()

    const actionSelect = screen.getAllByRole('combobox')[1]
    await user.selectOptions(actionSelect, 'freeze_profile')
    expect(actionSelect).toHaveValue('freeze_profile')

    const profileSelect = screen.getAllByRole('combobox')[2]
    await waitFor(() => expect(profileSelect).toBeEnabled())
    expect(profileSelect).toHaveValue('profile-1')
  })
})
