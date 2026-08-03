// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminOptimizationDeadLetter, AdminOptimizationDeadLetterDetail } from '../contracts'

const { adminApiBlob, adminApiJson } = vi.hoisted(() => ({ adminApiBlob: vi.fn(), adminApiJson: vi.fn() }))
vi.mock('../../../lib/admin-api-client', () => ({ adminApiBlob, adminApiJson }))

import DeadLetterPanel from './DeadLetterPanel'

describe('DeadLetterPanel', () => {
  beforeEach(() => {
    adminApiJson.mockReset()
    adminApiBlob.mockReset().mockResolvedValue(new Blob(['{}'], { type: 'application/json' }))
    adminApiJson.mockImplementation(async (url: string) => {
      if (url.includes('view=dead_letter')) return { dead_letter: detail() }
      return { dead_letters: [record()] }
    })
  })

  it('shows the original configuration and operator data on demand while exposing the complete payload as a download', async () => {
    render(<DeadLetterPanel />)

    expect(await screen.findByText(/任务 job-1/)).toBeInTheDocument()
    expect(screen.queryByText('申请的基建配置')).not.toBeInTheDocument()
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:dead-letter')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    fireEvent.click(screen.getByRole('button', { name: '下载完整任务载荷 JSON' }))
    expect(adminApiBlob).toHaveBeenCalledWith(
      '/api/admin/optimization?view=dead_letter_download&id=letter-1',
      { fallbackMessage: '下载完整任务载荷失败' },
    )
    expect(await screen.findByRole('button', { name: '下载完整任务载荷 JSON' })).toBeEnabled()
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:dead-letter')

    fireEvent.click(screen.getByRole('button', { name: '查看申请配置和干员数据' }))

    expect(await screen.findByText('申请的基建配置')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: '申请的基建配置' })).getByText(/"controlCenterLevel": 5/)).toBeInTheDocument()
    const operatorSummary = screen.getByText('干员数据（1）')
    expect(operatorSummary).toBeInTheDocument()
    expect(screen.queryByText('完整任务载荷')).not.toBeInTheDocument()
    expect(within(operatorSummary.closest('details')!).getByText(/"name": "能天使"/)).toBeInTheDocument()
    expect(adminApiJson).toHaveBeenCalledWith(
      '/api/admin/optimization?view=dead_letter&id=letter-1',
      { fallbackMessage: '加载死信完整数据失败' },
    )
  })

  it('shows historical standalone suggestion dead letters as read-only audit records', async () => {
    adminApiJson.mockResolvedValue({ dead_letters: [record({ source: 'optimize_suggestions' })] })

    render(<DeadLetterPanel />)

    const readOnlyNotice = await screen.findByText('历史优化建议任务仅供审计，不可重放')
    const legacyRecord = readOnlyNotice.closest('article')!
    expect(within(legacyRecord).queryByRole('button', { name: '重放' })).not.toBeInTheDocument()
    expect(within(legacyRecord).getByRole('button', { name: '丢弃' })).toBeInTheDocument()
  })
})

function record(overrides: Partial<AdminOptimizationDeadLetter> = {}): AdminOptimizationDeadLetter {
  return {
    id: 'letter-1',
    job_id: 'job-1',
    profile_id: 'profile-1',
    source: 'account_profile',
    failure_kind: 'worker_crash',
    public_error_code: 'execution_retries_exhausted',
    internal_error_message: 'worker exited unexpectedly',
    diagnostic_json: { payload_version: 3 },
    attempt_count: 2,
    status: 'pending_review',
    replay_count: 0,
    replayed_job_id: null,
    replayed_by: null,
    replayed_at: null,
    resolution_reason: null,
    resolved_by: null,
    resolved_at: null,
    created_at: '2026-07-19T10:00:00.000Z',
    updated_at: '2026-07-19T10:00:00.000Z',
    ...overrides,
  }
}

function detail(): AdminOptimizationDeadLetterDetail {
  return {
    ...record(),
    payload_json: {
      version: 3,
      submittedAt: 1_753_002_000_000,
      effectiveConfig: { controlCenterLevel: 5, layout: '243' },
      operators: [{ name: '能天使', elite: 2, level: 90 }],
      request: { include_current: true },
    },
  }
}
