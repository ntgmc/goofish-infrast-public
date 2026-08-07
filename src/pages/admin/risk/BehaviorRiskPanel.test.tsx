// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BehaviorRiskPanel from './BehaviorRiskPanel'

const { apiJsonMock, ApiErrorMock } = vi.hoisted(() => {
  class TestApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly data: unknown,
      readonly url: string,
    ) {
      super(message)
    }
  }
  return { apiJsonMock: vi.fn(), ApiErrorMock: TestApiError }
})

vi.mock('../../../lib/api-client', () => ({
  ApiError: ApiErrorMock,
  apiJson: apiJsonMock,
}))

beforeEach(() => {
  apiJsonMock.mockReset()
  apiJsonMock.mockResolvedValue({
    cases: [{
      id: 'risk-case-1',
      status: 'pending',
      score: 55,
      categories: ['operator_data'],
      rules: [{
        code: 'operator_data_anomaly_repeated',
        category: 'operator_data',
        score: 55,
        explanation: '干员数据异常',
        evidence: { anomaly_count: 3 },
      }],
      model_version: 'behavior-risk-v1.2.0',
      first_seen_at: '2026-07-25T00:00:00.000Z',
      last_seen_at: '2026-07-25T01:00:00.000Z',
      expires_at: '2026-10-23T00:00:00.000Z',
      reviewed_at: null,
      reviewed_by: null,
      audits: [{
        id: 'audit-1',
        admin_username: 'reviewer',
        outcome: 'dismiss',
        note: '已核对记录',
        actions: [],
        case_snapshot: {},
        created_at: '2026-07-25T02:00:00.000Z',
        integrity_hash: null,
      }],
      members: [{
        user_id: 'user-1-complete-id',
        account_email: 'user-1@example.test',
        counts: { operator_data_anomaly: 3 },
        first_seen_at: '2026-07-25T00:00:00.000Z',
        last_seen_at: '2026-07-25T01:00:00.000Z',
        browser_prefixes: ['browser12345'],
        network_prefixes: ['network12345'],
        uid_prefixes: ['uid123456789'],
        output_prefixes: [],
        operator_fingerprint_prefixes: ['operator1234'],
        profiles: [{
          profile_id: 'profile-1-complete-id',
          profile_label: '主档案',
          kind: 'cdk',
          status: 'active',
        }],
      }],
    }],
    pagination: { page: 1, page_size: 25, total: 1, total_pages: 1 },
    health: {
      status: 'ok',
      last_collection_at: '2026-07-25T01:00:00.000Z',
      last_collection_status: 'success',
      last_evaluation_at: '2026-07-25T01:30:00.000Z',
      last_evaluation_status: 'success',
      last_failure_at: null,
      last_failure_stage: null,
      backlog_count: 0,
      events_processed: 3,
      duration_ms: 12,
      purged_events: 0,
    },
    capabilities: [
      'risk_view',
      'risk_review',
      'risk_config',
      'usage_view',
      'user_view',
      'sensitive_data_view',
      'user_manage',
      'user_delete',
      'optimization_view',
      'optimization_manage',
      'admin_manage',
    ],
  })
})

afterEach(() => {
  cleanup()
})

describe('BehaviorRiskPanel review form', () => {
  it('renders collection health for a security administrator with the full capability set', async () => {
    render(<BehaviorRiskPanel />)

    expect(await screen.findByText('采集与评估健康：正常')).toBeInTheDocument()
    expect(screen.getByText(/采集状态 success.*评估状态 success.*本次事件 3/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('labels repeated Skland UID mismatches in the member evidence', async () => {
    apiJsonMock.mockResolvedValueOnce(buildCasePage({
      id: 'mismatch-case',
      status: 'pending',
      email: 'mismatch@example.test',
      counts: { skland_uid_mismatch: 3 },
    }))

    render(<BehaviorRiskPanel />)

    const account = await screen.findByText('mismatch@example.test')
    expect(account.parentElement).toHaveTextContent('事件 森空岛 UID 不匹配=3')
  })

  it('keeps rendering while the reviewer types a note and changes member actions', async () => {
    const user = userEvent.setup()
    render(<BehaviorRiskPanel />)

    const note = await screen.findByRole('textbox', { name: '复核说明（必填，将写入审计）' })
    await user.type(note, '已核对用户提交记录')
    expect(note).toHaveValue('已核对用户提交记录')
    expect(screen.getByText('风险 55')).toBeInTheDocument()
    expect(screen.getByText('user-1@example.test')).toBeInTheDocument()
    expect(screen.getByText('用户 ID：user-1-complete-id')).toBeInTheDocument()
    expect(screen.getByText('完整性哈希：未记录')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '主档案 · profile-1-complete-id · cdk · active' })).toBeInTheDocument()

    const actionSelect = screen.getAllByRole('combobox')[1]
    await user.selectOptions(actionSelect, 'freeze_profile')
    expect(actionSelect).toHaveValue('freeze_profile')

    const profileSelect = screen.getAllByRole('combobox')[2]
    await waitFor(() => expect(profileSelect).toBeEnabled())
    expect(profileSelect).toHaveValue('profile-1-complete-id')
  })

  it('shows an explicit fallback while preserving the full ID for a deleted account', async () => {
    apiJsonMock.mockResolvedValueOnce({
      cases: [{
        id: 'risk-case-deleted',
        status: 'dismissed',
        score: 55,
        categories: ['operator_data'],
        rules: [],
        model_version: 'behavior-risk-v1.2.0',
        first_seen_at: '2026-07-25T00:00:00.000Z',
        last_seen_at: '2026-07-25T01:00:00.000Z',
        expires_at: '2026-10-23T00:00:00.000Z',
        reviewed_at: '2026-07-25T02:00:00.000Z',
        reviewed_by: 'system:behavior-risk-v1.2.0',
        audits: [],
        members: [{
          user_id: 'deleted-user-complete-id',
          account_email: null,
          counts: {},
          first_seen_at: '2026-07-25T00:00:00.000Z',
          last_seen_at: '2026-07-25T01:00:00.000Z',
          browser_prefixes: [],
          network_prefixes: [],
          uid_prefixes: [],
          output_prefixes: [],
          profiles: [],
        }],
      }],
      pagination: { page: 1, page_size: 25, total: 1, total_pages: 1 },
      health: {
        status: 'ok',
        last_collection_at: '2026-07-25T01:00:00.000Z',
        last_collection_status: 'success',
        last_evaluation_at: '2026-07-25T02:00:00.000Z',
        last_evaluation_status: 'success',
        last_failure_at: null,
        last_failure_stage: null,
        backlog_count: 0,
        events_processed: 0,
        duration_ms: 5,
        purged_events: 0,
      },
      capabilities: ['risk_view'],
    })

    render(<BehaviorRiskPanel />)

    expect(await screen.findByText('账号已删除')).toBeInTheDocument()
    expect(screen.getByText('用户 ID：deleted-user-complete-id')).toBeInTheDocument()
  })

  it('keeps the newest filter response when an older request resolves last', async () => {
    const user = userEvent.setup()
    let resolveOld!: (value: unknown) => void
    let resolveNew!: (value: unknown) => void
    apiJsonMock.mockReset()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNew = resolve }))
    render(<BehaviorRiskPanel />)

    await user.selectOptions(screen.getByRole('combobox', { name: '状态' }), 'actioned')
    await waitFor(() => expect(apiJsonMock).toHaveBeenCalledTimes(2))
    resolveNew(buildCasePage({ id: 'new-case', status: 'actioned', email: 'new@example.test' }))
    expect(await screen.findByText('new@example.test')).toBeInTheDocument()

    resolveOld(buildCasePage({ id: 'old-case', status: 'pending', email: 'old@example.test' }))
    await waitFor(() => expect(screen.queryByText('old@example.test')).not.toBeInTheDocument())
    expect(screen.getByText('new@example.test')).toBeInTheDocument()
  })

  it('clears stale cases when the current filter request fails and exposes retry', async () => {
    const user = userEvent.setup()
    render(<BehaviorRiskPanel />)
    expect(await screen.findByText('user-1@example.test')).toBeInTheDocument()

    apiJsonMock.mockRejectedValueOnce(new Error('当前筛选加载失败'))
    await user.selectOptions(screen.getByRole('combobox', { name: '状态' }), 'actioned')

    expect(await screen.findByRole('alert')).toHaveTextContent('当前筛选加载失败')
    expect(screen.queryByText('user-1@example.test')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试当前筛选' })).toBeInTheDocument()
  })

  it('reloads immediately after a concurrent 409 review conflict', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<BehaviorRiskPanel />)
    const note = await screen.findByRole('textbox', { name: '复核说明（必填，将写入审计）' })
    await user.type(note, '另一个管理员可能正在处理')
    apiJsonMock
      .mockRejectedValueOnce(new ApiErrorMock('该复核单已经处理。', 409, { error: '该复核单已经处理。' }, '/api/admin/behavior-risk'))
      .mockResolvedValueOnce(buildCasePage({ id: 'new-case', status: 'actioned', email: 'new@example.test' }))

    await user.click(screen.getByRole('button', { name: '标记误报' }))

    expect(await screen.findByText('该复核单已由其他管理员处理，列表已自动刷新。')).toBeInTheDocument()
    expect(await screen.findByText('new@example.test')).toBeInTheDocument()
  })
})

function buildCasePage(input: { id: string; status: 'pending' | 'dismissed' | 'actioned'; email: string; counts?: Record<string, number> }) {
  return {
    cases: [{
      id: input.id,
      status: input.status,
      score: 55,
      categories: ['operator_data'],
      rules: [],
      model_version: 'behavior-risk-v1.2.0',
      first_seen_at: '2026-07-25T00:00:00.000Z',
      last_seen_at: '2026-07-25T01:00:00.000Z',
      expires_at: '2026-10-23T00:00:00.000Z',
      reviewed_at: input.status === 'pending' ? null : '2026-07-25T02:00:00.000Z',
      reviewed_by: input.status === 'pending' ? null : 'reviewer',
      audits: [],
      members: [{
        user_id: `${input.id}-user`,
        account_email: input.email,
        counts: input.counts ?? {},
        first_seen_at: '2026-07-25T00:00:00.000Z',
        last_seen_at: '2026-07-25T01:00:00.000Z',
        browser_prefixes: [],
        network_prefixes: [],
        uid_prefixes: [],
        output_prefixes: [],
        profiles: [],
      }],
    }],
    pagination: { page: 1, page_size: 25, total: 1, total_pages: 1 },
    health: {
      status: 'ok',
      last_collection_at: '2026-07-25T01:00:00.000Z',
      last_collection_status: 'success',
      last_evaluation_at: '2026-07-25T02:00:00.000Z',
      last_evaluation_status: 'success',
      last_failure_at: null,
      last_failure_stage: null,
      backlog_count: 0,
      events_processed: 1,
      duration_ms: 5,
      purged_events: 0,
    },
    capabilities: ['risk_view', 'risk_review'],
  }
}
